# MCP Router Tauri Rewrite — Plan 4: Shared Config (Settings + Tokens)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Electron `SharedConfigManager` to a Rust `SharedConfigStore` — a JSON-file-backed store at `<app_data>/shared-config.json` that holds `AppSettings` and a list of `Token` entries. Wire it into `AppState` so future plans (commands, MCP runtime, HTTP token validation) can read/write settings and tokens without touching SQLite.

**Architecture:** Single struct `SharedConfigStore` wrapping a `RwLock<SharedConfig>` plus a file path. Each mutating method takes the write lock, mutates the in-memory state, and atomically persists to disk (write `.tmp` then `rename`). Round-trip serialization uses serde with `rename_all = "camelCase"` to match the file format established by the Electron version. `AppState` gains a `shared_config: Arc<SharedConfigStore>` field; lib.rs `setup()` opens it from `<app_data>/shared-config.json`.

**Tech Stack:** Same as Plans 1-3 — serde, serde_json, tokio (RwLock), chrono, ts-rs. No new dependencies.

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md`

**Plan series:** Plan 4 of N. Plan 5 will start wiring `#[tauri::command]` handlers using both the registry/repositories (from Plans 2-3) and the shared config store (from this plan). Plan 6+ tackles MCP runtime.

**Out of scope for Plan 4:**
- Any `#[tauri::command]` handlers (Plan 5)
- Real per-repo accessors on AppState (Plan 5; commands will construct repos on demand from `registry.get_or_init(DEFAULT_WORKSPACE)`)
- File watching / multi-process locking (single-instance Tauri lock + in-process RwLock is enough; the Electron app didn't watch either)
- Migration from old Electron data (no users)

---

## Schema decisions (matching Electron format)

Keep the Electron `shared-config.json` shape so any leftover dev file works (no users, but limits surprise during dev):

```json
{
  "settings": {
    "userId": "uuid-string",
    "packageManagerOverlayDisplayCount": 0,
    "autoUpdateEnabled": true,
    "showWindowOnStartup": true,
    "theme": "system",
    "lightweightMode": false,
    "serverIdleStopMinutes": 0,
    "maxRequestLogRows": 50000
  },
  "mcpApps": {
    "tokens": [
      {
        "id": "uuid-string",
        "clientId": "...",
        "issuedAt": 1714000000000,
        "serverAccess": { "server-id-1": true }
      }
    ]
  },
  "_meta": {
    "version": "1.0.0",
    "lastModified": "2026-04-27T10:00:00Z"
  }
}
```

Rust types use `#[serde(rename_all = "camelCase")]` plus explicit `#[serde(rename = "_meta")]` for the `_meta` field. `Token.issuedAt` is a unix-ms `i64` (matching the Electron version), NOT an ISO 8601 string — this is the one place we accept the legacy timestamp shape because tokens flow over MCP HTTP and the consumer expects ms.

---

## File Structure (state at end of Plan 4)

Changes from Plan 3 baseline:

```
src-tauri/src/
├── error.rs                        # unchanged
├── state.rs                        # MODIFIED: add shared_config field
├── lib.rs                          # MODIFIED: open SharedConfigStore in setup
├── shared_config/                  # NEW module
│   ├── mod.rs                      # NEW
│   ├── types.rs                    # NEW — AppSettings, Token, SharedConfig, Theme
│   └── store.rs                    # NEW — SharedConfigStore
├── persistence/                    # unchanged from Plan 3
├── commands/ping.rs                # unchanged
└── tests/
    ├── shared_config_test.rs       # NEW — store TDD tests
    └── (Plans 1-3 tests unchanged)

src/types/generated/
├── ... existing types ...
├── AppSettings.ts                  # NEW
├── Theme.ts                        # NEW
├── Token.ts                        # NEW
└── SharedConfig.ts                 # NEW (optional — only if any consumer uses it)
```

(`Token` and `Theme` are exported because Plan 5 commands will return them via Tauri invoke.)

---

## Plan 1-3 lessons learned (apply preemptively)

1. **`#[ts(export, export_to = "../../src/types/generated/")]`** — TWO `..`s.
2. **`#[serde(...)]` requires `#[derive(Serialize, Deserialize)]`** — even helper attrs.
3. **`init_pool_at_path`** is the path-based pool init.
4. **`tokio::time::sleep(Duration::from_millis(50))`** is enough for sub-second ordering.
5. **JSON encode helpers map errors to `AppError::Internal(...)`** — established convention.
6. **`tokio::sync::RwLock`** (not `std::sync::RwLock`) — needed because we hold the lock across `.await` points (file I/O).
7. **Atomic writes**: `tokio::fs::write` to `<path>.tmp` then `tokio::fs::rename` — Windows `rename` is atomic when target doesn't exist; if target exists, use `tokio::fs::write` directly (Windows allows write to existing) followed by `fsync`. Plan 4 uses the rename pattern with a try-rename-then-fallback strategy.

---

## Prerequisites

- [ ] Plan 3 complete (`tauri-plan-3-done` tag exists)
- [ ] On branch `tauri-rewrite`, working tree clean
- [ ] `cargo test` (in `src-tauri/`) reports 83 tests passing
- [ ] No leftover dev/cargo processes

---

## Tasks

### Task 1: Domain types for SharedConfig + ts-rs export

**Files:**
- Create: `src-tauri/src/shared_config/mod.rs`
- Create: `src-tauri/src/shared_config/types.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod shared_config;`)

