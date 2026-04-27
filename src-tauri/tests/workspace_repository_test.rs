use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::workspace::{SqliteWorkspaceRepository, WorkspaceRepository},
    types::workspace::{
        LocalWorkspaceConfig, NewWorkspace, RemoteWorkspaceConfig, WorkspaceDisplayInfo,
        WorkspacePatch, WorkspaceType,
    },
};

async fn make_repo() -> (tempfile::TempDir, SqliteWorkspaceRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("ws.sqlite"))
        .await
        .expect("pool");
    (tmp, SqliteWorkspaceRepository::new(pool))
}

#[tokio::test]
async fn create_local_workspace_round_trip() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkspace {
            name: "my local".into(),
            workspace_type: WorkspaceType::Local,
            local_config: Some(LocalWorkspaceConfig {
                database_path: "/tmp/foo.sqlite".into(),
            }),
            remote_config: None,
            display_info: None,
        })
        .await
        .expect("create");
    assert_eq!(created.workspace_type, WorkspaceType::Local);
    assert_eq!(
        created.local_config.as_ref().map(|c| c.database_path.as_str()),
        Some("/tmp/foo.sqlite")
    );
    assert!(!created.is_active);

    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.id, created.id);
    assert_eq!(fetched.local_config.unwrap().database_path, "/tmp/foo.sqlite");
}

#[tokio::test]
async fn create_remote_workspace_with_display_info() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkspace {
            name: "team-cloud".into(),
            workspace_type: WorkspaceType::Remote,
            local_config: None,
            remote_config: Some(RemoteWorkspaceConfig {
                api_url: "https://example.com/mcp".into(),
                auth_token: Some("xoxp-...".into()),
            }),
            display_info: Some(WorkspaceDisplayInfo {
                avatar_url: Some("https://cdn.example.com/team.png".into()),
                team_name: Some("Team Awesome".into()),
            }),
        })
        .await
        .expect("create");
    assert_eq!(created.workspace_type, WorkspaceType::Remote);
    assert_eq!(
        created.remote_config.as_ref().unwrap().api_url,
        "https://example.com/mcp"
    );
    assert_eq!(
        created.display_info.as_ref().unwrap().team_name.as_deref(),
        Some("Team Awesome")
    );
}

#[tokio::test]
async fn list_returns_all_workspaces_ordered_by_last_used_desc() {
    let (_tmp, repo) = make_repo().await;
    let a = repo
        .create(NewWorkspace {
            name: "a".into(),
            workspace_type: WorkspaceType::Local,
            local_config: None,
            remote_config: None,
            display_info: None,
        })
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    let b = repo
        .create(NewWorkspace {
            name: "b".into(),
            workspace_type: WorkspaceType::Local,
            local_config: None,
            remote_config: None,
            display_info: None,
        })
        .await
        .unwrap();

    let all = repo.list().await.expect("list");
    // most-recently-created first
    assert_eq!(all[0].id, b.id);
    assert_eq!(all[1].id, a.id);
}

#[tokio::test]
async fn set_active_clears_previous_and_marks_target() {
    let (_tmp, repo) = make_repo().await;
    let a = repo
        .create(NewWorkspace {
            name: "a".into(),
            workspace_type: WorkspaceType::Local,
            local_config: None,
            remote_config: None,
            display_info: None,
        })
        .await
        .unwrap();
    let b = repo
        .create(NewWorkspace {
            name: "b".into(),
            workspace_type: WorkspaceType::Local,
            local_config: None,
            remote_config: None,
            display_info: None,
        })
        .await
        .unwrap();

    repo.set_active(&a.id).await.expect("set a active");
    let active1 = repo.get_active().await.expect("active").expect("some");
    assert_eq!(active1.id, a.id);

    // Switching to b clears a.
    repo.set_active(&b.id).await.expect("set b active");
    let active2 = repo.get_active().await.expect("active").expect("some");
    assert_eq!(active2.id, b.id);
    let still_a = repo.get(&a.id).await.expect("get a").expect("some");
    assert!(!still_a.is_active);
}

#[tokio::test]
async fn get_active_returns_none_when_no_active() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewWorkspace {
        name: "w".into(),
        workspace_type: WorkspaceType::Local,
        local_config: None,
        remote_config: None,
        display_info: None,
    })
    .await
    .unwrap();

    let active = repo.get_active().await.expect("active");
    assert!(active.is_none());
}

#[tokio::test]
async fn update_changes_name_and_display_info() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkspace {
            name: "old".into(),
            workspace_type: WorkspaceType::Remote,
            local_config: None,
            remote_config: Some(RemoteWorkspaceConfig {
                api_url: "https://x.invalid".into(),
                auth_token: None,
            }),
            display_info: None,
        })
        .await
        .unwrap();

    let patched = repo
        .update(
            &created.id,
            WorkspacePatch {
                name: Some("new".into()),
                local_config: None,
                remote_config: None,
                display_info: Some(WorkspaceDisplayInfo {
                    avatar_url: None,
                    team_name: Some("Team X".into()),
                }),
            },
        )
        .await
        .expect("update");
    assert_eq!(patched.name, "new");
    assert_eq!(
        patched.display_info.as_ref().unwrap().team_name.as_deref(),
        Some("Team X")
    );
    // remote_config unchanged
    assert_eq!(patched.remote_config.as_ref().unwrap().api_url, "https://x.invalid");
}

#[tokio::test]
async fn delete_round_trip() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkspace {
            name: "tmp".into(),
            workspace_type: WorkspaceType::Local,
            local_config: None,
            remote_config: None,
            display_info: None,
        })
        .await
        .unwrap();
    assert!(repo.delete(&created.id).await.expect("delete"));
    assert!(repo.get(&created.id).await.expect("get").is_none());
}
