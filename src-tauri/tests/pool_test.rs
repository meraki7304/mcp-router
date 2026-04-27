use std::path::PathBuf;

use mcp_router_lib::persistence::pool::init_pool;

#[tokio::test]
async fn init_pool_creates_db_and_runs_migrations() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let db_path: PathBuf = tmp.path().join("test.sqlite");

    let pool = init_pool(&db_path).await.expect("pool");

    let row: (String,) = sqlx::query_as("SELECT value FROM _meta WHERE key = 'schema_introduced_at'")
        .fetch_one(&pool)
        .await
        .expect("query meta row");

    assert!(!row.0.is_empty());
}
