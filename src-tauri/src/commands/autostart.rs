use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::error::{AppError, AppResult};

#[tauri::command]
pub async fn autostart_is_enabled(app: AppHandle) -> AppResult<bool> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| AppError::Internal(format!("autostart is_enabled: {e}")))
}

#[tauri::command]
pub async fn autostart_enable(app: AppHandle) -> AppResult<()> {
    app.autolaunch()
        .enable()
        .map_err(|e| AppError::Internal(format!("autostart enable: {e}")))
}

#[tauri::command]
pub async fn autostart_disable(app: AppHandle) -> AppResult<()> {
    app.autolaunch()
        .disable()
        .map_err(|e| AppError::Internal(format!("autostart disable: {e}")))
}
