# MCP Router Tauri Rewrite — Plan 5: Tauri Commands

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the persistence layer (Plans 2-4) to the frontend via `#[tauri::command]` handlers — 36 commands across 7 IPC domains. After Plan 5: `invoke<T>("snake_case_name", { args })` from the frontend reaches Rust, runs the right repository/store method, and returns ts-rs-typed payloads.

**Architecture:** Each domain gets one file under `src-tauri/src/commands/`. Commands are thin: pull `tauri::State<AppState>`, get a `SqlitePool` from the registry (or use `state.shared_config` directly), construct the repository, call the method, return `AppResult<T>`. Add a small helper `AppState::pool()` to drop the registry boilerplate. Final task registers all in `tauri::generate_handler![...]` and smoke-tests via `pnpm tauri dev`.

**Tech Stack:** Same as Plans 1-4. No new dependencies.

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md`

**Plan series:** Plan 5 of N. Plan 6+ tackles MCP runtime (server start/stop/listTools/getStatus need `ServerManager` which doesn't exist yet); HTTP token validation (Plan 7); workflow executor (Plan 8); frontend integration (Plan 9 — finally lights up the dormant React renderer code).

**Out of scope for Plan 5:**
- Runtime-needing commands: server start/stop, list_tools, get_status, select_file (Plan 6+)
- AgentPath / Workspace commands (no UI consumer yet — defer)
- System / package-manager commands (Plan 7+ — depend on child process module)
- Settings side-effects (e.g., `lightweightMode` triggering window destroy, `serverIdleStopMinutes` mutating ServerManager) — Plan 5 just persists; Plan 6+ adds the apply-to-runtime hooks
- Per-command automated tests (covered indirectly by repo/store tests + final smoke)

---

## Command catalog (36 commands)

| Domain | Commands | Source |
|---|---|---|
| settings | `settings_get`, `settings_update` | shared_config |
| tokens | `tokens_list`, `tokens_get`, `tokens_save`, `tokens_delete`, `tokens_delete_client`, `tokens_update_server_access` | shared_config |
| projects | `projects_list`, `projects_get`, `projects_find_by_name`, `projects_create`, `projects_update`, `projects_delete` | ProjectRepository |
| servers | `servers_list`, `servers_list_by_project`, `servers_get`, `servers_find_by_name`, `servers_create`, `servers_update`, `servers_delete` | ServerRepository |
| logs | `logs_query`, `logs_trim` | RequestLogRepository |
| workflows | `workflows_list`, `workflows_list_enabled`, `workflows_list_by_type`, `workflows_get`, `workflows_create`, `workflows_update`, `workflows_delete` | WorkflowRepository |
| hooks | `hooks_list`, `hooks_get`, `hooks_find_by_name`, `hooks_create`, `hooks_update`, `hooks_delete` | HookModuleRepository |

Plus existing `ping`. Total registered = 37.

---

## Why no per-command tests

Each Plan 5 command is a 3-line wrapper:
1. Get pool/store from state
2. Construct repo
3. Call method

The **method** is what has behavior — and Plans 2-4 already cover it with 96 integration tests. A per-command unit test would either:
- Mock the repo (testing the mock, not the real wiring), or
- Spin up `tauri::test::mock_app` (heavy and beyond Plan 5's scope)

Pragmatic call: the wiring is verified by the final smoke run + by Plan 9 frontend integration when the React renderer starts calling these commands. If a wiring bug slips through, the Plan 9 integration catches it immediately.

---

## File Structure (state at end of Plan 5)

Changes from Plan 4 baseline:

```
src-tauri/src/
├── state.rs                    # MODIFIED: add pool() helper
├── lib.rs                      # MODIFIED: register all 37 commands in invoke_handler
└── commands/
    ├── mod.rs                  # MODIFIED: re-export new submodules
    ├── ping.rs                 # unchanged
    ├── settings.rs             # NEW
    ├── tokens.rs               # NEW
    ├── projects.rs             # NEW
    ├── servers.rs              # NEW
    ├── logs.rs                 # NEW
    ├── workflows.rs            # NEW
    └── hooks.rs                # NEW
