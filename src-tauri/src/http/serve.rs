use std::{net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    body::Body,
    extract::Request,
    middleware::{self, Next},
    response::Response,
    Json, Router,
};
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

/// 绑 [::] 而不是 127.0.0.1：客户端可能用 `localhost:3282` 它会解析成
/// IPv6 ::1，原来只绑 IPv4 时连不上。Windows dual-stack socket 自动覆盖
/// IPv4 + IPv6 loopback。仍然只接受 loopback 流量（外网不可达）。
pub const HTTP_BIND_ADDR: &str = "[::]:3282";

/// Build the axum router with `/mcp` mounted (auth-required) and a permissive `/health` endpoint.
pub fn build_router(
    server_manager: Arc<ServerManager>,
    shared_config: Arc<SharedConfigStore>,
) -> Router {
    let server_manager_for_factory = server_manager.clone();
    let shared_config_for_factory = shared_config.clone();

    // stateful_mode=true：保留 LocalSessionManager 维护的 session 状态。
    //
    // 已知限制：dev 重启会清空内存里的 session，已连过的 MCP 客户端持着老 session-id
    // 重连会撞 'session not found'。客户端按 spec 应当 404 后重新 initialize，
    // 但很多实现（如 LibreChat #11868）不重连，要用户手动重启客户端。
    //
    // 改成 stateless+json_response 也无济于事——客户端如果开 SSE GET 流，
    // server 同样会因为认不出老 session-id 而报错。根本上是客户端缓存问题。
    // StreamableHttpServerConfig 是 #[non_exhaustive]，只能 default + 字段赋值。
    let mut cfg = StreamableHttpServerConfig::default();
    cfg.stateful_mode = true;
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
                .layer(middleware::from_fn(log_request))
                .layer(middleware::from_fn_with_state(
                    auth_state,
                    require_bearer_token,
                ))
                .service(mcp_service),
        )
}

/// 临时诊断中间件：把每个 /mcp 请求的方法/路径/session-id/accept 记下来，
/// 方便定位 "session not found" 的具体场景。
async fn log_request(req: Request, next: Next) -> Response<Body> {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let session_id = req
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("(none)")
        .to_string();
    let accept = req
        .headers()
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("(none)")
        .to_string();
    let auth_present = req.headers().contains_key("authorization");
    info!(
        %method,
        %uri,
        session_id = %session_id,
        accept = %accept,
        auth_present,
        "mcp http request"
    );
    let response = next.run(req).await;
    info!(
        status = %response.status(),
        "mcp http response"
    );
    response
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
