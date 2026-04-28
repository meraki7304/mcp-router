# MCP Router Tauri Rewrite — Plan 8b: Workflow Executor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the workflow executor that walks `Workflow.nodes` + `edges` (xyflow JSON shape), calls `HookRuntime` for `HookNode`s, and chains intermediate values through the graph. Add `workflows_execute(id, input)` Tauri command. After Plan 8b: a frontend can run a stored workflow end-to-end IF it only contains Start/End/Hook nodes (MCPCallNode errors out — Plan 8c handles).

**Architecture:** New module `src-tauri/src/workflow/executor.rs`. Define typed `WorkflowNode` enum that deserializes from the xyflow JSON shape stored in `workflows.nodes_json`. The executor:
1. Parses `nodes` and `edges` into typed structs
2. Finds the `StartNode` (single, errors if 0 or >1)
3. Walks edges from current node; for each visited node dispatches to a node-type-specific runner
4. Threads a `serde_json::Value` (current state) through the graph
5. Stops at `EndNode`, returning the current value

Linear-chain workflows are the Plan 8b target. Branching (multiple outgoing edges from a node) is a future plan when the frontend introduces conditional routing.

**Tech Stack:** No new dependencies. Uses existing rquickjs (Plan 8), HookModuleRepository (Plan 3), serde_json.

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md` §8.

**Plan series:** Plan 8b of N. **Plan 8c** = MCPCallNode integration (needs `ServerManager.call_tool_typed` extension). **Plan 9** = frontend integration. Plan 7b deferred.

**Out of scope for Plan 8b:**
- MCPCallNode: returns `AppError::Internal("TODO Plan 8c")` (Plan 8c implements via `ServerManager.call_tool_typed`)
- Conditional / branching workflows (single linear chain only)
- Parallel execution (sequential only)
- Workflow cancellation mid-run (runs to completion or first error)
- Per-node timeout (HookRuntime has memory cap; no time cap yet)
- Run history persistence (not stored anywhere; result returned to caller)

---

## xyflow node/edge format reminder

The frontend's xyflow editor stores nodes and edges as JSON arrays. Plan 3's `Workflow.nodes_json` and `Workflow.edges_json` hold these. Shape we accept (matches xyflow defaults):

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": {"x":0,"y":0}, "data": {} },
    { "id": "n2", "type": "hook", "position": {"x":100,"y":0}, "data": { "hookId": "hk-abc" } },
    { "id": "n3", "type": "mcp-call", "position": {"x":200,"y":0}, "data": { "serverId":"srv","toolName":"fetch","args":{} } },
    { "id": "n4", "type": "end", "position": {"x":300,"y":0}, "data": {} }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2" },
    { "id": "e2", "source": "n2", "target": "n3" },
    { "id": "e3", "source": "n3", "target": "n4" }
  ]
}
```

Rust types ignore `position` and any other xyflow fields beyond `id`, `type`, `data`. We use `#[serde(default)]` and `#[serde(rename_all = "camelCase")]` so unknown fields don't break parsing.

---

## File Structure (state at end of Plan 8b)

```
src-tauri/src/
├── workflow/
│   ├── mod.rs                         # MODIFIED: add executor module
│   ├── hook_runtime.rs                # unchanged
│   └── executor.rs                    # NEW
└── commands/
    ├── mod.rs                         # unchanged
    ├── hook_runtime.rs                # unchanged
    └── workflows.rs                   # MODIFIED: add workflows_execute command
src-tauri/tests/
└── workflow_executor_test.rs          # NEW
src-tauri/src/lib.rs                   # MODIFIED: register workflows_execute
```

---

## Plan 1-8 lessons learned (apply preemptively)

1. `tokio::sync::RwLock` for async-spanning state — not used here (executor is sync at the graph-walk layer; HookRuntime spawns its own blocking task internally).
2. ts-rs auto-export tests run inside `cargo test`.
3. Don't add `#[serde(deny_unknown_fields)]` — xyflow adds future fields and we want to ignore them gracefully.
4. Pre-existing ts-rs `serde(skip_serializing_if)` warnings are noise; don't touch.
5. `From<sqlx::Error> for AppError` propagates SQL errors via `?`.

---

## Prerequisites

- [ ] Plan 8 complete (`tauri-plan-8-done` tag exists)
- [ ] On branch `tauri-rewrite`, working tree clean
- [ ] `cargo test` reports 110 tests passing

---

## Tasks

### Task 1: WorkflowExecutor (TDD)