```

No new tests. No new ts-rs types. No schema changes.

---

## Plan 1-4 lessons learned (apply preemptively)

1. `#[tauri::command]` async functions need `tauri::State<'_, AppState>` (note the lifetime) — see plan code.
2. The lifetime mismatch between `State<'_, T>` and `async fn` requires `Result<T, Error>` (NOT bare `T`) — Tauri handles `AppResult<T>` natively because `AppError` is `Serialize`.
3. `From<sqlx::Error> for AppError` lets `?` work uniformly — keep using it.
4. Command function name == Tauri channel name: `projects_list` is invoked via `invoke("projects_list", ...)`. snake_case is the convention.
5. `SqlitePool` is `Clone` (Arc-backed) — passing it into `Sqlite<X>Repository::new(pool)` is cheap.
6. `Arc<SharedConfigStore>` deref-as-`&SharedConfigStore` works because we use `state.shared_config.method()` (deref through `Arc`).

---

## Prerequisites

- [ ] Plan 4 complete (`tauri-plan-4-done` tag exists)
- [ ] On branch `tauri-rewrite`, working tree clean
- [ ] `cargo test` (in `src-tauri/`) reports 96 tests passing
- [ ] No leftover dev/cargo processes

---

## Tasks

### Task 1: settings + tokens commands (shared_config)

**Files:**
- Create: `src-tauri/src/commands/settings.rs`
- Create: `src-tauri/src/commands/tokens.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod settings;` `pub mod tokens;`)

These commands proxy `state.shared_config` directly. No pool needed.

#### Step 1: Create commands/settings.rs

```rust
use tauri::State;

use crate::{
    error::AppResult,
    shared_config::types::AppSettings,
    state::AppState,
};

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> AppResult<AppSettings> {
    Ok(state.shared_config.get_settings().await)
}

#[tauri::command]
pub async fn settings_update(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<()> {
    state.shared_config.update_settings(settings).await
}
```

#### Step 2: Create commands/tokens.rs

```rust
use std::collections::HashMap;

use tauri::State;

use crate::{
    error::AppResult,
    shared_config::types::Token,
    state::AppState,
};

#[tauri::command]
pub async fn tokens_list(state: State<'_, AppState>) -> AppResult<Vec<Token>> {
    Ok(state.shared_config.list_tokens().await)
}

#[tauri::command]
pub async fn tokens_get(state: State<'_, AppState>, id: String) -> AppResult<Option<Token>> {
    Ok(state.shared_config.get_token(&id).await)
}

#[tauri::command]
pub async fn tokens_save(state: State<'_, AppState>, token: Token) -> AppResult<()> {
    state.shared_config.save_token(token).await
}

#[tauri::command]
pub async fn tokens_delete(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    state.shared_config.delete_token(&id).await
}

#[tauri::command]
pub async fn tokens_delete_client(
    state: State<'_, AppState>,
    client_id: String,
) -> AppResult<u32> {
    state.shared_config.delete_client_tokens(&client_id).await
}

#[tauri::command]
pub async fn tokens_update_server_access(
    state: State<'_, AppState>,
    id: String,
    server_access: HashMap<String, bool>,
) -> AppResult<bool> {
    state
        .shared_config
        .update_token_server_access(&id, server_access)
        .await
}
```

#### Step 3: Update commands/mod.rs

Open `src-tauri/src/commands/mod.rs` (currently `pub mod ping;`). Append:

```rust
pub mod settings;
pub mod tokens;
```

#### Step 4: Verify build

```bash
cd src-tauri
cargo check
cd ..
```
Expected: clean. (Tests still 96 — no test changes in Task 1.)

#### Step 5: Commit

```bash
git add src-tauri/src/commands/settings.rs src-tauri/src/commands/tokens.rs src-tauri/src/commands/mod.rs
git commit -m "feat(commands): settings + tokens (8 commands proxying shared_config)"
```

---

### Task 2: projects commands + AppState::pool() helper

