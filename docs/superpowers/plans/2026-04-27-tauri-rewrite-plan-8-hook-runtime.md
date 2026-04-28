# MCP Router Tauri Rewrite — Plan 8: Hook Runtime (rquickjs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the JavaScript execution engine for hook scripts. New module `src-tauri/src/workflow/hook_runtime.rs` exposes `HookRuntime::evaluate(script, input) -> AppResult<Value>` powered by `rquickjs` (QuickJS Rust bindings). Add one Tauri command `hooks_run(id, input)` that loads a hook by id from the DB and runs it. After Plan 8: a single hook script can be executed end-to-end from the frontend; the workflow executor that chains hooks + MCP calls comes in Plan 8b.

**Architecture:** New module `src-tauri/src/workflow/`. `HookRuntime` owns a `rquickjs::Runtime` (with memory + stack caps applied) and creates a fresh `Context::full` per evaluation. Each call: parse the input as JSON via `ctx.json_parse`, bind to global `input`, eval the user script, JSON-stringify the result, deserialize to `serde_json::Value`. No script caching, no shared globals across calls — keeps determinism + isolation. `hooks_run` command loads `HookModule.script` from DB then delegates to `state.hook_runtime.evaluate`.

**Tech Stack:** Adds `rquickjs = "0.9"` (with default features). All other deps unchanged.

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md` §8 (Workflow / Hook engine — risk #2).

**Plan series:** Plan 8 of N. **Plan 8b** = WorkflowExecutor that walks Workflow nodes/edges, calling HookNode → HookRuntime + StartNode/EndNode passthrough. **Plan 8c** = MCPCallNode that bridges to ServerManager.list_tools_typed + RunningService.call_tool. **Plan 9** = frontend integration.

**Out of scope for Plan 8:**
- Workflow executor / node graph traversal (Plan 8b)
- MCPCallNode integration (Plan 8c)
- Async hooks / `await` inside scripts (Plan 8b — needs `rquickjs::AsyncRuntime + AsyncContext`)
- `console.log` capture or fetch polyfill (Plan 8b — when frontend can show hook stdout)
- Per-hook script caching / pre-compiled bytecode (premature; revisit when workflow latency is measured)
- CPU-time interrupt callback for runaway scripts (memory cap is the safety net for Plan 8; interrupt added when we see a real timeout in production)

---

## What rquickjs gives us (verified against /delskayn/rquickjs docs)

```rust
use rquickjs::{Runtime, Context, CatchResultExt, CaughtError, Value};

let rt = Runtime::new()?;
rt.set_memory_limit(10 * 1024 * 1024);  // 10MB cap
rt.set_max_stack_size(256 * 1024);      // 256KB stack
let ctx = Context::full(&rt)?;

