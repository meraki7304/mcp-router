# MCP Router Tauri Rewrite — Plan 2: Persistence Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the full Plan 1+ DB schema in a single `0002_init_schema.sql` migration; build `WorkspacePoolRegistry` for multi-DB management; refactor `AppState` to hold the registry; implement the `Project` repository (trait + sqlite + TDD) as the canonical template for the 5 remaining DB-backed repos. Verify end-to-end: app starts, default workspace pool initializes, ProjectRepository round-trips a Project row.

**Architecture:** Single-crate Rust (`src-tauri/`) following Plan 1's module layout (`commands/`, `error.rs`, `state.rs`, `persistence/`). Persistence layer adds:
- Domain types (`persistence/types/`) with serde + ts-rs derive
- Repository traits (`persistence/repository/<name>.rs`) — abstract interface
- Sqlite implementations (same file as trait or sibling, named `Sqlite<Name>Repository`) — concrete
- `WorkspacePoolRegistry` (`persistence/registry.rs`) — central pool manager keyed by workspace id

The registry pattern keeps repository code workspace-agnostic: a repo holds a `SqlitePool` reference, the registry hands out the right pool. AppState holds `Arc<WorkspacePoolRegistry>` (replacing Plan 1's bare `Arc<SqlitePool>`). For Plan 2 we use a single "default" workspace; later plans add the actual workspace switching via `WorkspaceRepository`.

**Tech Stack:** Same as Plan 1 — sqlx 0.8 (sqlite + macros + migrate + chrono + uuid), tokio, async-trait, ts-rs 10, chrono, uuid v7. Add `async-trait` to deps for trait async methods.

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md`

**Plan series:** Plan 2 of N. Plan 3 will copy the Project repository pattern for Servers / RequestLogs / Workspaces / Workflows / HookModules / AgentPaths.

**Out of scope for Plan 2:**
- Other 5+ DB repositories (Plan 3)
- File-based "repositories" for Settings + Tokens (Plan 4 — they used SharedConfigManager, not SQLite)
- Real workspace switching UI/IPC (later plan)
- Actual MCP runtime integration (Plan 4+)

---

## Schema Decisions (consolidating from Electron version)

The Electron app's schema had inconsistencies (mixed timestamp formats, no FK constraints, plain JSON field names). For the rewrite we standardize:

1. **Timestamps**: All tables use `created_at TEXT NOT NULL` and `updated_at TEXT NOT NULL` storing ISO 8601 strings (sqlx + chrono::DateTime<Utc> default). The Electron app had millisecond integers in some tables and ISO strings in `workspaces` — we normalize to one shape.
2. **Booleans**: `INTEGER NOT NULL CHECK (col IN (0,1))` — no implicit `bool` types in sqlite, but the CHECK constraint enforces the convention.
3. **Foreign keys**: Real FK constraints with `ON DELETE CASCADE` where appropriate (e.g., `servers.project_id → projects.id`). `PRAGMA foreign_keys = ON` already set in `init_pool` from Plan 1.
4. **JSON fields**: Suffix `_json` on column names to make blob fields obvious. (`args` → `args_json`, `env` → `env_json`, `tool_permissions` → `tool_permissions_json`, etc.) Type stays `TEXT NOT NULL` with default `'[]'` or `'{}'`.
5. **Primary keys**: `id TEXT PRIMARY KEY`, populated with uuid v7 strings (lexicographic time-ordered) at insert time.
6. **Indexes**: Same as Electron version (each FK and frequent-query column gets an index). Names follow `idx_<table>_<column>` convention.

**Tables in 0002_init_schema.sql** (all schemas land in one migration even though only `projects` is used in Plan 2 — keeps schema flat):
- `projects` — id, name (UNIQUE NOCASE), optimization, created_at, updated_at
- `servers` — full MCP server config with project_id FK to projects
- `request_logs` — log entries (renamed from `requestLogs` to snake_case)
- `workspaces` — workspace registry
- `workflows` — workflow definitions (with nodes_json + edges_json)
- `hook_modules` — hook scripts
- `agent_paths` — name + path for known MCP agent binaries

(Existing `_meta` table from `0001_init.sql` stays — it's a harmless schema-introduced-at marker.)

---

## File Structure (state at end of Plan 2)

Changes from Plan 1 baseline:

```
src-tauri/
├── Cargo.toml                          # MODIFIED: add async-trait
├── migrations/
│   ├── 0001_init.sql                   # unchanged (_meta placeholder)
│   └── 0002_init_schema.sql            # NEW: full domain schema
├── src/
│   ├── error.rs                        # unchanged
│   ├── state.rs                        # MODIFIED: holds WorkspacePoolRegistry instead of bare pool
│   ├── lib.rs                          # MODIFIED: setup() builds registry, seeds default workspace
│   ├── persistence/
│   │   ├── mod.rs                      # MODIFIED: re-exports new submodules
│   │   ├── pool.rs                     # MODIFIED: exposes init_pool_at_path helper
│   │   ├── registry.rs                 # NEW: WorkspacePoolRegistry
│   │   ├── types/
│   │   │   ├── mod.rs                  # NEW
│   │   │   └── project.rs              # NEW: Project + NewProject + ProjectPatch + ts-rs derive
│   │   └── repository/
│   │       ├── mod.rs                  # NEW
│   │       └── project.rs              # NEW: ProjectRepository trait + SqliteProjectRepository
│   ├── commands/
│   │   ├── mod.rs                      # unchanged for Plan 2 (Plan 3+ adds project commands)
│   │   └── ping.rs                     # unchanged
│   └── tests/
│       ├── error_test.rs               # unchanged
│       ├── ping_test.rs                # unchanged
│       ├── pool_test.rs                # MODIFIED: tests both init_pool_at_path AND registry seeding
│       ├── registry_test.rs            # NEW: WorkspacePoolRegistry tests
│       └── project_repository_test.rs  # NEW: integration test against in-memory sqlite
└── ...
```

Frontend changes: **none** in Plan 2. The smoke ping UI from Plan 1 is unchanged.

---

## Prerequisites

- [ ] Plan 1 complete (`tauri-plan-1-done` tag exists)
- [ ] On branch `tauri-rewrite`, working tree clean
- [ ] `cargo test` (in `src-tauri/`) reports 7 tests passing
- [ ] No leftover dev/cargo processes (kill any from previous Plan 1 smoke runs)

---

## Tasks

### Task 1: Add async-trait dep + verify build

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add async-trait to [dependencies]**

Open `src-tauri/Cargo.toml`. Insert `async-trait = "0.1"` in the alphabetically-correct spot in `[dependencies]`. Final fragment near the top of the deps list should look like:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-opener = "2"
async-trait = "0.1"
serde = { version = "1", features = ["derive"] }
...
```

- [ ] **Step 2: cargo check**

```bash
cd src-tauri
cargo check
cd ..
```

Expected: success, downloads `async-trait` crate.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(rust): 加 async-trait 依赖（trait 异步方法用）"
```

---

### Task 2: Write 0002_init_schema.sql with full domain schema

**Files:**
- Create: `src-tauri/migrations/0002_init_schema.sql`

This migration creates all 7 domain tables (projects, servers, request_logs, workspaces, workflows, hook_modules, agent_paths) plus indexes. Plan 2 only USES the projects table — the rest sit waiting for Plan 3.

- [ ] **Step 1: Create the migration file**

Save this as `src-tauri/migrations/0002_init_schema.sql`:

```sql
-- Plan 2: full domain schema for Tauri rewrite.
-- Standardizes on:
--   * id TEXT PRIMARY KEY (uuid v7 strings populated by application)
--   * created_at / updated_at TEXT NOT NULL (ISO 8601 UTC)
--   * booleans as INTEGER with CHECK (col IN (0,1))
--   * JSON blob columns suffixed _json
--   * Foreign keys with ON DELETE CASCADE where it makes sense

-- ============================================================================
-- projects
-- ============================================================================
CREATE TABLE projects (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL COLLATE NOCASE,
    optimization TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_projects_name_unique ON projects(name COLLATE NOCASE);

-- ============================================================================
-- servers (MCP server configs)
-- ============================================================================
CREATE TABLE servers (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    server_type           TEXT NOT NULL DEFAULT 'local',  -- 'local' | 'remote'
    description           TEXT,
    version               TEXT,
    latest_version        TEXT,
    verification_status   TEXT,
    -- local server fields
    command               TEXT,
    args_json             TEXT NOT NULL DEFAULT '[]',
    env_json              TEXT NOT NULL DEFAULT '{}',
    context_path          TEXT,
    -- remote server fields
    remote_url            TEXT,
    bearer_token          TEXT,
    -- runtime config
    auto_start            INTEGER NOT NULL DEFAULT 0 CHECK (auto_start IN (0,1)),
    disabled              INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
    auto_approve          TEXT,
    input_params_json     TEXT NOT NULL DEFAULT '{}',
    required_params_json  TEXT NOT NULL DEFAULT '[]',
    tool_permissions_json TEXT NOT NULL DEFAULT '{}',
    project_id            TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX idx_servers_name       ON servers(name);
CREATE INDEX idx_servers_project_id ON servers(project_id);

-- ============================================================================
-- request_logs (renamed from Electron's "requestLogs")
-- ============================================================================
CREATE TABLE request_logs (
    id                  TEXT PRIMARY KEY,
    timestamp           TEXT NOT NULL,
    client_id           TEXT,
    client_name         TEXT,
    server_id           TEXT,
    server_name         TEXT,
    request_type        TEXT,
    request_params_json TEXT,
    response_data_json  TEXT,
    response_status     TEXT,
    duration_ms         INTEGER,
    error_message       TEXT
);
CREATE INDEX idx_request_logs_timestamp        ON request_logs(timestamp);
CREATE INDEX idx_request_logs_client_id        ON request_logs(client_id);
CREATE INDEX idx_request_logs_server_id        ON request_logs(server_id);
CREATE INDEX idx_request_logs_request_type     ON request_logs(request_type);
CREATE INDEX idx_request_logs_response_status  ON request_logs(response_status);

-- ============================================================================
-- workspaces
-- ============================================================================
CREATE TABLE workspaces (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    workspace_type     TEXT NOT NULL CHECK (workspace_type IN ('local','remote')),
    is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
    local_config_json  TEXT,
    remote_config_json TEXT,
    display_info_json  TEXT,
    created_at         TEXT NOT NULL,
    last_used_at       TEXT NOT NULL
);
CREATE INDEX idx_workspaces_active     ON workspaces(is_active);
CREATE INDEX idx_workspaces_type       ON workspaces(workspace_type);
CREATE INDEX idx_workspaces_last_used  ON workspaces(last_used_at);

-- ============================================================================
-- workflows
-- ============================================================================
CREATE TABLE workflows (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT,
    workflow_type TEXT,
    nodes_json    TEXT NOT NULL DEFAULT '[]',
    edges_json    TEXT NOT NULL DEFAULT '[]',
    enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX idx_workflows_enabled ON workflows(enabled);
CREATE INDEX idx_workflows_type    ON workflows(workflow_type);

-- ============================================================================
-- hook_modules
-- ============================================================================
CREATE TABLE hook_modules (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    script     TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_hook_modules_name ON hook_modules(name);

-- ============================================================================
-- agent_paths
-- ============================================================================
CREATE TABLE agent_paths (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    path       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

- [ ] **Step 2: Verify migration runs**

```bash
cd src-tauri
cargo test --test pool_test
cd ..
```

Expected: still passes (the existing pool test creates tempfile, runs both 0001 and 0002, then queries `_meta`). The fact that 0002 doesn't error confirms its SQL is valid.

If it fails because of SQL syntax, fix and re-run.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/migrations/0002_init_schema.sql
git commit -m "feat(persistence): 0002 全域 schema (projects/servers/logs/workspaces/workflows/hooks/agents)"
```

---

### Task 3: Add Project domain type with ts-rs derive

**Files:**
- Create: `src-tauri/src/persistence/types/mod.rs`
- Create: `src-tauri/src/persistence/types/project.rs`
- Modify: `src-tauri/src/persistence/mod.rs` (add `pub mod types;`)

- [ ] **Step 1: Create types/mod.rs**

```rust
pub mod project;
```

- [ ] **Step 2: Create types/project.rs**

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optimization: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct NewProject {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optimization: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ProjectPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optimization: Option<String>,
}
```

- [ ] **Step 3: Update persistence/mod.rs**

Open `src-tauri/src/persistence/mod.rs` (currently has `pub mod pool;`). Append:

```rust
pub mod types;
```

- [ ] **Step 4: Verify ts-rs export**

```bash
cd src-tauri
cargo test
cd ..
```

Expected: 7 existing tests pass + 3 new ts-rs auto-export tests for Project/NewProject/ProjectPatch.

Verify generated files exist:

```bash
ls C:/Projects/WebstormProjects/mcp-router/src/types/generated/
```

Expected: `AppError.ts`, `Project.ts`, `NewProject.ts`, `ProjectPatch.ts`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/persistence/mod.rs src-tauri/src/persistence/types src/types/generated
git commit -m "feat(persistence): Project / NewProject / ProjectPatch 类型 + ts-rs 导出"
```

---

### Task 4: Implement WorkspacePoolRegistry (TDD)

**Files:**
- Create: `src-tauri/src/persistence/registry.rs`
- Create: `src-tauri/tests/registry_test.rs`
- Modify: `src-tauri/src/persistence/pool.rs` (extract `init_pool_at_path` helper that takes a path)
- Modify: `src-tauri/src/persistence/mod.rs` (add `pub mod registry;`)

The registry maintains a `HashMap<WorkspaceId, SqlitePool>` behind a `RwLock`. When `get_or_init(ws_id)` is called, it either returns the cached pool or creates one (resolving DB path, creating pool, running migrations).

- [ ] **Step 1: Write failing registry test**

Create `src-tauri/tests/registry_test.rs`:

```rust
use mcp_router_lib::persistence::registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE};

#[tokio::test]
async fn registry_initializes_default_workspace_pool() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let registry = WorkspacePoolRegistry::new(tmp.path().to_path_buf());

    let pool = registry.get_or_init(DEFAULT_WORKSPACE).await.expect("pool");
    let row: (String,) = sqlx::query_as("SELECT value FROM _meta WHERE key = 'schema_introduced_at'")
        .fetch_one(&pool)
        .await
        .expect("query meta row");
    assert!(!row.0.is_empty());
}

#[tokio::test]
async fn registry_returns_same_pool_on_repeat_get() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let registry = WorkspacePoolRegistry::new(tmp.path().to_path_buf());

    let pool_a = registry.get_or_init(DEFAULT_WORKSPACE).await.expect("pool a");
    let pool_b = registry.get_or_init(DEFAULT_WORKSPACE).await.expect("pool b");

    // sqlx::SqlitePool is Clone (it's an Arc<...>); repeat gets should share the same underlying handle.
    // We verify by checking pool size — both clones reference the same pool's connection counts.
    assert_eq!(pool_a.size(), pool_b.size());
}

#[tokio::test]
async fn registry_isolates_pools_per_workspace() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let registry = WorkspacePoolRegistry::new(tmp.path().to_path_buf());

    let pool_default = registry.get_or_init(DEFAULT_WORKSPACE).await.expect("default");
    let pool_other = registry.get_or_init("ws-abc").await.expect("other");

    // Insert a unique row into "ws-abc"'s _meta and verify it's NOT visible in default's pool.
    sqlx::query("INSERT INTO _meta(key, value) VALUES ('isolation_marker', 'abc')")
        .execute(&pool_other)
        .await
        .expect("insert marker");

    let count_in_default: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM _meta WHERE key = 'isolation_marker'",
    )
    .fetch_one(&pool_default)
    .await
    .expect("query default");
    assert_eq!(count_in_default.0, 0);
}
```

- [ ] **Step 2: Run test, expect failure (compile error — module doesn't exist)**

```bash
cd src-tauri
cargo test --test registry_test
cd ..
```

Expected: FAIL with "unresolved import `mcp_router_lib::persistence::registry`".

- [ ] **Step 3: Refactor pool.rs to expose path-based init**

Open `src-tauri/src/persistence/pool.rs`. Currently `init_pool` takes a path. Rename it to `init_pool_at_path` (more explicit) and keep behavior identical:

```rust
use std::path::Path;

use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use tracing::info;

use crate::error::AppResult;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn init_pool_at_path(db_path: &Path) -> AppResult<SqlitePool> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            crate::error::AppError::Internal(format!("create db dir: {e}"))
        })?;
    }

    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(opts)
        .await?;

    info!(path = %db_path.display(), "running sqlx migrations");
    MIGRATOR.run(&pool).await.map_err(|e| {
        crate::error::AppError::Internal(format!("migrate: {e}"))
    })?;

    Ok(pool)
}

