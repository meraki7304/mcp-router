# MCP Router Tauri Rewrite — Plan 9d: Runtime Completeness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land 5 runtime features that make the app feel complete: request logging from MCP runtime → DB, Tauri events for server status changes, `/health` endpoint, lazy-start on first tool call, streamable HTTP client transport for remote MCP servers.

**Architecture:** All changes are within `src-tauri/`. ServerManager gains: `set_app_handle`, internal log repository access, status-change event emission, lazy-start in Aggregator path. Aggregator extended for lazy-start. http/serve gets a real `/health` handler. Cargo adds rmcp `transport-streamable-http-client-reqwest` feature.

**Tech Stack:** No new crates; expand rmcp features only.

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md` (§6 MCP, §7 HTTP, §10 risks)

**Plan series:** Plan 9d of N. Plan 7c (per-token serverAccess ACL) skipped per user choice. Plan 10 = tray richer / deep-link / single-instance / updater.

**Out of scope for Plan 9d:**
- Per-token ACL filtering — skipped
- Smart Routing / BM25 — skipped
- OAuth / PKCE for remote auth — only static bearer token in `Server.bearer_token`
- Frontend changes for events — keep 3s polling AND add event listener (belt-and-suspenders)

---

## Tasks

### Task 1: Request logging in ServerManager.call_tool_typed

**Files:**
- Modify: `src-tauri/src/mcp/server_manager.rs`

#### Step 1: Update call_tool_typed to insert RequestLog rows

Open `src-tauri/src/mcp/server_manager.rs`. Find the existing `call_tool_typed` method (added in Plan 7b). Replace its body with this version that wraps the rmcp call in a timing/logging span:

```rust
    pub async fn call_tool_typed(
        &self,
        server_id: &str,
        tool_name: &str,
        arguments: Option<serde_json::Map<String, serde_json::Value>>,
    ) -> AppResult<rmcp::model::CallToolResult> {
        let started_at = std::time::Instant::now();
        let timestamp = chrono::Utc::now();

        // Cache server name for log row (fail open — empty if lookup errors)
        let server_name = self
            .lookup_server(server_id)
            .await
            .ok()
            .flatten()
            .map(|s| s.name);

        // Run actual rmcp call
        let result = {
            let clients = self.clients.read().await;
            let service = clients.get(server_id).ok_or_else(|| {
                AppError::NotFound(format!("server {server_id} is not running"))
            })?;
            let req = rmcp::model::CallToolRequestParams::new(tool_name)
                .with_arguments(arguments.clone());
            service
                .call_tool(req)
                .await
                .map_err(|e| AppError::Upstream(format!("call_tool {tool_name}: {e}")))
        };

        let duration_ms = started_at.elapsed().as_millis() as i64;

        // Best-effort log insert; never fail the call because logging failed
        if let Ok(pool) = self
            .registry
            .get_or_init(crate::persistence::registry::DEFAULT_WORKSPACE)
            .await
        {
            use crate::persistence::{
                repository::request_log::{
                    RequestLogRepository, SqliteRequestLogRepository,
                },
                types::request_log::NewRequestLog,
            };
            let repo = SqliteRequestLogRepository::new(pool);

            let request_params = arguments
                .as_ref()
                .map(|a| serde_json::Value::Object(a.clone().into_iter().collect()));

            let response_data = match &result {
                Ok(r) => serde_json::to_value(r).ok(),
                Err(_) => None,
            };
            let response_status = Some(
                if result.is_ok() { "ok".to_string() } else { "error".to_string() },
            );
            let error_message = result.as_ref().err().map(|e| e.to_string());

            let entry = NewRequestLog {
                timestamp,
                client_id: None,  // 9d 暂不带 token client_id；7c 接 token-aware 时再填
                client_name: None,
                server_id: Some(server_id.to_string()),
                server_name,
                request_type: Some("tools/call".to_string()),
                request_params,
                response_data,
                response_status,
                duration_ms: Some(duration_ms),
                error_message,
            };
            if let Err(e) = repo.insert(entry).await {
                tracing::warn!(?e, "failed to insert request log row");
            }
        }

        result
    }
