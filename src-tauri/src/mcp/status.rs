use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Runtime status of an MCP server. Persistence-side `Server` (Plan 3) holds config;
/// runtime status lives only in `ServerManager`'s in-memory map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(tag = "kind", content = "message")]
pub enum ServerStatus {
    Stopped,
    Starting,
    Running,
    Failed(String),
}
