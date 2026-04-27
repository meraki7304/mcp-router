# MCP Router Tauri Rewrite — Plan 7: HTTP Server (axum :3282 with bearer-token auth)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an `axum`-backed HTTP server on `127.0.0.1:3282` that implements the streamable-HTTP MCP transport via `rmcp`'s `StreamableHttpService`. Add `Authorization: Bearer <token-id>` middleware that validates tokens against `SharedConfigStore`. The aggregator returned to clients is intentionally a STUB (empty tool list) — Plan 7b wires real aggregation from `ServerManager`.

**Architecture:** New module `src-tauri/src/http/`. `Aggregator` implements `rmcp::handler::server::ServerHandler` with overridden `get_info`, `list_tools` (returns empty), `call_tool` (returns error). `auth.rs` provides an axum `middleware::from_fn_with_state` that reads bearer token, looks up in `SharedConfigStore`, rejects 401 on miss. `serve.rs` builds the `axum::Router` (`/mcp` mounted with `StreamableHttpService`, auth middleware applied), binds a `tokio::net::TcpListener` on 127.0.0.1:3282, runs `axum::serve(listener, router)` as a background tokio task spawned in `lib.rs` setup.

**Tech Stack:** Adds `axum = "0.8"`, `tower-http = { version = "0.6", features = ["cors", "trace"] }`. rmcp gets new features `server`, `macros`, `transport-streamable-http-server`. Plus `reqwest = "0.12"` (dev-only, for the auth middleware oneshot test).

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md` §7 (HTTP module).

**Plan series:** Plan 7 of N. Plan 7b: real aggregator that pulls tools/list from each connected MCP server in `ServerManager` and routes `tools/call` by name prefix; plus settings-driven port (instead of hardcoded 3282); plus CORS allow-list. Plan 8 = workflow executor + rquickjs.

**Out of scope for Plan 7:**
- Real tool aggregation (Plan 7b — aggregator returns empty list here)
- `tools/call` routing (Plan 7b)
- Per-token server-access ACL (Plan 7b — Plan 7 just verifies token EXISTS)
- Configurable port (hardcoded 3282)
- CORS (Plan 7b)
- HTTPS / cert (`127.0.0.1` only; never exposed externally)
- `mcp-router-project-id` header routing (Plan 7b when projects come into play)

---

## What rmcp 1.5 server-side gives us (verified against shuttle.dev tutorial + docs.rs)

```rust
use rmcp::{
    handler::server::ServerHandler,
    model::{
        Implementation, ProtocolVersion, ServerCapabilities, ServerInfo,
    },
    transport::streamable_http_server::{
        session::local::LocalSessionManager,
        StreamableHttpService,
    },
};
use std::sync::Arc;

#[derive(Clone)]
struct MyServer { /* ... */ }

impl ServerHandler for MyServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2025_03_26,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "mcp-router-aggregator".into(),
                version: "1.1.0".into(),
                title: None,
                website_url: None,
                icons: None,
            },
            instructions: None,
        }
    }
    // list_tools / call_tool overrides go here
}

let svc = StreamableHttpService::new(
    || Ok(MyServer { /* per-session state */ }),  // factory: Fn() -> Result<Self, ...>
    LocalSessionManager::default().into(),         // Arc<dyn SessionManager>
    Default::default(),                             // StreamableHttpServerConfig
);
let router = axum::Router::new().nest_service("/mcp", svc);
axum::serve(listener, router).await?;
```

Key facts for Plan 7:
- `ServerHandler` is NOT dyn-compatible (no `Arc<dyn ServerHandler>`). The factory closure produces a fresh concrete instance per session, so per-session state lives in the struct.
- All 26 trait methods have default impls — we override only `get_info`, `list_tools`, `call_tool`.
- `LocalSessionManager` keeps sessions in-memory; sufficient for our local-only HTTP.
- `ProtocolVersion::V_2025_03_26` is the stable MCP spec. If rmcp 1.5 has bumped this constant, use whatever the current `ProtocolVersion::V_*` is — the agent should verify if cargo check fails on this.

---

## File Structure (state at end of Plan 7)

```
src-tauri/
├── Cargo.toml                  # MODIFIED: add axum, tower-http; expand rmcp features
├── src/
│   ├── http/                   # NEW module
│   │   ├── mod.rs              # NEW
│   │   ├── aggregator.rs       # NEW (stub ServerHandler)
│   │   ├── auth.rs             # NEW (token middleware)
│   │   └── serve.rs            # NEW (router builder + listener bind)
│   ├── state.rs                # unchanged
│   └── lib.rs                  # MODIFIED: spawn HTTP server task in setup
└── tests/
    └── http_auth_test.rs       # NEW (axum oneshot tests for auth middleware)
