use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use chrono::Utc;
use tokio::sync::RwLock;
use tracing::warn;

use crate::{
    error::{AppError, AppResult},
    shared_config::types::{AppSettings, SharedConfig, SharedConfigMeta, Token},
};

pub struct SharedConfigStore {
    file_path: PathBuf,
    state: RwLock<SharedConfig>,
}

impl SharedConfigStore {
    /// Open the store at `file_path`. If the file doesn't exist, defaults are used; the file
    /// is NOT created until the first mutation. If the file exists but can't be parsed,
    /// returns an `AppError::Internal` — caller may choose to delete-and-retry.
    pub async fn open(file_path: PathBuf) -> AppResult<Self> {
        let config = if file_path.exists() {
            match tokio::fs::read_to_string(&file_path).await {
                Ok(contents) => serde_json::from_str::<SharedConfig>(&contents)
                    .map_err(|e| AppError::Internal(format!("parse shared-config.json: {e}")))?,
                Err(e) => return Err(AppError::Internal(format!("read shared-config.json: {e}"))),
            }
        } else {
            SharedConfig::default()
        };
        Ok(Self {
            file_path,
            state: RwLock::new(config),
        })
    }

    pub fn file_path(&self) -> &Path {
        &self.file_path
    }

    // ----- Settings API -----

    pub async fn get_settings(&self) -> AppSettings {
        self.state.read().await.settings.clone()
    }

    pub async fn update_settings(&self, settings: AppSettings) -> AppResult<()> {
        let mut state = self.state.write().await;
        state.settings = settings;
        self.persist_locked(&mut state).await
    }

    // ----- Token API -----

    pub async fn list_tokens(&self) -> Vec<Token> {
        self.state.read().await.mcp_apps.tokens.clone()
    }

    pub async fn get_token(&self, id: &str) -> Option<Token> {
        self.state
            .read()
            .await
            .mcp_apps
            .tokens
            .iter()
            .find(|t| t.id == id)
            .cloned()
    }

    pub async fn save_token(&self, token: Token) -> AppResult<()> {
        let mut state = self.state.write().await;
        let tokens = &mut state.mcp_apps.tokens;
        if let Some(existing) = tokens.iter_mut().find(|t| t.id == token.id) {
            *existing = token;
        } else {
            tokens.push(token);
        }
        self.persist_locked(&mut state).await
    }

    pub async fn delete_token(&self, id: &str) -> AppResult<bool> {
        let mut state = self.state.write().await;
        let before = state.mcp_apps.tokens.len();
        state.mcp_apps.tokens.retain(|t| t.id != id);
        let removed = state.mcp_apps.tokens.len() < before;
        if removed {
            self.persist_locked(&mut state).await?;
        }
        Ok(removed)
    }

    pub async fn delete_client_tokens(&self, client_id: &str) -> AppResult<u32> {
        let mut state = self.state.write().await;
        let before = state.mcp_apps.tokens.len();
        state.mcp_apps.tokens.retain(|t| t.client_id != client_id);
        let removed = (before - state.mcp_apps.tokens.len()) as u32;
        if removed > 0 {
            self.persist_locked(&mut state).await?;
        }
        Ok(removed)
    }

    pub async fn update_token_server_access(
        &self,
        id: &str,
        server_access: HashMap<String, bool>,
    ) -> AppResult<bool> {
        let mut state = self.state.write().await;
        let updated = if let Some(token) = state.mcp_apps.tokens.iter_mut().find(|t| t.id == id) {
            token.server_access = server_access;
            true
        } else {
            false
        };
        if updated {
            self.persist_locked(&mut state).await?;
        }
        Ok(updated)
    }

    // ----- Internal: atomic write -----

    async fn persist_locked(
        &self,
        state: &mut tokio::sync::RwLockWriteGuard<'_, SharedConfig>,
    ) -> AppResult<()> {
        // Stamp _meta.lastModified
        let meta = state.meta.get_or_insert_with(SharedConfigMeta::default);
        meta.last_modified = Some(Utc::now());

        let serialized = serde_json::to_string_pretty(&**state)
            .map_err(|e| AppError::Internal(format!("encode shared-config: {e}")))?;

        if let Some(parent) = self.file_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Internal(format!("create config dir: {e}")))?;
        }

        // Atomic-ish: write to .tmp, then rename. On Windows `rename` over an existing file
        // can fail with EACCES on rare antivirus interactions; fall back to a direct write.
        let tmp_path = self.file_path.with_extension("json.tmp");
        if let Err(e) = tokio::fs::write(&tmp_path, serialized.as_bytes()).await {
            return Err(AppError::Internal(format!("write tmp config: {e}")));
        }

        if let Err(rename_err) = tokio::fs::rename(&tmp_path, &self.file_path).await {
            warn!(?rename_err, "rename failed, falling back to direct write");
            tokio::fs::write(&self.file_path, serialized.as_bytes())
                .await
                .map_err(|e| AppError::Internal(format!("write config (fallback): {e}")))?;
            // Best-effort cleanup of stale tmp.
            let _ = tokio::fs::remove_file(&tmp_path).await;
        }

        Ok(())
    }
}