ctx.with(|ctx| -> rquickjs::Result<()> {
    let input = ctx.json_parse(r#"{"x":42}"#.as_bytes())?;
    ctx.globals().set("input", input)?;

    let result: Value = ctx.eval::<Value, _>("({ doubled: input.x * 2 })".as_bytes())?;

    let json_str = ctx.json_stringify(result)?
        .ok_or_else(|| rquickjs::Error::Unknown)?
        .to_string()?;
    // json_str == r#"{"doubled":84}"#

    Ok(())
})?;
```

Key facts:
- `Runtime::new` is sync; `Context::full(&runtime)` adds standard intrinsics (Math, JSON, Object, Array, etc.).
- `ctx.with(|ctx| {...})` is the execution scope; closure runs sync.
- `ctx.eval::<T, _>(code.as_bytes())` returns `rquickjs::Result<T>`. Errors include `rquickjs::Error::Exception` for thrown JS values.
- `CatchResultExt::catch(&ctx)` upgrades errors to `CaughtError` for typed exception handling.
- `ctx.json_parse(s.as_bytes())` parses JSON to a `Value`.
- `ctx.json_stringify(value)` returns `Result<Option<String>>` — `Ok(None)` means JSON.stringify returned undefined (root was function, etc.).
- The runtime is NOT `Send` — must be used from one thread. We use `tokio::task::spawn_blocking` to run hook scripts off the async executor.

---

## File Structure (state at end of Plan 8)

```
src-tauri/
├── Cargo.toml                          # MODIFIED: add rquickjs
├── src/
│   ├── workflow/                       # NEW module
│   │   ├── mod.rs                      # NEW
│   │   └── hook_runtime.rs             # NEW
│   ├── state.rs                        # MODIFIED: add hook_runtime field
│   ├── lib.rs                          # MODIFIED: construct HookRuntime in setup; register hooks_run command
│   └── commands/
│       ├── mod.rs                      # MODIFIED: re-export hook_runtime command
│       └── hook_runtime.rs             # NEW (one command: hooks_run)
└── tests/
    └── hook_runtime_test.rs            # NEW (5 unit tests)
```

---

## Plan 1-7 lessons learned (apply preemptively)

1. `tokio::sync::RwLock` for async-spanning state.
2. ts-rs auto-export tests run inside `cargo test`.
3. `tower` was needed at runtime not just dev-deps in Plan 7 — same may apply if rquickjs has runtime-only sub-features.
4. `#[non_exhaustive]` types from third-party crates can't be struct-literaled.
5. Build dep can take several minutes on first compile (rquickjs bundles QuickJS C source).

---

## Prerequisites

- [ ] Plan 7 complete (`tauri-plan-7-done` tag exists)
- [ ] On branch `tauri-rewrite`, working tree clean
- [ ] `cargo test` reports 105 tests passing
- [ ] On Windows: a working C toolchain (MSVC `cl.exe` via Visual Studio Build Tools, OR mingw-w64 `gcc`). rquickjs builds the QuickJS C source via the `cc` crate. If neither toolchain exists, `cargo build` will fail with `error: linker 'cc' not found` or similar. Install Build Tools for Visual Studio first if so.

---

## Tasks

### Task 1: Add rquickjs + HookRuntime + tests (TDD)

**Files:**
- Modify: `src-tauri/Cargo.toml` (add rquickjs)
- Create: `src-tauri/src/workflow/mod.rs`
- Create: `src-tauri/src/workflow/hook_runtime.rs`
- Create: `src-tauri/tests/hook_runtime_test.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod workflow;`)

#### Step 1: Add rquickjs to Cargo.toml

Open `src-tauri/Cargo.toml`. In `[dependencies]` add (alphabetically near other crates):

```toml
rquickjs = "0.9"
```