```

---

## Plan 1-6 lessons learned (apply preemptively)

1. `tokio::sync::RwLock` (not std).
2. `From<sqlx::Error> for AppError` propagates SQL errors via `?`.
3. ts-rs auto-export tests run inside `cargo test`.
4. Don't try to derive ts-rs on rmcp types (`#[non_exhaustive]`); pass through serde_json::Value.
5. rmcp's `ServerHandler` requires `Sized + Send + Sync + 'static` + `Clone` (because `StreamableHttpService` clones it per session).
6. axum 0.8 uses `tokio::net::TcpListener::bind` + `axum::serve(listener, router)` — NOT the older `axum::Server::bind`.

---

## Prerequisites

- [ ] Plan 6 complete (`tauri-plan-6-done` tag exists)
- [ ] On branch `tauri-rewrite`, working tree clean
- [ ] `cargo test` reports 101 tests passing
- [ ] No leftover dev/cargo processes; port 3282 not held by an orphan

---

## Tasks

### Task 1: Add deps + verify build

**Files:**
- Modify: `src-tauri/Cargo.toml`

#### Step 1: Update Cargo.toml

Open `src-tauri/Cargo.toml`. In `[dependencies]`:

**Replace** the existing rmcp line with the expanded-feature version:

```toml
rmcp = { version = "1.5", features = [
    "client",
    "server",
    "macros",
    "transport-child-process",
    "transport-streamable-http-server",
] }
```

**Add** alphabetically:

```toml
axum = "0.8"
tower-http = { version = "0.6", features = ["trace"] }
```

In `[dev-dependencies]` add:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
tower = { version = "0.5", features = ["util"] }
http-body-util = "0.1"
```

(`tower::ServiceExt::oneshot` is needed for the auth middleware test.)

#### Step 2: cargo build

```bash
cd src-tauri
cargo build
cd ..
```

Expected: success. First build downloads axum + tower-http + rmcp's server features. Several minutes possible.

If a feature flag conflicts (e.g., rmcp 1.5 renamed `transport-streamable-http-server`), use WebFetch to confirm against `https://docs.rs/rmcp/latest/rmcp/transport/index.html` and adjust. Pin a specific 1.5.x version if needed.

#### Step 3: Commit

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(rust): 加 axum 0.8 + tower-http；扩展 rmcp 服务端 features"
```

---

### Task 2: Aggregator skeleton (ServerHandler stub)

**Files:**
- Create: `src-tauri/src/http/mod.rs`
- Create: `src-tauri/src/http/aggregator.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod http;`)

#### Step 1: Create http/mod.rs

```rust
pub mod aggregator;
pub mod auth;
pub mod serve;
```

(Note: `auth` and `serve` don't exist yet. Same approach as Plan 4 — the agent shouldn't commit until all three files exist, OR commit Task 2 with mod.rs containing only `pub mod aggregator;` and append the others in Tasks 3-4. **Simpler**: just declare aggregator only here; append `auth` in Task 3 and `serve` in Task 4. Use this Step 1 instead:)

```rust
pub mod aggregator;
```

#### Step 2: Create http/aggregator.rs

```rust
use std::sync::Arc;

