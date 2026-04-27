use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceType {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct LocalWorkspaceConfig {
    pub database_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct RemoteWorkspaceConfig {
    pub api_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct WorkspaceDisplayInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub workspace_type: WorkspaceType,
    pub is_active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_config: Option<LocalWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_config: Option<RemoteWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_info: Option<WorkspaceDisplayInfo>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct NewWorkspace {
    pub name: String,
    pub workspace_type: WorkspaceType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_config: Option<LocalWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_config: Option<RemoteWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_info: Option<WorkspaceDisplayInfo>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct WorkspacePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_config: Option<LocalWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_config: Option<RemoteWorkspaceConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_info: Option<WorkspaceDisplayInfo>,
}
