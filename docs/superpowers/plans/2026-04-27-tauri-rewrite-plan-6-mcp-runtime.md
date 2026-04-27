# MCP Router Tauri Rewrite — Plan 6: MCP Runtime (stdio)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the first cut of the MCP runtime — a `ServerManager` that can spawn a stdio-based MCP server subprocess, connect to it via the rmcp client, list its tools, and stop it. Wire 4 new Tauri commands (`servers_start`, `servers_stop`, `servers_get_status`, `servers_list_tools`). After Plan 6: a frontend (or a manual smoke test using `npx @modelcontextprotocol/server-everything`) can start a configured local server and read its tool list.

**Architecture:** New module `src-tauri/src/mcp/` containing `server_manager.rs`. `ServerManager` holds an `Arc<WorkspacePoolRegistry>` (to look up server configs in SQLite) and a `RwLock<HashMap<ServerId, RunningService>>` of live rmcp client connections. Start spawns a `tokio::process::Command` via rmcp's `TokioChildProcess` transport; stop cancels the running service. AppState gains `Arc<ServerManager>`. The 4 new commands proxy to ServerManager methods.

**Tech Stack:** Adds `rmcp = "1.5"` (with `client` + `transport-child-process` features). All other deps unchanged.

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md` — risk #1 (rmcp maturity) is addressed by sticking to stdio transport in this plan; SSE / streamable HTTP transports + idle timer + log-insert hook are deferred.

**Plan series:** Plan 6 of N. Plan 6b will add the streamable HTTP transport for remote servers + the idle auto-stop timer + RequestLog hook. Plan 7 = HTTP server (axum on :3282 exposing aggregated MCP). Plan 8 = workflow executor + rquickjs hook engine.

**Out of scope for Plan 6:**
- Streamable HTTP / SSE transports (Plan 6b — only stdio here)
- Idle auto-stop timer driven by `serverIdleStopMinutes` setting (Plan 6b)
- Logging tool calls into RequestLogRepository (Plan 6b)
- Auto-start at app launch (the original Electron auto-start scan happened in `initMCPServices` — Plan 6b adds it)
- `call_tool` command (Plan 8 needs it for workflow executor; Plan 9 frontend doesn't directly call tools — that's an MCP-client-side concern via the :3282 HTTP)
- Restart on subprocess crash (defer; surfaces as `Failed` status until manual restart)
- Tool schema as a typed Rust struct → ts-rs DTO (we pass `serde_json::Value` for now; frontend treats as `unknown` per MCP spec)

---

## What rmcp 1.5 gives us (verified against docs.rs)

```rust
use rmcp::{ServiceExt, transport::TokioChildProcess};
use tokio::process::Command;

let service = ().serve(TokioChildProcess::new(Command::new("npx"))?).await?;
let tools = service.list_all_tools().await?;       // Vec<rmcp::model::Tool>
service.cancel().await?;                            // graceful shutdown, consumes self
```

Key facts:
- `()` (the unit type) implements `ServiceExt` for the client role.
- `().serve(transport)` returns `rmcp::service::RunningService<RoleClient, ()>` after the MCP `initialize/initialized` handshake completes.
- `RunningService` derefs to `Peer<RoleClient>`, exposing `list_all_tools`, `call_tool`, etc. directly.
- `cancel(self)` consumes the service for graceful close. `close(&mut self)` exists if you want to keep the value alive.
- `TokioChildProcess::new(cmd: tokio::process::Command)` returns `Result<TokioChildProcess, ...>` — the `?` is required.
- `rmcp::model::Tool` is `#[non_exhaustive]` with `Serialize + Deserialize + Clone`. We serialize-and-pass-through as `serde_json::Value` (frontend types it as MCP `Tool` shape — well-defined by spec).

---

## File Structure (state at end of Plan 6)

```
src-tauri/
├── Cargo.toml                      # MODIFIED: add rmcp dep
├── src/
│   ├── mcp/                        # NEW module
│   │   ├── mod.rs                  # NEW
│   │   ├── server_manager.rs       # NEW
│   │   └── status.rs               # NEW (ServerStatus enum + ts-rs)
│   ├── state.rs                    # MODIFIED: add server_manager field
│   ├── lib.rs                      # MODIFIED: setup constructs + manages ServerManager; register 4 new commands
│   └── commands/
│       ├── mod.rs                  # MODIFIED: re-export server_runtime
│       └── server_runtime.rs       # NEW (4 commands)
└── tests/
    └── server_manager_test.rs      # NEW (status / lookup-missing tests; no real rmcp connection)
```