#### Step 1: Create shared_config/mod.rs

Task 1 only declares `types`; Task 2 will append `store` after `store.rs` exists. That keeps each commit compile-clean.

```rust
pub mod types;
```

#### Step 2: Create shared_config/types.rs

```rust
use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// UI theme preference. Matches Electron `Theme` enum (`light | dark | system`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    System,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::System
    }
}

/// Application-level settings. All fields optional with sensible defaults applied at read time.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_manager_overlay_display_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_update_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_window_on_startup: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<Theme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lightweight_mode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_idle_stop_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_request_log_rows: Option<u64>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            user_id: Some(String::new()),
            package_manager_overlay_display_count: Some(0),
            auto_update_enabled: Some(true),
            show_window_on_startup: Some(true),
            theme: Some(Theme::System),
            lightweight_mode: Some(false),
            server_idle_stop_minutes: Some(0),
            max_request_log_rows: Some(50_000),
        }
    }
}

/// MCP client token used for HTTP `Authorization: Bearer ...` against the :3282 server.
/// `issued_at` is unix milliseconds (matches Electron) for wire compatibility with MCP clients.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub id: String,
    pub client_id: String,
    pub issued_at: i64,
    pub server_access: HashMap<String, bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAppsConfig {
    pub tokens: Vec<Token>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedConfigMeta {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub migrated_at: Option<DateTime<Utc>>,
}

impl Default for SharedConfigMeta {
    fn default() -> Self {
        Self {
            version: "1.0.0".to_string(),
            last_modified: Some(Utc::now()),
            migrated_at: None,
        }
    }
}

/// Top-level shape of `<app_data>/shared-config.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedConfig {
    pub settings: AppSettings,
    pub mcp_apps: McpAppsConfig,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none", default)]
    pub meta: Option<SharedConfigMeta>,
}

impl Default for SharedConfig {
    fn default() -> Self {
        Self {
            settings: AppSettings::default(),
            mcp_apps: McpAppsConfig::default(),
            meta: Some(SharedConfigMeta::default()),
        }
    }
}
```

> Notes:
> - `SharedConfig` and `McpAppsConfig` and `SharedConfigMeta` are NOT ts-rs-exported because they're internal containers. `AppSettings` and `Token` and `Theme` are exported (Plan 5 commands return them).
> - `#[serde(rename_all = "camelCase")]` matches the Electron file format.
> - `Token.serverAccess` becomes `Record<string, boolean>` in TypeScript (HashMap<String, bool> → object).
> - `SharedConfigMeta` has `migrated_at` for the legacy migration metadata that may exist in old files (we read+ignore on load).

#### Step 3: Wire mod in lib.rs

Open `src-tauri/src/lib.rs`. Append after `pub mod state;`:

```rust
pub mod shared_config;
```

#### Step 4: Verify compile + ts-rs export

```bash
cd src-tauri
cargo check
cargo test 2>&1 | tail -3
cd ..
```

