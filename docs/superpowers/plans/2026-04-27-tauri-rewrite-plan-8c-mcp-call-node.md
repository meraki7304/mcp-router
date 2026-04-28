# MCP Router Tauri Rewrite — Plan 8c: MCPCallNode in WorkflowExecutor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `MCPCallNode` in `WorkflowExecutor` to actually call MCP tools via `ServerManager::call_tool_typed` (added in Plan 7b). After Plan 8c: a workflow node like `{ id: "n", type: "mcp-call", data: { serverId, toolName, args } }` invokes the tool, reads the result, and threads it as JSON to the next node.

**Architecture:** Single-task plan. `WorkflowExecutor` gains a constructor argument `Arc<ServerManager>` and the `mcp-call` branch in `run_node` parses node `data` (`serverId`, `toolName`, `args`), calls `server_manager.call_tool_typed(server_id, tool_name, arguments_map)`, extracts the structured `CallToolResult.content` into a JSON value, returns it. Update `workflows_execute` command to pass the server_manager into the executor constructor.

**Tech Stack:** No new dependencies.

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md` §8.

**Plan series:** Plan 8c of N. After this, the workflow story is complete (Start/Hook/MCPCall/End). Next: Plan 9 (frontend integration).

**Out of scope for Plan 8c:**
- Variable interpolation in `args` (e.g., `args: { url: "{{input.url}}" }` substituting from the chain state) — Plan 8d if needed; Plan 8c passes `args` literally
- `mcp-call` against a server that's NOT running auto-starts it — Plan 8c errors out and the user must start servers explicitly
- Tool call timeouts — relies on rmcp's defaults
- Streaming tool responses — `call_tool_typed` collects the full response

---

## MCPCallNode data shape

```json
{
  "id": "n",
  "type": "mcp-call",
  "data": {
    "serverId": "srv-uuid",
    "toolName": "fetch",
    "args": { "url": "https://example.com" }
  }
}
```

`serverId` (TEXT, references `servers.id`); `toolName` (string, MCP-side tool identifier); `args` (object, passed straight through as `Option<serde_json::Map<String, Value>>` to `call_tool_typed`).

If `args` is missing or null, we pass `None` (matches MCP spec: `arguments` is optional).

---

## Tool result → JSON shape

`rmcp::model::CallToolResult` has a `content: Vec<rmcp::model::Content>` field where `Content` is a tagged union (`{ type: "text", text: "..." }`, `{ type: "image", data, mimeType }`, etc.). For the chain state, we serialize the entire `CallToolResult` as JSON via serde — the shape lands as:

```json
{
  "content": [{"type": "text", "text": "..."}, ...],
  "isError": false
}
```

Downstream HookNodes can read `input.content[0].text` etc.

---

## File Structure (state at end of Plan 8c)

```
src-tauri/src/
├── workflow/
│   └── executor.rs                     # MODIFIED: take Arc<ServerManager>; implement mcp-call branch
└── commands/
    └── workflows.rs                    # MODIFIED: pass server_manager when constructing executor
src-tauri/tests/
└── workflow_executor_test.rs           # MODIFIED: replace "errors on mcp-call" test with one that errors when server not running
```

No new files. Three existing files modified.

---

## Plan 1-8b lessons learned (apply preemptively)

1. `rmcp::model::CallToolResult` is `#[non_exhaustive]` with `Serialize` — pass it through `serde_json::to_value` to get a JSON value. Don't construct literals.
2. `serde_json::Map<String, Value>` is what `call_tool_typed` accepts. Convert from `serde_json::Value::Object` via `.as_object().cloned()`.
3. ts-rs auto-export tests counted in cargo test — Plan 8c adds NO ts-rs types; existing test count of 120 stays unless we add new tests (we replace one, count stays).

---

## Prerequisites

- [ ] Plan 7b complete (`tauri-plan-7b-done` tag exists)
- [ ] On branch `tauri-rewrite`, working tree clean
- [ ] `cargo test` reports 120 tests passing

---

## Tasks

### Task 1: WorkflowExecutor mcp-call branch + workflows_execute update + smoke + tag

This is a single-task plan because the change is small and tightly coupled.

**Files:**
- Modify: `src-tauri/src/workflow/executor.rs` (add `Arc<ServerManager>` field; implement mcp-call branch)
- Modify: `src-tauri/src/commands/workflows.rs` (pass server_manager when constructing executor)
- Modify: `src-tauri/tests/workflow_executor_test.rs` (rewrite `execute_errors_on_mcp_call_node_in_plan_8b` to test new behavior)

#### Step 1: Update workflow/executor.rs

Open `src-tauri/src/workflow/executor.rs`. Apply these changes:

**Add to imports** (top of file, alongside existing crate imports):

```rust
use crate::mcp::server_manager::ServerManager;
```