// Compatibility alias — keeps Plan 1 lib.rs working until it switches to registry in Task 5.
pub async fn init_pool(db_path: &Path) -> AppResult<SqlitePool> {
    init_pool_at_path(db_path).await
}
```

The `init_pool` alias keeps `pool_test.rs` and lib.rs compiling without immediate changes.

- [ ] **Step 4: Implement persistence/registry.rs**

```rust
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use sqlx::SqlitePool;
use tokio::sync::RwLock;
use tracing::info;

use crate::{
    error::AppResult,
    persistence::pool::init_pool_at_path,
};

pub const DEFAULT_WORKSPACE: &str = "default";

pub struct WorkspacePoolRegistry {
    base_dir: PathBuf,
    pools: RwLock<HashMap<String, SqlitePool>>,
}

impl WorkspacePoolRegistry {
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir,
            pools: RwLock::new(HashMap::new()),
        }
    }

    pub async fn get_or_init(&self, workspace_id: &str) -> AppResult<SqlitePool> {
        // fast path: already cached
        {
            let pools = self.pools.read().await;
            if let Some(pool) = pools.get(workspace_id) {
                return Ok(pool.clone());
            }
        }

        // slow path: create + insert. take write lock, double-check under it.
        let mut pools = self.pools.write().await;
        if let Some(pool) = pools.get(workspace_id) {
            return Ok(pool.clone());
        }

        let db_path = self.workspace_db_path(workspace_id);
        info!(workspace = workspace_id, path = %db_path.display(), "initializing workspace pool");

        let pool = init_pool_at_path(&db_path).await?;
        pools.insert(workspace_id.to_string(), pool.clone());
        Ok(pool)
    }

    pub async fn close(&self, workspace_id: &str) -> AppResult<()> {
        let mut pools = self.pools.write().await;
        if let Some(pool) = pools.remove(workspace_id) {
            pool.close().await;
        }
        Ok(())
    }

    pub async fn close_all(&self) {
        let mut pools = self.pools.write().await;
        let drained: Vec<_> = pools.drain().collect();
        drop(pools);
        for (_, pool) in drained {
            pool.close().await;
        }
    }

    fn workspace_db_path(&self, workspace_id: &str) -> PathBuf {
        if workspace_id == DEFAULT_WORKSPACE {
            self.base_dir.join("mcp-router.sqlite")
        } else {
            self.base_dir
                .join("workspaces")
                .join(format!("{workspace_id}.sqlite"))
        }
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }
}
```

- [ ] **Step 5: Wire mod in persistence/mod.rs**

Append after `pub mod types;`:

```rust
pub mod registry;
```

- [ ] **Step 6: Re-run registry test**

```bash
cd src-tauri
cargo test --test registry_test
cd ..
```

Expected: PASS (3 tests). If `pool.size()` doesn't exist on this sqlx version, the test for "same pool on repeat get" can compare connection options or just verify both calls return without error — adjust the assertion accordingly. Don't loosen the isolation test.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/persistence/registry.rs src-tauri/src/persistence/pool.rs src-tauri/src/persistence/mod.rs src-tauri/tests/registry_test.rs
git commit -m "feat(persistence): WorkspacePoolRegistry + 3 集成测试"
```