(Default features include `loader` (module loading), `array-buffer` etc. We don't need to disable any for Plan 8 — the build is still tractable. If 0.9 doesn't resolve cleanly on Windows, try `0.10` or whatever's current per `cargo search rquickjs`.)

#### Step 2: cargo build

```bash
cd src-tauri
cargo build
cd ..
```

Expected: success. First build compiles the QuickJS C source — ~2-5 minutes on a typical machine. If `cc` linker errors appear on Windows, install Visual Studio Build Tools (with "Desktop development with C++") and retry.

If `cargo build` fails for non-toolchain reasons (e.g., feature-flag conflict, MSRV bump), document the fix and proceed.

#### Step 3: Write failing test

Create `src-tauri/tests/hook_runtime_test.rs`:

```rust
use serde_json::json;

use mcp_router_lib::workflow::hook_runtime::HookRuntime;

fn make_runtime() -> HookRuntime {
    HookRuntime::new().expect("HookRuntime::new")
}

#[tokio::test]
async fn evaluate_simple_arithmetic_returns_value() {
    let rt = make_runtime();
    let result = rt
        .evaluate("input.a + input.b", json!({ "a": 2, "b": 3 }))
        .await
        .expect("evaluate");
    assert_eq!(result, json!(5));
}

#[tokio::test]
async fn evaluate_with_object_input_and_object_output() {
    let rt = make_runtime();
    let result = rt
        .evaluate(
            "({ doubled: input.x * 2, name: input.label.toUpperCase() })",
            json!({ "x": 21, "label": "answer" }),
        )
        .await
        .expect("evaluate");
    assert_eq!(result, json!({ "doubled": 42, "name": "ANSWER" }));
}

#[tokio::test]
async fn evaluate_array_input_and_array_output() {
    let rt = make_runtime();
    let result = rt
        .evaluate("input.map(x => x * x)", json!([1, 2, 3, 4]))
        .await
        .expect("evaluate");
    assert_eq!(result, json!([1, 4, 9, 16]));
}

#[tokio::test]
async fn syntax_error_returns_app_error() {
    let rt = make_runtime();
    let result = rt
        .evaluate("this is not valid javascript {", json!(null))
        .await;
    assert!(result.is_err(), "expected error, got {:?}", result);
}

#[tokio::test]
async fn runtime_exception_returns_app_error_with_message() {
    let rt = make_runtime();
    let result = rt
        .evaluate("throw new Error('boom')", json!(null))
        .await;
    assert!(result.is_err(), "expected error, got {:?}", result);
    let err = result.unwrap_err();
    let msg = format!("{err:?}");
    assert!(
        msg.to_lowercase().contains("boom"),
        "expected error message to contain 'boom', got: {msg}"
    );
}
```

#### Step 4: Run test, expect failure

```bash
cd src-tauri
cargo test --test hook_runtime_test
cd ..
```

Expected: FAIL — "unresolved import `mcp_router_lib::workflow`".

#### Step 5: Create workflow/mod.rs

```rust
pub mod hook_runtime;
```

#### Step 6: Create workflow/hook_runtime.rs

```rust
use rquickjs::{CatchResultExt, CaughtError, Context, Runtime, Value};
use serde_json::Value as JsonValue;
use tokio::task;

use crate::error::{AppError, AppResult};

/// Owns a `rquickjs::Runtime` configured with memory + stack caps.
/// Each `evaluate` call creates a fresh `Context::full`, parses input as JSON, binds it as
/// the global `input`, evaluates the user script, JSON-stringifies the result and returns it.
///
/// The QuickJS `Runtime` is NOT `Send`, so `evaluate` runs on a `spawn_blocking` worker.
pub struct HookRuntime {
    // We rebuild the Runtime per evaluate to keep memory and globals isolated.
    // For Plan 8 this is the simplest correct shape; if hook latency becomes a concern,
    // we can switch to a per-call Context within a long-lived Runtime in Plan 8b.
    memory_limit: usize,
    max_stack_size: usize,
}

impl HookRuntime {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            memory_limit: 16 * 1024 * 1024, // 16 MB
            max_stack_size: 512 * 1024,     // 512 KB
        })
    }

    pub async fn evaluate(&self, script: impl Into<String>, input: JsonValue) -> AppResult<JsonValue> {
        let script = script.into();
        let memory_limit = self.memory_limit;
        let max_stack_size = self.max_stack_size;

        task::spawn_blocking(move || -> AppResult<JsonValue> {
            let rt = Runtime::new()
                .map_err(|e| AppError::Internal(format!("rquickjs Runtime::new: {e}")))?;
            rt.set_memory_limit(memory_limit);
            rt.set_max_stack_size(max_stack_size);

            let ctx = Context::full(&rt)
                .map_err(|e| AppError::Internal(format!("rquickjs Context::full: {e}")))?;

            ctx.with(|ctx| -> AppResult<JsonValue> {
                let input_json_str = serde_json::to_string(&input).map_err(|e| {
                    AppError::Internal(format!("encode hook input to json: {e}"))
                })?;

                let input_value = ctx
                    .json_parse(input_json_str.as_bytes())
                    .map_err(|e| AppError::InvalidInput(format!("parse hook input: {e}")))?;

                ctx.globals()
                    .set("input", input_value)
                    .map_err(|e| AppError::Internal(format!("set global 'input': {e}")))?;

                let result: Value = ctx
                    .eval::<Value, _>(script.as_bytes())
                    .catch(&ctx)
                    .map_err(catch_to_app_error)?;

                let json_str = ctx
                    .json_stringify(result)
                    .map_err(|e| AppError::InvalidInput(format!("stringify hook result: {e}")))?
                    .ok_or_else(|| {
                        AppError::InvalidInput(
                            "hook script returned undefined; return a JSON-encodable value"
                                .into(),
                        )
                    })?
                    .to_string()
                    .map_err(|e| {
                        AppError::Internal(format!("read stringified hook result: {e}"))
                    })?;

                serde_json::from_str(&json_str).map_err(|e| {
                    AppError::Internal(format!("decode hook result json: {e}"))
                })
            })
        })
        .await
        .map_err(|e| AppError::Internal(format!("hook task join: {e}")))?
    }
}

fn catch_to_app_error(err: CaughtError) -> AppError {
    match err {
        CaughtError::Exception(exc) => {
            let msg = exc.message().unwrap_or_default();
            let stack = exc.stack().unwrap_or_default();
            if stack.is_empty() {
                AppError::InvalidInput(format!("hook threw: {msg}"))
            } else {
                AppError::InvalidInput(format!("hook threw: {msg}\n{stack}"))
            }
        }
        CaughtError::Value(v) => AppError::InvalidInput(format!("hook threw value: {v:?}")),
        CaughtError::Error(e) => AppError::Internal(format!("rquickjs error: {e}")),
    }
}
```

> Notes:
> - `task::spawn_blocking` keeps QuickJS off the async executor (Runtime is `!Send`).
> - We rebuild Runtime + Context per call. This costs a few hundred microseconds per hook; acceptable for Plan 8. If profiling later shows it's a hot path, switch to a per-thread cached Runtime via `thread_local!`.
> - Errors from JS exceptions become `AppError::InvalidInput` (frontend will format these as "your hook script errored"), not `Internal`.
> - `Result<Option<String>>` from `json_stringify`: `None` means JSON.stringify returned undefined — surface a clear error message to the user.

#### Step 7: Wire mod in lib.rs

Open `src-tauri/src/lib.rs`. Append to the top-level `pub mod` declarations (alphabetical):

```rust
pub mod workflow;
```

Should land just before `state` or end of the mod-decl block.

#### Step 8: Re-run tests

```bash
cd src-tauri
cargo test --test hook_runtime_test
cd ..
```

Expected: PASS (5 tests).

If `evaluate_array_input_and_array_output` fails because the script `input.map(x => x * x)` doesn't behave as expected — this happens when QuickJS interprets `input` as an Object instead of an Array. The fix would be ensuring the JSON parse round-trips arrays as Array (it should by default). If you see this, double-check the eval path uses `ctx.json_parse` (not `eval`).

#### Step 9: Run all tests

```bash
cd src-tauri
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected: 105 + 5 = **110 tests passing**.

#### Step 10: Commit

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/workflow src-tauri/src/lib.rs src-tauri/tests/hook_runtime_test.rs
git commit -m "feat(workflow): HookRuntime (rquickjs, JS hook eval with JSON input/output) + 5 测试"
```

---

### Task 2: hooks_run command + AppState wiring + smoke + tag

**Files:**
- Modify: `src-tauri/src/state.rs` (add `hook_runtime` field)
- Create: `src-tauri/src/commands/hook_runtime.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod hook_runtime;`)
- Modify: `src-tauri/src/lib.rs` (construct HookRuntime in setup; register `hooks_run` command)