We deliberately don't add an integration test that spawns a real MCP server in Plan 6 — that requires `uvx` or `npx` available on the build/test host and is brittle. Plan 6 verifies via:
1. `cargo build` (rmcp links cleanly)
2. Unit tests for the ServerManager state-machine surface (lookup, status-when-stopped, stop-when-not-running)
3. Final smoke run + a manual instruction in the report for the user to optionally test by creating a server config + calling `servers_start` via DevTools console

---

## Plan 1-5 lessons learned (apply preemptively)

1. `#[ts(export, export_to = "../../src/types/generated/")]` — TWO `..`s.
2. `tokio::sync::RwLock` (not `std::sync::RwLock`) — we hold across `.await`.
3. `#[serde(rename_all = "lowercase")]` for enums sent over wire (we use it on `ServerStatus`).
4. `From<sqlx::Error> for AppError` propagates SQL errors via `?`.
5. ts-rs auto-export tests run inside `cargo test` — total tally grows when new exported types land.
6. `tauri::State<'_, AppState>` lifetime: don't drop the `'_`.

---

## Prerequisites

- [ ] Plan 5 complete (`tauri-plan-5-done` tag exists)
- [ ] On branch `tauri-rewrite`, working tree clean
- [ ] `cargo test` (in `src-tauri/`) reports 96 tests passing
- [ ] No leftover dev/cargo processes

---

## Tasks

### Task 1: Add rmcp dependency + verify build

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `rmcp` to `[dependencies]`)

#### Step 1: Add rmcp to Cargo.toml

Open `src-tauri/Cargo.toml`. Find the `[dependencies]` block. Insert (alphabetically near other deps):

```toml
rmcp = { version = "1.5", features = ["client", "transport-child-process"] }
```

(Don't add other transports yet — `transport-streamable-http-client-reqwest` is for Plan 6b. Each feature pulls in extra deps; minimize to start.)

#### Step 2: cargo build

```bash
cd src-tauri
cargo build
cd ..
```

Expected: success. First build downloads rmcp + its transitive deps (likely tokio extensions, schemars, etc.). 5-10 minutes possible on first link.

If `cargo build` reports a feature-gate or version conflict, the most likely cause is rmcp's MSRV (Minimum Supported Rust Version) being higher than ours. Fix by bumping `rust-version` in Cargo.toml's `[package]`. Document the bump in the commit.

#### Step 3: Quick smoke import test (just to confirm types are reachable)

Create a temporary scratch file to verify the imports compile, then delete:

```bash
cat > /tmp/rmcp_imports_check.rs <<'EOF'
// scratch — verifies rmcp public API is what plan assumes
use rmcp::ServiceExt;
use rmcp::transport::TokioChildProcess;
use rmcp::service::RunningService;
use rmcp::model::Tool;
fn _unused() {
    let _: Option<RunningService<rmcp::RoleClient, ()>> = None;
    let _: Option<Tool> = None;
    let _: fn() = || {};
    // ServiceExt is a trait; reachability is enough.
    let _ = std::marker::PhantomData::<dyn ServiceExt>;
}
EOF
```

You don't need to compile this — it's a checklist of imports the plan assumes. If any of these symbols don't exist in rmcp 1.5, STOP and report — the plan needs adjustment before Tasks 2-5.

#### Step 4: Commit

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(rust): 加 rmcp 1.5 (client + stdio child-process transport)"
```

---

### Task 2: ServerStatus enum + ServerManager skeleton

**Files:**
- Create: `src-tauri/src/mcp/mod.rs`
- Create: `src-tauri/src/mcp/status.rs`
- Create: `src-tauri/src/mcp/server_manager.rs`
- Create: `src-tauri/tests/server_manager_test.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod mcp;`)

The skeleton has the public surface and stores no live connections — `start` returns `AppError::Internal("not implemented")`. Task 3 fills it in. This task lands the types + state + the simpler methods (status, stop-when-empty, list_tools-when-empty) and tests them.

