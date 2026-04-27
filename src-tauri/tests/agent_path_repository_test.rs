use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::agent_path::{AgentPathRepository, SqliteAgentPathRepository},
    types::agent_path::{AgentPathPatch, NewAgentPath},
};

async fn make_repo() -> (tempfile::TempDir, SqliteAgentPathRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("agent_paths.sqlite"))
        .await
        .expect("pool");
    (tmp, SqliteAgentPathRepository::new(pool))
}

#[tokio::test]
async fn create_then_get_returns_same_entry() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewAgentPath {
            name: "node".into(),
            path: "/usr/local/bin/node".into(),
        })
        .await
        .expect("create");
    assert_eq!(created.name, "node");
    assert_eq!(created.path, "/usr/local/bin/node");

    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.id, created.id);
}

#[tokio::test]
async fn list_orders_by_name() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewAgentPath { name: "uvx".into(), path: "/x".into() }).await.unwrap();
    repo.create(NewAgentPath { name: "node".into(), path: "/n".into() }).await.unwrap();
    repo.create(NewAgentPath { name: "deno".into(), path: "/d".into() }).await.unwrap();

    let all = repo.list().await.expect("list");
    let names: Vec<_> = all.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, vec!["deno", "node", "uvx"]);
}

#[tokio::test]
async fn find_by_name_works() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewAgentPath { name: "Bun".into(), path: "/b".into() })
        .await
        .unwrap();
    let found = repo.find_by_name("Bun").await.expect("find").expect("some");
    assert_eq!(found.id, created.id);
}

#[tokio::test]
async fn update_changes_path() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewAgentPath { name: "node".into(), path: "/old".into() })
        .await
        .unwrap();
    let original = created.updated_at;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let patched = repo
        .update(&created.id, AgentPathPatch { name: None, path: Some("/new".into()) })
        .await
        .expect("update");
    assert_eq!(patched.path, "/new");
    assert_eq!(patched.name, "node"); // unchanged
    assert!(patched.updated_at > original);
}

#[tokio::test]
async fn delete_returns_true_then_get_returns_none() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewAgentPath { name: "tmp".into(), path: "/t".into() })
        .await
        .unwrap();
    assert!(repo.delete(&created.id).await.expect("delete"));
    assert!(repo.get(&created.id).await.expect("get").is_none());
    assert!(!repo.delete(&created.id).await.expect("delete again"));
}

#[tokio::test]
async fn create_with_duplicate_name_fails() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewAgentPath { name: "uniq".into(), path: "/a".into() }).await.unwrap();
    let dup = repo.create(NewAgentPath { name: "uniq".into(), path: "/b".into() }).await;
    assert!(dup.is_err());
}
