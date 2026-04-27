use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};

use crate::shared_config::store::SharedConfigStore;

/// State the middleware closes over.
#[derive(Clone)]
pub struct AuthState {
    pub shared_config: Arc<SharedConfigStore>,
}

/// axum middleware: requires `Authorization: Bearer <token-id>`. Looks up the token in
/// `SharedConfigStore`. On miss returns 401. On hit, attaches the `Token` to request extensions
/// so downstream handlers can read it (Plan 7b uses this for per-token server-access ACL).
pub async fn require_bearer_token(
    State(state): State<AuthState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token_id = match auth_header.and_then(|s| s.strip_prefix("Bearer ")) {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => return Err(StatusCode::UNAUTHORIZED),
    };

    let token = match state.shared_config.get_token(&token_id).await {
        Some(t) => t,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    req.extensions_mut().insert(token);
    Ok(next.run(req).await)
}

/// Helper for unauthorized responses with a JSON body — useful when middleware returns 401 from
/// inside a handler instead of via Result. Not used directly by `require_bearer_token` but exposed
/// here for Plan 7b's per-server-access ACL.
#[allow(dead_code)]
pub fn unauthorized_json(message: &str) -> Response {
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!(r#"{{"error":"{}"}}"#, message)))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}