use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParam, CallToolResult, Implementation, ListToolsResult,
        PaginatedRequestParam, ProtocolVersion, ServerCapabilities, ServerInfo,
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
/// Plan 7 ships a stub: `list_tools` returns empty, `call_tool` errors. Plan 7b wires real aggregation.
#[derive(Clone)]
pub struct Aggregator {
    #[allow(dead_code)] // used in Plan 7b
    pub server_manager: Arc<ServerManager>,
    #[allow(dead_code)] // available for future per-aggregation telemetry
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
        ServerInfo {
            protocol_version: ProtocolVersion::V_2025_03_26,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "mcp-router-aggregator".into(),
                version: env!("CARGO_PKG_VERSION").into(),
                title: Some("MCP Router".into()),
                website_url: None,
                icons: None,
            },
            instructions: Some(
                "MCP Router aggregates tools across configured servers. \
                 Plan 7 ships a stub (no tools); Plan 7b wires real aggregation."
                    .into(),
            ),
        }
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        // Plan 7b: collect tools from each running ServerManager client and prefix names.
        Ok(ListToolsResult {
            tools: vec![],
            next_cursor: None,
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        Err(McpError::invalid_request(
            format!(
                "tool '{}' not found — Plan 7 aggregator is a stub (Plan 7b adds routing)",
                request.name
            ),
            None,
        ))
    }
}
```

> Notes:
> - If `ListToolsResult { tools, next_cursor }` doesn't match rmcp 1.5's exact field names (e.g., it uses `tools: Vec<Tool>, next_cursor: Option<String>`), the agent verifies via `cargo build` and fixes the literal. Same for `CallToolResult` and `McpError::invalid_request`.
> - `env!("CARGO_PKG_VERSION")` reads the Cargo.toml version at build time — avoids hard-coding "1.1.0" twice.
> - `Aggregator` is `Clone` so `StreamableHttpService` can clone it per session.

#### Step 3: Wire in lib.rs

Open `src-tauri/src/lib.rs`. Append to the top-level `pub mod` declarations:

```rust
pub mod http;
```

(Place alphabetically — between `error` and `mcp`.)

#### Step 4: Verify build

```bash
cd src-tauri
cargo check
cd ..
```

Expected: clean. If `ProtocolVersion::V_2025_03_26` doesn't exist (rmcp may have rolled forward), check `https://docs.rs/rmcp/latest/rmcp/model/enum.ProtocolVersion.html` for the current variant and substitute.

#### Step 5: Commit

```bash
git add src-tauri/src/http src-tauri/src/lib.rs
git commit -m "feat(http): Aggregator stub (ServerHandler 返回空 tool list；Plan 7b 接入真实聚合)"
```

---

### Task 3: Auth middleware + oneshot test

**Files:**
- Create: `src-tauri/src/http/auth.rs`
- Modify: `src-tauri/src/http/mod.rs` (add `pub mod auth;`)
- Create: `src-tauri/tests/http_auth_test.rs`

#### Step 1: Create http/auth.rs

```rust
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};

use crate::shared_config::store::SharedConfigStore;

/// State the middleware closes over.
#[derive(Clone)]
pub struct AuthState {
    pub shared_config: Arc<SharedConfigStore>,
}

/// axum middleware: requires `Authorization: Bearer <token-id>`. Looks up the token in
/// `SharedConfigStore`. On miss returns 401. On hit, attaches the `Token` to request extensions
/// so downstream handlers can read it (Plan 7b uses this for per-token server-access ACL).
pub async fn require_bearer_token(
    State(state): State<AuthState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token_id = match auth_header.and_then(|s| s.strip_prefix("Bearer ")) {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => return Err(StatusCode::UNAUTHORIZED),
    };

    let token = match state.shared_config.get_token(&token_id).await {
        Some(t) => t,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    req.extensions_mut().insert(token);
    Ok(next.run(req).await)
}

/// Helper for unauthorized responses with a JSON body — useful when middleware returns 401 from
/// inside a handler instead of via Result. Not used directly by `require_bearer_token` but exposed
/// here for Plan 7b's per-server-access ACL.
#[allow(dead_code)]
pub fn unauthorized_json(message: &str) -> Response {
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!(r#"{{"error":"{}"}}"#, message)))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}
```

#### Step 2: Update http/mod.rs

Append:

```rust
pub mod auth;
```

#### Step 3: Create tests/http_auth_test.rs

