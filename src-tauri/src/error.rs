use serde::Serialize;
use thiserror::Error;
use ts_rs::TS;

#[derive(Debug, Error, Serialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("upstream: {0}")]
    Upstream(String),

    #[error("internal: {0}")]
    Internal(String),
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => AppError::NotFound("row not found".into()),
            other => AppError::Internal(other.to_string()),
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;