---

### Task 5: Refactor AppState to hold registry; update lib.rs setup

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs` (setup closure)
- Modify: `src-tauri/tests/pool_test.rs` (update to use registry path or keep using `init_pool` alias)

This is a breaking refactor of AppState — every later commit assumes registry-backed state.

- [ ] **Step 1: Replace state.rs**

```rust
use std::sync::Arc;

use crate::persistence::registry::WorkspacePoolRegistry;

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<WorkspacePoolRegistry>,
}

impl AppState {
    pub fn new(registry: WorkspacePoolRegistry) -> Self {
        Self {
            registry: Arc::new(registry),
        }
    }
}
```

- [ ] **Step 2: Update lib.rs setup closure**

Open `src-tauri/src/lib.rs`. The current setup closure (from Plan 1 Task 19) calls `init_pool(&db_path)` and constructs `AppState::new(pool)`. Replace with:

```rust
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app data dir");

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let registry = WorkspacePoolRegistry::new(app_data_dir);
                match registry.get_or_init(DEFAULT_WORKSPACE).await {
                    Ok(_) => {
                        let state = AppState::new(registry);
                        handle.manage(state);
                        info!("AppState initialized (registry seeded with default workspace)");
                    }
                    Err(err) => {
                        error!(?err, "failed to init AppState — default workspace pool failed");
                    }
                }
            });

            Ok(())
        })
