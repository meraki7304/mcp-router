use serde_json::json;

use mcp_router_lib::persistence::{
    pool::init_pool_at_path,
    repository::workflow::{SqliteWorkflowRepository, WorkflowRepository},
    types::workflow::{NewWorkflow, WorkflowPatch},
};

async fn make_repo() -> (tempfile::TempDir, SqliteWorkflowRepository) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = init_pool_at_path(&tmp.path().join("wf.sqlite"))
        .await
        .expect("pool");
    (tmp, SqliteWorkflowRepository::new(pool))
}

fn sample_nodes() -> serde_json::Value {
    json!([{ "id": "start", "type": "start" }, { "id": "end", "type": "end" }])
}

fn sample_edges() -> serde_json::Value {
    json!([{ "from": "start", "to": "end" }])
}

#[tokio::test]
async fn create_then_get_round_trip_preserves_graph_json() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkflow {
            name: "primary".into(),
            description: Some("hello".into()),
            workflow_type: Some("default".into()),
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .expect("create");
    let fetched = repo.get(&created.id).await.expect("get").expect("some");
    assert_eq!(fetched.name, "primary");
    assert!(fetched.enabled);
    assert_eq!(fetched.nodes, sample_nodes());
    assert_eq!(fetched.edges, sample_edges());
}

#[tokio::test]
async fn list_returns_all_ordered_by_updated_at_desc() {
    let (_tmp, repo) = make_repo().await;
    let a = repo
        .create(NewWorkflow {
            name: "a".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    let b = repo
        .create(NewWorkflow {
            name: "b".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();

    let all = repo.list().await.expect("list");
    // most-recently-updated first
    assert_eq!(all[0].id, b.id);
    assert_eq!(all[1].id, a.id);
}

#[tokio::test]
async fn list_enabled_filters_disabled_rows() {
    let (_tmp, repo) = make_repo().await;
    let on = repo
        .create(NewWorkflow {
            name: "on".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();
    let off = repo
        .create(NewWorkflow {
            name: "off".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: false,
        })
        .await
        .unwrap();

    let enabled_only = repo.list_enabled().await.expect("list_enabled");
    let ids: Vec<_> = enabled_only.iter().map(|w| w.id.as_str()).collect();
    assert!(ids.contains(&on.id.as_str()));
    assert!(!ids.contains(&off.id.as_str()));
}

#[tokio::test]
async fn list_by_type_filters_correctly() {
    let (_tmp, repo) = make_repo().await;
    repo.create(NewWorkflow {
        name: "a".into(),
        description: None,
        workflow_type: Some("default".into()),
        nodes: sample_nodes(),
        edges: sample_edges(),
        enabled: true,
    })
    .await
    .unwrap();
    repo.create(NewWorkflow {
        name: "b".into(),
        description: None,
        workflow_type: Some("hook".into()),
        nodes: sample_nodes(),
        edges: sample_edges(),
        enabled: true,
    })
    .await
    .unwrap();

    let defaults = repo.list_by_type("default").await.expect("by type");
    assert_eq!(defaults.len(), 1);
    assert_eq!(defaults[0].name, "a");
}

#[tokio::test]
async fn update_replaces_nodes_and_bumps_updated_at() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkflow {
            name: "w".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();
    let original = created.updated_at;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let new_nodes = json!([{ "id": "x" }]);
    let patched = repo
        .update(
            &created.id,
            WorkflowPatch {
                nodes: Some(new_nodes.clone()),
                ..Default::default()
            },
        )
        .await
        .expect("update");
    assert_eq!(patched.nodes, new_nodes);
    assert!(patched.updated_at > original);
}

#[tokio::test]
async fn update_can_disable() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkflow {
            name: "w".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();
    let patched = repo
        .update(
            &created.id,
            WorkflowPatch {
                enabled: Some(false),
                ..Default::default()
            },
        )
        .await
        .expect("update");
    assert!(!patched.enabled);
}

#[tokio::test]
async fn delete_round_trip() {
    let (_tmp, repo) = make_repo().await;
    let created = repo
        .create(NewWorkflow {
            name: "tmp".into(),
            description: None,
            workflow_type: None,
            nodes: sample_nodes(),
            edges: sample_edges(),
            enabled: true,
        })
        .await
        .unwrap();
    assert!(repo.delete(&created.id).await.expect("delete"));
    assert!(repo.get(&created.id).await.expect("get").is_none());
}
