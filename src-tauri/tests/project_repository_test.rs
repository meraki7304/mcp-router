use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::project::{ProjectRepository, SqliteProjectRepository},
    types::project::{NewProject, ProjectPatch},
};

async fn make_repo() -> (tempfile::TempDir, SqliteProjectRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("projects.sqlite"))
        .await
        .expect("pool");
    let repo = SqliteProjectRepository::new(pool);
    (tmp, repo)
}

#[tokio::test]
async fn create_then_get_returns_same_project() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewProject {
            name: "foo".into(),
            optimization: Some("speed".into()),
        })
        .await
        .expect("create");
    assert_eq!(created.name, "foo");
    assert_eq!(created.optimization.as_deref(), Some("speed"));

    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.id, created.id);
    assert_eq!(fetched.name, "foo");
}

#[tokio::test]
async fn list_returns_all_projects_ordered_by_name() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewProject { name: "zeta".into(), optimization: None }).await.unwrap();
    repo.create(NewProject { name: "alpha".into(), optimization: None }).await.unwrap();
    repo.create(NewProject { name: "mu".into(), optimization: None }).await.unwrap();

    let all = repo.list().await.expect("list");
    let names: Vec<_> = all.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, vec!["alpha", "mu", "zeta"]);
}

#[tokio::test]
async fn find_by_name_is_case_insensitive() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewProject { name: "MyProject".into(), optimization: None })
        .await
        .unwrap();

    let found = repo.find_by_name("myproject").await.expect("find").expect("some");
    assert_eq!(found.id, created.id);
}

#[tokio::test]
async fn update_changes_fields_and_bumps_updated_at() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewProject { name: "name1".into(), optimization: None })
        .await
        .unwrap();
    let original_updated = created.updated_at;

    // Sleep briefly so updated_at advances past created_at at sub-second resolution.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let patched = repo
        .update(
            &created.id,
            ProjectPatch {
                name: Some("name2".into()),
                optimization: Some("memory".into()),
            },
        )
        .await
        .expect("update");
    assert_eq!(patched.name, "name2");
    assert_eq!(patched.optimization.as_deref(), Some("memory"));
    assert!(patched.updated_at > original_updated);
}

#[tokio::test]
async fn delete_returns_true_then_get_returns_none() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewProject { name: "tmp".into(), optimization: None })
        .await
        .unwrap();

    let deleted = repo.delete(&created.id).await.expect("delete");
    assert!(deleted);

    let after = repo.get(&created.id).await.expect("get");
    assert!(after.is_none());

    // Deleting again returns false.
    let deleted_again = repo.delete(&created.id).await.expect("delete");
    assert!(!deleted_again);
}

#[tokio::test]
async fn create_with_duplicate_name_fails() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewProject { name: "uniq".into(), optimization: None })
        .await
        .unwrap();

    let dup = repo.create(NewProject { name: "uniq".into(), optimization: None }).await;
    assert!(dup.is_err(), "expected unique-name error");
}