**Files:**
- Create: `src-tauri/src/workflow/executor.rs`
- Create: `src-tauri/tests/workflow_executor_test.rs`
- Modify: `src-tauri/src/workflow/mod.rs` (add `pub mod executor;`)

#### Step 1: Write failing test

Create `src-tauri/tests/workflow_executor_test.rs`:

```rust
use std::sync::Arc;

use serde_json::json;

use mcp_router_lib::{
    persistence::{
        pool::init_pool_at_path,
        repository::{
            hook_module::{HookModuleRepository, SqliteHookModuleRepository},
            workflow::{SqliteWorkflowRepository, WorkflowRepository},
        },
        types::{
            hook_module::NewHookModule,
            workflow::NewWorkflow,
        },
    },
    workflow::{executor::WorkflowExecutor, hook_runtime::HookRuntime},
};

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
    let executor = WorkflowExecutor::new(
        Arc::new(SqliteHookModuleRepository::new(pool.clone())),
        hook_runtime.clone(),
    );
    (tmp, workflows, hooks, hook_runtime, executor)
}

#[tokio::test]
async fn execute_start_to_end_passes_input_through() {
    let (_tmp, workflows, _hooks, _rt, executor) = make_setup().await;
    let wf = workflows
        .create(NewWorkflow {
            name: "passthrough".into(),
            description: None,
            workflow_type: None,
            nodes: json!([
                { "id": "s", "type": "start", "data": {} },
                { "id": "e", "type": "end", "data": {} }
            ]),
            edges: json!([
                { "id": "e1", "source": "s", "target": "e" }
            ]),
            enabled: true,
        })
        .await
        .unwrap();

    let result = executor
        .execute(&wf, json!({ "x": 42 }))
        .await
        .expect("execute");
    assert_eq!(result, json!({ "x": 42 }));
}

#[tokio::test]
async fn execute_with_single_hook_transforms_value() {
    let (_tmp, workflows, hooks, _rt, executor) = make_setup().await;
    let hook = hooks
        .create(NewHookModule {
            name: "double".into(),
            script: "({ doubled: input.x * 2 })".into(),
        })
        .await
        .unwrap();
    let wf = workflows
        .create(NewWorkflow {
            name: "wf-double".into(),
            description: None,
            workflow_type: None,
            nodes: json!([
                { "id": "s", "type": "start", "data": {} },
                { "id": "h", "type": "hook", "data": { "hookId": hook.id } },
                { "id": "e", "type": "end", "data": {} }
            ]),
            edges: json!([
                { "id": "e1", "source": "s", "target": "h" },
                { "id": "e2", "source": "h", "target": "e" }
            ]),
            enabled: true,
        })
        .await
        .unwrap();

    let result = executor
        .execute(&wf, json!({ "x": 21 }))
        .await
        .expect("execute");
    assert_eq!(result, json!({ "doubled": 42 }));
}

#[tokio::test]
async fn execute_with_two_hooks_chains_outputs() {
    let (_tmp, workflows, hooks, _rt, executor) = make_setup().await;
    let h1 = hooks
        .create(NewHookModule {
            name: "first".into(),
            script: "({ stage1: input.start + 1 })".into(),
        })
        .await
        .unwrap();
    let h2 = hooks
        .create(NewHookModule {
            name: "second".into(),
            script: "({ stage2: input.stage1 * 10 })".into(),
        })
        .await
        .unwrap();
    let wf = workflows
        .create(NewWorkflow {
            name: "chain".into(),
            description: None,
            workflow_type: None,
            nodes: json!([
                { "id": "s", "type": "start", "data": {} },
                { "id": "h1", "type": "hook", "data": { "hookId": h1.id } },
                { "id": "h2", "type": "hook", "data": { "hookId": h2.id } },
                { "id": "e", "type": "end", "data": {} }
            ]),
            edges: json!([
                { "id": "e1", "source": "s", "target": "h1" },
                { "id": "e2", "source": "h1", "target": "h2" },
                { "id": "e3", "source": "h2", "target": "e" }
            ]),
            enabled: true,
        })
        .await
        .unwrap();

    let result = executor
        .execute(&wf, json!({ "start": 4 }))
        .await
        .expect("execute");
    assert_eq!(result, json!({ "stage2": 50 }));
}

#[tokio::test]
async fn execute_errors_when_no_start_node() {
    let (_tmp, workflows, _hooks, _rt, executor) = make_setup().await;
    let wf = workflows
        .create(NewWorkflow {
            name: "no-start".into(),
            description: None,
            workflow_type: None,
            nodes: json!([
                { "id": "e", "type": "end", "data": {} }
            ]),
            edges: json!([]),
            enabled: true,
        })
        .await
        .unwrap();
    let result = executor.execute(&wf, json!({})).await;
    assert!(result.is_err());
    let msg = format!("{:?}", result.unwrap_err());
    assert!(msg.to_lowercase().contains("start"));
}

#[tokio::test]
async fn execute_errors_when_hook_missing_id() {
    let (_tmp, workflows, _hooks, _rt, executor) = make_setup().await;
    let wf = workflows
        .create(NewWorkflow {
            name: "bad-hook".into(),
            description: None,
            workflow_type: None,
            nodes: json!([
                { "id": "s", "type": "start", "data": {} },
                { "id": "h", "type": "hook", "data": { "hookId": "nonexistent" } },
                { "id": "e", "type": "end", "data": {} }
            ]),
            edges: json!([
                { "id": "e1", "source": "s", "target": "h" },
                { "id": "e2", "source": "h", "target": "e" }
            ]),
            enabled: true,
        })
        .await
        .unwrap();
    let result = executor.execute(&wf, json!({})).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn execute_errors_on_mcp_call_node_in_plan_8b() {
    let (_tmp, workflows, _hooks, _rt, executor) = make_setup().await;
    let wf = workflows
        .create(NewWorkflow {
            name: "with-mcp".into(),
            description: None,
            workflow_type: None,
            nodes: json!([
                { "id": "s", "type": "start", "data": {} },
                { "id": "m", "type": "mcp-call", "data": { "serverId": "x", "toolName": "y", "args": {} } },
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
    assert!(msg.to_lowercase().contains("mcp"));
}
```