#### Step 1: Update state.rs

Replace the file with:

```rust
use std::sync::Arc;

use crate::{
    mcp::server_manager::ServerManager,
    persistence::registry::WorkspacePoolRegistry,
    shared_config::store::SharedConfigStore,
    workflow::hook_runtime::HookRuntime,
};

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<WorkspacePoolRegistry>,
    pub shared_config: Arc<SharedConfigStore>,
    pub server_manager: Arc<ServerManager>,
    pub hook_runtime: Arc<HookRuntime>,
}

impl AppState {
    pub fn new(
        registry: Arc<WorkspacePoolRegistry>,
        shared_config: SharedConfigStore,
        server_manager: ServerManager,
        hook_runtime: HookRuntime,
    ) -> Self {
        Self {
            registry,
            shared_config: Arc::new(shared_config),
            server_manager: Arc::new(server_manager),
            hook_runtime: Arc::new(hook_runtime),
        }
    }

    pub async fn pool(&self) -> crate::error::AppResult<sqlx::SqlitePool> {
        self.registry
            .get_or_init(crate::persistence::registry::DEFAULT_WORKSPACE)
            .await
    }
}
```

#### Step 2: Create commands/hook_runtime.rs

```rust
use serde_json::Value;
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    persistence::repository::hook_module::{HookModuleRepository, SqliteHookModuleRepository},
    state::AppState,
};

#[tauri::command]
pub async fn hooks_run(
    state: State<'_, AppState>,
    id: String,
    input: Value,
) -> AppResult<Value> {
    let repo = SqliteHookModuleRepository::new(state.pool().await?);
    let hook = repo
        .get(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("hook_module {id}")))?;
    state.hook_runtime.evaluate(hook.script, input).await
}
```

