use std::collections::HashMap;

use mcp_router_lib::shared_config::{
    store::SharedConfigStore,
    types::{AppSettings, Theme, Token},
};

async fn make_store() -> (tempfile::TempDir, SharedConfigStore) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let store = SharedConfigStore::open(tmp.path().join("shared-config.json"))
        .await
        .expect("open");
    (tmp, store)
}

#[tokio::test]
async fn fresh_store_returns_default_settings() {
    let (_tmp, store) = make_store().await;
    let s = store.get_settings().await;
    assert_eq!(s.theme, Some(Theme::System));
    assert_eq!(s.auto_update_enabled, Some(true));
    assert_eq!(s.max_request_log_rows, Some(50_000));
}

#[tokio::test]
async fn update_settings_persists_to_disk() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let path = tmp.path().join("shared-config.json");

    {
        let store = SharedConfigStore::open(path.clone()).await.expect("open");
        let mut s = store.get_settings().await;
        s.theme = Some(Theme::Dark);
        s.lightweight_mode = Some(true);
        store.update_settings(s).await.expect("update_settings");
    }

    // Re-open: settings should round-trip.
    let store2 = SharedConfigStore::open(path).await.expect("reopen");
    let s2 = store2.get_settings().await;
    assert_eq!(s2.theme, Some(Theme::Dark));
    assert_eq!(s2.lightweight_mode, Some(true));
}

#[tokio::test]
async fn list_tokens_starts_empty() {
    let (_tmp, store) = make_store().await;
    let tokens = store.list_tokens().await;
    assert!(tokens.is_empty());
}

#[tokio::test]
async fn save_and_get_token() {
    let (_tmp, store) = make_store().await;
    let token = sample_token("t1", "client-A", &[("server-x", true)]);
    store.save_token(token.clone()).await.expect("save");

    let fetched = store.get_token("t1").await.expect("get");
    assert_eq!(fetched.id, "t1");
    assert_eq!(fetched.client_id, "client-A");
    assert_eq!(fetched.server_access.get("server-x"), Some(&true));
}

#[tokio::test]
async fn save_token_with_existing_id_replaces() {
    let (_tmp, store) = make_store().await;
    let t1 = sample_token("t1", "client-A", &[("s", true)]);
    let t1b = sample_token("t1", "client-A", &[("s", false)]);
    store.save_token(t1).await.unwrap();
    store.save_token(t1b).await.unwrap();

    let tokens = store.list_tokens().await;
    assert_eq!(tokens.len(), 1);
    assert_eq!(tokens[0].server_access.get("s"), Some(&false));
}

#[tokio::test]
async fn delete_token_returns_true_then_get_returns_none() {
    let (_tmp, store) = make_store().await;
    let token = sample_token("t1", "client-A", &[]);
    store.save_token(token).await.unwrap();

    let removed = store.delete_token("t1").await.expect("delete");
    assert!(removed);
    assert!(store.get_token("t1").await.is_none());

    let removed_again = store.delete_token("t1").await.expect("delete again");
    assert!(!removed_again);
}

#[tokio::test]
async fn delete_client_tokens_removes_all_matching() {
    let (_tmp, store) = make_store().await;
    store.save_token(sample_token("t1", "alice", &[])).await.unwrap();
    store.save_token(sample_token("t2", "alice", &[])).await.unwrap();
    store.save_token(sample_token("t3", "bob", &[])).await.unwrap();

    let removed = store.delete_client_tokens("alice").await.expect("delete client");
    assert_eq!(removed, 2);

    let remaining = store.list_tokens().await;
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].client_id, "bob");
}

#[tokio::test]
async fn update_token_server_access_replaces_field() {
    let (_tmp, store) = make_store().await;
    store
        .save_token(sample_token("t1", "client-A", &[("old-server", true)]))
        .await
        .unwrap();

    let mut new_access = HashMap::new();
    new_access.insert("new-server".to_string(), true);
    new_access.insert("another-server".to_string(), false);

    let updated = store
        .update_token_server_access("t1", new_access.clone())
        .await
        .expect("update");
    assert!(updated);

    let token = store.get_token("t1").await.expect("get");
    assert_eq!(token.server_access, new_access);
    assert!(!token.server_access.contains_key("old-server"));
}

#[tokio::test]
async fn update_token_server_access_returns_false_for_missing_token() {
    let (_tmp, store) = make_store().await;
    let updated = store
        .update_token_server_access("nonexistent", HashMap::new())
        .await
        .expect("update");
    assert!(!updated);
}

#[tokio::test]
async fn open_with_existing_file_preserves_unknown_fields_being_dropped_silently() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let path = tmp.path().join("shared-config.json");

    // Write a file with the legacy Electron shape, including an unrecognized field.
    let legacy = r#"{
        "settings": { "theme": "dark", "lightweightMode": true },
        "mcpApps": { "tokens": [] },
        "_meta": { "version": "1.0.0", "lastModified": "2026-04-27T00:00:00Z" },
        "futureFeature": { "weShouldIgnoreThis": true }
    }"#;
    tokio::fs::write(&path, legacy).await.expect("write legacy");

    let store = SharedConfigStore::open(path).await.expect("open legacy");
    let s = store.get_settings().await;
    assert_eq!(s.theme, Some(Theme::Dark));
    assert_eq!(s.lightweight_mode, Some(true));
}

fn sample_token(id: &str, client_id: &str, access: &[(&str, bool)]) -> Token {
    let mut server_access = HashMap::new();
    for (k, v) in access {
        server_access.insert(k.to_string(), *v);
    }
    Token {
        id: id.into(),
        client_id: client_id.into(),
        issued_at: 1_714_000_000_000,
        server_access,
    }
}