Expected: `cargo check` clean. `cargo test` total 83 + 3 (ts-rs auto-export tests for Theme, AppSettings, Token) = **86 tests passing**.

Verify `.ts` files:

```bash
ls C:/Projects/WebstormProjects/mcp-router/src/types/generated/ | grep -E "^(Theme|AppSettings|Token)\.ts$"
```

Expected: `AppSettings.ts`, `Theme.ts`, `Token.ts`.

#### Step 5: Commit

```bash
git add src-tauri/src/shared_config src-tauri/src/lib.rs src/types/generated
git commit -m "feat(shared-config): AppSettings / Token / Theme 类型 + ts-rs 导出"
```

---

### Task 2: SharedConfigStore (TDD)

**Files:**
- Create: `src-tauri/src/shared_config/store.rs`
- Create: `src-tauri/tests/shared_config_test.rs`
- Modify: `src-tauri/src/shared_config/mod.rs` (append `pub mod store;`)

The store handles file I/O atomically. On open: read file (or use defaults if missing). On every mutation: take write lock, mutate in-memory state, write `.tmp`, rename to final. Read methods take the read lock and clone (cheap because tokens are typically <100).

#### Step 1: Write failing test

`src-tauri/tests/shared_config_test.rs`:

```rust
use std::collections::HashMap;

use mcp_router_lib::shared_config::{
    store::SharedConfigStore,
    types::{AppSettings, Theme, Token},
};

async fn make_store() -> (tempfile::TempDir, SharedConfigStore) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let store = SharedConfigStore::open(tmp.path().join("shared-config.json"))
        .await
        .expect("open");
    (tmp, store)
}

#[tokio::test]
async fn fresh_store_returns_default_settings() {
    let (_tmp, store) = make_store().await;
    let s = store.get_settings().await;
    assert_eq!(s.theme, Some(Theme::System));
    assert_eq!(s.auto_update_enabled, Some(true));
    assert_eq!(s.max_request_log_rows, Some(50_000));
}

#[tokio::test]
async fn update_settings_persists_to_disk() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let path = tmp.path().join("shared-config.json");

    {
        let store = SharedConfigStore::open(path.clone()).await.expect("open");
        let mut s = store.get_settings().await;
        s.theme = Some(Theme::Dark);
        s.lightweight_mode = Some(true);
        store.update_settings(s).await.expect("update_settings");
    }

    // Re-open: settings should round-trip.
    let store2 = SharedConfigStore::open(path).await.expect("reopen");
    let s2 = store2.get_settings().await;
    assert_eq!(s2.theme, Some(Theme::Dark));
    assert_eq!(s2.lightweight_mode, Some(true));
}

#[tokio::test]
async fn list_tokens_starts_empty() {
    let (_tmp, store) = make_store().await;
    let tokens = store.list_tokens().await;
    assert!(tokens.is_empty());
}

#[tokio::test]
async fn save_and_get_token() {
    let (_tmp, store) = make_store().await;
    let token = sample_token("t1", "client-A", &[("server-x", true)]);
    store.save_token(token.clone()).await.expect("save");

    let fetched = store.get_token("t1").await.expect("get");
    assert_eq!(fetched.id, "t1");
    assert_eq!(fetched.client_id, "client-A");
    assert_eq!(fetched.server_access.get("server-x"), Some(&true));
}

#[tokio::test]
async fn save_token_with_existing_id_replaces() {
    let (_tmp, store) = make_store().await;
    let t1 = sample_token("t1", "client-A", &[("s", true)]);
    let t1b = sample_token("t1", "client-A", &[("s", false)]);
    store.save_token(t1).await.unwrap();
    store.save_token(t1b).await.unwrap();

    let tokens = store.list_tokens().await;
    assert_eq!(tokens.len(), 1);
    assert_eq!(tokens[0].server_access.get("s"), Some(&false));
}

#[tokio::test]
async fn delete_token_returns_true_then_get_returns_none() {
    let (_tmp, store) = make_store().await;
    let token = sample_token("t1", "client-A", &[]);
    store.save_token(token).await.unwrap();

    let removed = store.delete_token("t1").await.expect("delete");
    assert!(removed);
    assert!(store.get_token("t1").await.is_none());

    let removed_again = store.delete_token("t1").await.expect("delete again");
    assert!(!removed_again);
}

#[tokio::test]
async fn delete_client_tokens_removes_all_matching() {
    let (_tmp, store) = make_store().await;
    store.save_token(sample_token("t1", "alice", &[])).await.unwrap();
    store.save_token(sample_token("t2", "alice", &[])).await.unwrap();
    store.save_token(sample_token("t3", "bob", &[])).await.unwrap();

    let removed = store.delete_client_tokens("alice").await.expect("delete client");
    assert_eq!(removed, 2);

    let remaining = store.list_tokens().await;
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].client_id, "bob");
}

#[tokio::test]
async fn update_token_server_access_replaces_field() {
    let (_tmp, store) = make_store().await;
    store
        .save_token(sample_token("t1", "client-A", &[("old-server", true)]))
        .await
        .unwrap();

    let mut new_access = HashMap::new();
    new_access.insert("new-server".to_string(), true);
    new_access.insert("another-server".to_string(), false);

    let updated = store
        .update_token_server_access("t1", new_access.clone())
        .await
        .expect("update");
    assert!(updated);

    let token = store.get_token("t1").await.expect("get");
    assert_eq!(token.server_access, new_access);
    assert!(!token.server_access.contains_key("old-server"));
}

#[tokio::test]
async fn update_token_server_access_returns_false_for_missing_token() {
    let (_tmp, store) = make_store().await;
    let updated = store
        .update_token_server_access("nonexistent", HashMap::new())
        .await
        .expect("update");
    assert!(!updated);
}

#[tokio::test]
async fn open_with_existing_file_preserves_unknown_fields_being_dropped_silently() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let path = tmp.path().join("shared-config.json");

    // Write a file with the legacy Electron shape, including an unrecognized field.
    let legacy = r#"{
        "settings": { "theme": "dark", "lightweightMode": true },
        "mcpApps": { "tokens": [] },
        "_meta": { "version": "1.0.0", "lastModified": "2026-04-27T00:00:00Z" },
        "futureFeature": { "weShouldIgnoreThis": true }
    }"#;
    tokio::fs::write(&path, legacy).await.expect("write legacy");

    let store = SharedConfigStore::open(path).await.expect("open legacy");
    let s = store.get_settings().await;
    assert_eq!(s.theme, Some(Theme::Dark));
    assert_eq!(s.lightweight_mode, Some(true));
}

fn sample_token(id: &str, client_id: &str, access: &[(&str, bool)]) -> Token {
    let mut server_access = HashMap::new();
    for (k, v) in access {
        server_access.insert(k.to_string(), *v);
    }
    Token {
        id: id.into(),
        client_id: client_id.into(),
        issued_at: 1_714_000_000_000,
        server_access,
    }
}
```