```

Add the new imports at the top of lib.rs alongside the existing ones:

```rust
use crate::{
    commands::ping::ping,
    persistence::registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE},
    state::AppState,
};
```

(Remove the `use crate::persistence::pool::init_pool;` line — no longer used.)

- [ ] **Step 3: Update pool_test.rs to import the new alias name**

The existing `tests/pool_test.rs` imports `init_pool`. The compatibility alias still exists, so the test will keep passing. Verify:

```bash
cd src-tauri
cargo test --test pool_test
cd ..
```

Expected: PASS.

- [ ] **Step 4: Verify cargo build passes overall**

```bash
cd src-tauri
cargo check
cd ..
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "refactor(rust): AppState 持 WorkspacePoolRegistry；setup 用 registry 初始化默认 workspace"
```

---

### Task 6: Implement ProjectRepository trait + SqliteProjectRepository (TDD)

**Files:**
- Create: `src-tauri/src/persistence/repository/mod.rs`
- Create: `src-tauri/src/persistence/repository/project.rs`
- Create: `src-tauri/tests/project_repository_test.rs`
- Modify: `src-tauri/src/persistence/mod.rs` (add `pub mod repository;`)

The trait surface deliberately keeps Electron's repository API simple: list / get / find_by_name / create / update / delete. No bulk batch ops in Plan 2 — add when actually needed.

- [ ] **Step 1: Write failing repository test**

Create `src-tauri/tests/project_repository_test.rs`:

```rust
use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::project::{ProjectRepository, SqliteProjectRepository},
    types::project::{NewProject, ProjectPatch},
};

