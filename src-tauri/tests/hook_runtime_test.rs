use serde_json::json;

use mcp_router_lib::workflow::hook_runtime::HookRuntime;

fn make_runtime() -> HookRuntime {
    HookRuntime::new().expect("HookRuntime::new")
}

#[tokio::test]
async fn evaluate_simple_arithmetic_returns_value() {
    let rt = make_runtime();
    let result = rt
        .evaluate("input.a + input.b", json!({ "a": 2, "b": 3 }))
        .await
        .expect("evaluate");
    assert_eq!(result, json!(5));
}

#[tokio::test]
async fn evaluate_with_object_input_and_object_output() {
    let rt = make_runtime();
    let result = rt
        .evaluate(
            "({ doubled: input.x * 2, name: input.label.toUpperCase() })",
            json!({ "x": 21, "label": "answer" }),
        )
        .await
        .expect("evaluate");
    assert_eq!(result, json!({ "doubled": 42, "name": "ANSWER" }));
}

#[tokio::test]
async fn evaluate_array_input_and_array_output() {
    let rt = make_runtime();
    let result = rt
        .evaluate("input.map(x => x * x)", json!([1, 2, 3, 4]))
        .await
        .expect("evaluate");
    assert_eq!(result, json!([1, 4, 9, 16]));
}

#[tokio::test]
async fn syntax_error_returns_app_error() {
    let rt = make_runtime();
    let result = rt
        .evaluate("this is not valid javascript {", json!(null))
        .await;
    assert!(result.is_err(), "expected error, got {:?}", result);
}

#[tokio::test]
async fn runtime_exception_returns_app_error_with_message() {
    let rt = make_runtime();
    let result = rt
        .evaluate("throw new Error('boom')", json!(null))
        .await;
    assert!(result.is_err(), "expected error, got {:?}", result);
    let err = result.unwrap_err();
    let msg = format!("{err:?}");
    assert!(
        msg.to_lowercase().contains("boom"),
        "expected error message to contain 'boom', got: {msg}"
    );
}