```

#### Step 2: Verify build

```bash
cd src-tauri
cargo check
cd ..
```

#### Step 3: Commit

```bash
git add src-tauri/src/mcp/server_manager.rs
git commit -m "feat(mcp): call_tool_typed 写 request log（runtime 工具调用持久化到 logs 表）"
```

---

### Task 2: Tauri events on server status changes

**Files:**
- Modify: `src-tauri/src/mcp/server_manager.rs`
- Modify: `src-tauri/src/lib.rs` (set app handle after AppState built)
- Modify: `src/platform-api/tauri-platform-api.ts` (no-op — events flow through tauri-api直接 listen，不必经 PlatformAPI)
- Modify: `src/components/App.tsx`（添加 listen 触发 refreshServers）

#### Step 1: Add app_handle field to ServerManager

In `src-tauri/src/mcp/server_manager.rs`, replace the struct definition + impl-new:

```rust
use std::sync::OnceLock;
use tauri::AppHandle;

pub struct ServerManager {
    registry: Arc<WorkspacePoolRegistry>,
    clients: RwLock<HashMap<String, RunningService<RoleClient, ()>>>,
    app_handle: OnceLock<AppHandle>,
}

impl ServerManager {
    pub fn new(registry: Arc<WorkspacePoolRegistry>) -> Self {
        Self {
            registry,
            clients: RwLock::new(HashMap::new()),
            app_handle: OnceLock::new(),
        }
    }

    /// Setup 阶段调一次：把 AppHandle 注入进来，以便后续 emit 事件
    pub fn set_app_handle(&self, handle: AppHandle) {
        let _ = self.app_handle.set(handle);
    }

    fn emit_status_change(&self, server_id: &str, status: &ServerStatus) {
        use tauri::Emitter;
        if let Some(handle) = self.app_handle.get() {
            let payload = serde_json::json!({ "id": server_id, "status": status });
            if let Err(e) = handle.emit("server-status-changed", payload) {
                tracing::warn!(?e, "emit server-status-changed failed");
            }
        }
    }
```

(Keep all other methods; just modify struct + new + add the two methods above.)

#### Step 2: Emit on start / stop success

In `start`, after the `clients.insert(...)` line and `info!(server_id, "mcp server running")`, append:

```rust
        self.emit_status_change(server_id, &ServerStatus::Running);
```

In `stop`, inside the `Some(service)` branch after `service.cancel().await`, before `Ok(true)`:

```rust
                self.emit_status_change(server_id, &ServerStatus::Stopped);
```

#### Step 3: Wire app_handle in lib.rs setup

In `src-tauri/src/lib.rs`, find the line `handle.manage(state);` and BEFORE it add:

```rust
                state.server_manager.set_app_handle(handle.clone());
```

This must be INSIDE the `tauri::async_runtime::spawn(async move { ... })` block that constructs `state`.

#### Step 4: Add frontend listener

Open `src/components/App.tsx`. Find the existing 3-second polling effect (`setInterval(() => refreshServers ...)`) and add a tauri event listener as a sibling effect:

```tsx
  // 监听后端 server-status-changed 事件，立即刷一次（替代/补充 3 秒轮询）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("server-status-changed", () => {
          refreshServers().catch(() => {});
        });
      } catch (e) {
        console.error("listen server-status-changed failed", e);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshServers]);
