use crate::error::AppResult;

pub fn ping_impl(name: &str) -> String {
    let display = if name.trim().is_empty() { "world" } else { name };
    format!("Hello, {display}! (from Rust)")
}

#[tauri::command]
pub async fn ping(name: String) -> AppResult<String> {
    Ok(ping_impl(&name))
}