#### Step 2: Run failing test

```bash
cd src-tauri
cargo test --test workflow_executor_test
cd ..
```
Expected: FAIL — "unresolved import `mcp_router_lib::workflow::executor`".

#### Step 3: Create workflow/executor.rs

```rust
use std::{collections::HashMap, sync::Arc};

use serde::Deserialize;
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    persistence::{
        repository::hook_module::HookModuleRepository,
        types::workflow::Workflow,
    },
    workflow::hook_runtime::HookRuntime,
};

/// Loose-typed view of a workflow node parsed from xyflow JSON. Unknown fields ignored.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParsedNode {
    id: String,
    #[serde(rename = "type", default)]
    node_type: String,
    #[serde(default)]
    data: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParsedEdge {
    #[serde(default)]
    #[allow(dead_code)]
    id: String,
    source: String,
    target: String,
}

/// Hook-node-specific data shape.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HookNodeData {
    hook_id: String,
}

pub struct WorkflowExecutor {
    hooks: Arc<dyn HookModuleRepository>,
    hook_runtime: Arc<HookRuntime>,
}

impl WorkflowExecutor {
    pub fn new(
        hooks: Arc<dyn HookModuleRepository>,
        hook_runtime: Arc<HookRuntime>,
    ) -> Self {
        Self { hooks, hook_runtime }
    }

    /// Execute the workflow as a linear chain Start → ... → End. Errors if multiple Start nodes,
    /// no Start node, more than one outgoing edge from a node, or any runner errors.
    pub async fn execute(&self, workflow: &Workflow, input: Value) -> AppResult<Value> {
        let nodes: Vec<ParsedNode> = serde_json::from_value(workflow.nodes.clone())
            .map_err(|e| AppError::InvalidInput(format!("parse workflow nodes: {e}")))?;
        let edges: Vec<ParsedEdge> = serde_json::from_value(workflow.edges.clone())
            .map_err(|e| AppError::InvalidInput(format!("parse workflow edges: {e}")))?;

        // Build adjacency: source-id -> Vec<target-id>
        let mut adj: HashMap<String, Vec<String>> = HashMap::new();
        for edge in &edges {
            adj.entry(edge.source.clone())
                .or_default()
                .push(edge.target.clone());
        }
        let nodes_by_id: HashMap<String, &ParsedNode> =
            nodes.iter().map(|n| (n.id.clone(), n)).collect();

        // Find the Start node — exactly one required.
        let start_nodes: Vec<&ParsedNode> =
            nodes.iter().filter(|n| n.node_type == "start").collect();
        if start_nodes.is_empty() {
            return Err(AppError::InvalidInput(
                "workflow has no start node".into(),
            ));
        }
        if start_nodes.len() > 1 {
            return Err(AppError::InvalidInput(format!(
                "workflow has {} start nodes (expected exactly 1)",
                start_nodes.len()
            )));
        }
        let mut current_id = start_nodes[0].id.clone();
        let mut state = input;
        let mut visited = std::collections::HashSet::new();

        loop {
            if !visited.insert(current_id.clone()) {
                return Err(AppError::InvalidInput(format!(
                    "workflow cycle detected at node {current_id}"
                )));
            }

            let node = nodes_by_id.get(&current_id).ok_or_else(|| {
                AppError::InvalidInput(format!("edge target {current_id} has no node"))
            })?;

            // Run the node.
            state = self.run_node(node, state).await?;

            if node.node_type == "end" {
                return Ok(state);
            }

            // Follow the single outgoing edge. Plan 8b doesn't branch.
            let next = adj.get(&current_id).cloned().unwrap_or_default();
            match next.as_slice() {
                [] => {
                    return Err(AppError::InvalidInput(format!(
                        "node {current_id} has no outgoing edge and isn't an end node"
                    )));
                }
                [single] => {
                    current_id = single.clone();
                }
                many => {
                    return Err(AppError::InvalidInput(format!(
                        "node {current_id} has {} outgoing edges (Plan 8b supports linear chains only)",
                        many.len()
                    )));
                }
            }
        }
    }

    async fn run_node(&self, node: &ParsedNode, state: Value) -> AppResult<Value> {
        match node.node_type.as_str() {
            "start" => Ok(state), // pass through
            "end" => Ok(state),   // pass through (caller checks node_type and stops)
            "hook" => {
                let data: HookNodeData = serde_json::from_value(node.data.clone())
                    .map_err(|e| AppError::InvalidInput(format!(
                        "node {} has invalid hook data: {e}",
                        node.id
                    )))?;
                let hook = self
                    .hooks
                    .get(&data.hook_id)
                    .await?
                    .ok_or_else(|| AppError::NotFound(format!(
                        "hook_module {} (referenced by node {})",
                        data.hook_id, node.id
                    )))?;
                self.hook_runtime.evaluate(hook.script, state).await
            }
            "mcp-call" => Err(AppError::Internal(format!(
                "node {} is mcp-call — not implemented in Plan 8b (Plan 8c)",
                node.id
            ))),
            other => Err(AppError::InvalidInput(format!(
                "node {} has unknown type {other:?}",
                node.id
            ))),
        }
    }
}
```

