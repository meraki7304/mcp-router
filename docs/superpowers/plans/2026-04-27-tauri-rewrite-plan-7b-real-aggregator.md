# MCP Router Tauri Rewrite — Plan 7b: Real Aggregator + ServerManager Typed APIs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Plan 7 stub Aggregator with a real one. After Plan 7b: an external MCP client (e.g., `@modelcontextprotocol/inspector`) connecting to `http://127.0.0.1:3282/mcp` with a valid bearer token sees the merged tool list of every running MCP server (names prefixed with `<server-name>__`) and can invoke `tools/call` which routes to the right backend server.

**Architecture:** Extend `ServerManager` with three new methods that return rmcp-typed values (vs Plan 6's serde_json passthrough): `list_tools_typed`, `call_tool_typed`, `running_servers`. The Aggregator overrides `list_tools` to walk all running servers and concatenate their tools (prefix names with `<server-name>__`), and `call_tool` to parse the prefix and route. Per-token server-access ACL is **deferred** to Plan 7c — Plan 7b allows any valid token to see all tools (current Electron behavior is the same baseline).

**Tech Stack:** No new dependencies. Uses existing rmcp 1.5 (client + server features) and the Plan 6 ServerManager.

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md` §6.

**Plan series:** Plan 7b of N. **Plan 7c** = per-token `serverAccess` ACL (requires session-scoped Token threading — non-trivial because rmcp's `RequestContext` doesn't expose axum request extensions). **Plan 8c** = MCPCallNode in WorkflowExecutor (uses `call_tool_typed` from this plan). **Plan 9** = frontend integration.

**Out of scope for Plan 7b:**
- Per-token ACL (Plan 7c — needs LocalSessionManager extension or similar)
- CORS (Plan 7c — only matters when browser clients connect)
- Configurable HTTP port (still hardcoded 3282)
- Notification streaming (`tools/list_changed` etc.) when server set changes mid-session
- MCPCallNode wiring (Plan 8c uses these new typed methods)

---

## Naming convention: `<server-name>__<tool-name>`

When the Aggregator merges tools from multiple servers, names need to be unique. Plan 7b uses **double-underscore as separator**:
- Backend server `fetch` exposes `get` → aggregator exposes `fetch__get`
- Backend server `database` exposes `query` → aggregator exposes `database__query`

**Constraints:**
- Server `name` must not contain `__`. We don't enforce in DB; if it does, calls to that server's tools error out (`invalid tool name format`). Document for now; enforce in Plan 9 frontend.
- If two servers share a name (which shouldn't happen — server names are unique-by-convention but Plan 3's schema doesn't enforce), only the first wins. Document.

`call_tool` parses by `name.split_once("__")` → `(server_name, tool_name)`.

---

## File Structure (state at end of Plan 7b)

```
src-tauri/src/
├── mcp/
│   ├── mod.rs                          # MODIFIED: re-export RunningServerInfo
│   ├── status.rs                       # unchanged
│   └── server_manager.rs               # MODIFIED: add list_tools_typed / call_tool_typed / running_servers
└── http/
    └── aggregator.rs                   # MODIFIED: real list_tools + call_tool
src-tauri/tests/
└── server_manager_test.rs              # MODIFIED: add NotFound-shape tests for new methods
```

No new files. Three existing files modified.

---

## Plan 1-8b lessons learned (apply preemptively)

1. `rmcp::model::Tool` is `#[non_exhaustive]` — can't construct via struct literal, but **field-by-field mutation IS allowed** (only construction + exhaustive match are blocked). We mutate `tool.name = Cow::Owned(...)`.
2. `rmcp::model::CallToolRequestParams` (plural) was Plan 7's correction — same here.
3. `RunningService` derefs to `Peer<RoleClient>` — has `list_all_tools` and `call_tool` directly.
4. `McpError::invalid_request(message, data: Option<...>)` and `McpError::internal_error(message, data)` — both take 2 args. Cargo build will tell you if signatures shifted in this rmcp version.
5. ts-rs auto-export tests counted in cargo test. Plan 7b adds NO ts-rs types; count grows only with new integration tests (4 new ServerManager NotFound tests).

---

## Prerequisites

- [ ] Plan 8b complete (`tauri-plan-8b-done` tag exists)
- [ ] On branch `tauri-rewrite`, working tree clean
- [ ] `cargo test` reports 116 tests passing

---

## Tasks

### Task 1: ServerManager typed API extensions (TDD)

**Files:**
- Modify: `src-tauri/src/mcp/server_manager.rs` (add 3 methods + helper struct)
- Modify: `src-tauri/src/mcp/mod.rs` (re-export RunningServerInfo)
- Modify: `src-tauri/tests/server_manager_test.rs` (4 new NotFound-shape tests)

#### Step 1: Add new types + methods to server_manager.rs

Open `src-tauri/src/mcp/server_manager.rs`. The current file (post-Plan-6) has `ServerManager` with `start`, `stop`, `status`, `list_tools` (returns `Vec<serde_json::Value>`), and `lookup_server` helper.

**Add** the following near the top of the file, after the existing `use` block:

```rust
/// Lightweight info about a server that's currently running. Returned by `running_servers()`
/// for Aggregator consumption (avoids cloning the full Server config).
#[derive(Debug, Clone)]
pub struct RunningServerInfo {
    pub id: String,
    pub name: String,
}
```

**Add** these three methods to `impl ServerManager` (place them after the existing `list_tools`):

```rust
    /// Return the (id, name) of every server currently running. Useful for the Aggregator
    /// to enumerate tools across servers. Names are looked up from the DB per call —
    /// not cached, since the user may rename a server while it's running (rare but possible).
    pub async fn running_servers(&self) -> AppResult<Vec<RunningServerInfo>> {
        let ids: Vec<String> = {
            let clients = self.clients.read().await;
            clients.keys().cloned().collect()
        };
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(server) = self.lookup_server(&id).await? {
                out.push(RunningServerInfo {
                    id: server.id,
                    name: server.name,
                });
            }
            // If lookup_server returns None, the server config was deleted while running.
            // Skip silently — the entry will be cleaned up on next stop.
        }
        Ok(out)
    }

    /// Returns the typed tool list for a running server. Plan 7b's Aggregator uses this to
    /// merge tools across servers without paying for serde_json round-trips.
    pub async fn list_tools_typed(&self, server_id: &str) -> AppResult<Vec<rmcp::model::Tool>> {
        let clients = self.clients.read().await;
        let service = clients.get(server_id).ok_or_else(|| {
            AppError::NotFound(format!("server {server_id} is not running"))
        })?;

        service
            .list_all_tools()
            .await
            .map_err(|e| AppError::Upstream(format!("list_all_tools: {e}")))
    }

    /// Call a tool on a running server. Returns the rmcp `CallToolResult` directly.
    pub async fn call_tool_typed(
        &self,
        server_id: &str,
        tool_name: &str,
        arguments: Option<serde_json::Map<String, serde_json::Value>>,
    ) -> AppResult<rmcp::model::CallToolResult> {
        let clients = self.clients.read().await;
        let service = clients.get(server_id).ok_or_else(|| {
            AppError::NotFound(format!("server {server_id} is not running"))
        })?;

        let req = rmcp::model::CallToolRequestParams {
            name: tool_name.into(),
            arguments,
        };

        service
            .call_tool(req)
            .await
            .map_err(|e| AppError::Upstream(format!("call_tool {tool_name}: {e}")))
    }
```

> Notes:
> - All three methods take `&self` and use `self.clients.read().await` — concurrent calls are fine.
> - `service.call_tool(req).await` is on `Peer<RoleClient>` (RunningService derefs to it).
> - If `CallToolRequestParams` field is named differently in rmcp 1.5 (e.g., `arguments_json` or wrapped in another type), adjust to match. Plan 7's agent verified this struct exists; Plan 7b should accept whatever cargo build says.
> - We don't expose `meta` / `progress_token` etc. — Plan 7b passes `None`. Plan 7c can extend.

#### Step 2: Re-export from mcp/mod.rs

Open `src-tauri/src/mcp/mod.rs`. The current content is:

```rust
pub mod server_manager;
pub mod status;
```

No changes needed — `RunningServerInfo` is reachable as `crate::mcp::server_manager::RunningServerInfo` already.

#### Step 3: Add tests for new methods

Open `src-tauri/tests/server_manager_test.rs`. The current file (post-Plan-6) has 4 tests using `make_manager()`. **Append** these 4 tests at the bottom:

```rust
#[tokio::test]
async fn list_tools_typed_errors_when_not_running() {
    let (_tmp, mgr) = make_manager();
    let result = mgr.list_tools_typed("missing").await;
    assert!(matches!(
        result,
        Err(mcp_router_lib::error::AppError::NotFound(_))
    ));
}

#[tokio::test]
async fn call_tool_typed_errors_when_not_running() {
    let (_tmp, mgr) = make_manager();
    let result = mgr.call_tool_typed("missing", "any", None).await;
    assert!(matches!(
        result,
        Err(mcp_router_lib::error::AppError::NotFound(_))
    ));
}

#[tokio::test]
async fn running_servers_returns_empty_when_none_running() {
    let (_tmp, mgr) = make_manager();
    let infos = mgr.running_servers().await.expect("running_servers");
    assert!(infos.is_empty());
}

#[tokio::test]
async fn running_servers_returns_app_result_ok_after_pool_init() {
    // Sanity: the registry pool init (which happens lazily inside running_servers) doesn't error
    // when there are no running servers.
    let (_tmp, mgr) = make_manager();
    let result = mgr.running_servers().await;
    assert!(result.is_ok(), "expected Ok, got {:?}", result);
}
```

(The fourth test is intentionally similar to the third — it's a slightly different framing that documents intent for future readers. If you find this redundant, drop it.)

#### Step 4: cargo check + cargo test

```bash
cd src-tauri
cargo check
cargo test --test server_manager_test
cd ..
```

Expected: cargo check clean. server_manager_test reports 8 PASS (4 from Plan 6 + 4 new).

If `service.call_tool(req)` doesn't compile (signature differs), check `https://docs.rs/rmcp/latest/rmcp/service/struct.Peer.html` for the actual signature — it might be `peer.call_tool(req)` via deref, or might take `&Self` instead of `&mut`.

#### Step 5: Run all tests

```bash
cd src-tauri
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected total: 116 + 4 = **120 tests passing**.

#### Step 6: Commit

```bash
git add src-tauri/src/mcp/server_manager.rs src-tauri/tests/server_manager_test.rs
git commit -m "feat(mcp): ServerManager 类型化 API (running_servers / list_tools_typed / call_tool_typed) + 4 测试"
```

---

### Task 2: Real Aggregator + smoke + tag

**Files:**
- Modify: `src-tauri/src/http/aggregator.rs` (replace stub `list_tools` and `call_tool`)

#### Step 1: Replace aggregator.rs

Open `src-tauri/src/http/aggregator.rs`. Replace the entire file with:

```rust
use std::sync::Arc;

use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, Implementation, ListToolsResult,
        PaginatedRequestParams, ProtocolVersion, ServerCapabilities, ServerInfo,
    },
    service::RequestContext,
    ErrorData as McpError, RoleServer,
};

