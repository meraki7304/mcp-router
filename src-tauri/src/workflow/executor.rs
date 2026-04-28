use std::{collections::HashMap, sync::Arc};

use serde::Deserialize;
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    persistence::{
        repository::hook_module::HookModuleRepository,
        types::workflow::Workflow,
    },
    workflow::hook_runtime::HookRuntime,
};

/// Loose-typed view of a workflow node parsed from xyflow JSON. Unknown fields ignored.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParsedNode {
    id: String,
    #[serde(rename = "type", default)]
    node_type: String,
    #[serde(default)]
    data: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParsedEdge {
    #[serde(default)]
    #[allow(dead_code)]
    id: String,
    source: String,
    target: String,
}

/// Hook-node-specific data shape.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HookNodeData {
    hook_id: String,
}

pub struct WorkflowExecutor {
    hooks: Arc<dyn HookModuleRepository>,
    hook_runtime: Arc<HookRuntime>,
}

impl WorkflowExecutor {
    pub fn new(
        hooks: Arc<dyn HookModuleRepository>,
        hook_runtime: Arc<HookRuntime>,
    ) -> Self {
        Self { hooks, hook_runtime }
    }

    /// Execute the workflow as a linear chain Start → ... → End. Errors if multiple Start nodes,
    /// no Start node, more than one outgoing edge from a node, or any runner errors.
    pub async fn execute(&self, workflow: &Workflow, input: Value) -> AppResult<Value> {
        let nodes: Vec<ParsedNode> = serde_json::from_value(workflow.nodes.clone())
            .map_err(|e| AppError::InvalidInput(format!("parse workflow nodes: {e}")))?;
        let edges: Vec<ParsedEdge> = serde_json::from_value(workflow.edges.clone())
            .map_err(|e| AppError::InvalidInput(format!("parse workflow edges: {e}")))?;

        // Build adjacency: source-id -> Vec<target-id>
        let mut adj: HashMap<String, Vec<String>> = HashMap::new();
        for edge in &edges {
            adj.entry(edge.source.clone())
                .or_default()
                .push(edge.target.clone());
        }
        let nodes_by_id: HashMap<String, &ParsedNode> =
            nodes.iter().map(|n| (n.id.clone(), n)).collect();

        // Find the Start node — exactly one required.
        let start_nodes: Vec<&ParsedNode> =
            nodes.iter().filter(|n| n.node_type == "start").collect();
        if start_nodes.is_empty() {
            return Err(AppError::InvalidInput(
                "workflow has no start node".into(),
            ));
        }
        if start_nodes.len() > 1 {
            return Err(AppError::InvalidInput(format!(
                "workflow has {} start nodes (expected exactly 1)",
                start_nodes.len()
            )));
        }
        let mut current_id = start_nodes[0].id.clone();
        let mut state = input;
        let mut visited = std::collections::HashSet::new();

        loop {
            if !visited.insert(current_id.clone()) {
                return Err(AppError::InvalidInput(format!(
                    "workflow cycle detected at node {current_id}"
                )));
            }

            let node = nodes_by_id.get(&current_id).ok_or_else(|| {
                AppError::InvalidInput(format!("edge target {current_id} has no node"))
            })?;

            // Run the node.
            state = self.run_node(node, state).await?;

            if node.node_type == "end" {
                return Ok(state);
            }

            // Follow the single outgoing edge. Plan 8b doesn't branch.
            let next = adj.get(&current_id).cloned().unwrap_or_default();
            match next.as_slice() {
                [] => {
                    return Err(AppError::InvalidInput(format!(
                        "node {current_id} has no outgoing edge and isn't an end node"
                    )));
                }
                [single] => {
                    current_id = single.clone();
                }
                many => {
                    return Err(AppError::InvalidInput(format!(
                        "node {current_id} has {} outgoing edges (Plan 8b supports linear chains only)",
                        many.len()
                    )));
                }
            }
        }
    }

    async fn run_node(&self, node: &ParsedNode, state: Value) -> AppResult<Value> {
        match node.node_type.as_str() {
            "start" => Ok(state), // pass through
            "end" => Ok(state),   // pass through (caller checks node_type and stops)
            "hook" => {
                let data: HookNodeData = serde_json::from_value(node.data.clone())
                    .map_err(|e| AppError::InvalidInput(format!(
                        "node {} has invalid hook data: {e}",
                        node.id
                    )))?;
                let hook = self
                    .hooks
                    .get(&data.hook_id)
                    .await?
                    .ok_or_else(|| AppError::NotFound(format!(
                        "hook_module {} (referenced by node {})",
                        data.hook_id, node.id
                    )))?;
                self.hook_runtime.evaluate(hook.script, state).await
            }
            "mcp-call" => Err(AppError::Internal(format!(
                "node {} is mcp-call — not implemented in Plan 8b (Plan 8c)",
                node.id
            ))),
            other => Err(AppError::InvalidInput(format!(
                "node {} has unknown type {other:?}",
                node.id
            ))),
        }
    }
}