**Files:**
- Modify: `src-tauri/src/state.rs` (add `pool()` helper)
- Create: `src-tauri/src/commands/projects.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod projects;`)

This is the first repo-backed command file. Add a small helper to AppState so subsequent tasks don't repeat the registry boilerplate.

#### Step 1: Add `pool()` helper to AppState

Open `src-tauri/src/state.rs`. After the `impl AppState { ... }` block's `new` method, add:

```rust
impl AppState {
    pub fn new(registry: WorkspacePoolRegistry, shared_config: SharedConfigStore) -> Self {
        Self {
            registry: Arc::new(registry),
            shared_config: Arc::new(shared_config),
        }
    }

    /// Convenience: returns the SqlitePool for the currently-active workspace.
    /// Plan 5 uses DEFAULT_WORKSPACE; Plan 6+ may evolve this when workspace switching commands land.
    pub async fn pool(&self) -> crate::error::AppResult<sqlx::SqlitePool> {
        self.registry
            .get_or_init(crate::persistence::registry::DEFAULT_WORKSPACE)
            .await
    }
}
```

(Replace the existing `impl AppState { ... }` block with the above.)

#### Step 2: Create commands/projects.rs

```rust
use tauri::State;

use crate::{
    error::AppResult,
    persistence::{
        repository::project::{ProjectRepository, SqliteProjectRepository},
        types::project::{NewProject, Project, ProjectPatch},
    },
    state::AppState,
};

async fn repo(state: &State<'_, AppState>) -> AppResult<SqliteProjectRepository> {
    Ok(SqliteProjectRepository::new(state.pool().await?))
}

#[tauri::command]
pub async fn projects_list(state: State<'_, AppState>) -> AppResult<Vec<Project>> {
    repo(&state).await?.list().await
}

#[tauri::command]
pub async fn projects_get(state: State<'_, AppState>, id: String) -> AppResult<Option<Project>> {
    repo(&state).await?.get(&id).await
}

#[tauri::command]
pub async fn projects_find_by_name(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<Option<Project>> {
    repo(&state).await?.find_by_name(&name).await
}

#[tauri::command]
pub async fn projects_create(
    state: State<'_, AppState>,
    input: NewProject,
) -> AppResult<Project> {
    repo(&state).await?.create(input).await
}

#[tauri::command]
pub async fn projects_update(
    state: State<'_, AppState>,
    id: String,
    patch: ProjectPatch,
) -> AppResult<Project> {
    repo(&state).await?.update(&id, patch).await
}

#[tauri::command]
pub async fn projects_delete(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    repo(&state).await?.delete(&id).await
}
```

> The local `repo()` helper keeps each command body to one line. Sub-millisecond cost (just `Arc` clone + new struct).

#### Step 3: Update commands/mod.rs

Append:

```rust
pub mod projects;
```

#### Step 4: Verify build

```bash
cd src-tauri
cargo check
cd ..
```
Expected: clean.

#### Step 5: Commit

```bash
git add src-tauri/src/state.rs src-tauri/src/commands/projects.rs src-tauri/src/commands/mod.rs
git commit -m "feat(commands): projects (6 commands) + AppState::pool() helper"
```

---

### Task 3: servers commands

**Files:**
- Create: `src-tauri/src/commands/servers.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod servers;`)

#### Step 1: Create commands/servers.rs