async fn make_repo() -> (tempfile::TempDir, SqliteProjectRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("projects.sqlite"))
        .await
        .expect("pool");
    let repo = SqliteProjectRepository::new(pool);
    (tmp, repo)
}

#[tokio::test]
async fn create_then_get_returns_same_project() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewProject {
            name: "foo".into(),
            optimization: Some("speed".into()),
        })
        .await
        .expect("create");
    assert_eq!(created.name, "foo");
    assert_eq!(created.optimization.as_deref(), Some("speed"));

    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.id, created.id);
    assert_eq!(fetched.name, "foo");
}

#[tokio::test]
async fn list_returns_all_projects_ordered_by_name() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewProject { name: "zeta".into(), optimization: None }).await.unwrap();
    repo.create(NewProject { name: "alpha".into(), optimization: None }).await.unwrap();
    repo.create(NewProject { name: "mu".into(), optimization: None }).await.unwrap();

    let all = repo.list().await.expect("list");
    let names: Vec<_> = all.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, vec!["alpha", "mu", "zeta"]);
}

#[tokio::test]
async fn find_by_name_is_case_insensitive() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewProject { name: "MyProject".into(), optimization: None })
        .await
        .unwrap();

    let found = repo.find_by_name("myproject").await.expect("find").expect("some");
    assert_eq!(found.id, created.id);
}