#### Step 1: Create mcp/mod.rs

```rust
pub mod server_manager;
pub mod status;
```

#### Step 2: Create mcp/status.rs

```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Runtime status of an MCP server. Persistence-side `Server` (Plan 3) holds config;
/// runtime status lives only in `ServerManager`'s in-memory map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(tag = "kind", content = "message")]
pub enum ServerStatus {
    Stopped,
    Starting,
    Running,
    Failed(String),
}
```

#### Step 3: Create mcp/server_manager.rs (skeleton)

```rust
use std::{collections::HashMap, sync::Arc};

use rmcp::{service::RunningService, RoleClient};
use serde_json::Value;
use tokio::sync::RwLock;
use tracing::info;

use crate::{
    error::{AppError, AppResult},
    mcp::status::ServerStatus,
    persistence::registry::WorkspacePoolRegistry,
};

pub struct ServerManager {
    #[allow(dead_code)] // populated in Task 3
    registry: Arc<WorkspacePoolRegistry>,
    clients: RwLock<HashMap<String, RunningService<RoleClient, ()>>>,
}

impl ServerManager {
    pub fn new(registry: Arc<WorkspacePoolRegistry>) -> Self {
        Self {
            registry,
            clients: RwLock::new(HashMap::new()),
        }
    }

    /// Returns the runtime status of `server_id`. Stopped if not in the active map.
    pub async fn status(&self, server_id: &str) -> ServerStatus {
        let clients = self.clients.read().await;
        if clients.contains_key(server_id) {
            ServerStatus::Running
        } else {
            ServerStatus::Stopped
        }
    }

    /// Skeleton: implemented in Task 3.
    pub async fn start(&self, _server_id: &str) -> AppResult<()> {
        Err(AppError::Internal(
            "ServerManager::start not implemented yet (Plan 6 Task 3)".into(),
        ))
    }

    /// Stop a running server. Idempotent: returns `false` if it wasn't running.
    pub async fn stop(&self, server_id: &str) -> AppResult<bool> {
        let removed = {
            let mut clients = self.clients.write().await;
            clients.remove(server_id)
        };
        match removed {
            Some(service) => {
                info!(server_id, "stopping mcp server (cancel)");
                if let Err(e) = service.cancel().await {
                    return Err(AppError::Upstream(format!("cancel mcp service: {e}")));
                }
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Skeleton: implemented in Task 3.
    pub async fn list_tools(&self, server_id: &str) -> AppResult<Vec<Value>> {
        let clients = self.clients.read().await;
        if !clients.contains_key(server_id) {
            return Err(AppError::NotFound(format!(
                "server {server_id} is not running"
            )));
        }
        Err(AppError::Internal(
            "ServerManager::list_tools not implemented yet (Plan 6 Task 3)".into(),
        ))
    }
}
```

#### Step 4: Create tests/server_manager_test.rs

```rust
use std::sync::Arc;

use mcp_router_lib::{
    mcp::{server_manager::ServerManager, status::ServerStatus},
    persistence::registry::WorkspacePoolRegistry,
};

fn make_manager() -> ServerManager {
    let tmp = tempfile::tempdir().expect("tempdir");
    let registry = Arc::new(WorkspacePoolRegistry::new(tmp.path().to_path_buf()));
    ServerManager::new(registry)
}

#[tokio::test]
async fn status_returns_stopped_when_no_active_client() {
    let mgr = make_manager();
    let status = mgr.status("missing").await;
    assert_eq!(status, ServerStatus::Stopped);
}

#[tokio::test]
async fn stop_returns_false_when_not_running() {
    let mgr = make_manager();
    let stopped = mgr.stop("never-started").await.expect("stop");
    assert!(!stopped);
}

#[tokio::test]
async fn list_tools_errors_when_not_running() {
    let mgr = make_manager();
    let result = mgr.list_tools("missing").await;
    assert!(matches!(
        result,
        Err(mcp_router_lib::error::AppError::NotFound(_))
    ));
}

#[tokio::test]
async fn start_returns_internal_error_in_skeleton() {
    let mgr = make_manager();
    let result = mgr.start("any").await;
    assert!(matches!(
        result,
        Err(mcp_router_lib::error::AppError::Internal(_))
    ));
}
```