```rust
use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
    middleware,
    routing::get,
    Router,
};
use http_body_util::BodyExt;
use tower::ServiceExt;

use mcp_router_lib::{
    http::auth::{require_bearer_token, AuthState},
    shared_config::{store::SharedConfigStore, types::Token},
};

async fn make_router() -> (tempfile::TempDir, Router, Arc<SharedConfigStore>) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let store = SharedConfigStore::open(tmp.path().join("shared-config.json"))
        .await
        .expect("open store");
    let store_arc = Arc::new(store);

    let auth_state = AuthState {
        shared_config: store_arc.clone(),
    };

    let app = Router::new()
        .route("/protected", get(|| async { "ok" }))
        .layer(middleware::from_fn_with_state(
            auth_state,
            require_bearer_token,
        ));

    (tmp, app, store_arc)
}

#[tokio::test]
async fn missing_authorization_header_returns_401() {
    let (_tmp, app, _) = make_router().await;
    let response = app
        .oneshot(Request::builder().uri("/protected").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn malformed_bearer_returns_401() {
    let (_tmp, app, _) = make_router().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/protected")
                .header("Authorization", "NotBearer x")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unknown_bearer_token_returns_401() {
    let (_tmp, app, _) = make_router().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/protected")
                .header("Authorization", "Bearer not-a-real-token-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn valid_bearer_token_passes_through() {
    let (_tmp, app, store) = make_router().await;
    let token = Token {
        id: "tok-abc".into(),
        client_id: "client-x".into(),
        issued_at: 1_714_000_000_000,
        server_access: HashMap::new(),
    };
    store.save_token(token).await.expect("save");

    let response = app
        .oneshot(
            Request::builder()
                .uri("/protected")
                .header("Authorization", "Bearer tok-abc")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], b"ok");
}
```

#### Step 4: Run tests

```bash
cd src-tauri
cargo test --test http_auth_test
cd ..
```

Expected: PASS (4 tests).

If `tower::ServiceExt::oneshot` isn't available, check the `tower` features (need `"util"`).

#### Step 5: Run all tests

```bash
cd src-tauri
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected total: 101 + 4 = **105 tests passing**.

#### Step 6: Commit

```bash
git add src-tauri/src/http/auth.rs src-tauri/src/http/mod.rs src-tauri/tests/http_auth_test.rs
git commit -m "feat(http): bearer-token auth middleware (查 SharedConfigStore) + 4 个 oneshot 测试"
```

---

### Task 4: HTTP server bind + spawn in lib.rs setup + smoke + tag

**Files:**
- Create: `src-tauri/src/http/serve.rs`
- Modify: `src-tauri/src/http/mod.rs` (add `pub mod serve;`)
- Modify: `src-tauri/src/lib.rs` (spawn HTTP server task in setup)

#### Step 1: Create http/serve.rs

```rust
use std::{net::SocketAddr, sync::Arc};

use axum::{middleware, Router};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpService,
};
use tokio::net::TcpListener;
use tracing::{error, info};

use crate::{
    error::{AppError, AppResult},
    http::{
        aggregator::Aggregator,
        auth::{require_bearer_token, AuthState},
    },
    mcp::server_manager::ServerManager,
    shared_config::store::SharedConfigStore,
};

pub const HTTP_BIND_ADDR: &str = "127.0.0.1:3282";

/// Build the axum router with `/mcp` mounted (auth-required) and a permissive `/health` endpoint.
pub fn build_router(
    server_manager: Arc<ServerManager>,
    shared_config: Arc<SharedConfigStore>,
) -> Router {
    let server_manager_for_factory = server_manager.clone();
    let shared_config_for_factory = shared_config.clone();

    let mcp_service = StreamableHttpService::new(
        move || {
            Ok(Aggregator::new(
                server_manager_for_factory.clone(),
                shared_config_for_factory.clone(),
            ))
        },
        LocalSessionManager::default().into(),
        Default::default(),
    );

    let auth_state = AuthState {
        shared_config: shared_config.clone(),
    };

    Router::new()
        .route("/health", axum::routing::get(|| async { "ok" }))
        .nest_service(
            "/mcp",
            tower::ServiceBuilder::new()
                .layer(middleware::from_fn_with_state(
                    auth_state,
                    require_bearer_token,
                ))
                .service(mcp_service),
        )
}

