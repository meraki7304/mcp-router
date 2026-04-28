use std::{net::SocketAddr, sync::Arc, time::Duration};

use axum::{middleware, Json, Router};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use serde_json::json;
use tokio::net::TcpListener;
use tracing::{error, info};

use crate::{
    error::{AppError, AppResult},
    http::{
        aggregator::Aggregator,
        auth::{require_bearer_token, AuthState},
    },
    mcp::server_manager::ServerManager,
    shared_config::store::SharedConfigStore,
};

pub const HTTP_BIND_ADDR: &str = "127.0.0.1:3282";

/// Build the axum router with `/mcp` mounted (auth-required) and a permissive `/health` endpoint.
pub fn build_router(
    server_manager: Arc<ServerManager>,
    shared_config: Arc<SharedConfigStore>,
) -> Router {
    let server_manager_for_factory = server_manager.clone();
    let shared_config_for_factory = shared_config.clone();

    // 无状态 + JSON 响应模式：每个 POST 请求独立处理，不维护 session，不开 SSE 流。
    //
    // 走 stateful_mode=true + LocalSessionManager 时，server 重启后内存里的 session
    // 全没了，但很多 MCP 客户端会缓存 session-id 重连——撞到 "session not found"
    // 就直接 closing connection 而不是按 spec 重新 initialize（典型 bug：见
    // LibreChat #11868）。
    //
    // Aggregator 场景不需要 server-side 主推通知（tools/list_changed 等），所以
    // 用 stateless + JSON 既稳又简单。代价：MCP 客户端如果指定要 SSE 会拿到 JSON。
    // StreamableHttpServerConfig 是 #[non_exhaustive]，只能 default + 字段赋值。
    let mut cfg = StreamableHttpServerConfig::default();
    cfg.stateful_mode = false;
    cfg.json_response = true;
    cfg.sse_keep_alive = Some(Duration::from_secs(30));
    cfg.sse_retry = Some(Duration::from_secs(3));

    let mcp_service = StreamableHttpService::new(
        move || {
            Ok(Aggregator::new(
                server_manager_for_factory.clone(),
                shared_config_for_factory.clone(),
            ))
        },
        LocalSessionManager::default().into(),
        cfg,
    );

    let auth_state = AuthState {
        shared_config: shared_config.clone(),
    };

    // /health 用闭包捕获 server_manager，避免 Router 与 mcp 子服务的 state 类型冲突
    let sm_for_health = server_manager.clone();
    let health_route = axum::routing::get(move || {
        let sm = sm_for_health.clone();
        async move { health_response(sm).await }
    });

    Router::new()
        .route("/health", health_route)
        .nest_service(
            "/mcp",
            tower::ServiceBuilder::new()
                .layer(middleware::from_fn_with_state(
                    auth_state,
                    require_bearer_token,
                ))
                .service(mcp_service),
        )
}

/// Build the /health JSON payload: hub state + per-running-server status.
async fn health_response(server_manager: Arc<ServerManager>) -> Json<serde_json::Value> {
    let running = server_manager.running_servers().await.unwrap_or_default();
    let mut servers = Vec::with_capacity(running.len());
    for info in running {
        let status = server_manager.status(&info.id).await;
        servers.push(json!({
            "id": info.id,
            "name": info.name,
            "status": status,
        }));
    }
    let count = servers.len();
    Json(json!({
        "state": "ready",
        "servers": servers,
        "running_count": count,
    }))
}

/// Spawn the HTTP server on `127.0.0.1:3282` as a tokio task. Returns immediately after binding.
/// Errors during request handling are logged via `tracing::error`; the task runs forever.
pub async fn spawn_http_server(
    server_manager: Arc<ServerManager>,
    shared_config: Arc<SharedConfigStore>,
) -> AppResult<()> {
    let addr: SocketAddr = HTTP_BIND_ADDR.parse().map_err(|e| {
        AppError::Internal(format!("parse bind addr {HTTP_BIND_ADDR}: {e}"))
    })?;

    let listener = TcpListener::bind(addr).await.map_err(|e| {
        AppError::Internal(format!("bind {HTTP_BIND_ADDR}: {e}"))
    })?;
    info!(addr = %addr, "MCP HTTP server listening");

    let router = build_router(server_manager, shared_config);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            error!(error = %e, "MCP HTTP server stopped");
        }
    });

    Ok(())
}