The fourth test will be REWRITTEN in Task 3 (Step 1) to expect a real success-or-NotFound path.

#### Step 5: Wire `pub mod mcp;` in lib.rs

Open `src-tauri/src/lib.rs`. The current top of file has:
```rust
pub mod commands;
pub mod error;
pub mod persistence;
pub mod shared_config;
pub mod state;
```

Insert `pub mod mcp;` alphabetically:

```rust
pub mod commands;
pub mod error;
pub mod mcp;
pub mod persistence;
pub mod shared_config;
pub mod state;
```

#### Step 6: Run tests

```bash
cd src-tauri
cargo test --test server_manager_test
cd ..
```

Expected: PASS (4 tests).

```bash
cd src-tauri
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected total: 96 (Plan 5) + 4 (server_manager_test) + 1 (ts-rs auto-export for `ServerStatus`) = **101 tests passing**.

#### Step 7: Commit

```bash
git add src-tauri/src/mcp src-tauri/src/lib.rs src-tauri/tests/server_manager_test.rs src/types/generated
git commit -m "feat(mcp): ServerStatus 枚举 + ServerManager 骨架（status/stop/list_tools 半成品） + 4 测试"
```

---

### Task 3: Implement start / list_tools (real rmcp wiring)

**Files:**
- Modify: `src-tauri/src/mcp/server_manager.rs` (replace skeleton with real implementation)
- Modify: `src-tauri/tests/server_manager_test.rs` (rewrite the `start` test to expect NotFound for missing server config)

#### Step 1: Rewrite server_manager.rs

Replace the entire file with:

```rust
use std::{collections::HashMap, sync::Arc};

use rmcp::{
    service::RunningService,
    transport::TokioChildProcess,
    RoleClient, ServiceExt,
};
use serde_json::Value;
use tokio::{process::Command, sync::RwLock};
use tracing::{info, warn};

use crate::{
    error::{AppError, AppResult},
    mcp::status::ServerStatus,
    persistence::{
        registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE},
        repository::server::{ServerRepository, SqliteServerRepository},
        types::server::{Server, ServerType},
    },
};

pub struct ServerManager {
    registry: Arc<WorkspacePoolRegistry>,
    clients: RwLock<HashMap<String, RunningService<RoleClient, ()>>>,
}

impl ServerManager {
    pub fn new(registry: Arc<WorkspacePoolRegistry>) -> Self {
        Self {
            registry,
            clients: RwLock::new(HashMap::new()),
        }
    }

    pub async fn status(&self, server_id: &str) -> ServerStatus {
        let clients = self.clients.read().await;
        if clients.contains_key(server_id) {
            ServerStatus::Running
        } else {
            ServerStatus::Stopped
        }
    }

    pub async fn start(&self, server_id: &str) -> AppResult<()> {
        // Reject if already running.
        {
            let clients = self.clients.read().await;
            if clients.contains_key(server_id) {
                return Err(AppError::InvalidInput(format!(
                    "server {server_id} is already running"
                )));
            }
        }

        // Look up the server config.
        let server = self
            .lookup_server(server_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("server {server_id}")))?;

        if !matches!(server.server_type, ServerType::Local) {
            return Err(AppError::InvalidInput(format!(
                "server {server_id} is type {:?}; only Local stdio supported in Plan 6",
                server.server_type
            )));
        }
        if server.disabled {
            return Err(AppError::InvalidInput(format!(
                "server {server_id} is disabled"
            )));
        }

        let command_str = server
            .command
            .as_deref()
            .ok_or_else(|| AppError::InvalidInput(format!("server {server_id} has no command")))?;

        let mut cmd = Command::new(command_str);
        cmd.args(&server.args);
        for (k, v) in &server.env {
            cmd.env(k, v);
        }
        if let Some(cwd) = server.context_path.as_deref() {
            cmd.current_dir(cwd);
        }

        info!(server_id, command = %command_str, "spawning mcp server subprocess");

        let transport = TokioChildProcess::new(cmd).map_err(|e| {
            AppError::Upstream(format!("spawn mcp server subprocess: {e}"))
        })?;

        let service: RunningService<RoleClient, ()> = ()
            .serve(transport)
            .await
            .map_err(|e| AppError::Upstream(format!("rmcp serve: {e}")))?;