```rust
use tauri::State;

use crate::{
    error::AppResult,
    persistence::{
        repository::server::{ServerRepository, SqliteServerRepository},
        types::server::{NewServer, Server, ServerPatch},
    },
    state::AppState,
};

async fn repo(state: &State<'_, AppState>) -> AppResult<SqliteServerRepository> {
    Ok(SqliteServerRepository::new(state.pool().await?))
}

#[tauri::command]
pub async fn servers_list(state: State<'_, AppState>) -> AppResult<Vec<Server>> {
    repo(&state).await?.list().await
}

#[tauri::command]
pub async fn servers_list_by_project(
    state: State<'_, AppState>,
    project_id: String,
) -> AppResult<Vec<Server>> {
    repo(&state).await?.list_by_project(&project_id).await
}

#[tauri::command]
pub async fn servers_get(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Option<Server>> {
    repo(&state).await?.get(&id).await
}

#[tauri::command]
pub async fn servers_find_by_name(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<Option<Server>> {
    repo(&state).await?.find_by_name(&name).await
}

#[tauri::command]
pub async fn servers_create(
    state: State<'_, AppState>,
    input: NewServer,
) -> AppResult<Server> {
    repo(&state).await?.create(input).await
}

#[tauri::command]
pub async fn servers_update(
    state: State<'_, AppState>,
    id: String,
    patch: ServerPatch,
) -> AppResult<Server> {
    repo(&state).await?.update(&id, patch).await
}

#[tauri::command]
pub async fn servers_delete(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    repo(&state).await?.delete(&id).await
}
```

#### Step 2: Update commands/mod.rs

Append:

```rust
pub mod servers;
```

#### Step 3: Verify + commit

```bash
cd src-tauri
cargo check
cd ..
git add src-tauri/src/commands/servers.rs src-tauri/src/commands/mod.rs
git commit -m "feat(commands): servers (7 config-CRUD commands; start/stop deferred to Plan 6)"
```

---

### Task 4: logs commands

**Files:**
- Create: `src-tauri/src/commands/logs.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod logs;`)

Logs are write-mostly from MCP runtime (Plan 6+). For Plan 5 we expose only the read-side and the retention trim — frontend uses these to show a log viewer and let the user clear/cap.

#### Step 1: Create commands/logs.rs

```rust
use tauri::State;

use crate::{
    error::AppResult,
    persistence::{
        repository::request_log::{RequestLogRepository, SqliteRequestLogRepository},
        types::request_log::{RequestLogPage, RequestLogQuery},
    },
    state::AppState,
};

async fn repo(state: &State<'_, AppState>) -> AppResult<SqliteRequestLogRepository> {
    Ok(SqliteRequestLogRepository::new(state.pool().await?))
}

#[tauri::command]
pub async fn logs_query(
    state: State<'_, AppState>,
    query: RequestLogQuery,
) -> AppResult<RequestLogPage> {
    repo(&state).await?.query(query).await
}

#[tauri::command]
pub async fn logs_trim(state: State<'_, AppState>, max_rows: u64) -> AppResult<u64> {
    repo(&state).await?.trim_to_max(max_rows).await
}
```

#### Step 2: Update commands/mod.rs

Append:

```rust
pub mod logs;
```

#### Step 3: Verify + commit

```bash
cd src-tauri
cargo check
cd ..
git add src-tauri/src/commands/logs.rs src-tauri/src/commands/mod.rs
git commit -m "feat(commands): logs (query + trim; insert stays in-process for Plan 6 runtime)"
```

---

### Task 5: workflows commands

**Files:**
- Create: `src-tauri/src/commands/workflows.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod workflows;`)

#### Step 1: Create commands/workflows.rs

```rust
use tauri::State;

use crate::{
    error::AppResult,
    persistence::{
        repository::workflow::{SqliteWorkflowRepository, WorkflowRepository},
        types::workflow::{NewWorkflow, Workflow, WorkflowPatch},
    },
    state::AppState,
};

async fn repo(state: &State<'_, AppState>) -> AppResult<SqliteWorkflowRepository> {
    Ok(SqliteWorkflowRepository::new(state.pool().await?))
}

#[tauri::command]
pub async fn workflows_list(state: State<'_, AppState>) -> AppResult<Vec<Workflow>> {
    repo(&state).await?.list().await
}

#[tauri::command]
pub async fn workflows_list_enabled(
    state: State<'_, AppState>,
) -> AppResult<Vec<Workflow>> {
    repo(&state).await?.list_enabled().await
}

#[tauri::command]
pub async fn workflows_list_by_type(
    state: State<'_, AppState>,
    workflow_type: String,
) -> AppResult<Vec<Workflow>> {
    repo(&state).await?.list_by_type(&workflow_type).await
}

#[tauri::command]
pub async fn workflows_get(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Option<Workflow>> {
    repo(&state).await?.get(&id).await
}

#[tauri::command]
pub async fn workflows_create(
    state: State<'_, AppState>,
    input: NewWorkflow,
) -> AppResult<Workflow> {
    repo(&state).await?.create(input).await
}

#[tauri::command]
pub async fn workflows_update(
    state: State<'_, AppState>,
    id: String,
    patch: WorkflowPatch,
) -> AppResult<Workflow> {
    repo(&state).await?.update(&id, patch).await
}

#[tauri::command]
pub async fn workflows_delete(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    repo(&state).await?.delete(&id).await
}
```

