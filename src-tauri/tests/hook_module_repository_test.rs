use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::hook_module::{HookModuleRepository, SqliteHookModuleRepository},
    types::hook_module::{HookModulePatch, NewHookModule},
};

async fn make_repo() -> (tempfile::TempDir, SqliteHookModuleRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("hooks.sqlite"))
        .await
        .expect("pool");
    (tmp, SqliteHookModuleRepository::new(pool))
}

#[tokio::test]
async fn create_then_get_round_trip() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewHookModule {
            name: "redact_pii".into(),
            script: "exports.run = (req) => req".into(),
        })
        .await
        .expect("create");
    assert_eq!(created.name, "redact_pii");
    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.script, "exports.run = (req) => req");
}

#[tokio::test]
async fn list_orders_by_name() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewHookModule { name: "z_hook".into(), script: "/* */".into() }).await.unwrap();
    repo.create(NewHookModule { name: "a_hook".into(), script: "/* */".into() }).await.unwrap();
    let all = repo.list().await.expect("list");
    assert_eq!(all[0].name, "a_hook");
    assert_eq!(all[1].name, "z_hook");
}

#[tokio::test]
async fn find_by_name_returns_none_when_missing() {
    let (_tmp, repo) = make_repo().await;
    let found = repo.find_by_name("nonexistent").await.expect("find");
    assert!(found.is_none());
}

#[tokio::test]
async fn update_replaces_script() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewHookModule { name: "h".into(), script: "v1".into() })
        .await
        .unwrap();
    let original = created.updated_at;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let patched = repo
        .update(&created.id, HookModulePatch { name: None, script: Some("v2".into()) })
        .await
        .expect("update");
    assert_eq!(patched.script, "v2");
    assert!(patched.updated_at > original);
}

#[tokio::test]
async fn delete_round_trip() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewHookModule { name: "tmp".into(), script: "//".into() })
        .await
        .unwrap();
    assert!(repo.delete(&created.id).await.expect("delete"));
    assert!(repo.get(&created.id).await.expect("get").is_none());
}

#[tokio::test]
async fn create_with_duplicate_name_fails() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewHookModule { name: "u".into(), script: "/* */".into() }).await.unwrap();
    let dup = repo.create(NewHookModule { name: "u".into(), script: "/* */".into() }).await;
    assert!(dup.is_err());
}