```

(Place this near the existing `setInterval(...)` polling effect. Both effects coexist — events drive immediate refresh, polling is the fallback.)

#### Step 5: Verify build + smoke

```bash
cd src-tauri
cargo check
cd ..
```

#### Step 6: Commit

```bash
git add src-tauri/src/mcp/server_manager.rs src-tauri/src/lib.rs src/components/App.tsx
git commit -m "feat(events): server-status-changed 事件 — 起停后端立即推送，前端 listen 触发刷新（保留 3s 轮询兜底）"
```

---

### Task 3: /health endpoint with hub state + per-server status

**Files:**
- Modify: `src-tauri/src/http/serve.rs`

#### Step 1: Replace the placeholder /health with a structured handler

In `src-tauri/src/http/serve.rs`, find the line `.route("/health", axum::routing::get(|| async { "ok" }))` in `build_router`. Replace with:

```rust
        .route(
            "/health",
            axum::routing::get(health_handler).with_state(server_manager.clone()),
        )
```

> **Note**: `Router::route` with `.with_state(...)` may not chain the way shown in Tauri 2 axum 0.8. If compile errors, factor out: build the `/health` route on its own `Router`, merge with main router via `.merge(...)`. The agent should iterate based on actual axum signatures.

Add this handler at the bottom of `serve.rs`:

```rust
use axum::{extract::State, Json};
use serde_json::json;

async fn health_handler(
    State(server_manager): State<Arc<ServerManager>>,
) -> Json<serde_json::Value> {
    let running = server_manager.running_servers().await.unwrap_or_default();
    let mut servers = Vec::with_capacity(running.len());
    for info in running {
        let status = server_manager.status(&info.id).await;
        servers.push(json!({
            "id": info.id,
            "name": info.name,
            "status": status,
        }));
    }
    Json(json!({
        "state": "ready",
        "servers": servers,
        "running_count": servers.len(),
    }))
}
```

> If `axum::extract::State` requires the router to be generic over the state type, fall back to the simpler form: capture `server_manager` in a closure passed to `axum::routing::get`. Example:
>
> ```rust
> let sm_for_health = server_manager.clone();
> .route("/health", axum::routing::get(move || {
>     let sm = sm_for_health.clone();
>     async move {
>         let running = sm.running_servers().await.unwrap_or_default();
>         // ... build json response
>         Json(...)
>     }
> }))
> ```

Pick whichever form actually compiles; structure is the same.

#### Step 2: Verify

```bash
cd src-tauri
cargo check
cd ..
```

#### Step 3: Commit

```bash
git add src-tauri/src/http/serve.rs
git commit -m "feat(http): /health 端点返 hub state + 每台 server 名/id/状态"
```

---

### Task 4: Lazy-start on Aggregator.call_tool

**Files:**
- Modify: `src-tauri/src/mcp/server_manager.rs` (add `find_server_by_name` helper)
- Modify: `src-tauri/src/http/aggregator.rs`

#### Step 1: Add helper to ServerManager

Append (near `tool_permissions`):

```rust
    /// 按 name 查 server，找不到返回 None。给 Aggregator 懒启动用。
    pub async fn find_server_by_name(
        &self,
        name: &str,
    ) -> AppResult<Option<crate::persistence::types::server::Server>> {
        let pool = self
            .registry
            .get_or_init(crate::persistence::registry::DEFAULT_WORKSPACE)
            .await?;
        use crate::persistence::repository::server::{
            ServerRepository, SqliteServerRepository,
        };
        let repo = SqliteServerRepository::new(pool);
        repo.find_by_name(name).await
    }