#### Step 2: Update commands/mod.rs

Append:

```rust
pub mod workflows;
```

#### Step 3: Verify + commit

```bash
cd src-tauri
cargo check
cd ..
git add src-tauri/src/commands/workflows.rs src-tauri/src/commands/mod.rs
git commit -m "feat(commands): workflows (7 commands incl. list_enabled / list_by_type)"
```

---

### Task 6: hooks commands

**Files:**
- Create: `src-tauri/src/commands/hooks.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod hooks;`)

#### Step 1: Create commands/hooks.rs

```rust
use tauri::State;

use crate::{
    error::AppResult,
    persistence::{
        repository::hook_module::{HookModuleRepository, SqliteHookModuleRepository},
        types::hook_module::{HookModule, HookModulePatch, NewHookModule},
    },
    state::AppState,
};

async fn repo(state: &State<'_, AppState>) -> AppResult<SqliteHookModuleRepository> {
    Ok(SqliteHookModuleRepository::new(state.pool().await?))
}

#[tauri::command]
pub async fn hooks_list(state: State<'_, AppState>) -> AppResult<Vec<HookModule>> {
    repo(&state).await?.list().await
}

#[tauri::command]
pub async fn hooks_get(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Option<HookModule>> {
    repo(&state).await?.get(&id).await
}

#[tauri::command]
pub async fn hooks_find_by_name(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<Option<HookModule>> {
    repo(&state).await?.find_by_name(&name).await
}

#[tauri::command]
pub async fn hooks_create(
    state: State<'_, AppState>,
    input: NewHookModule,
) -> AppResult<HookModule> {
    repo(&state).await?.create(input).await
}

#[tauri::command]
pub async fn hooks_update(
    state: State<'_, AppState>,
    id: String,
    patch: HookModulePatch,
) -> AppResult<HookModule> {
    repo(&state).await?.update(&id, patch).await
}

#[tauri::command]
pub async fn hooks_delete(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    repo(&state).await?.delete(&id).await
}
```

#### Step 2: Update commands/mod.rs

Append:

```rust
pub mod hooks;
```

#### Step 3: Verify + commit

```bash
cd src-tauri
cargo check
cd ..
git add src-tauri/src/commands/hooks.rs src-tauri/src/commands/mod.rs
git commit -m "feat(commands): hooks (6 commands)"
```

---

### Task 7: Register all commands + smoke + tag

**Files:**
- Modify: `src-tauri/src/lib.rs` (extend `tauri::generate_handler![...]` with all 36 new commands)

#### Step 1: Update lib.rs invoke_handler

Open `src-tauri/src/lib.rs`. The current invoke_handler is:

```rust
.invoke_handler(tauri::generate_handler![ping])
```

Replace with the full list. **Important**: imports at top need to bring in each domain's commands. Add this block to the `use crate::{ ... };` import:

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
    persistence::registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE},
    shared_config::store::SharedConfigStore,
    state::AppState,
};
```

(Remove the existing `commands::ping::ping` line — superseded by the structured `commands::{...}` import.)

Then update the `.invoke_handler(...)` call:

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

#### Step 2: Verify build

```bash
cd src-tauri
cargo check
cd ..
```
Expected: clean. If a name typo exists, the compiler will pinpoint it.

#### Step 3: Run all tests

```bash
cd src-tauri
cargo test 2>&1 | grep -E "test result:" | tail -3
cd ..
```
Expected: 96 tests still passing (Plan 5 added no new tests).

#### Step 4: Smoke run pnpm tauri dev

```bash
cd C:/Projects/WebstormProjects/mcp-router && pnpm tauri dev > /tmp/plan5-smoke.log 2>&1 &
DEV_PID=$!
echo "PID=$DEV_PID"

