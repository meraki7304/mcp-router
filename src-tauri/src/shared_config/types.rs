use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// UI theme preference. Matches Electron `Theme` enum (`light | dark | system`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    System,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::System
    }
}

/// Application-level settings. All fields optional with sensible defaults applied at read time.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_manager_overlay_display_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_update_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_window_on_startup: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_start_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<Theme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lightweight_mode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_idle_stop_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_request_log_rows: Option<u64>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            user_id: Some(String::new()),
            package_manager_overlay_display_count: Some(0),
            auto_update_enabled: Some(true),
            show_window_on_startup: Some(true),
            auto_start_enabled: Some(false),
            theme: Some(Theme::System),
            lightweight_mode: Some(false),
            server_idle_stop_minutes: Some(0),
            max_request_log_rows: Some(50_000),
        }
    }
}

/// MCP client token used for HTTP `Authorization: Bearer ...` against the :3282 server.
/// `issued_at` is unix milliseconds (matches Electron) for wire compatibility with MCP clients.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub id: String,
    pub client_id: String,
    pub issued_at: i64,
    pub server_access: HashMap<String, bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAppsConfig {
    pub tokens: Vec<Token>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedConfigMeta {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub migrated_at: Option<DateTime<Utc>>,
}

impl Default for SharedConfigMeta {
    fn default() -> Self {
        Self {
            version: "1.0.0".to_string(),
            last_modified: Some(Utc::now()),
            migrated_at: None,
        }
    }
}

/// Top-level shape of `<app_data>/shared-config.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedConfig {
    pub settings: AppSettings,
    pub mcp_apps: McpAppsConfig,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none", default)]
    pub meta: Option<SharedConfigMeta>,
}

impl Default for SharedConfig {
    fn default() -> Self {
        Self {
            settings: AppSettings::default(),
            mcp_apps: McpAppsConfig::default(),
            meta: Some(SharedConfigMeta::default()),
        }
    }
}
