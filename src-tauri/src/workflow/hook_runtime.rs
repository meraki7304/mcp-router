use rquickjs::{CatchResultExt, CaughtError, Context, Runtime, Value};
use serde_json::Value as JsonValue;
use tokio::task;

use crate::error::{AppError, AppResult};

/// Owns a `rquickjs::Runtime` configured with memory + stack caps.
/// Each `evaluate` call creates a fresh `Context::full`, parses input as JSON, binds it as
/// the global `input`, evaluates the user script, JSON-stringifies the result and returns it.
///
/// The QuickJS `Runtime` is NOT `Send`, so `evaluate` runs on a `spawn_blocking` worker.
pub struct HookRuntime {
    // We rebuild the Runtime per evaluate to keep memory and globals isolated.
    // For Plan 8 this is the simplest correct shape; if hook latency becomes a concern,
    // we can switch to a per-call Context within a long-lived Runtime in Plan 8b.
    memory_limit: usize,
    max_stack_size: usize,
}

impl HookRuntime {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            memory_limit: 16 * 1024 * 1024, // 16 MB
            max_stack_size: 512 * 1024,     // 512 KB
        })
    }

    pub async fn evaluate(
        &self,
        script: impl Into<String>,
        input: JsonValue,
    ) -> AppResult<JsonValue> {
        let script = script.into();
        let memory_limit = self.memory_limit;
        let max_stack_size = self.max_stack_size;

        task::spawn_blocking(move || -> AppResult<JsonValue> {
            let rt = Runtime::new()
                .map_err(|e| AppError::Internal(format!("rquickjs Runtime::new: {e}")))?;
            rt.set_memory_limit(memory_limit);
            rt.set_max_stack_size(max_stack_size);

            let ctx = Context::full(&rt)
                .map_err(|e| AppError::Internal(format!("rquickjs Context::full: {e}")))?;

            ctx.with(|ctx| -> AppResult<JsonValue> {
                let input_json_str = serde_json::to_string(&input).map_err(|e| {
                    AppError::Internal(format!("encode hook input to json: {e}"))
                })?;

                let input_value = ctx
                    .json_parse(input_json_str.as_bytes())
                    .map_err(|e| AppError::InvalidInput(format!("parse hook input: {e}")))?;

                ctx.globals()
                    .set("input", input_value)
                    .map_err(|e| AppError::Internal(format!("set global 'input': {e}")))?;

                let result: Value = ctx
                    .eval::<Value, _>(script.as_bytes())
                    .catch(&ctx)
                    .map_err(catch_to_app_error)?;

                let json_str = ctx
                    .json_stringify(result)
                    .map_err(|e| AppError::InvalidInput(format!("stringify hook result: {e}")))?
                    .ok_or_else(|| {
                        AppError::InvalidInput(
                            "hook script returned undefined; return a JSON-encodable value"
                                .into(),
                        )
                    })?
                    .to_string()
                    .map_err(|e| {
                        AppError::Internal(format!("read stringified hook result: {e}"))
                    })?;

                serde_json::from_str(&json_str).map_err(|e| {
                    AppError::Internal(format!("decode hook result json: {e}"))
                })
            })
        })
        .await
        .map_err(|e| AppError::Internal(format!("hook task join: {e}")))?
    }
}

fn catch_to_app_error(err: CaughtError) -> AppError {
    match err {
        CaughtError::Exception(exc) => {
            let msg = exc.message().unwrap_or_default();
            let stack = exc.stack().unwrap_or_default();
            if stack.is_empty() {
                AppError::InvalidInput(format!("hook threw: {msg}"))
            } else {
                AppError::InvalidInput(format!("hook threw: {msg}\n{stack}"))
            }
        }
        CaughtError::Value(v) => AppError::InvalidInput(format!("hook threw value: {v:?}")),
        CaughtError::Error(e) => AppError::Internal(format!("rquickjs error: {e}")),
    }
}