#### Step 4: Wire mod in workflow/mod.rs

Open `src-tauri/src/workflow/mod.rs`. Append:

```rust
pub mod executor;
```

#### Step 5: Re-run tests

```bash
cd src-tauri
cargo test --test workflow_executor_test
cd ..
```

Expected: PASS (6 tests).

If `Arc<dyn HookModuleRepository>` complains about object safety: ensure `HookModuleRepository` has `Send + Sync` bounds in the trait declaration (Plan 3 set this; verify).

#### Step 6: Run all tests

```bash
cd src-tauri
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected: 110 + 6 = **116 tests passing**.

#### Step 7: Commit

```bash
git add src-tauri/src/workflow/executor.rs src-tauri/src/workflow/mod.rs src-tauri/tests/workflow_executor_test.rs
git commit -m "feat(workflow): WorkflowExecutor 走线性 Start→Hook*→End 节点链 + 6 集成测试"
```

---

### Task 2: workflows_execute command + smoke + tag

**Files:**
- Modify: `src-tauri/src/commands/workflows.rs` (add execute command)
- Modify: `src-tauri/src/lib.rs` (register `workflows_execute`)

#### Step 1: Update commands/workflows.rs

Open `src-tauri/src/commands/workflows.rs`. The current file has 7 commands (`workflows_list`, etc.). Add at the bottom:

```rust
use std::sync::Arc;

use serde_json::Value;

use crate::{
    persistence::repository::hook_module::SqliteHookModuleRepository,
    workflow::executor::WorkflowExecutor,
};

#[tauri::command]
pub async fn workflows_execute(
    state: State<'_, AppState>,
    id: String,
    input: Value,
) -> AppResult<Value> {
    let pool = state.pool().await?;
    let workflow = SqliteWorkflowRepository::new(pool.clone())
        .get(&id)
        .await?
        .ok_or_else(|| crate::error::AppError::NotFound(format!("workflow {id}")))?;

    let hooks: Arc<dyn crate::persistence::repository::hook_module::HookModuleRepository> =
        Arc::new(SqliteHookModuleRepository::new(pool));

    let executor = WorkflowExecutor::new(hooks, state.hook_runtime.clone());
    executor.execute(&workflow, input).await
}
```

The `use std::sync::Arc;` line goes at the top of the file with the existing imports if not already there. Same for `serde_json::Value`. The `crate::workflow::executor::WorkflowExecutor` import is new. If the existing file imports differ in style, integrate cleanly.

#### Step 2: Update lib.rs

Add `workflows_execute` to the `workflows::{...}` import block:

```rust
        workflows::{
            workflows_create, workflows_delete, workflows_execute, workflows_get,
            workflows_list, workflows_list_by_type, workflows_list_enabled, workflows_update,
        },