for i in $(seq 1 60); do
  sleep 5
  if grep -q "AppState initialized" /tmp/plan5-smoke.log 2>/dev/null; then
    echo "READY at ~$((i*5))s"
    break
  fi
  if grep -q -E "error\[|^error:|panicked|could not compile|Port .* already in use" /tmp/plan5-smoke.log 2>/dev/null; then
    echo "FAIL"
    break
  fi
done

grep -E "AppState initialized|registry|shared_config" /tmp/plan5-smoke.log

kill -9 $DEV_PID 2>/dev/null
sleep 3
ps -ef 2>/dev/null | grep -iE "tauri|cargo|mcp-router|vite" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

Expected: `AppState initialized (registry + shared_config seeded)` log; no panic, no missing-handler errors during build.

#### Step 5: Commit + tag

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(rust): 注册全部 36 个 commands 到 invoke_handler"
git tag -a tauri-plan-5-done -m "Plan 5 (tauri commands) complete: 36 commands across 7 domains"
```

#### Step 6: Show summary

```bash
git log --oneline tauri-plan-4-done..HEAD
```
Expected: ~8 commits since Plan 4 (1 plan doc + 6 domain files + 1 final lib.rs).

---

## Plan 5 Validation Checklist

- [ ] `cd src-tauri && cargo test` reports 96 tests passing (no failures, no decrease)
- [ ] `cargo check` clean (ignore pre-existing ts-rs `serde(skip_serializing_if)` notes)
- [ ] `pnpm tauri dev` starts cleanly; logs show `AppState initialized (registry + shared_config seeded)`
- [ ] `tauri::generate_handler![...]` in lib.rs lists all 37 commands (1 ping + 36 new)
- [ ] tag `tauri-plan-5-done` exists

---

## What Plan 6 Will Cover (preview, not part of this plan)

**Plan 6: MCP Runtime.** Implement `ServerManager`:
- `tokio::process::Command` for stdio MCP servers + lifecycle (spawn / wait / kill)
- `rmcp` client wrappers (stdio / SSE / streamable HTTP transports)
- Idle auto-stop timer (`serverIdleStopMinutes` from settings)
- Wire into AppState (`Arc<ServerManager>`)
- Add commands: `servers_start`, `servers_stop`, `servers_get_status`, `servers_list_tools`
- Plug `RequestLogRepository::insert` into the runtime so logs accumulate during tool calls

This is the biggest plan after Plan 3 — `rmcp` is a fresh dependency surface that may surprise.

---

## Notes for the Engineer Executing This Plan

- **No tests in this plan** is intentional. The 96 existing tests cover all behavior; commands are pure plumbing.
- **`async fn repo(state: &State<'_, AppState>) -> AppResult<...>`** is the per-file helper pattern. Keep it tiny — 2 lines.
- **`tauri::State<'_, AppState>`** lifetime: don't try to drop the `'_` — Rust requires it on async commands.
- **HashMap arg**: `HashMap<String, bool>` serializes naturally from JSON object. Frontend sends `{ "server-id": true }`, Rust receives `HashMap`.
- **Don't add commands not in the catalog** even if "while you're here it'd be nice to also expose X". YAGNI — wait for a consumer.
- **Don't touch frontend `platform-api` here** — Plan 9 is when the React side starts calling these commands. Plan 5 just builds the Rust side.
- **Smoke run timing**: ~30-90s on first build after Plan 5's many new files; subsequent builds are incremental and fast.
- **Watch for `unused_imports` warnings**: if Task 7's import block has a typo (e.g., `servers_list_by_project` doesn't match an actual function name), the compiler will flag — fix and re-run.
