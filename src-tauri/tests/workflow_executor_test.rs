use std::sync::Arc;

use serde_json::json;

use mcp_router_lib::{
    mcp::server_manager::ServerManager,
    persistence::{
        pool::init_pool_at_path,
        registry::WorkspacePoolRegistry,
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
    let registry = Arc::new(WorkspacePoolRegistry::new(tmp.path().to_path_buf()));
    let server_manager = Arc::new(ServerManager::new(registry));
    let executor = WorkflowExecutor::new(
        Arc::new(SqliteHookModuleRepository::new(pool.clone())),
        hook_runtime.clone(),
        server_manager,
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