#### Step 2: Run failing test

```bash
cd src-tauri
cargo test --test shared_config_test
cd ..
```
Expected: FAIL with "unresolved import `mcp_router_lib::shared_config::store`".

#### Step 3: Implement shared_config/store.rs

```rust
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use chrono::Utc;
use tokio::sync::RwLock;
use tracing::warn;

use crate::{
    error::{AppError, AppResult},
    shared_config::types::{AppSettings, SharedConfig, SharedConfigMeta, Token},
};

pub struct SharedConfigStore {
    file_path: PathBuf,
    state: RwLock<SharedConfig>,
}

impl SharedConfigStore {
    /// Open the store at `file_path`. If the file doesn't exist, defaults are used; the file
    /// is NOT created until the first mutation. If the file exists but can't be parsed,
    /// returns an `AppError::Internal` — caller may choose to delete-and-retry.
    pub async fn open(file_path: PathBuf) -> AppResult<Self> {
        let config = if file_path.exists() {
            match tokio::fs::read_to_string(&file_path).await {
                Ok(contents) => serde_json::from_str::<SharedConfig>(&contents)
                    .map_err(|e| AppError::Internal(format!("parse shared-config.json: {e}")))?,
                Err(e) => return Err(AppError::Internal(format!("read shared-config.json: {e}"))),
            }
        } else {
            SharedConfig::default()
        };
        Ok(Self {
            file_path,
            state: RwLock::new(config),
        })
    }

    pub fn file_path(&self) -> &Path {
        &self.file_path
    }

    // ----- Settings API -----

    pub async fn get_settings(&self) -> AppSettings {
        self.state.read().await.settings.clone()
    }

    pub async fn update_settings(&self, settings: AppSettings) -> AppResult<()> {
        let mut state = self.state.write().await;
        state.settings = settings;
        self.persist_locked(&mut state).await
    }

    // ----- Token API -----

    pub async fn list_tokens(&self) -> Vec<Token> {
        self.state.read().await.mcp_apps.tokens.clone()
    }

    pub async fn get_token(&self, id: &str) -> Option<Token> {
        self.state
            .read()
            .await
            .mcp_apps
            .tokens
            .iter()
            .find(|t| t.id == id)
            .cloned()
    }

    pub async fn save_token(&self, token: Token) -> AppResult<()> {
        let mut state = self.state.write().await;
        let tokens = &mut state.mcp_apps.tokens;
        if let Some(existing) = tokens.iter_mut().find(|t| t.id == token.id) {
            *existing = token;
        } else {
            tokens.push(token);
        }
        self.persist_locked(&mut state).await
    }

    pub async fn delete_token(&self, id: &str) -> AppResult<bool> {
        let mut state = self.state.write().await;
        let before = state.mcp_apps.tokens.len();
        state.mcp_apps.tokens.retain(|t| t.id != id);
        let removed = state.mcp_apps.tokens.len() < before;
        if removed {
            self.persist_locked(&mut state).await?;
        }
        Ok(removed)
    }

    pub async fn delete_client_tokens(&self, client_id: &str) -> AppResult<u32> {
        let mut state = self.state.write().await;
        let before = state.mcp_apps.tokens.len();
        state.mcp_apps.tokens.retain(|t| t.client_id != client_id);
        let removed = (before - state.mcp_apps.tokens.len()) as u32;
        if removed > 0 {
            self.persist_locked(&mut state).await?;
        }
        Ok(removed)
    }

    pub async fn update_token_server_access(
        &self,
        id: &str,
        server_access: HashMap<String, bool>,
    ) -> AppResult<bool> {
        let mut state = self.state.write().await;
        let updated = if let Some(token) = state.mcp_apps.tokens.iter_mut().find(|t| t.id == id) {
            token.server_access = server_access;
            true
        } else {
            false
        };
        if updated {
            self.persist_locked(&mut state).await?;
        }
        Ok(updated)
    }

    // ----- Internal: atomic write -----

    async fn persist_locked(
        &self,
        state: &mut tokio::sync::RwLockWriteGuard<'_, SharedConfig>,
    ) -> AppResult<()> {
        // Stamp _meta.lastModified
        let meta = state.meta.get_or_insert_with(SharedConfigMeta::default);
        meta.last_modified = Some(Utc::now());

        let serialized = serde_json::to_string_pretty(&**state)
            .map_err(|e| AppError::Internal(format!("encode shared-config: {e}")))?;

        if let Some(parent) = self.file_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Internal(format!("create config dir: {e}")))?;
        }

        // Atomic-ish: write to .tmp, then rename. On Windows `rename` over an existing file
        // can fail with EACCES on rare antivirus interactions; fall back to a direct write.
        let tmp_path = self.file_path.with_extension("json.tmp");
        if let Err(e) = tokio::fs::write(&tmp_path, serialized.as_bytes()).await {
            return Err(AppError::Internal(format!("write tmp config: {e}")));
        }

        if let Err(rename_err) = tokio::fs::rename(&tmp_path, &self.file_path).await {
            warn!(?rename_err, "rename failed, falling back to direct write");
            tokio::fs::write(&self.file_path, serialized.as_bytes())
                .await
                .map_err(|e| AppError::Internal(format!("write config (fallback): {e}")))?;
            // Best-effort cleanup of stale tmp.
            let _ = tokio::fs::remove_file(&tmp_path).await;
        }

        Ok(())
    }
}
```

