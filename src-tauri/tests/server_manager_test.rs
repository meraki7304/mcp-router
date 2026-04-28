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

#[tokio::test]
async fn list_tools_typed_errors_when_not_running() {
    let (_tmp, mgr) = make_manager();
    let result = mgr.list_tools_typed("missing").await;
    assert!(matches!(
        result,
        Err(mcp_router_lib::error::AppError::NotFound(_))
    ));
}

#[tokio::test]
async fn call_tool_typed_errors_when_not_running() {
    let (_tmp, mgr) = make_manager();
    let result = mgr.call_tool_typed("missing", "any", None).await;
    assert!(matches!(
        result,
        Err(mcp_router_lib::error::AppError::NotFound(_))
    ));
}

#[tokio::test]
async fn running_servers_returns_empty_when_none_running() {
    let (_tmp, mgr) = make_manager();
    let infos = mgr.running_servers().await.expect("running_servers");
    assert!(infos.is_empty());
}

#[tokio::test]
async fn running_servers_returns_app_result_ok_after_pool_init() {
    // Sanity: the registry pool init (which happens lazily inside running_servers) doesn't error
    // when there are no running servers.
    let (_tmp, mgr) = make_manager();
    let result = mgr.running_servers().await;
    assert!(result.is_ok(), "expected Ok, got {:?}", result);
}