**Add an `MCPCallNodeData` struct** alongside the existing `HookNodeData`:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpCallNodeData {
    server_id: String,
    tool_name: String,
    #[serde(default)]
    args: Value,
}
```

**Update `WorkflowExecutor` struct** to hold `Arc<ServerManager>`:

```rust
pub struct WorkflowExecutor {
    hooks: Arc<dyn HookModuleRepository>,
    hook_runtime: Arc<HookRuntime>,
    server_manager: Arc<ServerManager>,
}

impl WorkflowExecutor {
    pub fn new(
        hooks: Arc<dyn HookModuleRepository>,
        hook_runtime: Arc<HookRuntime>,
        server_manager: Arc<ServerManager>,
    ) -> Self {
        Self {
            hooks,
            hook_runtime,
            server_manager,
        }
    }
    // execute(&self, ...) unchanged
}
```

**Replace the `mcp-call` arm** of `run_node`:

```rust
            "mcp-call" => {
                let data: McpCallNodeData = serde_json::from_value(node.data.clone())
                    .map_err(|e| AppError::InvalidInput(format!(
                        "node {} has invalid mcp-call data: {e}",
                        node.id
                    )))?;

                // Coerce args (Value) to Option<Map> as expected by call_tool_typed.
                let arguments = match data.args {
                    Value::Null => None,
                    Value::Object(map) => Some(map),
                    other => {
                        return Err(AppError::InvalidInput(format!(
                            "node {} mcp-call args must be a JSON object, got: {other:?}",
                            node.id
                        )));
                    }
                };

                let result = self
                    .server_manager
                    .call_tool_typed(&data.server_id, &data.tool_name, arguments)
                    .await?;

                // CallToolResult → JSON Value via Serialize.
                serde_json::to_value(&result).map_err(|e| {
                    AppError::Internal(format!("encode CallToolResult: {e}"))
                })
            }
```

(The previous Plan 8b arm returned `AppError::Internal("...Plan 8c...")`. Replace it entirely with the above.)

#### Step 2: Update commands/workflows.rs

Open `src-tauri/src/commands/workflows.rs`. The `workflows_execute` command currently constructs `WorkflowExecutor::new(hooks, state.hook_runtime.clone())` — update to also pass `state.server_manager.clone()`:

```rust
    let executor = WorkflowExecutor::new(
        hooks,
        state.hook_runtime.clone(),
        state.server_manager.clone(),
    );
```

(The rest of the file stays the same.)

#### Step 3: Update tests/workflow_executor_test.rs

Open `src-tauri/tests/workflow_executor_test.rs`.

**Add to imports** (alongside other use statements):

```rust
use mcp_router_lib::{
    mcp::server_manager::ServerManager,
    persistence::registry::WorkspacePoolRegistry,
};
```

**Update `make_setup`** to construct + pass a ServerManager. Replace the body of `make_setup`:

```rust
async fn make_setup() -> (
    tempfile::TempDir,
    SqliteWorkflowRepository,
    SqliteHookModuleRepository,
    Arc<HookRuntime>,
    WorkflowExecutor,
) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("wf.sqlite"))
        .await
        .expect("pool");
    let workflows = SqliteWorkflowRepository::new(pool.clone());
    let hooks = SqliteHookModuleRepository::new(pool.clone());
    let hook_runtime = Arc::new(HookRuntime::new().expect("runtime"));
    let registry = Arc::new(WorkspacePoolRegistry::new(tmp.path().to_path_buf()));
    let server_manager = Arc::new(ServerManager::new(registry));
    let executor = WorkflowExecutor::new(
        Arc::new(SqliteHookModuleRepository::new(pool.clone())),
        hook_runtime.clone(),
        server_manager,
    );
    (tmp, workflows, hooks, hook_runtime, executor)
}
```

**Replace the test** `execute_errors_on_mcp_call_node_in_plan_8b` with `execute_errors_on_mcp_call_when_server_not_running` (different behavior now — instead of always erroring, it errors only if the server isn't running):

```rust
#[tokio::test]
async fn execute_errors_on_mcp_call_when_server_not_running() {
    let (_tmp, workflows, _hooks, _rt, executor) = make_setup().await;
    let wf = workflows
        .create(NewWorkflow {
            name: "with-mcp".into(),
            description: None,
            workflow_type: None,
            nodes: json!([
                { "id": "s", "type": "start", "data": {} },
                { "id": "m", "type": "mcp-call", "data": {
                    "serverId": "nonexistent-server-id",
                    "toolName": "any",
                    "args": {}
                } },
                { "id": "e", "type": "end", "data": {} }
            ]),
            edges: json!([
                { "id": "e1", "source": "s", "target": "m" },
                { "id": "e2", "source": "m", "target": "e" }
            ]),
            enabled: true,
        })
        .await
        .unwrap();
    let result = executor.execute(&wf, json!({})).await;
    assert!(result.is_err());
    let msg = format!("{:?}", result.unwrap_err());
    assert!(
        msg.to_lowercase().contains("not running") || msg.to_lowercase().contains("notfound"),
        "expected 'not running' or 'NotFound' in error, got: {msg}"
    );
}
```

(All other tests keep working — Start→End and hook-chain tests don't touch ServerManager.)

#### Step 4: cargo check + cargo test

```bash
cd src-tauri
cargo check
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected: clean check; **120 tests passing** (count unchanged — one test rewritten, not added).