use crate::{
    mcp::server_manager::ServerManager,
    shared_config::store::SharedConfigStore,
};

/// MCP server that aggregates tools from all servers managed by `ServerManager`.
///
/// Plan 7b: real aggregation. `list_tools` walks every running server and merges their
/// tools, prefixing names with `<server-name>__`. `call_tool` parses the prefix and
/// routes to the right backend server.
///
/// Per-token ACL (filtering by `Token.serverAccess`) is deferred to Plan 7c.
#[derive(Clone)]
pub struct Aggregator {
    pub server_manager: Arc<ServerManager>,
    #[allow(dead_code)] // used in Plan 7c for per-token ACL
    pub shared_config: Arc<SharedConfigStore>,
}

impl Aggregator {
    pub fn new(
        server_manager: Arc<ServerManager>,
        shared_config: Arc<SharedConfigStore>,
    ) -> Self {
        Self {
            server_manager,
            shared_config,
        }
    }
}

impl ServerHandler for Aggregator {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::default()
            .with_protocol_version(ProtocolVersion::V_2025_03_26)
            .with_capabilities(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new("mcp-router-aggregator", env!("CARGO_PKG_VERSION"))
                    .with_title("MCP Router"),
            )
            .with_instructions(
                "MCP Router aggregates tools across configured local servers. \
                 Tool names are prefixed with `<server-name>__` so callers can identify the \
                 backing server. Plan 7c will add per-token server-access filtering.",
            )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let running = self
            .server_manager
            .running_servers()
            .await
            .map_err(|e| McpError::internal_error(format!("running_servers: {e}"), None))?;