        // Insert under write lock (re-checking idempotency to handle concurrent starts).
        let mut clients = self.clients.write().await;
        if clients.contains_key(server_id) {
            // Race: someone else started it. Tear ours down.
            drop(clients);
            warn!(server_id, "concurrent start detected; cancelling our service");
            let _ = service.cancel().await;
            return Err(AppError::InvalidInput(format!(
                "server {server_id} was started concurrently"
            )));
        }
        clients.insert(server_id.to_string(), service);
        info!(server_id, "mcp server running");
        Ok(())
    }

    pub async fn stop(&self, server_id: &str) -> AppResult<bool> {
        let removed = {
            let mut clients = self.clients.write().await;
            clients.remove(server_id)
        };
        match removed {
            Some(service) => {
                info!(server_id, "stopping mcp server (cancel)");
                if let Err(e) = service.cancel().await {
                    return Err(AppError::Upstream(format!("cancel mcp service: {e}")));
                }
                Ok(true)
            }
            None => Ok(false),
        }
    }

    pub async fn list_tools(&self, server_id: &str) -> AppResult<Vec<Value>> {
        let clients = self.clients.read().await;
        let service = clients.get(server_id).ok_or_else(|| {
            AppError::NotFound(format!("server {server_id} is not running"))
        })?;

        // RunningService derefs to Peer<RoleClient>; list_all_tools is on Peer.
        let tools = service
            .list_all_tools()
            .await
            .map_err(|e| AppError::Upstream(format!("list_all_tools: {e}")))?;

        // Serialize each rmcp::model::Tool to serde_json::Value.
        // The Tool type is #[non_exhaustive] so we can't construct it ourselves,
        // but Serialize lets us pass-through to JSON.
        tools
            .into_iter()
            .map(|t| {
                serde_json::to_value(&t).map_err(|e| {
                    AppError::Internal(format!("encode rmcp Tool to JSON: {e}"))
                })
            })
            .collect()
    }

    // Internal: fetch a server config from the default workspace's DB.
    async fn lookup_server(&self, server_id: &str) -> AppResult<Option<Server>> {
        let pool = self.registry.get_or_init(DEFAULT_WORKSPACE).await?;
        let repo = SqliteServerRepository::new(pool);
        repo.get(server_id).await
    }
}
```

#### Step 2: Update tests/server_manager_test.rs

Replace the `start_returns_internal_error_in_skeleton` test with one that exercises the lookup path:

```rust
use std::sync::Arc;

use mcp_router_lib::{
    mcp::{server_manager::ServerManager, status::ServerStatus},
    persistence::registry::WorkspacePoolRegistry,
};

fn make_manager() -> (tempfile::TempDir, ServerManager) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let registry = Arc::new(WorkspacePoolRegistry::new(tmp.path().to_path_buf()));
    let mgr = ServerManager::new(registry);
    (tmp, mgr)
}

#[tokio::test]
async fn status_returns_stopped_when_no_active_client() {
    let (_tmp, mgr) = make_manager();
    let status = mgr.status("missing").await;
    assert_eq!(status, ServerStatus::Stopped);
}

#[tokio::test]
async fn stop_returns_false_when_not_running() {
    let (_tmp, mgr) = make_manager();
    let stopped = mgr.stop("never-started").await.expect("stop");
    assert!(!stopped);
}

#[tokio::test]
async fn list_tools_errors_when_not_running() {
    let (_tmp, mgr) = make_manager();
    let result = mgr.list_tools("missing").await;
    assert!(matches!(
        result,
        Err(mcp_router_lib::error::AppError::NotFound(_))
    ));
}

#[tokio::test]
async fn start_returns_not_found_for_missing_server_config() {
    let (_tmp, mgr) = make_manager();
    // No server with this id exists in the DB.
    let result = mgr.start("nonexistent").await;
    assert!(
        matches!(result, Err(mcp_router_lib::error::AppError::NotFound(_))),
        "expected NotFound, got {:?}",
        result
    );
}
```

The `start_returns_not_found_for_missing_server_config` test exercises the full path: `start` → `lookup_server` → `registry.get_or_init` (creates empty DB + runs migrations) → `repo.get` → returns `None` → `ok_or_else(NotFound)`.

#### Step 3: Run tests

```bash
cd src-tauri
cargo test --test server_manager_test
cd ..
```

Expected: PASS (4 tests, including the new lookup-NotFound path).

If `start_returns_not_found_for_missing_server_config` hangs, the migration is probably re-running in a way that takes too long. Confirm by checking logs — the test takes ~100ms because it creates a fresh sqlite + runs 0001 + 0002.

#### Step 4: Run all tests

```bash
cd src-tauri
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected: still 101 (no new tests; one was rewritten).