#### Step 4: Wire mod in shared_config/mod.rs

Open `src-tauri/src/shared_config/mod.rs` (currently has `pub mod types;`). Append:

```rust
pub mod store;
```

#### Step 5: Re-run tests

```bash
cd src-tauri
cargo test --test shared_config_test
cd ..
```

Expected: PASS (10 tests).

If tests fail:
- **"file not found" on `open` of an empty path**: confirm `if file_path.exists()` branch — returns default config, doesn't try to read.
- **"invalid type" on parse**: legacy file has unexpected shape. The test `open_with_existing_file_preserves_unknown_fields_being_dropped_silently` deliberately includes a top-level unknown field — serde drops it by default. If parsing fails, you might need `#[serde(deny_unknown_fields)]` removed (it's not in the plan code; if you added it, remove).
- **"theme `Dark` doesn't match `dark`"**: enum should have `#[serde(rename_all = "lowercase")]` (yes, in the Theme type).

#### Step 6: Commit

```bash
git add src-tauri/src/shared_config/store.rs src-tauri/src/shared_config/mod.rs src-tauri/tests/shared_config_test.rs
git commit -m "feat(shared-config): SharedConfigStore (settings + tokens, 原子写盘) + 10 集成测试"
```

---

### Task 3: Wire SharedConfigStore into AppState + smoke + tag

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs` (setup closure)

#### Step 1: Update state.rs

```rust
use std::sync::Arc;

use crate::{
    persistence::registry::WorkspacePoolRegistry,
    shared_config::store::SharedConfigStore,
};

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<WorkspacePoolRegistry>,
    pub shared_config: Arc<SharedConfigStore>,
}