```

Add `workflows_execute,` to the `tauri::generate_handler![...]` list — insert after the existing `workflows_update,` line:

```rust
            workflows_update,
            workflows_execute,
```

(Total registered handlers: 42 + 1 = 43.)

#### Step 3: cargo check + cargo test

```bash
cd src-tauri
cargo check
cargo test 2>&1 | grep "test result:" | tail -3
cd ..
```

Expected: clean check; 116 tests passing.

#### Step 4: Smoke run

```bash
cd C:/Projects/WebstormProjects/mcp-router && pnpm tauri dev > /tmp/plan8b-smoke.log 2>&1 &
DEV_PID=$!

for i in $(seq 1 60); do
  sleep 5
  if grep -q "AppState initialized" /tmp/plan8b-smoke.log 2>/dev/null; then
    echo "READY at ~$((i*5))s"
    break
  fi
  if grep -q -E "error\[|^error:|panicked|could not compile" /tmp/plan8b-smoke.log 2>/dev/null; then
    echo "FAIL"
    break
  fi
done

grep -E "AppState initialized|MCP HTTP server" /tmp/plan8b-smoke.log

kill -9 $DEV_PID 2>/dev/null
sleep 3
ps -ef 2>/dev/null | grep -iE "tauri|cargo|mcp-router|vite" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

Expected: `AppState initialized` log line. HTTP bind may fail if user's Electron app holds 3282 — that's OK.

#### Step 5: Commit + tag

```bash
git add src-tauri/src/commands/workflows.rs src-tauri/src/lib.rs
git commit -m "feat(workflow): workflows_execute command (链式 hook 节点 + start/end)"
git tag -a tauri-plan-8b-done -m "Plan 8b (workflow executor — Start/Hook/End) complete"
```

#### Step 6: Show summary

```bash
git log --oneline tauri-plan-8-done..HEAD
```

Expected: ~3 commits since Plan 8 (1 plan doc + 1 executor + 1 wiring).

---

## Plan 8b Validation Checklist

- [ ] `cargo test` reports 116 tests passing
- [ ] `pnpm tauri dev` smoke shows `AppState initialized`
- [ ] `tauri::generate_handler![...]` lists 43 commands
- [ ] tag `tauri-plan-8b-done` exists

---

## Manual smoke (optional, post-Plan-8b)

```js
const { invoke } = window.__TAURI__.core;

// Create a hook
await invoke("hooks_create", { input: { name: "double", script: "({ doubled: input.x * 2 })" } });
const hooks = await invoke("hooks_list");
const hookId = hooks.find(h => h.name === "double").id;

// Create a workflow that uses it
await invoke("workflows_create", {
  input: {
    name: "test-workflow",
    description: "double the x value",
    nodes: [
      { id: "s", type: "start", data: {} },
      { id: "h", type: "hook", data: { hookId } },
      { id: "e", type: "end", data: {} }
    ],
    edges: [
      { id: "e1", source: "s", target: "h" },
      { id: "e2", source: "h", target: "e" }
    ],
    enabled: true
  }
});
const workflows = await invoke("workflows_list");
const wfId = workflows[0].id;

// Run it
const result = await invoke("workflows_execute", { id: wfId, input: { x: 21 } });
console.log(result); // { doubled: 42 }
```

---

## Notes for the Engineer Executing This Plan

- **Linear chains only** — no branching. Multi-output nodes are an error.
- **Cycle detection** via `visited: HashSet<NodeId>` — protects against malformed workflows.
- **Unknown node types** error out via `AppError::InvalidInput` — frontend will show "unknown node type 'xxx'".
- **MCPCallNode is intentionally Internal-error** (Plan 8c) — not a misuse, just unimplemented.
- **xyflow extra fields are ignored** — `position`, `width`, `height`, etc. don't break parsing thanks to no `deny_unknown_fields`.
- **`Arc<dyn HookModuleRepository>`** depends on the trait being object-safe. Plan 3 declared it `: Send + Sync` — verify if compile fails with object-safety error.
- **Don't add a new ts-rs type** for ParsedNode/ParsedEdge — they're internal parsing helpers, never exposed to JS.