#### Step 3: Update commands/mod.rs

Append:

```rust
pub mod hook_runtime;
```

#### Step 4: Update lib.rs

Two edits:

**Edit A — imports**: Add `hook_runtime::hooks_run` and `HookRuntime` to the `use crate::{ ... };` block. The current command imports + `mcp::server_manager::ServerManager` + `http::serve::spawn_http_server` etc. — append two more entries:

In `commands::{ ... }` block, after `hooks::{...}`, add:

```rust
        hook_runtime::hooks_run,
```

In the outer `crate::{ ... }` block (alongside `mcp::server_manager::ServerManager`), add:

```rust
    workflow::hook_runtime::HookRuntime,
```

**Edit B — setup**: After constructing `server_manager`, before `AppState::new`, add HookRuntime construction:

```rust
                let server_manager = ServerManager::new(registry.clone());

                let hook_runtime = match HookRuntime::new() {
                    Ok(rt) => rt,
                    Err(err) => {
                        error!(?err, "failed to construct HookRuntime");
                        return;
                    }
                };

                let state = AppState::new(registry, shared_config, server_manager, hook_runtime);
```

(The 4-arg `AppState::new` matches the new signature in state.rs Step 1.)

**Edit C — invoke_handler**: Append `hooks_run` to the `tauri::generate_handler![...]` list. Insert after the existing `hooks_update` line:

```rust
            hooks_update,
            hooks_run,
```

(Total registered handlers: 41 + 1 = 42.)

#### Step 5: cargo check + cargo test

```bash
cd src-tauri
cargo check
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected: clean check; 110 tests passing.

#### Step 6: Smoke run

If port 3282 is held by a running Electron MCP Router, the spawn_http_server will log an error but the rest of the app continues. The smoke check verifies AppState was built (which is what Plan 8 cares about):

```bash
cd C:/Projects/WebstormProjects/mcp-router && pnpm tauri dev > /tmp/plan8-smoke.log 2>&1 &
DEV_PID=$!
echo "PID=$DEV_PID"

for i in $(seq 1 60); do
  sleep 5
  if grep -q "AppState initialized" /tmp/plan8-smoke.log 2>/dev/null; then
    echo "READY at ~$((i*5))s"
    break
  fi
  if grep -q -E "error\[|^error:|panicked|could not compile" /tmp/plan8-smoke.log 2>/dev/null; then
    echo "FAIL"
    break
  fi
done

grep -E "AppState initialized|HookRuntime|MCP HTTP server" /tmp/plan8-smoke.log

kill -9 $DEV_PID 2>/dev/null
sleep 3
ps -ef 2>/dev/null | grep -iE "tauri|cargo|mcp-router|vite" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