```

#### Step 2: Update Aggregator.call_tool with lazy-start

In `src-tauri/src/http/aggregator.rs`, replace the `call_tool` method body with:

```rust
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let (server_name, tool_name) = request.name.split_once("__").ok_or_else(|| {
            McpError::invalid_request(
                format!(
                    "tool name '{}' is not in '<server-name>__<tool-name>' form",
                    request.name
                ),
                None,
            )
        })?;

        // 找到该 server（无论 running 还是 stopped）
        let server = self
            .server_manager
            .find_server_by_name(server_name)
            .await
            .map_err(|e| McpError::internal_error(format!("find_server_by_name: {e}"), None))?
            .ok_or_else(|| {
                McpError::invalid_request(
                    format!("server '{server_name}' not configured"),
                    None,
                )
            })?;

        if server.disabled {
            return Err(McpError::invalid_request(
                format!("server '{server_name}' is disabled"),
                None,
            ));
        }

        // 懒启动：未运行就先 start
        let status = self.server_manager.status(&server.id).await;
        if !matches!(status, crate::mcp::status::ServerStatus::Running) {
            tracing::info!(server_id = %server.id, "lazy-starting server for tool call");
            self.server_manager.start(&server.id).await.map_err(|e| {
                McpError::internal_error(format!("lazy start '{server_name}': {e}"), None)
            })?;
        }

        // 工具权限过滤
        let perms = self
            .server_manager
            .tool_permissions(&server.id)
            .await
            .unwrap_or_default();
        if matches!(perms.get(tool_name), Some(false)) {
            return Err(McpError::invalid_request(
                format!("tool '{tool_name}' is disabled on server '{server_name}'"),
                None,
            ));
        }

        self.server_manager
            .call_tool_typed(&server.id, tool_name, request.arguments)
            .await
            .map_err(|e| {
                McpError::internal_error(format!("call_tool '{tool_name}': {e}"), None)
            })
    }
```

(`list_tools` keeps the "running only" behavior — we don't lazy-start just because a client asked for the tool list.)

#### Step 3: Verify + commit

```bash
cd src-tauri
cargo check
cd ..
git add src-tauri/src/mcp/server_manager.rs src-tauri/src/http/aggregator.rs
git commit -m "feat(http): Aggregator.call_tool 懒启动 — 未运行的 server 收到调用先启动；按 name 而非 id 路由（不要求事先 running）"
```

---

### Task 5: Streamable HTTP client transport (remote MCP servers)

**Files:**
- Modify: `src-tauri/Cargo.toml` (rmcp feature)
- Modify: `src-tauri/src/mcp/server_manager.rs` (start path branches by server_type)

#### Step 1: Add rmcp feature

In `src-tauri/Cargo.toml`, find the `rmcp = { ... }` block and add `transport-streamable-http-client-reqwest` to the features:

```toml
rmcp = { version = "1.5", features = [
    "client",
    "server",
    "macros",
    "transport-child-process",
    "transport-streamable-http-server",
    "transport-streamable-http-client-reqwest",
] }
```

#### Step 2: Branch start() by server_type

Open `src-tauri/src/mcp/server_manager.rs`. Find the `start` method body and locate the section that builds `Command` + `TokioChildProcess`. Replace from the `command_str` lookup through the `()..serve(transport).await` line with this branching version:

```rust
        let service: RunningService<RoleClient, ()> = match server.server_type {
            ServerType::Local => {
                let command_str = server.command.as_deref().ok_or_else(|| {
                    AppError::InvalidInput(format!("server {server_id} has no command"))
                })?;

                let mut cmd = Command::new(command_str);
                cmd.args(&server.args);
                for (k, v) in &server.env {
                    cmd.env(k, v);
                }
                if let Some(cwd) = server.context_path.as_deref() {
                    cmd.current_dir(cwd);
                }

                info!(server_id, command = %command_str, "spawning local mcp server subprocess");

                let transport = TokioChildProcess::new(cmd).map_err(|e| {
                    AppError::Upstream(format!("spawn mcp server subprocess: {e}"))
                })?;

                ()
                    .serve(transport)
                    .await
                    .map_err(|e| AppError::Upstream(format!("rmcp serve (stdio): {e}")))?
            }
            ServerType::Remote => {
                let url = server.remote_url.as_deref().ok_or_else(|| {
                    AppError::InvalidInput(format!(
                        "remote server {server_id} has no remote_url"
                    ))
                })?;

                info!(server_id, url, "connecting to remote mcp server (streamable http)");

                use rmcp::transport::streamable_http_client::StreamableHttpClientTransport;
                let transport = StreamableHttpClientTransport::from_uri(url.to_string());

                ()
                    .serve(transport)
                    .await
                    .map_err(|e| AppError::Upstream(format!("rmcp serve (streamable http): {e}")))?
            }
        };