#### Step 5: Smoke run

```bash
cd C:/Projects/WebstormProjects/mcp-router && pnpm tauri dev > /tmp/plan8c-smoke.log 2>&1 &
DEV_PID=$!

for i in $(seq 1 60); do
  sleep 5
  if grep -q "AppState initialized" /tmp/plan8c-smoke.log 2>/dev/null; then
    echo "READY at ~$((i*5))s"
    break
  fi
  if grep -q -E "error\[|^error:|panicked|could not compile" /tmp/plan8c-smoke.log 2>/dev/null; then
    echo "FAIL"
    break
  fi
done

grep -E "AppState initialized|MCP HTTP server" /tmp/plan8c-smoke.log

kill -9 $DEV_PID 2>/dev/null
sleep 3
ps -ef 2>/dev/null | grep -iE "tauri|cargo|mcp-router|vite" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

Expected: `AppState initialized` log line.

#### Step 6: Commit + tag

```bash
git add src-tauri/src/workflow/executor.rs src-tauri/src/commands/workflows.rs src-tauri/tests/workflow_executor_test.rs
git commit -m "feat(workflow): MCPCallNode 接 ServerManager.call_tool_typed (workflow Start→Hook→MCP→End 全通)"
git tag -a tauri-plan-8c-done -m "Plan 8c (MCPCallNode in WorkflowExecutor) complete — workflow node types fully implemented"
```

#### Step 7: Show summary

```bash
git log --oneline tauri-plan-7b-done..HEAD
```

Expected: ~2 commits since Plan 7b (1 plan doc + 1 implementation).

---

## Plan 8c Validation Checklist

- [ ] `cargo test` reports 120 tests passing (unchanged count — one test rewritten)
- [ ] `pnpm tauri dev` smoke shows `AppState initialized`
- [ ] `tauri::generate_handler![...]` count unchanged (43)
- [ ] tag `tauri-plan-8c-done` exists

---

## Manual smoke (optional, post-Plan-8c)

To exercise the full workflow with MCP call (assumes user closed Electron MCP Router):

```js
const { invoke } = window.__TAURI__.core;

// 1. Start a real MCP server (requires npx on PATH)
await invoke("servers_create", {
  input: {
    name: "everything",
    serverType: "local",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    env: {},
    autoStart: false, disabled: false,
    inputParams: {}, requiredParams: [], toolPermissions: {}
  }
});
const servers = await invoke("servers_list");
const srvId = servers.find(s => s.name === "everything").id;
await invoke("servers_start", { id: srvId });
const tools = await invoke("servers_list_tools", { id: srvId });
console.log("tools:", tools.map(t => t.name));  // expect 'echo', 'add', etc.

// 2. Create a workflow that calls 'echo' tool
await invoke("workflows_create", {
  input: {
    name: "echo-test",
    nodes: [
      { id: "s", type: "start", data: {} },
      { id: "m", type: "mcp-call", data: { serverId: srvId, toolName: "echo", args: { message: "hello from workflow" } } },
      { id: "e", type: "end", data: {} }
    ],
    edges: [
      { id: "e1", source: "s", target: "m" },
      { id: "e2", source: "m", target: "e" }
    ],
    enabled: true
  }
});
const wfs = await invoke("workflows_list");
const wfId = wfs.find(w => w.name === "echo-test").id;

// 3. Execute the workflow
const result = await invoke("workflows_execute", { id: wfId, input: {} });
console.log(result);
// expect: { content: [{ type: "text", text: "Echo: hello from workflow" }], isError: false }
```

---

## Notes for the Engineer Executing This Plan

- **`CallToolResult` Serialize via serde_json::to_value** — no manual extraction needed. Frontend gets the full structured shape including `content[]` and `isError`.
- **`call_tool_typed`'s arguments arg is `Option<serde_json::Map<String, Value>>`** — Plan 8c converts from the node's `args: Value` field at the boundary.
- **No variable interpolation** — `args` in node data is passed literally. If a user wants `args: { url: input.value }`, they must use a HookNode upstream to compute it.
- **WorkflowExecutor::new now takes 3 Arc args** — verify the Plan 8b call site in `commands/workflows.rs` is updated. cargo check will pinpoint missed call sites.
- **Test `execute_errors_on_mcp_call_node_in_plan_8b` is replaced**, not deleted — the new test covers more useful behavior (server-not-running) than the old "always errors" check.
- **Don't add notification/streaming support** — `CallToolResult` is the full sync response. rmcp may expose progress notifications elsewhere; not Plan 8c's concern.
