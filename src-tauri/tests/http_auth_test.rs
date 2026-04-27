use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
    middleware,
    routing::get,
    Router,
};
use http_body_util::BodyExt;
use tower::ServiceExt;

use mcp_router_lib::{
    http::auth::{require_bearer_token, AuthState},
    shared_config::{store::SharedConfigStore, types::Token},
};

async fn make_router() -> (tempfile::TempDir, Router, Arc<SharedConfigStore>) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let store = SharedConfigStore::open(tmp.path().join("shared-config.json"))
        .await
        .expect("open store");
    let store_arc = Arc::new(store);

    let auth_state = AuthState {
        shared_config: store_arc.clone(),
    };

    let app = Router::new()
        .route("/protected", get(|| async { "ok" }))
        .layer(middleware::from_fn_with_state(
            auth_state,
            require_bearer_token,
        ));

    (tmp, app, store_arc)
}

#[tokio::test]
async fn missing_authorization_header_returns_401() {
    let (_tmp, app, _) = make_router().await;
    let response = app
        .oneshot(Request::builder().uri("/protected").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn malformed_bearer_returns_401() {
    let (_tmp, app, _) = make_router().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/protected")
                .header("Authorization", "NotBearer x")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unknown_bearer_token_returns_401() {
    let (_tmp, app, _) = make_router().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/protected")
                .header("Authorization", "Bearer not-a-real-token-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn valid_bearer_token_passes_through() {
    let (_tmp, app, store) = make_router().await;
    let token = Token {
        id: "tok-abc".into(),
        client_id: "client-x".into(),
        issued_at: 1_714_000_000_000,
        server_access: HashMap::new(),
    };
    store.save_token(token).await.expect("save");

    let response = app
        .oneshot(
            Request::builder()
                .uri("/protected")
                .header("Authorization", "Bearer tok-abc")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], b"ok");
}