Expected: log shows `AppState initialized (registry + shared_config + server_manager seeded; HTTP server on 127.0.0.1:3282)` (or a fallback message if HTTP bind failed due to port conflict). The plan 8 success criterion is the AppState init line — HTTP server bind failure (port conflict) is acceptable for Plan 8 sign-off.

#### Step 7: Commit + tag

```bash
git add src-tauri/src/state.rs src-tauri/src/commands/hook_runtime.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(workflow): hooks_run command + HookRuntime 接入 AppState"
git tag -a tauri-plan-8-done -m "Plan 8 (hook runtime, rquickjs) complete: HookRuntime + hooks_run command"
```

#### Step 8: Show summary

```bash
git log --oneline tauri-plan-7-done..HEAD
```

Expected: ~3 commits since Plan 7 (1 plan doc + 1 hook_runtime + 1 wiring).

---

## Plan 8 Validation Checklist

- [ ] `cargo build` clean (rquickjs links cleanly — needs C toolchain on Windows)
- [ ] `cargo test` reports 110 tests passing
- [ ] `pnpm tauri dev` smoke shows `AppState initialized` (HTTP bind may fail due to user's running Electron app — that's OK)
- [ ] `tauri::generate_handler![...]` lists 42 commands (41 + `hooks_run`)
- [ ] tag `tauri-plan-8-done` exists

---

## Manual smoke (optional, post-Plan-8)

To exercise hook execution end-to-end via the Tauri command:

1. With `pnpm tauri dev` running, open DevTools console.
2. Save a hook:
   ```js
   const { invoke } = window.__TAURI__.core;
   await invoke("hooks_create", {
     input: {
       name: "double",
       script: "({ doubled: input.value * 2 })"
     }
   });
   const all = await invoke("hooks_list");
   const id = all[0].id;
   const result = await invoke("hooks_run", { id, input: { value: 21 } });
   console.log(result); // { doubled: 42 }
   ```
3. Expected: console logs `{ doubled: 42 }`.

---

## What Plan 8b Will Cover (preview, not part of this plan)

**Plan 8b: WorkflowExecutor.** Walks `Workflow.nodes` + `edges`, dispatching to per-node-type runners:
- `StartNode` → pass input through
- `EndNode` → return current state as result
- `HookNode` → pull hook script from DB by `hookId` field, call `HookRuntime::evaluate`
- `MCPCallNode` → return `AppError::Internal("Plan 8c not yet")` (Plan 8c implements via `ServerManager::call_tool_typed`)

Add command `workflows_execute(id, input) -> AppResult<Value>`. Frontend can drive a workflow.

**Plan 8c**: MCPCallNode wires to ServerManager. Requires extending ServerManager with `call_tool` (parallel to its existing `list_tools`).

---

## Notes for the Engineer Executing This Plan

- **`rquickjs::Runtime` is `!Send`** — must use `tokio::task::spawn_blocking`. Don't try to hold it across `.await` points; the test will panic at runtime if you do.
- **Per-call Runtime construction** is intentional for isolation in Plan 8. Future optimization possible.
- **Memory cap (16MB) and stack (512KB)** are arbitrary; reasonable for typical hooks. Adjust if real usage hits the limit.
- **JS exceptions become `AppError::InvalidInput`**, not `Internal`. Rationale: the user wrote the buggy script.
- **No console.log capture** — script `console.log("hi")` calls are silently dropped (QuickJS' default `console` may not even exist depending on intrinsic loading). Plan 8b adds a logger that captures into `tracing::info`.
- **No `await`** — synchronous JS only. Plan 8b can opt into `rquickjs::AsyncRuntime` if hooks need fetch/etc.
- **rquickjs version**: pin to 0.9 if it builds; bump to whatever's current if 0.9 fails. Document the version actually used in the commit message.
- **`ctx.json_parse` and `ctx.json_stringify` take/return bytes-or-strings** — verify against your rquickjs minor version; the doc snippet uses `&[u8]`. If signatures differ, adjust to whatever compiles.
- **Don't add the workflow executor here** — Plan 8b. Hooks alone is the deliverable.