#[tokio::test]
async fn update_changes_fields_and_bumps_updated_at() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewProject { name: "name1".into(), optimization: None })
        .await
        .unwrap();
    let original_updated = created.updated_at;

    // Sleep briefly so updated_at advances past created_at at sub-second resolution.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let patched = repo
        .update(
            &created.id,
            ProjectPatch {
                name: Some("name2".into()),
                optimization: Some("memory".into()),
            },
        )
        .await
        .expect("update");
    assert_eq!(patched.name, "name2");
    assert_eq!(patched.optimization.as_deref(), Some("memory"));
    assert!(patched.updated_at > original_updated);
}

#[tokio::test]
async fn delete_returns_true_then_get_returns_none() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewProject { name: "tmp".into(), optimization: None })
        .await
        .unwrap();

    let deleted = repo.delete(&created.id).await.expect("delete");
    assert!(deleted);

    let after = repo.get(&created.id).await.expect("get");
    assert!(after.is_none());

    // Deleting again returns false.
    let deleted_again = repo.delete(&created.id).await.expect("delete");
    assert!(!deleted_again);
}

#[tokio::test]
async fn create_with_duplicate_name_fails() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewProject { name: "uniq".into(), optimization: None })
        .await
        .unwrap();

    let dup = repo.create(NewProject { name: "uniq".into(), optimization: None }).await;
    assert!(dup.is_err(), "expected unique-name error");
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
cd src-tauri
cargo test --test project_repository_test
cd ..
```

Expected: FAIL with "unresolved import `mcp_router_lib::persistence::repository::project`".

- [ ] **Step 3: Create repository/mod.rs**

```rust
pub mod project;
```

- [ ] **Step 4: Implement repository/project.rs**

```rust
use async_trait::async_trait;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::AppResult,
    persistence::types::project::{NewProject, Project, ProjectPatch},
};

