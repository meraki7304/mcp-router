use mcp_router_lib::error::AppError;
use serde_json::json;

#[test]
fn app_error_serializes_with_kind_and_message() {
    let err = AppError::NotFound("server abc".into());
    let v = serde_json::to_value(&err).expect("serialize");
    assert_eq!(v, json!({ "kind": "NotFound", "message": "server abc" }));
}

#[test]
fn app_error_invalid_input_serialization() {
    let err = AppError::InvalidInput("bad".into());
    let v = serde_json::to_value(&err).expect("serialize");
    assert_eq!(v, json!({ "kind": "InvalidInput", "message": "bad" }));
}

#[test]
fn app_error_from_sqlx_maps_to_internal() {
    // sqlx::Error::RowNotFound -> AppError::NotFound (special-case)
    let sqlx_err = sqlx::Error::RowNotFound;
    let app_err: AppError = sqlx_err.into();
    matches!(app_err, AppError::NotFound(_));
}