#### Step 5: Commit

```bash
git add src-tauri/src/mcp/server_manager.rs src-tauri/tests/server_manager_test.rs
git commit -m "feat(mcp): 实现 ServerManager start/list_tools (rmcp stdio TokioChildProcess)"
```

---

### Task 4: Wire ServerManager into AppState + 4 commands

**Files:**
- Modify: `src-tauri/src/state.rs` (add `server_manager` field)
- Create: `src-tauri/src/commands/server_runtime.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod server_runtime;`)
- Modify: `src-tauri/src/lib.rs` (construct ServerManager in setup; register 4 new commands)

#### Step 1: Update state.rs

This task changes `AppState::new` to take `Arc<WorkspacePoolRegistry>` directly (instead of an owned `WorkspacePoolRegistry`) so it can be shared with `ServerManager` without an awkward `try_unwrap` dance in setup. Replace the file with:

```rust
use std::sync::Arc;

use crate::{
    mcp::server_manager::ServerManager,
    persistence::registry::WorkspacePoolRegistry,
    shared_config::store::SharedConfigStore,
};

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<WorkspacePoolRegistry>,
    pub shared_config: Arc<SharedConfigStore>,
    pub server_manager: Arc<ServerManager>,
}

impl AppState {
    pub fn new(
        registry: Arc<WorkspacePoolRegistry>,
        shared_config: SharedConfigStore,
        server_manager: ServerManager,
    ) -> Self {
        Self {
            registry,
            shared_config: Arc::new(shared_config),
            server_manager: Arc::new(server_manager),
        }
    }

    pub async fn pool(&self) -> crate::error::AppResult<sqlx::SqlitePool> {
        self.registry
            .get_or_init(crate::persistence::registry::DEFAULT_WORKSPACE)
            .await
    }
}
```

#### Step 2: Create commands/server_runtime.rs

```rust
use serde_json::Value;
use tauri::State;

use crate::{
    error::AppResult,
    mcp::status::ServerStatus,
    state::AppState,
};

#[tauri::command]
pub async fn servers_start(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.server_manager.start(&id).await
}

#[tauri::command]
pub async fn servers_stop(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    state.server_manager.stop(&id).await
}

#[tauri::command]
pub async fn servers_get_status(state: State<'_, AppState>, id: String) -> AppResult<ServerStatus> {
    Ok(state.server_manager.status(&id).await)
}

#[tauri::command]
pub async fn servers_list_tools(state: State<'_, AppState>, id: String) -> AppResult<Vec<Value>> {
    state.server_manager.list_tools(&id).await
}
```

#### Step 3: Update commands/mod.rs

Append:

```rust
pub mod server_runtime;
```

#### Step 4: Update lib.rs

Two edits in `src-tauri/src/lib.rs`:

**Edit A — imports**: Add `server_runtime` commands and `ServerManager` to the `use crate::{ ... };` block. Final shape (replace the existing `use crate::{ ... }`):

```rust
use crate::{
    commands::{
        hooks::{
            hooks_create, hooks_delete, hooks_find_by_name, hooks_get, hooks_list, hooks_update,
        },
        logs::{logs_query, logs_trim},
        ping::ping,
        projects::{
            projects_create, projects_delete, projects_find_by_name, projects_get, projects_list,
            projects_update,
        },
        server_runtime::{
            servers_get_status, servers_list_tools, servers_start, servers_stop,
        },
        servers::{
            servers_create, servers_delete, servers_find_by_name, servers_get,
            servers_list, servers_list_by_project, servers_update,
        },
        settings::{settings_get, settings_update},
        tokens::{
            tokens_delete, tokens_delete_client, tokens_get, tokens_list, tokens_save,
            tokens_update_server_access,
        },
        workflows::{
            workflows_create, workflows_delete, workflows_get, workflows_list,
            workflows_list_by_type, workflows_list_enabled, workflows_update,
        },
    },
    mcp::server_manager::ServerManager,
    persistence::registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE},
    shared_config::store::SharedConfigStore,
    state::AppState,
};
```

