use chrono::{Duration, Utc};
use serde_json::json;

use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::request_log::{RequestLogRepository, SqliteRequestLogRepository},
    types::request_log::{NewRequestLog, RequestLogQuery},
};

async fn make_repo() -> (tempfile::TempDir, SqliteRequestLogRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("logs.sqlite"))
        .await
        .expect("pool");
    (tmp, SqliteRequestLogRepository::new(pool))
}

fn sample(ts_offset_secs: i64, server: Option<&str>) -> NewRequestLog {
    NewRequestLog {
        timestamp: Utc::now() - Duration::seconds(ts_offset_secs),
        client_id: Some("c1".into()),
        client_name: Some("Test Client".into()),
        server_id: server.map(|s| s.to_string()),
        server_name: None,
        request_type: Some("tools/list".into()),
        request_params: Some(json!({ "foo": 1 })),
        response_data: Some(json!({ "ok": true })),
        response_status: Some("ok".into()),
        duration_ms: Some(42),
        error_message: None,
    }
}

#[tokio::test]
async fn insert_returns_log_with_assigned_id() {
    let (_tmp, repo) = make_repo().await;
    let inserted = repo.insert(sample(0, Some("s1"))).await.expect("insert");
    assert!(!inserted.id.is_empty());
    assert_eq!(inserted.server_id.as_deref(), Some("s1"));
    assert_eq!(inserted.duration_ms, Some(42));
    assert_eq!(inserted.request_params, Some(json!({ "foo": 1 })));
}

#[tokio::test]
async fn query_returns_most_recent_first_with_no_filters() {
    let (_tmp, repo) = make_repo().await;
    repo.insert(sample(10, Some("s1"))).await.unwrap();
    repo.insert(sample(5, Some("s1"))).await.unwrap();
    repo.insert(sample(0, Some("s1"))).await.unwrap();

    let page = repo
        .query(RequestLogQuery { before: None, limit: 10, ..Default::default() })
        .await
        .expect("query");
    assert_eq!(page.items.len(), 3);
    assert!(page.items[0].timestamp > page.items[1].timestamp);
    assert!(page.items[1].timestamp > page.items[2].timestamp);
    assert!(!page.has_more);
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn query_paginates_via_before_cursor() {
    let (_tmp, repo) = make_repo().await;
    for i in 0..5 {
        repo.insert(sample(i, None)).await.unwrap();
    }

    let first = repo
        .query(RequestLogQuery { before: None, limit: 2, ..Default::default() })
        .await
        .expect("first page");
    assert_eq!(first.items.len(), 2);
    assert!(first.has_more);
    let cursor = first.next_cursor.expect("cursor");

    let second = repo
        .query(RequestLogQuery { before: Some(cursor), limit: 2, ..Default::default() })
        .await
        .expect("second page");
    assert_eq!(second.items.len(), 2);
    assert!(second.items[0].timestamp < first.items[1].timestamp);
}

#[tokio::test]
async fn query_filters_by_server_id() {
    let (_tmp, repo) = make_repo().await;
    repo.insert(sample(2, Some("s1"))).await.unwrap();
    repo.insert(sample(1, Some("s2"))).await.unwrap();
    repo.insert(sample(0, Some("s1"))).await.unwrap();

    let page = repo
        .query(RequestLogQuery {
            server_id: Some("s1".into()),
            limit: 10,
            ..Default::default()
        })
        .await
        .expect("query");
    assert_eq!(page.items.len(), 2);
    assert!(page.items.iter().all(|l| l.server_id.as_deref() == Some("s1")));
}

#[tokio::test]
async fn trim_keeps_only_max_recent_rows() {
    let (_tmp, repo) = make_repo().await;
    for i in 0..10 {
        repo.insert(sample(i, None)).await.unwrap();
    }
    let deleted = repo.trim_to_max(3).await.expect("trim");
    assert_eq!(deleted, 7);

    let page = repo
        .query(RequestLogQuery { before: None, limit: 100, ..Default::default() })
        .await
        .expect("query");
    assert_eq!(page.items.len(), 3);
}

#[tokio::test]
async fn trim_with_zero_max_clears_all() {
    let (_tmp, repo) = make_repo().await;
    for _ in 0..3 {
        repo.insert(sample(0, None)).await.unwrap();
    }
    let deleted = repo.trim_to_max(0).await.expect("trim");
    assert_eq!(deleted, 3);

    let page = repo
        .query(RequestLogQuery { before: None, limit: 10, ..Default::default() })
        .await
        .expect("query");
    assert!(page.items.is_empty());
}