        let mut all = Vec::new();
        for info in running {
            // Per-server failures don't kill the whole list — log + skip.
            let tools = match self.server_manager.list_tools_typed(&info.id).await {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!(server_id = %info.id, error = %e, "list_tools_typed failed; skipping server");
                    continue;
                }
            };
            for mut tool in tools {
                tool.name = std::borrow::Cow::Owned(format!("{}__{}", info.name, tool.name));
                all.push(tool);
            }
        }

        Ok(ListToolsResult::with_all_items(all))
    }

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

        let running = self
            .server_manager
            .running_servers()
            .await
            .map_err(|e| McpError::internal_error(format!("running_servers: {e}"), None))?;

        let info = running
            .iter()
            .find(|i| i.name == server_name)
            .ok_or_else(|| {
                McpError::invalid_request(
                    format!("server '{server_name}' is not running"),
                    None,
                )
            })?;

        self.server_manager
            .call_tool_typed(&info.id, tool_name, request.arguments)
            .await
            .map_err(|e| {
                McpError::internal_error(format!("call_tool '{tool_name}': {e}"), None)
            })
    }
}
```

> Notes:
> - `ServerInfo::default()` + builder methods is the `#[non_exhaustive]`-friendly construction approach Plan 7's agent discovered.
> - `Implementation::new(name, version).with_title(...)` similarly avoids struct-literal.
> - `ListToolsResult::with_all_items(all)` is rmcp's helper to construct from a Vec.
> - Per-server failure handling: if one server crashes / disconnects mid-flight, we log and skip its tools rather than failing the whole list — clients see a smaller list, but other servers stay accessible.