impl AppState {
    pub fn new(registry: WorkspacePoolRegistry, shared_config: SharedConfigStore) -> Self {
        Self {
            registry: Arc::new(registry),
            shared_config: Arc::new(shared_config),
        }
    }
}
```

#### Step 2: Update lib.rs setup closure

Open `src-tauri/src/lib.rs`. The current setup closure (Plan 2 Task 5) constructs `WorkspacePoolRegistry`, calls `get_or_init(DEFAULT_WORKSPACE)`, then `AppState::new(registry)`. Replace with:

```rust
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app data dir");

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let shared_config_path = app_data_dir.join("shared-config.json");
                let shared_config = match SharedConfigStore::open(shared_config_path).await {
                    Ok(s) => s,
                    Err(err) => {
                        error!(?err, "failed to open shared-config.json");
                        return;
                    }
                };

                let registry = WorkspacePoolRegistry::new(app_data_dir);
                match registry.get_or_init(DEFAULT_WORKSPACE).await {
                    Ok(_) => {
                        let state = AppState::new(registry, shared_config);
                        handle.manage(state);
                        info!("AppState initialized (registry + shared_config seeded)");
                    }
                    Err(err) => {
                        error!(?err, "failed to init AppState — default workspace pool failed");
                    }
                }
            });

            Ok(())
        })
```

Update the `use` block at the top of lib.rs to also bring in `SharedConfigStore`:

```rust
use crate::{
    commands::ping::ping,
    persistence::registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE},
    shared_config::store::SharedConfigStore,
    state::AppState,
};
```

#### Step 3: Verify build

```bash
cd src-tauri
cargo check
cd ..
```

Expected: clean.

#### Step 4: Run all tests

```bash
cd src-tauri
cargo test 2>&1 | tail -3
cd ..
```

Expected: 86 (Plan 4 Task 1 add) + 10 (shared_config tests) = **96 tests passing**, possibly +1 if a new doc-test or auto-generated test arose.

#### Step 5: Smoke run

```bash
cd C:/Projects/WebstormProjects/mcp-router && pnpm tauri dev > /tmp/plan4-smoke.log 2>&1 &
DEV_PID=$!
echo "PID=$DEV_PID"

for i in $(seq 1 60); do
  sleep 5
  if grep -q "AppState initialized" /tmp/plan4-smoke.log 2>/dev/null; then
    echo "READY at ~$((i*5))s"
    break
  fi
  if grep -q -E "error\[|^error:|panicked|could not compile|Port .* already in use" /tmp/plan4-smoke.log 2>/dev/null; then
    echo "FAIL"
    break
  fi
done

echo "--- relevant log ---"
grep -E "AppState|shared-config|registry|migrations" /tmp/plan4-smoke.log

kill -9 $DEV_PID 2>/dev/null
sleep 3
ps -ef 2>/dev/null | grep -iE "tauri|cargo|mcp-router|vite" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

