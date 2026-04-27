use mcp_router_lib::commands::ping::ping_impl;

#[test]
fn ping_returns_hello_with_name() {
    let out = ping_impl("Tauri");
    assert_eq!(out, "Hello, Tauri! (from Rust)");
}

#[test]
fn ping_handles_empty_name() {
    let out = ping_impl("");
    assert_eq!(out, "Hello, world! (from Rust)");
}
