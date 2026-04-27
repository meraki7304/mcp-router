use std::collections::HashMap;

use serde_json::json;

use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::server::{ServerRepository, SqliteServerRepository},
    types::server::{NewServer, ServerPatch, ServerType},
};
use sqlx::SqlitePool;

async fn make_repo() -> (tempfile::TempDir, SqlitePool, SqliteServerRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("servers.sqlite"))
        .await
        .expect("pool");
    let repo = SqliteServerRepository::new(pool.clone());
    (tmp, pool, repo)
}

async fn seed_project(pool: &SqlitePool, id: &str) {
    let now = chrono::Utc::now();
    sqlx::query(
        "INSERT INTO projects(id, name, optimization, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(id)
    .bind("none")
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .expect("seed project");
}

fn local_server(name: &str) -> NewServer {
    let mut env = HashMap::new();
    env.insert("LOG_LEVEL".into(), "info".into());
    NewServer {
        name: name.into(),
        server_type: ServerType::Local,
        description: Some("test server".into()),
        command: Some("uvx".into()),
        args: vec!["mcp-server-fetch".into()],
        env,
        context_path: None,
        remote_url: None,
        bearer_token: None,
        auto_start: false,
        disabled: false,
        auto_approve: None,
        input_params: json!({ "url": "https://x" }),
        required_params: vec!["url".into()],
        tool_permissions: {
            let mut p = HashMap::new();
            p.insert("fetch".into(), true);
            p
        },
        project_id: None,
    }
}

#[tokio::test]
async fn create_local_server_round_trips_all_fields() {
    let (_tmp, _pool, repo) = make_repo().await;
    let created = repo.create(local_server("fetcher")).await.expect("create");
    assert_eq!(created.name, "fetcher");
    assert_eq!(created.server_type, ServerType::Local);
    assert_eq!(created.command.as_deref(), Some("uvx"));
    assert_eq!(created.args, vec!["mcp-server-fetch".to_string()]);
    assert_eq!(created.env.get("LOG_LEVEL").map(String::as_str), Some("info"));
    assert_eq!(created.input_params, json!({ "url": "https://x" }));
    assert_eq!(created.required_params, vec!["url".to_string()]);
    assert_eq!(created.tool_permissions.get("fetch"), Some(&true));

    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.id, created.id);
    assert_eq!(fetched.env, created.env);
    assert_eq!(fetched.tool_permissions, created.tool_permissions);
}

#[tokio::test]
async fn create_remote_server_with_url_and_token() {
    let (_tmp, _pool, repo) = make_repo().await;
    let created = repo
        .create(NewServer {
            name: "remote".into(),
            server_type: ServerType::Remote,
            description: None,
            command: None,
            args: vec![],
            env: HashMap::new(),
            context_path: None,
            remote_url: Some("https://api.example.com/mcp".into()),
            bearer_token: Some("token-xyz".into()),
            auto_start: true,
            disabled: false,
            auto_approve: None,
            input_params: json!({}),
            required_params: vec![],
            tool_permissions: HashMap::new(),
            project_id: None,
        })
        .await
        .expect("create");
    assert_eq!(created.server_type, ServerType::Remote);
    assert_eq!(created.remote_url.as_deref(), Some("https://api.example.com/mcp"));
    assert_eq!(created.bearer_token.as_deref(), Some("token-xyz"));
    assert!(created.auto_start);
}

#[tokio::test]
async fn list_orders_by_name() {
    let (_tmp, _pool, repo) = make_repo().await;
    repo.create(local_server("zeta")).await.unwrap();
    repo.create(local_server("alpha")).await.unwrap();
    repo.create(local_server("mu")).await.unwrap();

    let all = repo.list().await.expect("list");
    let names: Vec<_> = all.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["alpha", "mu", "zeta"]);
}

#[tokio::test]
async fn list_by_project_filters_correctly() {
    let (_tmp, pool, repo) = make_repo().await;
    seed_project(&pool, "proj-1").await;
    seed_project(&pool, "proj-2").await;
    let mut a = local_server("a");
    a.project_id = Some("proj-1".into());
    let mut b = local_server("b");
    b.project_id = Some("proj-2".into());
    let c = local_server("c"); // no project
    repo.create(a).await.unwrap();
    repo.create(b).await.unwrap();
    repo.create(c).await.unwrap();

    let in_proj1 = repo.list_by_project("proj-1").await.expect("list_by_project");
    assert_eq!(in_proj1.len(), 1);
    assert_eq!(in_proj1[0].name, "a");
}

#[tokio::test]
async fn find_by_name_works() {
    let (_tmp, _pool, repo) = make_repo().await;
    let created = repo.create(local_server("named")).await.unwrap();
    let found = repo.find_by_name("named").await.expect("find").expect("some");
    assert_eq!(found.id, created.id);
}

#[tokio::test]
async fn update_changes_command_and_env() {
    let (_tmp, _pool, repo) = make_repo().await;
    let created = repo.create(local_server("svc")).await.unwrap();
    let original = created.updated_at;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let mut new_env = HashMap::new();
    new_env.insert("LOG_LEVEL".into(), "debug".into());
    new_env.insert("EXTRA".into(), "1".into());

    let patched = repo
        .update(
            &created.id,
            ServerPatch {
                command: Some("npx".into()),
                env: Some(new_env.clone()),
                disabled: Some(true),
                ..Default::default()
            },
        )
        .await
        .expect("update");
    assert_eq!(patched.command.as_deref(), Some("npx"));
    assert_eq!(patched.env, new_env);
    assert!(patched.disabled);
    assert!(patched.updated_at > original);
}

#[tokio::test]
async fn delete_round_trip() {
    let (_tmp, _pool, repo) = make_repo().await;
    let created = repo.create(local_server("tmp")).await.unwrap();
    assert!(repo.delete(&created.id).await.expect("delete"));
    assert!(repo.get(&created.id).await.expect("get").is_none());
}