Expected: log shows `AppState initialized (registry + shared_config seeded)`.

Verify the file was created (or already exists from earlier run; either way the path resolves):

```bash
ls -la "$APPDATA/com.mcprouter.app/shared-config.json" 2>/dev/null \
  || ls -la ~/Library/Application\ Support/com.mcprouter.app/shared-config.json 2>/dev/null \
  || echo "file not auto-created (expected — first run only writes on mutation)"
```

The store's `open()` does NOT create the file — only mutations do. So on a fresh data dir the file won't exist after smoke. That's intended; once Plan 5's `settings:save` command runs, the file will appear.

To force a write for verification, you could optionally write a tiny one-shot test that calls `update_settings` after registry init. Not required for Plan 4 sign-off.

#### Step 6: Commit AppState/lib.rs changes

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "refactor(rust): AppState 持 SharedConfigStore；lib.rs setup 顺序 shared_config → registry"
```

#### Step 7: Tag

```bash
git tag -a tauri-plan-4-done -m "Plan 4 (shared config: settings + tokens) complete: SharedConfigStore + AppState wiring"
```

#### Step 8: Show summary

```bash
git log --oneline tauri-plan-3-done..HEAD
```

Expected: ~4 commits (1 plan doc + 1 types + 1 store + 1 wiring).

---

## Plan 4 Validation Checklist

- [ ] `cd src-tauri && cargo test` reports ~96 tests passing (no failures)
- [ ] `pnpm tauri dev` starts cleanly; logs show `AppState initialized (registry + shared_config seeded)`
- [ ] `cargo check` clean (ignore pre-existing ts-rs `serde(skip_serializing_if)` notes)
- [ ] `src/types/generated/` contains: `Theme.ts`, `AppSettings.ts`, `Token.ts`
- [ ] tag `tauri-plan-4-done` exists

---

## What Plan 5 Will Cover (preview, not part of this plan)

**Plan 5: Tauri Commands.** Wire 9 IPC domains as `#[tauri::command]` handlers, each a thin function that:
1. Pulls `State<AppState>`
2. Constructs a repository (e.g., `SqliteProjectRepository::new(state.registry.get_or_init(DEFAULT_WORKSPACE).await?)`) OR reads/writes `state.shared_config`
3. Returns `AppResult<T>` where `T` is a ts-rs-exported type
4. Frontend calls via `invoke<T>("snake_case_name", { args })` from `src/platform-api/tauri-platform-api.ts`

Domains: `server`, `log`, `settings`, `apps` (tokens), `system`, `package`, `workflow`, `hook`, `projects`. ~9 task groupings.

---

## Notes for the Engineer Executing This Plan

- **No new migrations** in Plan 4 — schema 0002 from Plan 2 is unchanged.
- **`SharedConfigStore::open` is NOT idempotent w.r.t. file creation**: it only creates on first mutation. This is by design — empty fresh installs don't need a config file until the user changes a setting.
- **Token IDs are application-assigned, not auto-generated**: Plan 4's store doesn't enforce uniqueness via UUID at save time; the caller picks the ID. Plan 5's command-layer can `Uuid::now_v7()` before calling save_token.
- **Atomic write on Windows**: the `.tmp + rename` pattern is the platform standard. The fallback to direct write is for the rare antivirus-interleave case. Don't replace with `tokio::fs::write` only — losing atomicity risks corrupted config files on power loss mid-write.
- **`tokio::sync::RwLock`** (not `parking_lot::RwLock` or `std::sync::RwLock`): we hold the lock across `.await` (file I/O), which only `tokio` supports.
- **Token timestamps**: `issued_at` is unix ms (i64), NOT chrono::DateTime. This is the one place we accept the legacy ms format, because tokens are sent over MCP HTTP and consumers expect that shape.
- **Don't pre-fetch the file lock at `open` time**: opening the store should be fast and infallible (returning defaults if file missing). File I/O happens lazily.
- **Test coverage**: 10 store tests cover settings round-trip, save/get/delete tokens, client filter, server access update, missing-token edge, legacy file with unknown fields. If you find yourself wanting MORE tests for "what if disk is full", that's beyond Plan 4 — add when the symptom materializes.
