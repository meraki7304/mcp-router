# MCP Router Tauri Rewrite — Plan 3: Remaining DB Repositories

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 6 remaining DB-backed repositories (AgentPath, HookModule, Workspace, Workflow, RequestLog, Server), each following the `ProjectRepository` template established in Plan 2: domain type with serde + ts-rs derive → trait + `Sqlite<Name>Repository` impl → integration tests against tempfile sqlite. After completion: every table in `0002_init_schema.sql` has a working repository pair, and `cargo test` covers ~50+ tests.

**Architecture:** Same module layout as Plan 2 — `persistence/types/<name>.rs` for domain types, `persistence/repository/<name>.rs` for trait + sqlite impl, `tests/<name>_repository_test.rs` for integration tests. Each repo is independent at the code level (no inter-repo Rust dependencies); FK relationships exist only at the schema level. Ordering by complexity (simplest first) so each subagent build confidence with the pattern before tackling the harder repos.

**Tech Stack:** Same as Plan 2 — sqlx 0.8 (sqlite + macros + chrono), tokio, async-trait, ts-rs 10, chrono, uuid v7, serde_json (for JSON blob fields).

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md`

**Plan series:** Plan 3 of N. Plan 4 will tackle the file-based "repositories" (settings + tokens via SharedConfigManager-equivalent). Plan 5 will start wiring `#[tauri::command]` handlers using these repositories. Plan 6+ continues with MCP runtime.

**Out of scope for Plan 3:**
- File-based stores (Settings, Tokens — Plan 4)
- Tauri commands wiring repositories to the frontend (Plan 5)
- Workspace switching IPC / actual workspace UX (later plan)
- Encrypted credential storage on Workspace (skipped — no consumer yet)

---

## Repos to implement (in order)

| # | Repo | Schema columns | Trait method count | Notes |
|---|---|---|---|---|
| 1 | AgentPath | 5 | 6 | Simplest — name+path config entries |
| 2 | HookModule | 5 | 6 | Like AgentPath but with `script` body |
| 3 | Workspace | 9 | 8 | `is_active` flag toggling needs transactional `set_active` |
| 4 | Workflow | 9 | 8 | JSON graphs (`nodes_json`, `edges_json`); list-by-type and list-enabled queries |
| 5 | RequestLog | 12 | 3 | Append-only with cursor pagination + retention trim — different shape from CRUD repos |
| 6 | Server | 21 | 7 | Biggest — many JSON fields + project_id FK |

---

## Prerequisites

- [ ] Plan 2 complete (`tauri-plan-2-done` tag exists)
- [ ] On branch `tauri-rewrite`, working tree clean
- [ ] `cargo test` (in `src-tauri/`) reports 19 tests passing
- [ ] No leftover `pnpm tauri dev` / cargo / node processes from prior smoke runs

---

## File Structure (state at end of Plan 3)

```
src-tauri/src/persistence/
├── mod.rs                           # MODIFIED: add new repository modules
├── pool.rs                          # unchanged
├── registry.rs                      # unchanged
├── types/
│   ├── mod.rs                       # MODIFIED: add agent_path, hook_module, workspace, workflow, request_log, server
│   ├── project.rs                   # unchanged
│   ├── agent_path.rs                # NEW
│   ├── hook_module.rs               # NEW
│   ├── workspace.rs                 # NEW
│   ├── workflow.rs                  # NEW
│   ├── request_log.rs               # NEW
│   └── server.rs                    # NEW
└── repository/
    ├── mod.rs                       # MODIFIED: add new modules
    ├── project.rs                   # unchanged
    ├── agent_path.rs                # NEW
    ├── hook_module.rs               # NEW
    ├── workspace.rs                 # NEW
    ├── workflow.rs                  # NEW
    ├── request_log.rs               # NEW
    └── server.rs                    # NEW

src-tauri/tests/
├── error_test.rs                    # unchanged
├── ping_test.rs                     # unchanged
├── pool_test.rs                     # unchanged
├── registry_test.rs                 # unchanged
├── project_repository_test.rs       # unchanged
├── agent_path_repository_test.rs    # NEW
├── hook_module_repository_test.rs   # NEW
├── workspace_repository_test.rs     # NEW
├── workflow_repository_test.rs      # NEW
├── request_log_repository_test.rs   # NEW
└── server_repository_test.rs        # NEW

src/types/generated/
├── AppError.ts, Project.ts, NewProject.ts, ProjectPatch.ts                # unchanged
├── AgentPath.ts, NewAgentPath.ts, AgentPathPatch.ts                       # NEW
├── HookModule.ts, NewHookModule.ts, HookModulePatch.ts                    # NEW
├── Workspace.ts, NewWorkspace.ts, WorkspacePatch.ts,
│   LocalWorkspaceConfig.ts, RemoteWorkspaceConfig.ts, WorkspaceDisplayInfo.ts,
│   WorkspaceType.ts                                                        # NEW
├── Workflow.ts, NewWorkflow.ts, WorkflowPatch.ts                          # NEW
├── RequestLog.ts, NewRequestLog.ts, RequestLogQuery.ts,
│   RequestLogCursor.ts, RequestLogPage.ts                                  # NEW
├── Server.ts, NewServer.ts, ServerPatch.ts, ServerType.ts                 # NEW
```

---

## Plan 1+2 lessons learned (apply preemptively)

The execution of Plans 1-2 surfaced these gotchas — they're already correct in the code below, but listed here so the agent doesn't reintroduce:

1. **`#[ts(export, export_to = "../../src/types/generated/")]`** — TWO `..`s up. ts-rs paths are relative to the `.rs` file, not the crate root.
2. **`#[serde(...)]` attributes** require `#[derive(Serialize, Deserialize)]` on the same type — they're helper attrs registered by the derive macro.
3. **`init_pool_at_path`** is the public path-based pool init (not `init_pool` — that's a back-compat alias).
4. **Test timing**: `tokio::time::sleep(Duration::from_millis(50))` is sufficient for `updated_at > created_at` checks — chrono uses µs precision.
5. **chrono `DateTime<Utc>` + sqlx**: stored as `TEXT` ISO 8601, no special handling needed for bind/read.
6. **`Uuid::now_v7().to_string()`** for time-ordered IDs — already in Cargo features.
7. **`async_trait`**: required on both trait declaration and impl block.
8. **`From<sqlx::Error> for AppError`** exists — sqlx errors propagate via `?`.

---

## Tasks

### Task 1: AgentPathRepository (TDD)

**Files:**
- Create: `src-tauri/src/persistence/types/agent_path.rs`
- Create: `src-tauri/src/persistence/repository/agent_path.rs`
- Create: `src-tauri/tests/agent_path_repository_test.rs`
- Modify: `src-tauri/src/persistence/types/mod.rs` (add `pub mod agent_path;`)
- Modify: `src-tauri/src/persistence/repository/mod.rs` (add `pub mod agent_path;`)

**Schema reference** (from `0002_init_schema.sql`):
```sql
CREATE TABLE agent_paths (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    path       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

#### Step 1: Create domain types

`src-tauri/src/persistence/types/agent_path.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct AgentPath {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct NewAgentPath {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct AgentPathPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}
```

Append to `src-tauri/src/persistence/types/mod.rs`:

```rust
pub mod agent_path;
```

#### Step 2: Write failing test

`src-tauri/tests/agent_path_repository_test.rs`:

```rust
use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::agent_path::{AgentPathRepository, SqliteAgentPathRepository},
    types::agent_path::{AgentPathPatch, NewAgentPath},
};

async fn make_repo() -> (tempfile::TempDir, SqliteAgentPathRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("agent_paths.sqlite"))
        .await
        .expect("pool");
    (tmp, SqliteAgentPathRepository::new(pool))
}

#[tokio::test]
async fn create_then_get_returns_same_entry() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewAgentPath {
            name: "node".into(),
            path: "/usr/local/bin/node".into(),
        })
        .await
        .expect("create");
    assert_eq!(created.name, "node");
    assert_eq!(created.path, "/usr/local/bin/node");

    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.id, created.id);
}

#[tokio::test]
async fn list_orders_by_name() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewAgentPath { name: "uvx".into(), path: "/x".into() }).await.unwrap();
    repo.create(NewAgentPath { name: "node".into(), path: "/n".into() }).await.unwrap();
    repo.create(NewAgentPath { name: "deno".into(), path: "/d".into() }).await.unwrap();

    let all = repo.list().await.expect("list");
    let names: Vec<_> = all.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, vec!["deno", "node", "uvx"]);
}

#[tokio::test]
async fn find_by_name_works() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewAgentPath { name: "Bun".into(), path: "/b".into() })
        .await
        .unwrap();
    let found = repo.find_by_name("Bun").await.expect("find").expect("some");
    assert_eq!(found.id, created.id);
}

#[tokio::test]
async fn update_changes_path() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewAgentPath { name: "node".into(), path: "/old".into() })
        .await
        .unwrap();
    let original = created.updated_at;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let patched = repo
        .update(&created.id, AgentPathPatch { name: None, path: Some("/new".into()) })
        .await
        .expect("update");
    assert_eq!(patched.path, "/new");
    assert_eq!(patched.name, "node"); // unchanged
    assert!(patched.updated_at > original);
}

#[tokio::test]
async fn delete_returns_true_then_get_returns_none() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewAgentPath { name: "tmp".into(), path: "/t".into() })
        .await
        .unwrap();
    assert!(repo.delete(&created.id).await.expect("delete"));
    assert!(repo.get(&created.id).await.expect("get").is_none());
    assert!(!repo.delete(&created.id).await.expect("delete again"));
}

#[tokio::test]
async fn create_with_duplicate_name_fails() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewAgentPath { name: "uniq".into(), path: "/a".into() }).await.unwrap();
    let dup = repo.create(NewAgentPath { name: "uniq".into(), path: "/b".into() }).await;
    assert!(dup.is_err());
}
```

#### Step 3: Run test, expect compile failure

```bash
cd src-tauri
cargo test --test agent_path_repository_test
cd ..
```
Expected: FAIL with "unresolved import `mcp_router_lib::persistence::repository::agent_path`".

#### Step 4: Implement repository

`src-tauri/src/persistence/repository/agent_path.rs`:

```rust
use async_trait::async_trait;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::AppResult,
    persistence::types::agent_path::{AgentPath, AgentPathPatch, NewAgentPath},
};

