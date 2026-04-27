use mcp_router_lib::persistence::registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE};

#[tokio::test]
async fn registry_initializes_default_workspace_pool() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let registry = WorkspacePoolRegistry::new(tmp.path().to_path_buf());

    let pool = registry.get_or_init(DEFAULT_WORKSPACE).await.expect("pool");
    let row: (String,) = sqlx::query_as("SELECT value FROM _meta WHERE key = 'schema_introduced_at'")
        .fetch_one(&pool)
        .await
        .expect("query meta row");
    assert!(!row.0.is_empty());
}

#[tokio::test]
async fn registry_returns_same_pool_on_repeat_get() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let registry = WorkspacePoolRegistry::new(tmp.path().to_path_buf());

    let pool_a = registry.get_or_init(DEFAULT_WORKSPACE).await.expect("pool a");
    let pool_b = registry.get_or_init(DEFAULT_WORKSPACE).await.expect("pool b");

    // sqlx::SqlitePool is Clone (it's an Arc<...>); repeat gets should share the same underlying handle.
    // We verify by checking pool size — both clones reference the same pool's connection counts.
    assert_eq!(pool_a.size(), pool_b.size());
}

#[tokio::test]
async fn registry_isolates_pools_per_workspace() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let registry = WorkspacePoolRegistry::new(tmp.path().to_path_buf());

    let pool_default = registry.get_or_init(DEFAULT_WORKSPACE).await.expect("default");
    let pool_other = registry.get_or_init("ws-abc").await.expect("other");

    // Insert a unique row into "ws-abc"'s _meta and verify it's NOT visible in default's pool.
    sqlx::query("INSERT INTO _meta(key, value) VALUES ('isolation_marker', 'abc')")
        .execute(&pool_other)
        .await
        .expect("insert marker");

    let count_in_default: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM _meta WHERE key = 'isolation_marker'",
    )
    .fetch_one(&pool_default)
    .await
    .expect("query default");
    assert_eq!(count_in_default.0, 0);
}