/// Spawn the HTTP server on `127.0.0.1:3282` as a tokio task. Returns immediately after binding.
/// Errors during request handling are logged via `tracing::error`; the task runs forever.
pub async fn spawn_http_server(
    server_manager: Arc<ServerManager>,
    shared_config: Arc<SharedConfigStore>,
) -> AppResult<()> {
    let addr: SocketAddr = HTTP_BIND_ADDR.parse().map_err(|e| {
        AppError::Internal(format!("parse bind addr {HTTP_BIND_ADDR}: {e}"))
    })?;

    let listener = TcpListener::bind(addr).await.map_err(|e| {
        AppError::Internal(format!("bind {HTTP_BIND_ADDR}: {e}"))
    })?;
    info!(addr = %addr, "MCP HTTP server listening");

    let router = build_router(server_manager, shared_config);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            error!(error = %e, "MCP HTTP server stopped");
        }
    });

    Ok(())
}
```

> Notes:
> - `nest_service("/mcp", ...)` mounts the rmcp service. The `tower::ServiceBuilder` chains the auth middleware in front of the rmcp service. If middleware-on-nested-service has compile issues with axum 0.8, fall back to using `Router::new().route("/mcp/{*path}", ...)` with the middleware on the route directly. The agent should iterate via cargo check.
> - `LocalSessionManager::default().into()` produces an `Arc<dyn SessionManager>` (the conversion is provided by rmcp).
> - `tokio::spawn` returns a `JoinHandle` we drop — the server runs forever. Plan 7b can introduce graceful shutdown via a `CancellationToken`.

#### Step 2: Update http/mod.rs

Append:

```rust
pub mod serve;
```

Final mod.rs:

```rust
pub mod aggregator;
pub mod auth;
pub mod serve;
```

#### Step 3: Update lib.rs setup

Open `src-tauri/src/lib.rs`. Add to the `use crate::{ ... }` block:

```rust
    http::serve::spawn_http_server,
```

(Place inside the `crate::{ ... }` braces alphabetically.)

In the setup closure body, AFTER `handle.manage(state);` and BEFORE the `info!("AppState initialized ...")` line, insert the HTTP server spawn:

```rust
                let state = AppState::new(registry, shared_config, server_manager);

                // Spawn the HTTP server BEFORE manage so we can use the components.
                let server_manager_arc = state.server_manager.clone();
                let shared_config_arc = state.shared_config.clone();
                if let Err(err) = spawn_http_server(server_manager_arc, shared_config_arc).await {
                    error!(?err, "failed to spawn MCP HTTP server (continuing without it)");
                }

                handle.manage(state);
                info!("AppState initialized (registry + shared_config + server_manager seeded; HTTP server on 127.0.0.1:3282)");
```

> Notes:
> - We spawn the HTTP server FROM the same async task that constructed AppState, so the server lifecycle is bound to the app process. If the spawn fails (e.g., port 3282 already taken), we log and continue — the rest of the app still works.
> - The clones go through `state.server_manager.clone()` — `Arc::clone` is cheap.

#### Step 4: cargo check + cargo test

```bash
cd src-tauri
cargo check
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected: cargo check clean, 105 tests passing.

#### Step 5: Smoke run pnpm tauri dev

```bash
cd C:/Projects/WebstormProjects/mcp-router && pnpm tauri dev > /tmp/plan7-smoke.log 2>&1 &
DEV_PID=$!
echo "PID=$DEV_PID"

for i in $(seq 1 60); do
  sleep 5
  if grep -q "MCP HTTP server listening" /tmp/plan7-smoke.log 2>/dev/null; then
    echo "READY at ~$((i*5))s"
    break
  fi
  if grep -q -E "error\[|^error:|panicked|could not compile|Port .* already in use" /tmp/plan7-smoke.log 2>/dev/null; then
    echo "FAIL"
    break
  fi
done

grep -E "MCP HTTP server|AppState initialized|registry|shared_config|server_manager" /tmp/plan7-smoke.log

# Optional: hit /health while dev is running
curl -sS http://127.0.0.1:3282/health || echo "(curl failed — agent may not have curl)"

kill -9 $DEV_PID 2>/dev/null
sleep 3
ps -ef 2>/dev/null | grep -iE "tauri|cargo|mcp-router|vite" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

Expected: log lines:
- `MCP HTTP server listening addr=127.0.0.1:3282`
- `AppState initialized (registry + shared_config + server_manager seeded; HTTP server on 127.0.0.1:3282)`

`curl http://127.0.0.1:3282/health` should return `ok`.

`curl http://127.0.0.1:3282/mcp` (no auth) should return 401.