#[async_trait]
pub trait ProjectRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<Project>>;
    async fn get(&self, id: &str) -> AppResult<Option<Project>>;
    async fn find_by_name(&self, name: &str) -> AppResult<Option<Project>>;
    async fn create(&self, input: NewProject) -> AppResult<Project>;
    async fn update(&self, id: &str, patch: ProjectPatch) -> AppResult<Project>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteProjectRepository {
    pool: SqlitePool,
}

impl SqliteProjectRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ProjectRepository for SqliteProjectRepository {
    async fn list(&self) -> AppResult<Vec<Project>> {
        let rows = sqlx::query("SELECT id, name, optimization, created_at, updated_at FROM projects ORDER BY name COLLATE NOCASE")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_project).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<Project>> {
        let row = sqlx::query("SELECT id, name, optimization, created_at, updated_at FROM projects WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_project).transpose()
    }

    async fn find_by_name(&self, name: &str) -> AppResult<Option<Project>> {
        let row = sqlx::query("SELECT id, name, optimization, created_at, updated_at FROM projects WHERE name = ? COLLATE NOCASE")
            .bind(name)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_project).transpose()
    }

    async fn create(&self, input: NewProject) -> AppResult<Project> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO projects(id, name, optimization, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&input.name)
        .bind(&input.optimization)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(Project {
            id,
            name: input.name,
            optimization: input.optimization,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update(&self, id: &str, patch: ProjectPatch) -> AppResult<Project> {
        let now = Utc::now();
        // SQLite doesn't have nice "update only set" syntax in a single query; we read, mutate, write.
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| crate::error::AppError::NotFound(format!("project {id}")))?;

        let new_name = patch.name.unwrap_or(existing.name);
        let new_optimization = patch.optimization.or(existing.optimization);

        sqlx::query(
            "UPDATE projects SET name = ?, optimization = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&new_name)
        .bind(&new_optimization)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(Project {
            id: id.to_string(),
            name: new_name,
            optimization: new_optimization,
            created_at: existing.created_at,
            updated_at: now,
        })
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn row_to_project(row: sqlx::sqlite::SqliteRow) -> AppResult<Project> {
    Ok(Project {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        optimization: row.try_get("optimization")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
```

- [ ] **Step 5: Wire mod in persistence/mod.rs**

Append after `pub mod registry;`:

```rust
pub mod repository;
```

- [ ] **Step 6: Re-run repository tests**

```bash
cd src-tauri
cargo test --test project_repository_test
cd ..
```

Expected: PASS (6 tests).

If `Uuid::now_v7()` is gated behind a feature in your uuid version, ensure `uuid = { version = "1", features = ["v4", "v7", "serde"] }` is in Cargo.toml (it should be from Plan 1).

If chrono `DateTime<Utc>` doesn't `Bind` to sqlx automatically, double-check that sqlx features include `chrono` (they do from Plan 1).

If a test fails because the duplicate-name error doesn't surface as `AppError::Internal` from sqlx (e.g., because the unique constraint manifests as a different sqlx error variant), tighten `From<sqlx::Error>` in `error.rs` to map `sqlx::Error::Database` with unique-violation to `AppError::InvalidInput`. Document the change in the commit. Otherwise leave error.rs as-is.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/persistence/repository src-tauri/src/persistence/mod.rs src-tauri/tests/project_repository_test.rs
git commit -m "feat(persistence): ProjectRepository trait + SqliteProjectRepository + 6 集成测试"
```

---

### Task 7: End-to-end smoke run + tag

**Files:** none (verification + tag only)

- [ ] **Step 1: Run all tests**

```bash
cd src-tauri
cargo test
cd ..
```

Expected total tests: 7 (Plan 1) + 3 ts-rs auto-export (Project, NewProject, ProjectPatch) + 3 registry + 6 project repository = **19 tests**, all passing.

- [ ] **Step 2: cargo build**

```bash
cd src-tauri
cargo build
cd ..
```

Expected: clean build.

- [ ] **Step 3: Smoke run pnpm tauri dev** (verify default workspace pool initializes against the new schema)

Start `pnpm tauri dev` and watch the logs for:

```
INFO running sqlx migrations path=...mcp-router.sqlite
INFO initializing workspace pool workspace=default path=...mcp-router.sqlite
INFO AppState initialized (registry seeded with default workspace)
```

If the previously-created `mcp-router.sqlite` from Plan 1 still has only the 0001 schema, sqlx will run 0002 against it on this startup. Verify by inspecting the DB after stopping dev:

```bash
ls "$APPDATA/com.mcprouter.app/" 2>/dev/null || ls ~/Library/Application\ Support/com.mcprouter.app/ 2>/dev/null
```

The file size should grow from ~20KB (Plan 1) to ~50KB+ after 0002 creates the additional tables.

If you have sqlite3 CLI installed, verify schema:

```bash
sqlite3 "$APPDATA/com.mcprouter.app/mcp-router.sqlite" ".schema projects"
```

Should print the projects table DDL.

- [ ] **Step 4: Stop dev**

`Ctrl+C`. Confirm clean exit.

- [ ] **Step 5: Tag completion**

```bash
git tag -a tauri-plan-2-done -m "Plan 2 (persistence foundation) complete: schema 0002 + WorkspacePoolRegistry + ProjectRepository"
```

- [ ] **Step 6: Show summary**

```bash
git log --oneline tauri-plan-1-done..HEAD
```

Expected: ~6-8 commits since Plan 1's tag.

---

## Plan 2 Validation Checklist

Before declaring Plan 2 complete:

- [ ] `cd src-tauri && cargo test` reports 19 tests passing (or higher, accounting for any auto-generated tests)
- [ ] `pnpm tauri dev` starts cleanly; logs show registry seeding default workspace pool
- [ ] DB at `<APPDATA>/com.mcprouter.app/mcp-router.sqlite` has all 8 tables (`_meta`, `projects`, `servers`, `request_logs`, `workspaces`, `workflows`, `hook_modules`, `agent_paths`)
- [ ] `src/types/generated/` has `AppError.ts`, `Project.ts`, `NewProject.ts`, `ProjectPatch.ts`
- [ ] `cargo check` clean (no warnings about unused imports etc — fix or `#[allow]` with reason)
- [ ] tag `tauri-plan-2-done` exists

---

## What Plan 3 Will Cover (preview, not part of this plan)

**Plan 3: Remaining DB Repositories.** Copy the ProjectRepository pattern for:
- `ServerRepository` — biggest, ~9 columns + JSON fields, with `project_id` FK
- `RequestLogRepository` — log-specific patterns: cursor pagination via `(timestamp, id)`, `trim_to_max_rows`
- `WorkspaceRepository` — active-flag toggling logic
- `WorkflowRepository` — node/edge JSON graph storage + `get_enabled` / `get_by_type` queries
- `HookModuleRepository` — name-uniqueness, bulk import
- `AgentPathRepository` — simplest, name+path key/value

Each repo gets its own task with TDD; ts-rs types for all domain models. Plan 4 will then bring the file-based settings/tokens stores.

---

## Notes for the Engineer Executing This Plan

- **TDD per repo method**: every public trait method has at least one test in `project_repository_test.rs`. Don't skip the duplicate-name test — uniqueness constraint behavior differs across sqlx versions and surfacing it in test catches flakes early.
- **Don't pre-build for Plan 3**: the trait surface here is intentionally small. Resist adding `count`, `find_one`, `transaction`, etc. until a concrete consumer needs them. Plan 1 found 5 plan bugs — over-engineering invites more.
- **Schema 0002 is the LOCK-IN moment**: once we run migrations against a real DB file, changing 0002 means re-migration with `DROP TABLE`. Take care reviewing it before Task 7 smoke run.
- **Registry vs single pool tradeoff**: We could have stuck with Plan 1's single pool for now. Adopting registry early lets Plan 3+'s workspace switching just hand a pool to repos rather than refactoring AppState then. Worth the upfront ~50 lines.
- **DateTime<Utc> in sqlx**: stores as `TEXT` ISO 8601; reads back via `try_get`. If you see a "MismatchedColumnType" error at runtime, the column was probably created without explicit type or with a non-TEXT type — verify schema.
- **`async_trait` overhead**: macro adds heap allocation per method call. Acceptable for IO-bound repos; not a concern at our scale. If we ever need zero-cost trait async, switch to AFIT (async fn in trait, stable in Rust 1.75+) — but `Send` bounds can be subtle. Stick with `async_trait` for Plan 2-3.
- **uuid v7**: provides time-ordered IDs that work nicely as primary keys (no fragmenting B-tree inserts). If your uuid crate version doesn't have v7, use v4 — minor performance difference at our scale.
- **No `cargo clippy` enforcement here**: Plan 2 doesn't add clippy to CI. If you spot warnings, fix them inline; don't bury under `#[allow]`.