#[async_trait]
pub trait AgentPathRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<AgentPath>>;
    async fn get(&self, id: &str) -> AppResult<Option<AgentPath>>;
    async fn find_by_name(&self, name: &str) -> AppResult<Option<AgentPath>>;
    async fn create(&self, input: NewAgentPath) -> AppResult<AgentPath>;
    async fn update(&self, id: &str, patch: AgentPathPatch) -> AppResult<AgentPath>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteAgentPathRepository {
    pool: SqlitePool,
}

impl SqliteAgentPathRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AgentPathRepository for SqliteAgentPathRepository {
    async fn list(&self) -> AppResult<Vec<AgentPath>> {
        let rows = sqlx::query("SELECT id, name, path, created_at, updated_at FROM agent_paths ORDER BY name COLLATE NOCASE")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_agent_path).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<AgentPath>> {
        let row = sqlx::query("SELECT id, name, path, created_at, updated_at FROM agent_paths WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_agent_path).transpose()
    }

    async fn find_by_name(&self, name: &str) -> AppResult<Option<AgentPath>> {
        let row = sqlx::query("SELECT id, name, path, created_at, updated_at FROM agent_paths WHERE name = ?")
            .bind(name)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_agent_path).transpose()
    }

    async fn create(&self, input: NewAgentPath) -> AppResult<AgentPath> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        sqlx::query("INSERT INTO agent_paths(id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&input.name)
            .bind(&input.path)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;
        Ok(AgentPath {
            id,
            name: input.name,
            path: input.path,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update(&self, id: &str, patch: AgentPathPatch) -> AppResult<AgentPath> {
        let now = Utc::now();
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| crate::error::AppError::NotFound(format!("agent_path {id}")))?;
        let new_name = patch.name.unwrap_or(existing.name);
        let new_path = patch.path.unwrap_or(existing.path);
        sqlx::query("UPDATE agent_paths SET name = ?, path = ?, updated_at = ? WHERE id = ?")
            .bind(&new_name)
            .bind(&new_path)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(AgentPath {
            id: id.to_string(),
            name: new_name,
            path: new_path,
            created_at: existing.created_at,
            updated_at: now,
        })
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM agent_paths WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn row_to_agent_path(row: sqlx::sqlite::SqliteRow) -> AppResult<AgentPath> {
    Ok(AgentPath {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        path: row.try_get("path")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
```

Append to `src-tauri/src/persistence/repository/mod.rs`:

```rust
pub mod agent_path;
```

#### Step 5: Re-run tests

```bash
cd src-tauri
cargo test --test agent_path_repository_test
cd ..
```
Expected: PASS (6 tests).

#### Step 6: Commit

```bash
git add src-tauri/src/persistence/types/agent_path.rs src-tauri/src/persistence/types/mod.rs src-tauri/src/persistence/repository/agent_path.rs src-tauri/src/persistence/repository/mod.rs src-tauri/tests/agent_path_repository_test.rs src/types/generated
git commit -m "feat(persistence): AgentPathRepository trait + Sqlite 实现 + 6 集成测试"
```

---

### Task 2: HookModuleRepository (TDD)

**Files:**
- Create: `src-tauri/src/persistence/types/hook_module.rs`
- Create: `src-tauri/src/persistence/repository/hook_module.rs`
- Create: `src-tauri/tests/hook_module_repository_test.rs`
- Modify: `src-tauri/src/persistence/types/mod.rs` (add `pub mod hook_module;`)
- Modify: `src-tauri/src/persistence/repository/mod.rs` (add `pub mod hook_module;`)

**Schema reference**:
```sql
CREATE TABLE hook_modules (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    script     TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

#### Step 1: Create domain types

`src-tauri/src/persistence/types/hook_module.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct HookModule {
    pub id: String,
    pub name: String,
    pub script: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct NewHookModule {
    pub name: String,
    pub script: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct HookModulePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
}
```

Append to `src-tauri/src/persistence/types/mod.rs`:

```rust
pub mod hook_module;
```

#### Step 2: Write failing test

`src-tauri/tests/hook_module_repository_test.rs`:

```rust
use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::hook_module::{HookModuleRepository, SqliteHookModuleRepository},
    types::hook_module::{HookModulePatch, NewHookModule},
};

async fn make_repo() -> (tempfile::TempDir, SqliteHookModuleRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("hooks.sqlite"))
        .await
        .expect("pool");
    (tmp, SqliteHookModuleRepository::new(pool))
}

#[tokio::test]
async fn create_then_get_round_trip() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewHookModule {
            name: "redact_pii".into(),
            script: "exports.run = (req) => req".into(),
        })
        .await
        .expect("create");
    assert_eq!(created.name, "redact_pii");
    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.script, "exports.run = (req) => req");
}

#[tokio::test]
async fn list_orders_by_name() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewHookModule { name: "z_hook".into(), script: "/* */".into() }).await.unwrap();
    repo.create(NewHookModule { name: "a_hook".into(), script: "/* */".into() }).await.unwrap();
    let all = repo.list().await.expect("list");
    assert_eq!(all[0].name, "a_hook");
    assert_eq!(all[1].name, "z_hook");
}

#[tokio::test]
async fn find_by_name_returns_none_when_missing() {
    let (_tmp, repo) = make_repo().await;
    let found = repo.find_by_name("nonexistent").await.expect("find");
    assert!(found.is_none());
}

#[tokio::test]
async fn update_replaces_script() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewHookModule { name: "h".into(), script: "v1".into() })
        .await
        .unwrap();
    let original = created.updated_at;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let patched = repo
        .update(&created.id, HookModulePatch { name: None, script: Some("v2".into()) })
        .await
        .expect("update");
    assert_eq!(patched.script, "v2");
    assert!(patched.updated_at > original);
}

#[tokio::test]
async fn delete_round_trip() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewHookModule { name: "tmp".into(), script: "//".into() })
        .await
        .unwrap();
    assert!(repo.delete(&created.id).await.expect("delete"));
    assert!(repo.get(&created.id).await.expect("get").is_none());
}

#[tokio::test]
async fn create_with_duplicate_name_fails() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewHookModule { name: "u".into(), script: "/* */".into() }).await.unwrap();
    let dup = repo.create(NewHookModule { name: "u".into(), script: "/* */".into() }).await;
    assert!(dup.is_err());
}
```

#### Step 3: Run test, expect compile failure

```bash
cd src-tauri
cargo test --test hook_module_repository_test
cd ..
```
Expected: FAIL — unresolved import.

#### Step 4: Implement repository

`src-tauri/src/persistence/repository/hook_module.rs`:

```rust
use async_trait::async_trait;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::AppResult,
    persistence::types::hook_module::{HookModule, HookModulePatch, NewHookModule},
};

#[async_trait]
pub trait HookModuleRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<HookModule>>;
    async fn get(&self, id: &str) -> AppResult<Option<HookModule>>;
    async fn find_by_name(&self, name: &str) -> AppResult<Option<HookModule>>;
    async fn create(&self, input: NewHookModule) -> AppResult<HookModule>;
    async fn update(&self, id: &str, patch: HookModulePatch) -> AppResult<HookModule>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteHookModuleRepository {
    pool: SqlitePool,
}

impl SqliteHookModuleRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl HookModuleRepository for SqliteHookModuleRepository {
    async fn list(&self) -> AppResult<Vec<HookModule>> {
        let rows = sqlx::query("SELECT id, name, script, created_at, updated_at FROM hook_modules ORDER BY name COLLATE NOCASE")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_hook).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<HookModule>> {
        let row = sqlx::query("SELECT id, name, script, created_at, updated_at FROM hook_modules WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_hook).transpose()
    }

    async fn find_by_name(&self, name: &str) -> AppResult<Option<HookModule>> {
        let row = sqlx::query("SELECT id, name, script, created_at, updated_at FROM hook_modules WHERE name = ?")
            .bind(name)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_hook).transpose()
    }

    async fn create(&self, input: NewHookModule) -> AppResult<HookModule> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        sqlx::query("INSERT INTO hook_modules(id, name, script, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&input.name)
            .bind(&input.script)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;
        Ok(HookModule {
            id,
            name: input.name,
            script: input.script,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update(&self, id: &str, patch: HookModulePatch) -> AppResult<HookModule> {
        let now = Utc::now();
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| crate::error::AppError::NotFound(format!("hook_module {id}")))?;
        let new_name = patch.name.unwrap_or(existing.name);
        let new_script = patch.script.unwrap_or(existing.script);
        sqlx::query("UPDATE hook_modules SET name = ?, script = ?, updated_at = ? WHERE id = ?")
            .bind(&new_name)
            .bind(&new_script)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(HookModule {
            id: id.to_string(),
            name: new_name,
            script: new_script,
            created_at: existing.created_at,
            updated_at: now,
        })
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM hook_modules WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn row_to_hook(row: sqlx::sqlite::SqliteRow) -> AppResult<HookModule> {
    Ok(HookModule {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        script: row.try_get("script")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
```

Append to `src-tauri/src/persistence/repository/mod.rs`:

```rust
pub mod hook_module;
```

#### Step 5: Run tests

```bash
cd src-tauri
cargo test --test hook_module_repository_test
cd ..
```
Expected: PASS (6 tests).

#### Step 6: Commit

```bash
git add src-tauri/src/persistence/types/hook_module.rs src-tauri/src/persistence/types/mod.rs src-tauri/src/persistence/repository/hook_module.rs src-tauri/src/persistence/repository/mod.rs src-tauri/tests/hook_module_repository_test.rs src/types/generated
git commit -m "feat(persistence): HookModuleRepository trait + Sqlite 实现 + 6 集成测试"
```

---

### Task 3: WorkspaceRepository (TDD)

**Files:**
- Create: `src-tauri/src/persistence/types/workspace.rs`
- Create: `src-tauri/src/persistence/repository/workspace.rs`
- Create: `src-tauri/tests/workspace_repository_test.rs`
- Modify: `src-tauri/src/persistence/types/mod.rs` (add `pub mod workspace;`)
- Modify: `src-tauri/src/persistence/repository/mod.rs` (add `pub mod workspace;`)

**Schema reference**:
```sql
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
```

This repo introduces three new patterns over the simple ones:
1. **Enum field** — `workspace_type` is `local | remote`. Use a Rust `enum` with `#[serde(rename_all = "lowercase")]`.
2. **Optional JSON blob fields** — `local_config_json`, `remote_config_json`, `display_info_json` are nullable JSON; deserialize with `serde_json::from_str` lazily; round-trip through typed structs.
3. **Active-flag toggle** — `set_active(id)` must atomically clear the previous active workspace and set the target. Use `pool.begin()` for a transaction.

#### Step 1: Create domain types

`src-tauri/src/persistence/types/workspace.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceType {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct LocalWorkspaceConfig {
    pub database_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct RemoteWorkspaceConfig {
    pub api_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct WorkspaceDisplayInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub workspace_type: WorkspaceType,
    pub is_active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_config: Option<LocalWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_config: Option<RemoteWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_info: Option<WorkspaceDisplayInfo>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct NewWorkspace {
    pub name: String,
    pub workspace_type: WorkspaceType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_config: Option<LocalWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_config: Option<RemoteWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_info: Option<WorkspaceDisplayInfo>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct WorkspacePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_config: Option<LocalWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_config: Option<RemoteWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_info: Option<WorkspaceDisplayInfo>,
}
```

Append to `src-tauri/src/persistence/types/mod.rs`:

```rust
pub mod workspace;
```

#### Step 2: Write failing test

`src-tauri/tests/workspace_repository_test.rs`:

```rust
use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::workspace::{SqliteWorkspaceRepository, WorkspaceRepository},
    types::workspace::{
        LocalWorkspaceConfig, NewWorkspace, RemoteWorkspaceConfig, WorkspaceDisplayInfo,
        WorkspacePatch, WorkspaceType,
    },
};

async fn make_repo() -> (tempfile::TempDir, SqliteWorkspaceRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("ws.sqlite"))
        .await
        .expect("pool");
    (tmp, SqliteWorkspaceRepository::new(pool))
}

#[tokio::test]
async fn create_local_workspace_round_trip() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkspace {
            name: "my local".into(),
            workspace_type: WorkspaceType::Local,
            local_config: Some(LocalWorkspaceConfig {
                database_path: "/tmp/foo.sqlite".into(),
            }),
            remote_config: None,
            display_info: None,
        })
        .await
        .expect("create");
    assert_eq!(created.workspace_type, WorkspaceType::Local);
    assert_eq!(
        created.local_config.as_ref().map(|c| c.database_path.as_str()),
        Some("/tmp/foo.sqlite")
    );
    assert!(!created.is_active);

    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.id, created.id);
    assert_eq!(fetched.local_config.unwrap().database_path, "/tmp/foo.sqlite");
}

#[tokio::test]
async fn create_remote_workspace_with_display_info() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkspace {
            name: "team-cloud".into(),
            workspace_type: WorkspaceType::Remote,
            local_config: None,
            remote_config: Some(RemoteWorkspaceConfig {
                api_url: "https://example.com/mcp".into(),
                auth_token: Some("xoxp-...".into()),
            }),
            display_info: Some(WorkspaceDisplayInfo {
                avatar_url: Some("https://cdn.example.com/team.png".into()),
                team_name: Some("Team Awesome".into()),
            }),
        })
        .await
        .expect("create");
    assert_eq!(created.workspace_type, WorkspaceType::Remote);
    assert_eq!(
        created.remote_config.as_ref().unwrap().api_url,
        "https://example.com/mcp"
    );
    assert_eq!(
        created.display_info.as_ref().unwrap().team_name.as_deref(),
        Some("Team Awesome")
    );
}

#[tokio::test]
async fn list_returns_all_workspaces_ordered_by_last_used_desc() {
    let (_tmp, repo) = make_repo().await;
    let a = repo
        .create(NewWorkspace {
            name: "a".into(),
            workspace_type: WorkspaceType::Local,
            local_config: None,
            remote_config: None,
            display_info: None,
        })
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    let b = repo
        .create(NewWorkspace {
            name: "b".into(),
            workspace_type: WorkspaceType::Local,
            local_config: None,
            remote_config: None,
            display_info: None,
        })
        .await
        .unwrap();

    let all = repo.list().await.expect("list");
    // most-recently-created first
    assert_eq!(all[0].id, b.id);
    assert_eq!(all[1].id, a.id);
}

#[tokio::test]
async fn set_active_clears_previous_and_marks_target() {
    let (_tmp, repo) = make_repo().await;
    let a = repo
        .create(NewWorkspace {
            name: "a".into(),
            workspace_type: WorkspaceType::Local,
            local_config: None,
            remote_config: None,
            display_info: None,
        })
        .await
        .unwrap();
    let b = repo
        .create(NewWorkspace {
            name: "b".into(),
            workspace_type: WorkspaceType::Local,
            local_config: None,
            remote_config: None,
            display_info: None,
        })
        .await
        .unwrap();

    repo.set_active(&a.id).await.expect("set a active");
    let active1 = repo.get_active().await.expect("active").expect("some");
    assert_eq!(active1.id, a.id);

    // Switching to b clears a.
    repo.set_active(&b.id).await.expect("set b active");
    let active2 = repo.get_active().await.expect("active").expect("some");
    assert_eq!(active2.id, b.id);
    let still_a = repo.get(&a.id).await.expect("get a").expect("some");
    assert!(!still_a.is_active);
}

#[tokio::test]
async fn get_active_returns_none_when_no_active() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewWorkspace {
        name: "w".into(),
        workspace_type: WorkspaceType::Local,
        local_config: None,
        remote_config: None,
        display_info: None,
    })
    .await
    .unwrap();

    let active = repo.get_active().await.expect("active");
    assert!(active.is_none());
}

#[tokio::test]
async fn update_changes_name_and_display_info() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkspace {
            name: "old".into(),
            workspace_type: WorkspaceType::Remote,
            local_config: None,
            remote_config: Some(RemoteWorkspaceConfig {
                api_url: "https://x.invalid".into(),
                auth_token: None,
            }),
            display_info: None,
        })
        .await
        .unwrap();

    let patched = repo
        .update(
            &created.id,
            WorkspacePatch {
                name: Some("new".into()),
                local_config: None,
                remote_config: None,
                display_info: Some(WorkspaceDisplayInfo {
                    avatar_url: None,
                    team_name: Some("Team X".into()),
                }),
            },
        )
        .await
        .expect("update");
    assert_eq!(patched.name, "new");
    assert_eq!(
        patched.display_info.as_ref().unwrap().team_name.as_deref(),
        Some("Team X")
    );
    // remote_config unchanged
    assert_eq!(patched.remote_config.as_ref().unwrap().api_url, "https://x.invalid");
}

#[tokio::test]
async fn delete_round_trip() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkspace {
            name: "tmp".into(),
            workspace_type: WorkspaceType::Local,
            local_config: None,
            remote_config: None,
            display_info: None,
        })
        .await
        .unwrap();
    assert!(repo.delete(&created.id).await.expect("delete"));
    assert!(repo.get(&created.id).await.expect("get").is_none());
}
```

#### Step 3: Run test, expect compile failure

```bash
cd src-tauri
cargo test --test workspace_repository_test
cd ..
```
Expected: FAIL — unresolved import.

#### Step 4: Implement repository

`src-tauri/src/persistence/repository/workspace.rs`:

```rust
use async_trait::async_trait;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    persistence::types::workspace::{
        LocalWorkspaceConfig, NewWorkspace, RemoteWorkspaceConfig, Workspace, WorkspaceDisplayInfo,
        WorkspacePatch, WorkspaceType,
    },
};

#[async_trait]
pub trait WorkspaceRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<Workspace>>;
    async fn get(&self, id: &str) -> AppResult<Option<Workspace>>;
    async fn get_active(&self) -> AppResult<Option<Workspace>>;
    async fn create(&self, input: NewWorkspace) -> AppResult<Workspace>;
    async fn update(&self, id: &str, patch: WorkspacePatch) -> AppResult<Workspace>;
    async fn set_active(&self, id: &str) -> AppResult<Workspace>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteWorkspaceRepository {
    pool: SqlitePool,
}

impl SqliteWorkspaceRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

const SELECT_COLS: &str = "id, name, workspace_type, is_active, local_config_json, remote_config_json, display_info_json, created_at, last_used_at";

#[async_trait]
impl WorkspaceRepository for SqliteWorkspaceRepository {
    async fn list(&self) -> AppResult<Vec<Workspace>> {
        let q = format!("SELECT {SELECT_COLS} FROM workspaces ORDER BY last_used_at DESC");
        let rows = sqlx::query(&q).fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_workspace).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<Workspace>> {
        let q = format!("SELECT {SELECT_COLS} FROM workspaces WHERE id = ?");
        let row = sqlx::query(&q).bind(id).fetch_optional(&self.pool).await?;
        row.map(row_to_workspace).transpose()
    }

    async fn get_active(&self) -> AppResult<Option<Workspace>> {
        let q = format!("SELECT {SELECT_COLS} FROM workspaces WHERE is_active = 1 LIMIT 1");
        let row = sqlx::query(&q).fetch_optional(&self.pool).await?;
        row.map(row_to_workspace).transpose()
    }

    async fn create(&self, input: NewWorkspace) -> AppResult<Workspace> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        let local_json = input
            .local_config
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode local_config: {e}")))?;
        let remote_json = input
            .remote_config
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode remote_config: {e}")))?;
        let display_json = input
            .display_info
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode display_info: {e}")))?;

        sqlx::query("INSERT INTO workspaces(id, name, workspace_type, is_active, local_config_json, remote_config_json, display_info_json, created_at, last_used_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&input.name)
            .bind(workspace_type_to_str(input.workspace_type))
            .bind(&local_json)
            .bind(&remote_json)
            .bind(&display_json)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;

        Ok(Workspace {
            id,
            name: input.name,
            workspace_type: input.workspace_type,
            is_active: false,
            local_config: input.local_config,
            remote_config: input.remote_config,
            display_info: input.display_info,
            created_at: now,
            last_used_at: now,
        })
    }

    async fn update(&self, id: &str, patch: WorkspacePatch) -> AppResult<Workspace> {
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("workspace {id}")))?;

        let new_name = patch.name.unwrap_or(existing.name);
        let new_local = patch.local_config.or(existing.local_config);
        let new_remote = patch.remote_config.or(existing.remote_config);
        let new_display = patch.display_info.or(existing.display_info);

        let local_json = new_local
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode local_config: {e}")))?;
        let remote_json = new_remote
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode remote_config: {e}")))?;
        let display_json = new_display
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode display_info: {e}")))?;

        sqlx::query("UPDATE workspaces SET name = ?, local_config_json = ?, remote_config_json = ?, display_info_json = ? WHERE id = ?")
            .bind(&new_name)
            .bind(&local_json)
            .bind(&remote_json)
            .bind(&display_json)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(Workspace {
            id: id.to_string(),
            name: new_name,
            workspace_type: existing.workspace_type,
            is_active: existing.is_active,
            local_config: new_local,
            remote_config: new_remote,
            display_info: new_display,
            created_at: existing.created_at,
            last_used_at: existing.last_used_at,
        })
    }

    async fn set_active(&self, id: &str) -> AppResult<Workspace> {
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE workspaces SET is_active = 0 WHERE is_active = 1")
            .execute(&mut *tx)
            .await?;
        let res = sqlx::query("UPDATE workspaces SET is_active = 1, last_used_at = ? WHERE id = ?")
            .bind(now)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("workspace {id}")));
        }
        tx.commit().await?;

        self.get(id)
            .await?
            .ok_or_else(|| AppError::Internal("workspace vanished after set_active".into()))
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM workspaces WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn workspace_type_to_str(ty: WorkspaceType) -> &'static str {
    match ty {
        WorkspaceType::Local => "local",
        WorkspaceType::Remote => "remote",
    }
}

fn workspace_type_from_str(s: &str) -> AppResult<WorkspaceType> {
    match s {
        "local" => Ok(WorkspaceType::Local),
        "remote" => Ok(WorkspaceType::Remote),
        other => Err(AppError::Internal(format!("unknown workspace_type: {other}"))),
    }
}

fn row_to_workspace(row: sqlx::sqlite::SqliteRow) -> AppResult<Workspace> {
    let workspace_type_str: String = row.try_get("workspace_type")?;
    let is_active_i: i64 = row.try_get("is_active")?;

    let local_json: Option<String> = row.try_get("local_config_json")?;
    let local_config: Option<LocalWorkspaceConfig> = local_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| AppError::Internal(format!("decode local_config: {e}")))?;

    let remote_json: Option<String> = row.try_get("remote_config_json")?;
    let remote_config: Option<RemoteWorkspaceConfig> = remote_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| AppError::Internal(format!("decode remote_config: {e}")))?;

    let display_json: Option<String> = row.try_get("display_info_json")?;
    let display_info: Option<WorkspaceDisplayInfo> = display_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| AppError::Internal(format!("decode display_info: {e}")))?;

    Ok(Workspace {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        workspace_type: workspace_type_from_str(&workspace_type_str)?,
        is_active: is_active_i != 0,
        local_config,
        remote_config,
        display_info,
        created_at: row.try_get("created_at")?,
        last_used_at: row.try_get("last_used_at")?,
    })
}
```

Append to `src-tauri/src/persistence/repository/mod.rs`:

```rust
pub mod workspace;
```

#### Step 5: Run tests

```bash
cd src-tauri
cargo test --test workspace_repository_test
cd ..
```
Expected: PASS (7 tests).

#### Step 6: Commit

```bash
git add src-tauri/src/persistence/types/workspace.rs src-tauri/src/persistence/types/mod.rs src-tauri/src/persistence/repository/workspace.rs src-tauri/src/persistence/repository/mod.rs src-tauri/tests/workspace_repository_test.rs src/types/generated
git commit -m "feat(persistence): WorkspaceRepository (含 set_active 事务) + 7 集成测试"
```

---

### Task 4: WorkflowRepository (TDD)

**Files:**
- Create: `src-tauri/src/persistence/types/workflow.rs`
- Create: `src-tauri/src/persistence/repository/workflow.rs`
- Create: `src-tauri/tests/workflow_repository_test.rs`
- Modify: `src-tauri/src/persistence/types/mod.rs` (add `pub mod workflow;`)
- Modify: `src-tauri/src/persistence/repository/mod.rs` (add `pub mod workflow;`)

**Schema reference**:
```sql
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
```

For Plan 3 we keep `nodes` and `edges` as `serde_json::Value` — the actual node/edge schemas are owned by the workflow editor (xyflow on the frontend). Plan 4+ may strict-type these once we wire the executor.

#### Step 1: Create domain types

`src-tauri/src/persistence/types/workflow.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct Workflow {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_type: Option<String>,
    #[ts(type = "unknown[]")]
    pub nodes: Value,
    #[ts(type = "unknown[]")]
    pub edges: Value,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct NewWorkflow {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_type: Option<String>,
    #[ts(type = "unknown[]")]
    pub nodes: Value,
    #[ts(type = "unknown[]")]
    pub edges: Value,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct WorkflowPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "unknown[] | undefined", optional)]
    pub nodes: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "unknown[] | undefined", optional)]
    pub edges: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}
```

Append to `src-tauri/src/persistence/types/mod.rs`:

```rust
pub mod workflow;
```

#### Step 2: Write failing test

`src-tauri/tests/workflow_repository_test.rs`:

```rust
use serde_json::json;

use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::workflow::{SqliteWorkflowRepository, WorkflowRepository},
    types::workflow::{NewWorkflow, WorkflowPatch},
};

async fn make_repo() -> (tempfile::TempDir, SqliteWorkflowRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("wf.sqlite"))
        .await
        .expect("pool");
    (tmp, SqliteWorkflowRepository::new(pool))
}

fn sample_nodes() -> serde_json::Value {
    json!([{ "id": "start", "type": "start" }, { "id": "end", "type": "end" }])
}

fn sample_edges() -> serde_json::Value {
    json!([{ "from": "start", "to": "end" }])
}

#[tokio::test]
async fn create_then_get_round_trip_preserves_graph_json() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkflow {
            name: "primary".into(),
            description: Some("hello".into()),
            workflow_type: Some("default".into()),
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .expect("create");
    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.name, "primary");
    assert!(fetched.enabled);
    assert_eq!(fetched.nodes, sample_nodes());
    assert_eq!(fetched.edges, sample_edges());
}

#[tokio::test]
async fn list_returns_all_ordered_by_updated_at_desc() {
    let (_tmp, repo) = make_repo().await;
    let a = repo
        .create(NewWorkflow {
            name: "a".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    let b = repo
        .create(NewWorkflow {
            name: "b".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();

    let all = repo.list().await.expect("list");
    // most-recently-updated first
    assert_eq!(all[0].id, b.id);
    assert_eq!(all[1].id, a.id);
}

#[tokio::test]
async fn list_enabled_filters_disabled_rows() {
    let (_tmp, repo) = make_repo().await;
    let on = repo
        .create(NewWorkflow {
            name: "on".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();
    let off = repo
        .create(NewWorkflow {
            name: "off".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: false,
        })
        .await
        .unwrap();

    let enabled_only = repo.list_enabled().await.expect("list_enabled");
    let ids: Vec<_> = enabled_only.iter().map(|w| w.id.as_str()).collect();
    assert!(ids.contains(&on.id.as_str()));
    assert!(!ids.contains(&off.id.as_str()));
}

#[tokio::test]
async fn list_by_type_filters_correctly() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewWorkflow {
        name: "a".into(),
        description: None,
        workflow_type: Some("default".into()),
        nodes: sample_nodes(),
        edges: sample_edges(),
        enabled: true,
    })
    .await
    .unwrap();
    repo.create(NewWorkflow {
        name: "b".into(),
        description: None,
        workflow_type: Some("hook".into()),
        nodes: sample_nodes(),
        edges: sample_edges(),
        enabled: true,
    })
    .await
    .unwrap();

    let defaults = repo.list_by_type("default").await.expect("by type");
    assert_eq!(defaults.len(), 1);
    assert_eq!(defaults[0].name, "a");
}

#[tokio::test]
async fn update_replaces_nodes_and_bumps_updated_at() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkflow {
            name: "w".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();
    let original = created.updated_at;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let new_nodes = json!([{ "id": "x" }]);
    let patched = repo
        .update(
            &created.id,
            WorkflowPatch {
                nodes: Some(new_nodes.clone()),
                ..Default::default()
            },
        )
        .await
        .expect("update");
    assert_eq!(patched.nodes, new_nodes);
    assert!(patched.updated_at > original);
}

#[tokio::test]
async fn update_can_disable() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkflow {
            name: "w".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();
    let patched = repo
        .update(
            &created.id,
            WorkflowPatch {
                enabled: Some(false),
                ..Default::default()
            },
        )
        .await
        .expect("update");
    assert!(!patched.enabled);
}

#[tokio::test]
async fn delete_round_trip() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkflow {
            name: "tmp".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();
    assert!(repo.delete(&created.id).await.expect("delete"));
    assert!(repo.get(&created.id).await.expect("get").is_none());
}
```

#### Step 3: Run test, expect compile failure

```bash
cd src-tauri
cargo test --test workflow_repository_test
cd ..
```
Expected: FAIL — unresolved import.

#### Step 4: Implement repository

`src-tauri/src/persistence/repository/workflow.rs`:

```rust
use async_trait::async_trait;
use chrono::Utc;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    persistence::types::workflow::{NewWorkflow, Workflow, WorkflowPatch},
};

#[async_trait]
pub trait WorkflowRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<Workflow>>;
    async fn list_enabled(&self) -> AppResult<Vec<Workflow>>;
    async fn list_by_type(&self, workflow_type: &str) -> AppResult<Vec<Workflow>>;
    async fn get(&self, id: &str) -> AppResult<Option<Workflow>>;
    async fn create(&self, input: NewWorkflow) -> AppResult<Workflow>;
    async fn update(&self, id: &str, patch: WorkflowPatch) -> AppResult<Workflow>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteWorkflowRepository {
    pool: SqlitePool,
}

impl SqliteWorkflowRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

const SELECT_COLS: &str = "id, name, description, workflow_type, nodes_json, edges_json, enabled, created_at, updated_at";

#[async_trait]
impl WorkflowRepository for SqliteWorkflowRepository {
    async fn list(&self) -> AppResult<Vec<Workflow>> {
        let q = format!("SELECT {SELECT_COLS} FROM workflows ORDER BY updated_at DESC");
        let rows = sqlx::query(&q).fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_workflow).collect()
    }

    async fn list_enabled(&self) -> AppResult<Vec<Workflow>> {
        let q = format!("SELECT {SELECT_COLS} FROM workflows WHERE enabled = 1 ORDER BY updated_at DESC");
        let rows = sqlx::query(&q).fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_workflow).collect()
    }

    async fn list_by_type(&self, workflow_type: &str) -> AppResult<Vec<Workflow>> {
        let q = format!("SELECT {SELECT_COLS} FROM workflows WHERE workflow_type = ? ORDER BY updated_at DESC");
        let rows = sqlx::query(&q)
            .bind(workflow_type)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_workflow).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<Workflow>> {
        let q = format!("SELECT {SELECT_COLS} FROM workflows WHERE id = ?");
        let row = sqlx::query(&q).bind(id).fetch_optional(&self.pool).await?;
        row.map(row_to_workflow).transpose()
    }

    async fn create(&self, input: NewWorkflow) -> AppResult<Workflow> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        let nodes_json = serde_json::to_string(&input.nodes)
            .map_err(|e| AppError::Internal(format!("encode nodes: {e}")))?;
        let edges_json = serde_json::to_string(&input.edges)
            .map_err(|e| AppError::Internal(format!("encode edges: {e}")))?;
        let enabled_i = if input.enabled { 1 } else { 0 };

        sqlx::query("INSERT INTO workflows(id, name, description, workflow_type, nodes_json, edges_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&input.name)
            .bind(&input.description)
            .bind(&input.workflow_type)
            .bind(&nodes_json)
            .bind(&edges_json)
            .bind(enabled_i)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;

        Ok(Workflow {
            id,
            name: input.name,
            description: input.description,
            workflow_type: input.workflow_type,
            nodes: input.nodes,
            edges: input.edges,
            enabled: input.enabled,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update(&self, id: &str, patch: WorkflowPatch) -> AppResult<Workflow> {
        let now = Utc::now();
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("workflow {id}")))?;

        let new_name = patch.name.unwrap_or(existing.name);
        let new_description = patch.description.or(existing.description);
        let new_type = patch.workflow_type.or(existing.workflow_type);
        let new_nodes = patch.nodes.unwrap_or(existing.nodes);
        let new_edges = patch.edges.unwrap_or(existing.edges);
        let new_enabled = patch.enabled.unwrap_or(existing.enabled);

        let nodes_json = serde_json::to_string(&new_nodes)
            .map_err(|e| AppError::Internal(format!("encode nodes: {e}")))?;
        let edges_json = serde_json::to_string(&new_edges)
            .map_err(|e| AppError::Internal(format!("encode edges: {e}")))?;
        let enabled_i = if new_enabled { 1 } else { 0 };

        sqlx::query("UPDATE workflows SET name = ?, description = ?, workflow_type = ?, nodes_json = ?, edges_json = ?, enabled = ?, updated_at = ? WHERE id = ?")
            .bind(&new_name)
            .bind(&new_description)
            .bind(&new_type)
            .bind(&nodes_json)
            .bind(&edges_json)
            .bind(enabled_i)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(Workflow {
            id: id.to_string(),
            name: new_name,
            description: new_description,
            workflow_type: new_type,
            nodes: new_nodes,
            edges: new_edges,
            enabled: new_enabled,
            created_at: existing.created_at,
            updated_at: now,
        })
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM workflows WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn row_to_workflow(row: sqlx::sqlite::SqliteRow) -> AppResult<Workflow> {
    let nodes_json: String = row.try_get("nodes_json")?;
    let edges_json: String = row.try_get("edges_json")?;
    let enabled_i: i64 = row.try_get("enabled")?;
    let nodes: Value = serde_json::from_str(&nodes_json)
        .map_err(|e| AppError::Internal(format!("decode nodes: {e}")))?;
    let edges: Value = serde_json::from_str(&edges_json)
        .map_err(|e| AppError::Internal(format!("decode edges: {e}")))?;

    Ok(Workflow {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        workflow_type: row.try_get("workflow_type")?,
        nodes,
        edges,
        enabled: enabled_i != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
```

Append to `src-tauri/src/persistence/repository/mod.rs`:

```rust
pub mod workflow;
```

#### Step 5: Run tests

```bash
cd src-tauri
cargo test --test workflow_repository_test
cd ..
```
Expected: PASS (7 tests).

#### Step 6: Commit

```bash
git add src-tauri/src/persistence/types/workflow.rs src-tauri/src/persistence/types/mod.rs src-tauri/src/persistence/repository/workflow.rs src-tauri/src/persistence/repository/mod.rs src-tauri/tests/workflow_repository_test.rs src/types/generated
git commit -m "feat(persistence): WorkflowRepository (含 list_enabled / list_by_type) + 7 集成测试"
```

---

### Task 5: RequestLogRepository (TDD)

**Files:**
- Create: `src-tauri/src/persistence/types/request_log.rs`
- Create: `src-tauri/src/persistence/repository/request_log.rs`
- Create: `src-tauri/tests/request_log_repository_test.rs`
- Modify: `src-tauri/src/persistence/types/mod.rs` (add `pub mod request_log;`)
- Modify: `src-tauri/src/persistence/repository/mod.rs` (add `pub mod request_log;`)

**Schema reference**:
```sql
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
```

This repo has a different shape from CRUD repos: append-only writes plus paginated reads. Trait surface:
- `insert(NewRequestLog)` — write a new log row.
- `query(RequestLogQuery)` — paginated read; cursor is `(timestamp, id)` so two rows with the same timestamp are still totally ordered.
- `trim_to_max(max_rows)` — keep only the most recent `max_rows` rows; returns deleted count.

#### Step 1: Create domain types

`src-tauri/src/persistence/types/request_log.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct RequestLog {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "unknown | undefined", optional)]
    pub request_params: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "unknown | undefined", optional)]
    pub response_data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct NewRequestLog {
    pub timestamp: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "unknown | undefined", optional)]
    pub request_params: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "unknown | undefined", optional)]
    pub response_data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct RequestLogCursor {
    pub timestamp: DateTime<Utc>,
    pub id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct RequestLogQuery {
    /// Return rows with (timestamp, id) strictly less than this cursor.
    /// Use None for the first page (most-recent rows).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<RequestLogCursor>,
    /// Max rows per page. Required (no implicit limit). Range 1..=500.
    pub limit: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct RequestLogPage {
    pub items: Vec<RequestLog>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<RequestLogCursor>,
    pub has_more: bool,
}
```

Append to `src-tauri/src/persistence/types/mod.rs`:

```rust
pub mod request_log;
```

#### Step 2: Write failing test

`src-tauri/tests/request_log_repository_test.rs`:

```rust
use chrono::{Duration, Utc};
use serde_json::json;

use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::request_log::{RequestLogRepository, SqliteRequestLogRepository},
    types::request_log::{NewRequestLog, RequestLogQuery},
};

async fn make_repo() -> (tempfile::TempDir, SqliteRequestLogRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("logs.sqlite"))
        .await
        .expect("pool");
    (tmp, SqliteRequestLogRepository::new(pool))
}

fn sample(ts_offset_secs: i64, server: Option<&str>) -> NewRequestLog {
    NewRequestLog {
        timestamp: Utc::now() - Duration::seconds(ts_offset_secs),
        client_id: Some("c1".into()),
        client_name: Some("Test Client".into()),
        server_id: server.map(|s| s.to_string()),
        server_name: None,
        request_type: Some("tools/list".into()),
        request_params: Some(json!({ "foo": 1 })),
        response_data: Some(json!({ "ok": true })),
        response_status: Some("ok".into()),
        duration_ms: Some(42),
        error_message: None,
    }
}

#[tokio::test]
async fn insert_returns_log_with_assigned_id() {
    let (_tmp, repo) = make_repo().await;
    let inserted = repo.insert(sample(0, Some("s1"))).await.expect("insert");
    assert!(!inserted.id.is_empty());
    assert_eq!(inserted.server_id.as_deref(), Some("s1"));
    assert_eq!(inserted.duration_ms, Some(42));
    assert_eq!(inserted.request_params, Some(json!({ "foo": 1 })));
}

#[tokio::test]
async fn query_returns_most_recent_first_with_no_filters() {
    let (_tmp, repo) = make_repo().await;
    repo.insert(sample(10, Some("s1"))).await.unwrap();
    repo.insert(sample(5, Some("s1"))).await.unwrap();
    repo.insert(sample(0, Some("s1"))).await.unwrap();

    let page = repo
        .query(RequestLogQuery { before: None, limit: 10, ..Default::default() })
        .await
        .expect("query");
    assert_eq!(page.items.len(), 3);
    assert!(page.items[0].timestamp > page.items[1].timestamp);
    assert!(page.items[1].timestamp > page.items[2].timestamp);
    assert!(!page.has_more);
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn query_paginates_via_before_cursor() {
    let (_tmp, repo) = make_repo().await;
    for i in 0..5 {
        repo.insert(sample(i, None)).await.unwrap();
    }

    let first = repo
        .query(RequestLogQuery { before: None, limit: 2, ..Default::default() })
        .await
        .expect("first page");
    assert_eq!(first.items.len(), 2);
    assert!(first.has_more);
    let cursor = first.next_cursor.expect("cursor");

    let second = repo
        .query(RequestLogQuery { before: Some(cursor), limit: 2, ..Default::default() })
        .await
        .expect("second page");
    assert_eq!(second.items.len(), 2);
    assert!(second.items[0].timestamp < first.items[1].timestamp);
}

#[tokio::test]
async fn query_filters_by_server_id() {
    let (_tmp, repo) = make_repo().await;
    repo.insert(sample(2, Some("s1"))).await.unwrap();
    repo.insert(sample(1, Some("s2"))).await.unwrap();
    repo.insert(sample(0, Some("s1"))).await.unwrap();

    let page = repo
        .query(RequestLogQuery {
            server_id: Some("s1".into()),
            limit: 10,
            ..Default::default()
        })
        .await
        .expect("query");
    assert_eq!(page.items.len(), 2);
    assert!(page.items.iter().all(|l| l.server_id.as_deref() == Some("s1")));
}

#[tokio::test]
async fn trim_keeps_only_max_recent_rows() {
    let (_tmp, repo) = make_repo().await;
    for i in 0..10 {
        repo.insert(sample(i, None)).await.unwrap();
    }
    let deleted = repo.trim_to_max(3).await.expect("trim");
    assert_eq!(deleted, 7);

    let page = repo
        .query(RequestLogQuery { before: None, limit: 100, ..Default::default() })
        .await
        .expect("query");
    assert_eq!(page.items.len(), 3);
}

#[tokio::test]
async fn trim_with_zero_max_clears_all() {
    let (_tmp, repo) = make_repo().await;
    for _ in 0..3 {
        repo.insert(sample(0, None)).await.unwrap();
    }
    let deleted = repo.trim_to_max(0).await.expect("trim");
    assert_eq!(deleted, 3);

    let page = repo
        .query(RequestLogQuery { before: None, limit: 10, ..Default::default() })
        .await
        .expect("query");
    assert!(page.items.is_empty());
}
```

#### Step 3: Run test, expect compile failure

```bash
cd src-tauri
cargo test --test request_log_repository_test
cd ..
```
Expected: FAIL — unresolved import.

#### Step 4: Implement repository

`src-tauri/src/persistence/repository/request_log.rs`:

```rust
use async_trait::async_trait;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    persistence::types::request_log::{
        NewRequestLog, RequestLog, RequestLogCursor, RequestLogPage, RequestLogQuery,
    },
};

#[async_trait]
pub trait RequestLogRepository: Send + Sync {
    async fn insert(&self, input: NewRequestLog) -> AppResult<RequestLog>;
    async fn query(&self, query: RequestLogQuery) -> AppResult<RequestLogPage>;
    /// Keep only the `max_rows` most-recent rows. Returns the number of deleted rows.
    async fn trim_to_max(&self, max_rows: u64) -> AppResult<u64>;
}

pub struct SqliteRequestLogRepository {
    pool: SqlitePool,
}

impl SqliteRequestLogRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

const SELECT_COLS: &str = "id, timestamp, client_id, client_name, server_id, server_name, request_type, request_params_json, response_data_json, response_status, duration_ms, error_message";

#[async_trait]
impl RequestLogRepository for SqliteRequestLogRepository {
    async fn insert(&self, input: NewRequestLog) -> AppResult<RequestLog> {
        let id = Uuid::now_v7().to_string();
        let request_params_json = input
            .request_params
            .as_ref()
            .map(|v| serde_json::to_string(v))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode request_params: {e}")))?;
        let response_data_json = input
            .response_data
            .as_ref()
            .map(|v| serde_json::to_string(v))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode response_data: {e}")))?;

        sqlx::query("INSERT INTO request_logs(id, timestamp, client_id, client_name, server_id, server_name, request_type, request_params_json, response_data_json, response_status, duration_ms, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(input.timestamp)
            .bind(&input.client_id)
            .bind(&input.client_name)
            .bind(&input.server_id)
            .bind(&input.server_name)
            .bind(&input.request_type)
            .bind(&request_params_json)
            .bind(&response_data_json)
            .bind(&input.response_status)
            .bind(input.duration_ms)
            .bind(&input.error_message)
            .execute(&self.pool)
            .await?;

        Ok(RequestLog {
            id,
            timestamp: input.timestamp,
            client_id: input.client_id,
            client_name: input.client_name,
            server_id: input.server_id,
            server_name: input.server_name,
            request_type: input.request_type,
            request_params: input.request_params,
            response_data: input.response_data,
            response_status: input.response_status,
            duration_ms: input.duration_ms,
            error_message: input.error_message,
        })
    }

    async fn query(&self, q: RequestLogQuery) -> AppResult<RequestLogPage> {
        let limit = q.limit.clamp(1, 500) as i64;
        let fetch_limit = limit + 1; // +1 to detect has_more

        let mut sql = format!("SELECT {SELECT_COLS} FROM request_logs WHERE 1=1");
        if q.before.is_some() {
            sql.push_str(" AND (timestamp < ? OR (timestamp = ? AND id < ?))");
        }
        if q.server_id.is_some() {
            sql.push_str(" AND server_id = ?");
        }
        if q.client_id.is_some() {
            sql.push_str(" AND client_id = ?");
        }
        if q.request_type.is_some() {
            sql.push_str(" AND request_type = ?");
        }
        if q.response_status.is_some() {
            sql.push_str(" AND response_status = ?");
        }
        sql.push_str(" ORDER BY timestamp DESC, id DESC LIMIT ?");

        let mut query = sqlx::query(&sql);
        if let Some(c) = q.before.as_ref() {
            query = query.bind(c.timestamp).bind(c.timestamp).bind(&c.id);
        }
        if let Some(v) = q.server_id.as_ref() { query = query.bind(v); }
        if let Some(v) = q.client_id.as_ref() { query = query.bind(v); }
        if let Some(v) = q.request_type.as_ref() { query = query.bind(v); }
        if let Some(v) = q.response_status.as_ref() { query = query.bind(v); }
        query = query.bind(fetch_limit);

        let rows = query.fetch_all(&self.pool).await?;
        let mut items: Vec<RequestLog> = rows.into_iter().map(row_to_log).collect::<AppResult<_>>()?;

        let has_more = items.len() as i64 > limit;
        if has_more {
            items.truncate(limit as usize);
        }
        let next_cursor = if has_more {
            items.last().map(|last| RequestLogCursor {
                timestamp: last.timestamp,
                id: last.id.clone(),
            })
        } else {
            None
        };

        Ok(RequestLogPage {
            items,
            next_cursor,
            has_more,
        })
    }

    async fn trim_to_max(&self, max_rows: u64) -> AppResult<u64> {
        // Identify rows to keep (most-recent N), delete the rest.
        let res = sqlx::query(
            "DELETE FROM request_logs WHERE id NOT IN (
                SELECT id FROM request_logs ORDER BY timestamp DESC, id DESC LIMIT ?
            )",
        )
        .bind(max_rows as i64)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }
}

fn row_to_log(row: sqlx::sqlite::SqliteRow) -> AppResult<RequestLog> {
    let request_params_json: Option<String> = row.try_get("request_params_json")?;
    let response_data_json: Option<String> = row.try_get("response_data_json")?;
    let request_params: Option<Value> = request_params_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| AppError::Internal(format!("decode request_params: {e}")))?;
    let response_data: Option<Value> = response_data_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| AppError::Internal(format!("decode response_data: {e}")))?;

    Ok(RequestLog {
        id: row.try_get("id")?,
        timestamp: row.try_get("timestamp")?,
        client_id: row.try_get("client_id")?,
        client_name: row.try_get("client_name")?,
        server_id: row.try_get("server_id")?,
        server_name: row.try_get("server_name")?,
        request_type: row.try_get("request_type")?,
        request_params,
        response_data,
        response_status: row.try_get("response_status")?,
        duration_ms: row.try_get("duration_ms")?,
        error_message: row.try_get("error_message")?,
    })
}
```

Append to `src-tauri/src/persistence/repository/mod.rs`:

```rust
pub mod request_log;
```

#### Step 5: Run tests

```bash
cd src-tauri
cargo test --test request_log_repository_test
cd ..
```
Expected: PASS (6 tests).

#### Step 6: Commit

```bash
git add src-tauri/src/persistence/types/request_log.rs src-tauri/src/persistence/types/mod.rs src-tauri/src/persistence/repository/request_log.rs src-tauri/src/persistence/repository/mod.rs src-tauri/tests/request_log_repository_test.rs src/types/generated
git commit -m "feat(persistence): RequestLogRepository (insert / 游标分页 query / trim) + 6 测试"
```

---

### Task 6: ServerRepository (TDD)

**Files:**
- Create: `src-tauri/src/persistence/types/server.rs`
- Create: `src-tauri/src/persistence/repository/server.rs`
- Create: `src-tauri/tests/server_repository_test.rs`
- Modify: `src-tauri/src/persistence/types/mod.rs` (add `pub mod server;`)
- Modify: `src-tauri/src/persistence/repository/mod.rs` (add `pub mod server;`)

**Schema reference**:
```sql
CREATE TABLE servers (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    server_type           TEXT NOT NULL DEFAULT 'local',
    description           TEXT,
    version               TEXT,
    latest_version        TEXT,
    verification_status   TEXT,
    command               TEXT,
    args_json             TEXT NOT NULL DEFAULT '[]',
    env_json              TEXT NOT NULL DEFAULT '{}',
    context_path          TEXT,
    remote_url            TEXT,
    bearer_token          TEXT,
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
```

The biggest type. Stored in DB; runtime fields (status / logs / errors / loaded tools / resources / prompts) live in the in-memory ServerManager (Plan 6+) — NOT in the repository.

#### Step 1: Create domain types

`src-tauri/src/persistence/types/server.rs`:

```rust
use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum ServerType {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub server_type: ServerType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bearer_token: Option<String>,
    pub auto_start: bool,
    pub disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_approve: Option<String>,
    #[ts(type = "unknown")]
    pub input_params: Value,
    pub required_params: Vec<String>,
    pub tool_permissions: HashMap<String, bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct NewServer {
    pub name: String,
    pub server_type: ServerType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bearer_token: Option<String>,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_approve: Option<String>,
    #[serde(default = "default_input_params")]
    #[ts(type = "unknown")]
    pub input_params: Value,
    #[serde(default)]
    pub required_params: Vec<String>,
    #[serde(default)]
    pub tool_permissions: HashMap<String, bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

fn default_input_params() -> Value {
    Value::Object(serde_json::Map::new())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ServerPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bearer_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_start: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_approve: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "unknown | undefined", optional)]
    pub input_params: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_params: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_permissions: Option<HashMap<String, bool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}
```

Append to `src-tauri/src/persistence/types/mod.rs`:

```rust
pub mod server;
```

#### Step 2: Write failing test

`src-tauri/tests/server_repository_test.rs`:

```rust
use std::collections::HashMap;

use serde_json::json;

use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::server::{ServerRepository, SqliteServerRepository},
    types::server::{NewServer, ServerPatch, ServerType},
};

async fn make_repo() -> (tempfile::TempDir, SqliteServerRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("servers.sqlite"))
        .await
        .expect("pool");
    (tmp, SqliteServerRepository::new(pool))
}

fn local_server(name: &str) -> NewServer {
    let mut env = HashMap::new();
    env.insert("LOG_LEVEL".into(), "info".into());
    NewServer {
        name: name.into(),
        server_type: ServerType::Local,
        description: Some("test server".into()),
        command: Some("uvx".into()),
        args: vec!["mcp-server-fetch".into()],
        env,
        context_path: None,
        remote_url: None,
        bearer_token: None,
        auto_start: false,
        disabled: false,
        auto_approve: None,
        input_params: json!({ "url": "https://x" }),
        required_params: vec!["url".into()],
        tool_permissions: {
            let mut p = HashMap::new();
            p.insert("fetch".into(), true);
            p
        },
        project_id: None,
    }
}

#[tokio::test]
async fn create_local_server_round_trips_all_fields() {
    let (_tmp, repo) = make_repo().await;
    let created = repo.create(local_server("fetcher")).await.expect("create");
    assert_eq!(created.name, "fetcher");
    assert_eq!(created.server_type, ServerType::Local);
    assert_eq!(created.command.as_deref(), Some("uvx"));
    assert_eq!(created.args, vec!["mcp-server-fetch".to_string()]);
    assert_eq!(created.env.get("LOG_LEVEL").map(String::as_str), Some("info"));
    assert_eq!(created.input_params, json!({ "url": "https://x" }));
    assert_eq!(created.required_params, vec!["url".to_string()]);
    assert_eq!(created.tool_permissions.get("fetch"), Some(&true));

    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.id, created.id);
    assert_eq!(fetched.env, created.env);
    assert_eq!(fetched.tool_permissions, created.tool_permissions);
}

#[tokio::test]
async fn create_remote_server_with_url_and_token() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewServer {
            name: "remote".into(),
            server_type: ServerType::Remote,
            description: None,
            command: None,
            args: vec![],
            env: HashMap::new(),
            context_path: None,
            remote_url: Some("https://api.example.com/mcp".into()),
            bearer_token: Some("token-xyz".into()),
            auto_start: true,
            disabled: false,
            auto_approve: None,
            input_params: json!({}),
            required_params: vec![],
            tool_permissions: HashMap::new(),
            project_id: None,
        })
        .await
        .expect("create");
    assert_eq!(created.server_type, ServerType::Remote);
    assert_eq!(created.remote_url.as_deref(), Some("https://api.example.com/mcp"));
    assert_eq!(created.bearer_token.as_deref(), Some("token-xyz"));
    assert!(created.auto_start);
}

#[tokio::test]
async fn list_orders_by_name() {
    let (_tmp, repo) = make_repo().await;
    repo.create(local_server("zeta")).await.unwrap();
    repo.create(local_server("alpha")).await.unwrap();
    repo.create(local_server("mu")).await.unwrap();

    let all = repo.list().await.expect("list");
    let names: Vec<_> = all.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["alpha", "mu", "zeta"]);
}

#[tokio::test]
async fn list_by_project_filters_correctly() {
    let (_tmp, repo) = make_repo().await;
    let mut a = local_server("a");
    a.project_id = Some("proj-1".into());
    let mut b = local_server("b");
    b.project_id = Some("proj-2".into());
    let c = local_server("c"); // no project
    repo.create(a).await.unwrap();
    repo.create(b).await.unwrap();
    repo.create(c).await.unwrap();

    let in_proj1 = repo.list_by_project("proj-1").await.expect("list_by_project");
    assert_eq!(in_proj1.len(), 1);
    assert_eq!(in_proj1[0].name, "a");
}

#[tokio::test]
async fn find_by_name_works() {
    let (_tmp, repo) = make_repo().await;
    let created = repo.create(local_server("named")).await.unwrap();
    let found = repo.find_by_name("named").await.expect("find").expect("some");
    assert_eq!(found.id, created.id);
}

#[tokio::test]
async fn update_changes_command_and_env() {
    let (_tmp, repo) = make_repo().await;
    let created = repo.create(local_server("svc")).await.unwrap();
    let original = created.updated_at;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let mut new_env = HashMap::new();
    new_env.insert("LOG_LEVEL".into(), "debug".into());
    new_env.insert("EXTRA".into(), "1".into());

    let patched = repo
        .update(
            &created.id,
            ServerPatch {
                command: Some("npx".into()),
                env: Some(new_env.clone()),
                disabled: Some(true),
                ..Default::default()
            },
        )
        .await
        .expect("update");
    assert_eq!(patched.command.as_deref(), Some("npx"));
    assert_eq!(patched.env, new_env);
    assert!(patched.disabled);
    assert!(patched.updated_at > original);
}

#[tokio::test]
async fn delete_round_trip() {
    let (_tmp, repo) = make_repo().await;
    let created = repo.create(local_server("tmp")).await.unwrap();
    assert!(repo.delete(&created.id).await.expect("delete"));
    assert!(repo.get(&created.id).await.expect("get").is_none());
}
```

#### Step 3: Run test, expect compile failure

```bash
cd src-tauri
cargo test --test server_repository_test
cd ..
```
Expected: FAIL — unresolved import.

#### Step 4: Implement repository

`src-tauri/src/persistence/repository/server.rs`:

```rust
use std::collections::HashMap;

use async_trait::async_trait;
use chrono::Utc;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    persistence::types::server::{NewServer, Server, ServerPatch, ServerType},
};

#[async_trait]
pub trait ServerRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<Server>>;
    async fn list_by_project(&self, project_id: &str) -> AppResult<Vec<Server>>;
    async fn get(&self, id: &str) -> AppResult<Option<Server>>;
    async fn find_by_name(&self, name: &str) -> AppResult<Option<Server>>;
    async fn create(&self, input: NewServer) -> AppResult<Server>;
    async fn update(&self, id: &str, patch: ServerPatch) -> AppResult<Server>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteServerRepository {
    pool: SqlitePool,
}

impl SqliteServerRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

const SELECT_COLS: &str = "id, name, server_type, description, version, latest_version, verification_status, command, args_json, env_json, context_path, remote_url, bearer_token, auto_start, disabled, auto_approve, input_params_json, required_params_json, tool_permissions_json, project_id, created_at, updated_at";

#[async_trait]
impl ServerRepository for SqliteServerRepository {
    async fn list(&self) -> AppResult<Vec<Server>> {
        let q = format!("SELECT {SELECT_COLS} FROM servers ORDER BY name COLLATE NOCASE");
        let rows = sqlx::query(&q).fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_server).collect()
    }

    async fn list_by_project(&self, project_id: &str) -> AppResult<Vec<Server>> {
        let q = format!("SELECT {SELECT_COLS} FROM servers WHERE project_id = ? ORDER BY name COLLATE NOCASE");
        let rows = sqlx::query(&q)
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_server).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<Server>> {
        let q = format!("SELECT {SELECT_COLS} FROM servers WHERE id = ?");
        let row = sqlx::query(&q).bind(id).fetch_optional(&self.pool).await?;
        row.map(row_to_server).transpose()
    }

    async fn find_by_name(&self, name: &str) -> AppResult<Option<Server>> {
        let q = format!("SELECT {SELECT_COLS} FROM servers WHERE name = ?");
        let row = sqlx::query(&q).bind(name).fetch_optional(&self.pool).await?;
        row.map(row_to_server).transpose()
    }

    async fn create(&self, input: NewServer) -> AppResult<Server> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        let args_json = serde_json::to_string(&input.args)
            .map_err(|e| AppError::Internal(format!("encode args: {e}")))?;
        let env_json = serde_json::to_string(&input.env)
            .map_err(|e| AppError::Internal(format!("encode env: {e}")))?;
        let input_params_json = serde_json::to_string(&input.input_params)
            .map_err(|e| AppError::Internal(format!("encode input_params: {e}")))?;
        let required_params_json = serde_json::to_string(&input.required_params)
            .map_err(|e| AppError::Internal(format!("encode required_params: {e}")))?;
        let tool_permissions_json = serde_json::to_string(&input.tool_permissions)
            .map_err(|e| AppError::Internal(format!("encode tool_permissions: {e}")))?;

        sqlx::query(
            "INSERT INTO servers(id, name, server_type, description, command, args_json, env_json, context_path, remote_url, bearer_token, auto_start, disabled, auto_approve, input_params_json, required_params_json, tool_permissions_json, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&input.name)
        .bind(server_type_to_str(input.server_type))
        .bind(&input.description)
        .bind(&input.command)
        .bind(&args_json)
        .bind(&env_json)
        .bind(&input.context_path)
        .bind(&input.remote_url)
        .bind(&input.bearer_token)
        .bind(input.auto_start as i64)
        .bind(input.disabled as i64)
        .bind(&input.auto_approve)
        .bind(&input_params_json)
        .bind(&required_params_json)
        .bind(&tool_permissions_json)
        .bind(&input.project_id)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(Server {
            id,
            name: input.name,
            server_type: input.server_type,
            description: input.description,
            version: None,
            latest_version: None,
            verification_status: None,
            command: input.command,
            args: input.args,
            env: input.env,
            context_path: input.context_path,
            remote_url: input.remote_url,
            bearer_token: input.bearer_token,
            auto_start: input.auto_start,
            disabled: input.disabled,
            auto_approve: input.auto_approve,
            input_params: input.input_params,
            required_params: input.required_params,
            tool_permissions: input.tool_permissions,
            project_id: input.project_id,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update(&self, id: &str, patch: ServerPatch) -> AppResult<Server> {
        let now = Utc::now();
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("server {id}")))?;

        let new_name = patch.name.unwrap_or(existing.name);
        let new_description = patch.description.or(existing.description);
        let new_version = patch.version.or(existing.version);
        let new_latest_version = patch.latest_version.or(existing.latest_version);
        let new_verification_status = patch.verification_status.or(existing.verification_status);
        let new_command = patch.command.or(existing.command);
        let new_args = patch.args.unwrap_or(existing.args);
        let new_env = patch.env.unwrap_or(existing.env);
        let new_context_path = patch.context_path.or(existing.context_path);
        let new_remote_url = patch.remote_url.or(existing.remote_url);
        let new_bearer_token = patch.bearer_token.or(existing.bearer_token);
        let new_auto_start = patch.auto_start.unwrap_or(existing.auto_start);
        let new_disabled = patch.disabled.unwrap_or(existing.disabled);
        let new_auto_approve = patch.auto_approve.or(existing.auto_approve);
        let new_input_params = patch.input_params.unwrap_or(existing.input_params);
        let new_required_params = patch.required_params.unwrap_or(existing.required_params);
        let new_tool_permissions = patch.tool_permissions.unwrap_or(existing.tool_permissions);
        let new_project_id = patch.project_id.or(existing.project_id);

        let args_json = serde_json::to_string(&new_args)
            .map_err(|e| AppError::Internal(format!("encode args: {e}")))?;
        let env_json = serde_json::to_string(&new_env)
            .map_err(|e| AppError::Internal(format!("encode env: {e}")))?;
        let input_params_json = serde_json::to_string(&new_input_params)
            .map_err(|e| AppError::Internal(format!("encode input_params: {e}")))?;
        let required_params_json = serde_json::to_string(&new_required_params)
            .map_err(|e| AppError::Internal(format!("encode required_params: {e}")))?;
        let tool_permissions_json = serde_json::to_string(&new_tool_permissions)
            .map_err(|e| AppError::Internal(format!("encode tool_permissions: {e}")))?;

        sqlx::query(
            "UPDATE servers SET name = ?, description = ?, version = ?, latest_version = ?, verification_status = ?, command = ?, args_json = ?, env_json = ?, context_path = ?, remote_url = ?, bearer_token = ?, auto_start = ?, disabled = ?, auto_approve = ?, input_params_json = ?, required_params_json = ?, tool_permissions_json = ?, project_id = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&new_name)
        .bind(&new_description)
        .bind(&new_version)
        .bind(&new_latest_version)
        .bind(&new_verification_status)
        .bind(&new_command)
        .bind(&args_json)
        .bind(&env_json)
        .bind(&new_context_path)
        .bind(&new_remote_url)
        .bind(&new_bearer_token)
        .bind(new_auto_start as i64)
        .bind(new_disabled as i64)
        .bind(&new_auto_approve)
        .bind(&input_params_json)
        .bind(&required_params_json)
        .bind(&tool_permissions_json)
        .bind(&new_project_id)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(Server {
            id: id.to_string(),
            name: new_name,
            server_type: existing.server_type,
            description: new_description,
            version: new_version,
            latest_version: new_latest_version,
            verification_status: new_verification_status,
            command: new_command,
            args: new_args,
            env: new_env,
            context_path: new_context_path,
            remote_url: new_remote_url,
            bearer_token: new_bearer_token,
            auto_start: new_auto_start,
            disabled: new_disabled,
            auto_approve: new_auto_approve,
            input_params: new_input_params,
            required_params: new_required_params,
            tool_permissions: new_tool_permissions,
            project_id: new_project_id,
            created_at: existing.created_at,
            updated_at: now,
        })
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM servers WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn server_type_to_str(ty: ServerType) -> &'static str {
    match ty {
        ServerType::Local => "local",
        ServerType::Remote => "remote",
    }
}

fn server_type_from_str(s: &str) -> AppResult<ServerType> {
    match s {
        "local" => Ok(ServerType::Local),
        "remote" => Ok(ServerType::Remote),
        other => Err(AppError::Internal(format!("unknown server_type: {other}"))),
    }
}

fn row_to_server(row: sqlx::sqlite::SqliteRow) -> AppResult<Server> {
    let server_type_str: String = row.try_get("server_type")?;
    let auto_start_i: i64 = row.try_get("auto_start")?;
    let disabled_i: i64 = row.try_get("disabled")?;

    let args_json: String = row.try_get("args_json")?;
    let env_json: String = row.try_get("env_json")?;
    let input_params_json: String = row.try_get("input_params_json")?;
    let required_params_json: String = row.try_get("required_params_json")?;
    let tool_permissions_json: String = row.try_get("tool_permissions_json")?;

    let args: Vec<String> = serde_json::from_str(&args_json)
        .map_err(|e| AppError::Internal(format!("decode args: {e}")))?;
    let env: HashMap<String, String> = serde_json::from_str(&env_json)
        .map_err(|e| AppError::Internal(format!("decode env: {e}")))?;
    let input_params: Value = serde_json::from_str(&input_params_json)
        .map_err(|e| AppError::Internal(format!("decode input_params: {e}")))?;
    let required_params: Vec<String> = serde_json::from_str(&required_params_json)
        .map_err(|e| AppError::Internal(format!("decode required_params: {e}")))?;
    let tool_permissions: HashMap<String, bool> = serde_json::from_str(&tool_permissions_json)
        .map_err(|e| AppError::Internal(format!("decode tool_permissions: {e}")))?;

    Ok(Server {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        server_type: server_type_from_str(&server_type_str)?,
        description: row.try_get("description")?,
        version: row.try_get("version")?,
        latest_version: row.try_get("latest_version")?,
        verification_status: row.try_get("verification_status")?,
        command: row.try_get("command")?,
        args,
        env,
        context_path: row.try_get("context_path")?,
        remote_url: row.try_get("remote_url")?,
        bearer_token: row.try_get("bearer_token")?,
        auto_start: auto_start_i != 0,
        disabled: disabled_i != 0,
        auto_approve: row.try_get("auto_approve")?,
        input_params,
        required_params,
        tool_permissions,
        project_id: row.try_get("project_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
```

Append to `src-tauri/src/persistence/repository/mod.rs`:

```rust
pub mod server;
```

#### Step 5: Run tests

```bash
cd src-tauri
cargo test --test server_repository_test
cd ..
```
Expected: PASS (7 tests).

#### Step 6: Commit

```bash
git add src-tauri/src/persistence/types/server.rs src-tauri/src/persistence/types/mod.rs src-tauri/src/persistence/repository/server.rs src-tauri/src/persistence/repository/mod.rs src-tauri/tests/server_repository_test.rs src/types/generated
git commit -m "feat(persistence): ServerRepository (含 list_by_project / 21 列) + 7 集成测试"
```

---

### Task 7: Final smoke run + tag

**Files:** none (verification + tag only)

#### Step 1: Run all tests

```bash
cd src-tauri
cargo test
cd ..
```

Expected total: 19 (Plan 2) + 6 + 6 + 7 + 7 + 6 + 7 = **58 tests passing**, plus ts-rs auto-export tests (each new type adds one). Total around **70+ tests**.

If any test fails, STOP and fix at the failing repo level.

#### Step 2: cargo build

```bash
cd src-tauri
cargo build
cd ..
```

Expected: clean.

#### Step 3: Smoke run pnpm tauri dev

The existing `mcp-router.sqlite` from Plans 1+2 already has 0001 + 0002 applied. Plan 3 adds NO new migrations (only 0002 schema is referenced). Starting dev should not run any new migrations:

```bash
pnpm tauri dev
```

Watch logs for the same Plan 2 startup sequence:
```
INFO initializing workspace pool workspace=default path=...mcp-router.sqlite
INFO running sqlx migrations path=...mcp-router.sqlite
INFO AppState initialized (registry seeded with default workspace)
```

(`running sqlx migrations` may appear even when there's nothing to run — sqlx logs it as part of pool init. The DB file size should be unchanged from Plan 2.)

Stop with `Ctrl+C`.

#### Step 4: Tag completion

```bash
git tag -a tauri-plan-3-done -m "Plan 3 (remaining DB repositories) complete: 6 repos, ~58 tests"
```

#### Step 5: Show summary

```bash
git log --oneline tauri-plan-2-done..HEAD
```

Expected: ~7 commits since Plan 2 (1 plan doc + 6 repository tasks).

---

## Plan 3 Validation Checklist

Before declaring Plan 3 complete:

- [ ] `cd src-tauri && cargo test` passes ~58+ tests
- [ ] All 6 new repository tests pass independently
- [ ] `cargo check` clean (ignore pre-existing ts-rs `serde(skip_serializing_if = ...)` notes — they're parse warnings, not errors)
- [ ] `src/types/generated/` contains `.ts` files for: AppError, Project, NewProject, ProjectPatch, AgentPath, NewAgentPath, AgentPathPatch, HookModule, NewHookModule, HookModulePatch, Workspace, NewWorkspace, WorkspacePatch, WorkspaceType, LocalWorkspaceConfig, RemoteWorkspaceConfig, WorkspaceDisplayInfo, Workflow, NewWorkflow, WorkflowPatch, RequestLog, NewRequestLog, RequestLogQuery, RequestLogCursor, RequestLogPage, Server, NewServer, ServerPatch, ServerType
- [ ] `pnpm tauri dev` starts cleanly; logs show registry seeding default workspace pool
- [ ] tag `tauri-plan-3-done` exists

---

## What Plan 4 Will Cover (preview, not part of this plan)

**Plan 4: File-based Stores + AppState wiring.** The Electron version had two non-DB "repositories":
- `SettingsRepository` — wraps `SharedConfigManager` for app-wide settings (`AppSettings` JSON file)
- `McpAppsManagerRepository` — manages tokens for connected MCP clients (also via SharedConfigManager)

Plan 4 ports these as a `SharedConfigStore` Rust module backed by a JSON file at `<app_data>/shared-config.json`, plus `SettingsService` and `TokenService` consumers. Also wires the registries/repositories into `AppState` so future commands can pull repos via `State<AppState>`.

---

## Notes for the Engineer Executing This Plan

- **TDD per repo**: every public trait method has at least one test. Don't paper over failures with `#[ignore]`.
- **No clippy enforcement here**: if you spot warnings, fix them inline.
- **Pattern is mechanical**: each repo follows the same shape. If you find yourself inventing new patterns mid-task (e.g., a special trait method shape, exotic error mapping), pause and ask — likely the plan code already covers it.
- **JSON serialize/deserialize errors map to `AppError::Internal`**: the helper functions in each repo file convert errors with `format!`. Don't introduce a new error variant for this; we already have `Internal` for "this shouldn't happen normally".
- **`HashMap<String, ...>` round-trip**: serde_json preserves order is NOT guaranteed. Tests should compare with `assert_eq!(map_a, map_b)` (HashMap equality) not key-by-key — already correct in plan code.
- **WorkflowRepository's `Value` field**: stays as `serde_json::Value` (not strict-typed) because the actual node/edge schema is xyflow-controlled and changes as the editor evolves. Don't try to type it.
- **ServerRepository's update**: 21 fields is a lot of `unwrap_or(existing.*)` boilerplate. Acceptable here — adding a derive helper macro would be over-engineering for one consumer.
- **No new migration in Plan 3**: schema 0002 is reused. If you find yourself wanting to ALTER a table, stop and report — schema changes belong in a 0003+ migration, not retrofit.