#### Step 2: cargo check + cargo test

```bash
cd src-tauri
cargo check
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected: clean check; 120 tests passing (no test changes in Task 2).

If `Implementation::new` doesn't exist or takes different args, check rmcp 1.5 docs and adjust. Same for `ServerInfo::default().with_*`. The structural intent is right; literal method names may differ slightly.

#### Step 3: Smoke run

```bash
cd C:/Projects/WebstormProjects/mcp-router && pnpm tauri dev > /tmp/plan7b-smoke.log 2>&1 &
DEV_PID=$!

for i in $(seq 1 60); do
  sleep 5
  if grep -q "AppState initialized" /tmp/plan7b-smoke.log 2>/dev/null; then
    echo "READY at ~$((i*5))s"
    break
  fi
  if grep -q -E "error\[|^error:|panicked|could not compile" /tmp/plan7b-smoke.log 2>/dev/null; then
    echo "FAIL"
    break
  fi
done

grep -E "AppState initialized|MCP HTTP server" /tmp/plan7b-smoke.log

kill -9 $DEV_PID 2>/dev/null
sleep 3
ps -ef 2>/dev/null | grep -iE "tauri|cargo|mcp-router|vite" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

Expected: `MCP HTTP server listening` + `AppState initialized` lines. If the user's Electron MCP Router is running on 3282, the bind fails — the smoke still passes the AppState init check.

#### Step 4: Commit + tag

```bash
git add src-tauri/src/http/aggregator.rs
git commit -m "feat(http): Aggregator 实装聚合 (list_tools 跨服务器+前缀；call_tool 按前缀路由)"
git tag -a tauri-plan-7b-done -m "Plan 7b (real aggregator with cross-server tool merge) complete"
```

#### Step 5: Show summary

```bash
git log --oneline tauri-plan-8b-done..HEAD
```

Expected: ~3 commits since Plan 8b (1 plan doc + 1 server_manager + 1 aggregator).

---

## Plan 7b Validation Checklist

- [ ] `cargo test` reports 120 tests passing (116 baseline + 4 new ServerManager NotFound tests)
- [ ] `pnpm tauri dev` smoke shows `AppState initialized` (HTTP bind may fail on user's Electron — OK)
- [ ] `tauri::generate_handler![...]` count unchanged (43)
- [ ] tag `tauri-plan-7b-done` exists

---

## Manual smoke (optional, post-Plan-7b)

To exercise real aggregation end-to-end (requires user closing the Electron MCP Router so port 3282 is free):

1. With `pnpm tauri dev` running, open DevTools console.
2. Save a token + start a real server:
   ```js
   const { invoke } = window.__TAURI__.core;
   await invoke("tokens_save", {
     token: { id: "t1", clientId: "smoke", issuedAt: Date.now(), serverAccess: {} }
   });
   await invoke("servers_create", {
     input: {
       name: "everything",
       serverType: "local",
       command: "npx",
       args: ["-y", "@modelcontextprotocol/server-everything"],
       env: {},
       autoStart: false,
       disabled: false,
       inputParams: {},
       requiredParams: [],
       toolPermissions: {}
     }
   });
   const all = await invoke("servers_list");
   const id = all[0].id;
   await invoke("servers_start", { id });
   ```
3. From a terminal:
   ```bash
   npx @modelcontextprotocol/inspector --uri http://127.0.0.1:3282/mcp \
     --header "Authorization: Bearer t1"
   ```
4. Expected: Inspector shows tools `everything__add`, `everything__echo`, etc. — server-everything's tools prefixed with the server name.
5. Calling `everything__echo` from the inspector should round-trip.

---

## Notes for the Engineer Executing This Plan

- **rmcp model field/method names may shift slightly between 1.5 patch versions**. Plan 7's agent fixed `CallToolRequestParam` → `CallToolRequestParams` (plural). Cargo build is the source of truth.
- **`#[non_exhaustive]` allows field mutation** — `tool.name = Cow::Owned(...)` works. The annotation only blocks construction via struct literal and exhaustive match.
- **Per-server failure isolation** in `list_tools`: if a backend server crashes during the call, we `tracing::warn!` and skip — the rest of the list still flows.
- **No tests for the actual rmcp protocol path** — same as Plan 6/7. Manual smoke is the validation.
- **Per-token ACL (`token.serverAccess`) is intentionally deferred to Plan 7c**. Plan 7b allows any valid bearer token to see all tools. This matches the Electron baseline.
- **Don't try to enforce `__` not in server names** in Plan 7b — schema doesn't enforce, no consumer checks. Plan 9 frontend can validate at create-time.