#### Step 6: Commit + tag

```bash
git add src-tauri/src/http/serve.rs src-tauri/src/http/mod.rs src-tauri/src/lib.rs
git commit -m "feat(http): MCP HTTP server (axum :3282 with bearer-auth middleware on /mcp)"
git tag -a tauri-plan-7-done -m "Plan 7 (HTTP server, stub aggregator) complete"
```

#### Step 7: Show summary

```bash
git log --oneline tauri-plan-6-done..HEAD
```

Expected: ~5 commits since Plan 6 (1 plan doc + 1 deps + 1 aggregator + 1 auth + 1 serve).

---

## Plan 7 Validation Checklist

- [ ] `cargo build` clean (axum + rmcp server features link)
- [ ] `cargo test` reports 105 tests passing
- [ ] `pnpm tauri dev` smoke shows `MCP HTTP server listening addr=127.0.0.1:3282`
- [ ] `curl http://127.0.0.1:3282/health` returns `ok`
- [ ] `curl http://127.0.0.1:3282/mcp` (no auth) returns 401
- [ ] `cargo check` clean (ignore pre-existing ts-rs notes)
- [ ] tag `tauri-plan-7-done` exists

---

## Manual smoke (optional, post-Plan-7)

To verify the MCP protocol layer works end-to-end:

1. With `pnpm tauri dev` running, open DevTools console.
2. Save a token:
   ```js
   const { invoke } = window.__TAURI__.core;
   await invoke("tokens_save", {
     token: {
       id: "test-token",
       clientId: "smoke",
       issuedAt: Date.now(),
       serverAccess: {}
     }
   });
   ```
3. From a terminal:
   ```bash
   npx @modelcontextprotocol/inspector --uri http://127.0.0.1:3282/mcp \
     --header "Authorization: Bearer test-token"
   ```
4. Expected: Inspector connects, shows server name "mcp-router-aggregator", shows 0 tools (stub). The protocol handshake is the verification — Plan 7b adds real tools.

---

## What Plan 7b Will Cover (preview, not part of this plan)

**Plan 7b: Real aggregation + per-token ACL + CORS + configurable port.**
- `Aggregator::list_tools` calls `ServerManager::list_tools_typed` for each Running server, prefixes tool names with `<server-name>__`, returns merged list
- `Aggregator::call_tool` parses prefix, routes to the right `RunningService`, awaits `call_tool` result
- Token's `server_access: HashMap<String, bool>` enforced — tools from disallowed servers filtered out of `list_tools` and `call_tool` returns "permission denied"
- Add CORS layer (origin allow-list from settings)
- Port configurable via `AppSettings.httpPort` (or stays 3282 if unset)

---

## Notes for the Engineer Executing This Plan

- **Aggregator is intentionally a stub**. Don't try to wire `ServerManager.list_tools` into `Aggregator::list_tools` here — Plan 7b does that with a typed-tools helper added to ServerManager.
- **`#[tool_router]` macro is NOT used** for Aggregator. The macro is for static tool definitions; ours are dynamic. Manual `ServerHandler` impl is the right pattern.
- **rmcp 1.5 model types** (`ListToolsResult`, `CallToolResult`, `McpError`, `ServerInfo`, etc.) may have slight field-name differences from the snippets above. The agent should `cargo build`, read the compiler errors, and fix the literal — the structural shape is right.
- **Listener bind on Windows**: `127.0.0.1:3282` should always be available since we don't expose externally. If port 3282 is taken (e.g., a running Electron-era version of MCP Router from `electron-final`), kill it first.
- **The HTTP server runs FOREVER** in a `tokio::spawn` background task. There's no graceful shutdown in Plan 7. The Tauri runtime exiting will drop the runtime, killing the task. Plan 7b adds CancellationToken-based shutdown.
- **No CORS in Plan 7**. The :3282 endpoint is meant for local MCP clients (other apps on the same machine via 127.0.0.1). Browser-based clients need CORS, which Plan 7b adds.
- **Test isolation**: each test in `http_auth_test.rs` creates a fresh `tempdir` + `SharedConfigStore`. Don't share state across tests.
- **`tower::ServiceExt::oneshot`** drives an axum router with a single request — perfect for middleware testing without binding a real port.