```

> Notes:
> - `StreamableHttpClientTransport::from_uri(String)` is the documented constructor. If rmcp 1.5 takes `&str` or `Url`, adjust.
> - **Bearer token for remote servers**: `server.bearer_token` is currently NOT injected. rmcp's transport may take auth via builder or via initial request headers; if not obvious, leave bearer_token unused in 9d and add to a follow-up task.
> - **stdio code path is byte-for-byte the same** as before; we just wrapped it in the match arm.

Remove the now-unused early bail `if !matches!(server.server_type, ServerType::Local)` if it still exists (it was added in Plan 6 to gate remote — now we handle Remote properly).

#### Step 3: Verify + smoke + tag

```bash
cd src-tauri
cargo check
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected: clean check + 120 tests passing (Plan 9d adds no new tests).

```bash
cd C:/Projects/WebstormProjects/mcp-router && pnpm tauri dev > /tmp/plan9d-smoke.log 2>&1 &
DEV_PID=$!
for i in $(seq 1 60); do
  sleep 5
  if grep -q "AppState initialized" /tmp/plan9d-smoke.log 2>/dev/null; then
    echo "READY at ~$((i*5))s"
    break
  fi
  if grep -q -E "panicked|could not compile" /tmp/plan9d-smoke.log 2>/dev/null; then
    echo "FAIL"
    break
  fi
done
grep -E "AppState initialized|MCP HTTP server" /tmp/plan9d-smoke.log
kill -9 $DEV_PID 2>/dev/null
sleep 3
ps -ef 2>/dev/null | grep -iE "tauri|cargo|mcp-router|vite" | grep -v grep | grep -v claude | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/mcp/server_manager.rs
git commit -m "feat(mcp): 远程 MCP server 走 streamable HTTP client transport（rmcp 1.5 feature 启用 + start() 按 server_type 分支）"
git tag -a tauri-plan-9d-done -m "Plan 9d (runtime completeness: logging + events + /health + lazy-start + streamable HTTP client) complete"
```

---

## Plan 9d Validation Checklist

- [ ] `cargo build` clean (rmcp's streamable-http-client-reqwest links)
- [ ] `cargo test` 120 passing
- [ ] `pnpm tauri dev` smoke shows `AppState initialized`
- [ ] `curl http://127.0.0.1:3282/health` 返 JSON 含 servers 列表
- [ ] tag `tauri-plan-9d-done` exists

## Manual smoke (post-Plan-9d)

1. 启动一台本地 MCP server，调用一个工具
2. 打开日志页 → 应看到这次调用的记录
3. 把另一台 server 配为 remote (server_type: remote, remote_url: http://...)
4. 关闭它（disabled=false 但 status=stopped）
5. 让外部 MCP 客户端调用它的工具 → 后端应自动 start，记录 lazy-start log
6. 启停按钮点击后立即更新（不等 3s 轮询）

## Notes

- **rmcp `StreamableHttpClientTransport::from_uri`** API 名/签名可能微调；agent 跟着 cargo 报错改
- **远程 server 的 bearer_token 注入**：rmcp 可能要 builder API；这次不实现，留 TODO
- **emit 用 `tauri::Emitter` trait** —— 需要 `use tauri::Emitter;` 显式
- **app_handle 用 `OnceLock`**：注入只发生一次（setup 阶段），后续读取无锁
- **Lazy-start 不递归**：只 Aggregator.call_tool 触发；list_tools 不触发
- **Per-server log 可能爆量**：MVP 版接受；将来设置项 `maxRequestLogRows` + `trim_to_max` 已存在但需要定时调用