**Edit B — setup closure body**: Replace the existing async-spawn block (Plan 5's version constructs registry as owned `WorkspacePoolRegistry`) with this version that wraps registry in `Arc` upfront so `ServerManager` and `AppState` can share it cheaply:

```rust
            tauri::async_runtime::spawn(async move {
                let shared_config_path = app_data_dir.join("shared-config.json");
                let shared_config = match SharedConfigStore::open(shared_config_path).await {
                    Ok(s) => s,
                    Err(err) => {
                        error!(?err, "failed to open shared-config.json");
                        return;
                    }
                };

                let registry = std::sync::Arc::new(WorkspacePoolRegistry::new(app_data_dir));
                if let Err(err) = registry.get_or_init(DEFAULT_WORKSPACE).await {
                    error!(?err, "failed to seed default workspace pool");
                    return;
                }

                let server_manager = ServerManager::new(registry.clone());

                let state = AppState::new(registry, shared_config, server_manager);
                handle.manage(state);
                info!("AppState initialized (registry + shared_config + server_manager seeded)");
            });
```

**Edit C — invoke_handler**: Add the 4 new commands. Final form:

```rust
        .invoke_handler(tauri::generate_handler![
            ping,
            settings_get,
            settings_update,
            tokens_list,
            tokens_get,
            tokens_save,
            tokens_delete,
            tokens_delete_client,
            tokens_update_server_access,
            projects_list,
            projects_get,
            projects_find_by_name,
            projects_create,
            projects_update,
            projects_delete,
            servers_list,
            servers_list_by_project,
            servers_get,
            servers_find_by_name,
            servers_create,
            servers_update,
            servers_delete,
            servers_start,
            servers_stop,
            servers_get_status,
            servers_list_tools,
            logs_query,
            logs_trim,
            workflows_list,
            workflows_list_enabled,
            workflows_list_by_type,
            workflows_get,
            workflows_create,
            workflows_update,
            workflows_delete,
            hooks_list,
            hooks_get,
            hooks_find_by_name,
            hooks_create,
            hooks_update,
            hooks_delete,
        ])
```

(Adds `servers_start`, `servers_stop`, `servers_get_status`, `servers_list_tools` after `servers_delete`. 41 commands total.)

#### Step 5: Verify build

```bash
cd src-tauri
cargo check
cd ..
```

Expected: clean.

#### Step 6: Run tests

```bash
cd src-tauri
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected: still 101 passing (no new tests in this task; existing tests still work).

#### Step 7: Commit

```bash
git add src-tauri/src/state.rs src-tauri/src/commands/server_runtime.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(mcp): ServerManager 接进 AppState；加 4 个 server runtime 命令 (start/stop/status/list_tools)"
```

---

### Task 5: Smoke + tag

**Files:** none (verification + tag only)

#### Step 1: cargo build (full)

```bash
cd src-tauri
cargo build
cd ..
```

Expected: clean.

#### Step 2: cargo test (full)

```bash
cd src-tauri
cargo test 2>&1 | grep -E "^(test result|running)" | tail -30
cd ..
```

Expected: 101 tests passing across all binaries.

#### Step 3: pnpm tauri dev smoke

```bash
cd C:/Projects/WebstormProjects/mcp-router && pnpm tauri dev > /tmp/plan6-smoke.log 2>&1 &
DEV_PID=$!
echo "PID=$DEV_PID"

for i in $(seq 1 60); do
  sleep 5
  if grep -q "AppState initialized" /tmp/plan6-smoke.log 2>/dev/null; then
    echo "READY at ~$((i*5))s"
    break
  fi
  if grep -q -E "error\[|^error:|panicked|could not compile|Port .* already in use" /tmp/plan6-smoke.log 2>/dev/null; then
    echo "FAIL"
    break
  fi
done

grep -E "AppState initialized|registry|shared_config|server_manager" /tmp/plan6-smoke.log

kill -9 $DEV_PID 2>/dev/null
sleep 3
ps -ef 2>/dev/null | grep -iE "tauri|cargo|mcp-router|vite" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

Expected: log line `AppState initialized (registry + shared_config + server_manager seeded)`.

#### Step 4: Tag

```bash
git tag -a tauri-plan-6-done -m "Plan 6 (MCP runtime, stdio) complete: ServerManager + 4 commands"
```

#### Step 5: Show summary

```bash
git log --oneline tauri-plan-5-done..HEAD
```

Expected: ~6 commits since Plan 5 (1 plan doc + 4 tasks + tag-only step has no commit).

---

## Plan 6 Validation Checklist

- [ ] `cd src-tauri && cargo build` clean (rmcp links cleanly)
- [ ] `cd src-tauri && cargo test` reports 101 tests passing
- [ ] `pnpm tauri dev` starts cleanly; logs show `AppState initialized (registry + shared_config + server_manager seeded)`
- [ ] `tauri::generate_handler![...]` in lib.rs lists 41 commands
- [ ] tag `tauri-plan-6-done` exists

---

## Manual smoke (optional, post-Plan-6)

To actually exercise rmcp end-to-end, do this once the user has time:

1. With `pnpm tauri dev` running, open DevTools (Ctrl+Shift+I in dev build).
2. In the console, call:
   ```js
   const { invoke } = window.__TAURI__.core;
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
   await invoke("servers_get_status", { id });  // → { kind: "Running" }
   const tools = await invoke("servers_list_tools", { id });
   console.log(tools); // serialized rmcp::model::Tool array
   await invoke("servers_stop", { id });
   ```
3. Expected: `tools` is a non-empty array with `name`, `description`, `inputSchema` fields per the MCP spec.

This requires `npx` available on PATH. Skip if not — the unit tests + smoke compile prove the wiring; only the rmcp protocol path is unverified by automation.

---

## What Plan 6b Will Cover (preview, not part of this plan)

**Plan 6b: Streamable HTTP transport + idle timer + log hook.** Extensions to Plan 6:
- Add `transport-streamable-http-client-reqwest` feature; implement remote-server start path that uses `StreamableHttpClientTransport::from_uri` instead of TokioChildProcess
- Background tokio task: scan `last_used_at` per active server, stop those past `serverIdleStopMinutes`
- Wrap rmcp's request/response flow to insert `RequestLog` rows via `RequestLogRepository`
- Auto-start at app launch: scan all servers with `auto_start = true`, call `start` on each
- Restart-on-crash: detect subprocess exit, mark `Failed`, optionally retry with backoff

Plan 7 (HTTP server) and Plan 8 (workflow executor) can land in parallel or before 6b — they don't depend on the runtime extensions.

---

## Notes for the Engineer Executing This Plan

- **rmcp 1.5 API is the verified shape** (per docs.rs and the official README at github.com/modelcontextprotocol/rust-sdk). If you find a method named differently (e.g., `list_tools` vs `list_all_tools`), trust the actual API and update the call site — but the trait and import paths should match.
- **`#[non_exhaustive]` on `Tool`**: don't try to construct `Tool` literals in your code. We only consume them via Serialize.
- **`RunningService::cancel(self)` consumes the value** — that's why `stop()` removes from the map first, then awaits cancel. Don't try to cancel through `&self`.
- **Concurrent start race**: the `start` method does a fast-path check (read lock), then re-checks under the write lock. This double-check pattern is necessary because two concurrent `start("X")` calls could both pass the read check.
- **DB lookup on every start**: each `start` call goes through `registry.get_or_init` then SQLite. This is fine — the call is once per user-initiated start, not in a hot path.
- **No automated test exercises the actual rmcp protocol** in Plan 6. We rely on the manual smoke (npx + server-everything) and on the rmcp library's own test suite. If Plan 6 lands and `start` panics at runtime, the most likely cause is an rmcp API change — read the error and check docs.rs/rmcp/latest.
- **Don't add streamable HTTP / SSE in Plan 6**. The plan is intentionally narrow: stdio only. Plan 6b extends.
- **Don't try to type rmcp::model::Tool as a ts-rs DTO**. The MCP spec defines it; frontend treats `tools: unknown[]` and consumes per spec. A typed wrapper is over-engineering.
