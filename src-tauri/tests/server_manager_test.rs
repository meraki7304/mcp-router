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
