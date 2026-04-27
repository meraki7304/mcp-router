use async_trait::async_trait;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    persistence::types::request_log::{
        NewRequestLog, RequestLog, RequestLogCursor, RequestLogPage, RequestLogQuery,
    },
};

#[async_trait]
pub trait RequestLogRepository: Send + Sync {
    async fn insert(&self, input: NewRequestLog) -> AppResult<RequestLog>;
    async fn query(&self, query: RequestLogQuery) -> AppResult<RequestLogPage>;
    /// Keep only the `max_rows` most-recent rows. Returns the number of deleted rows.
    async fn trim_to_max(&self, max_rows: u64) -> AppResult<u64>;
}

pub struct SqliteRequestLogRepository {
    pool: SqlitePool,
}

impl SqliteRequestLogRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

const SELECT_COLS: &str = "id, timestamp, client_id, client_name, server_id, server_name, request_type, request_params_json, response_data_json, response_status, duration_ms, error_message";

#[async_trait]
impl RequestLogRepository for SqliteRequestLogRepository {
    async fn insert(&self, input: NewRequestLog) -> AppResult<RequestLog> {
        let id = Uuid::now_v7().to_string();
        let request_params_json = input
            .request_params
            .as_ref()
            .map(|v| serde_json::to_string(v))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode request_params: {e}")))?;
        let response_data_json = input
            .response_data
            .as_ref()
            .map(|v| serde_json::to_string(v))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode response_data: {e}")))?;

        sqlx::query("INSERT INTO request_logs(id, timestamp, client_id, client_name, server_id, server_name, request_type, request_params_json, response_data_json, response_status, duration_ms, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(input.timestamp)
            .bind(&input.client_id)
            .bind(&input.client_name)
            .bind(&input.server_id)
            .bind(&input.server_name)
            .bind(&input.request_type)
            .bind(&request_params_json)
            .bind(&response_data_json)
            .bind(&input.response_status)
            .bind(input.duration_ms)
            .bind(&input.error_message)
            .execute(&self.pool)
            .await?;

        Ok(RequestLog {
            id,
            timestamp: input.timestamp,
            client_id: input.client_id,
            client_name: input.client_name,
            server_id: input.server_id,
            server_name: input.server_name,
            request_type: input.request_type,
            request_params: input.request_params,
            response_data: input.response_data,
            response_status: input.response_status,
            duration_ms: input.duration_ms,
            error_message: input.error_message,
        })
    }

    async fn query(&self, q: RequestLogQuery) -> AppResult<RequestLogPage> {
        let limit = q.limit.clamp(1, 500) as i64;
        let fetch_limit = limit + 1; // +1 to detect has_more

        let mut sql = format!("SELECT {SELECT_COLS} FROM request_logs WHERE 1=1");
        if q.before.is_some() {
            sql.push_str(" AND (timestamp < ? OR (timestamp = ? AND id < ?))");
        }
        if q.server_id.is_some() {
            sql.push_str(" AND server_id = ?");
        }
        if q.client_id.is_some() {
            sql.push_str(" AND client_id = ?");
        }
        if q.request_type.is_some() {
            sql.push_str(" AND request_type = ?");
        }
        if q.response_status.is_some() {
            sql.push_str(" AND response_status = ?");
        }
        sql.push_str(" ORDER BY timestamp DESC, id DESC LIMIT ?");

        let mut query = sqlx::query(&sql);
        if let Some(c) = q.before.as_ref() {
            query = query.bind(c.timestamp).bind(c.timestamp).bind(&c.id);
        }
        if let Some(v) = q.server_id.as_ref() { query = query.bind(v); }
        if let Some(v) = q.client_id.as_ref() { query = query.bind(v); }
        if let Some(v) = q.request_type.as_ref() { query = query.bind(v); }
        if let Some(v) = q.response_status.as_ref() { query = query.bind(v); }
        query = query.bind(fetch_limit);

        let rows = query.fetch_all(&self.pool).await?;
        let mut items: Vec<RequestLog> = rows.into_iter().map(row_to_log).collect::<AppResult<_>>()?;

        let has_more = items.len() as i64 > limit;
        if has_more {
            items.truncate(limit as usize);
        }
        let next_cursor = if has_more {
            items.last().map(|last| RequestLogCursor {
                timestamp: last.timestamp,
                id: last.id.clone(),
            })
        } else {
            None
        };

        Ok(RequestLogPage {
            items,
            next_cursor,
            has_more,
        })
    }

    async fn trim_to_max(&self, max_rows: u64) -> AppResult<u64> {
        // Identify rows to keep (most-recent N), delete the rest.
        let res = sqlx::query(
            "DELETE FROM request_logs WHERE id NOT IN (
                SELECT id FROM request_logs ORDER BY timestamp DESC, id DESC LIMIT ?
            )",
        )
        .bind(max_rows as i64)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }
}

fn row_to_log(row: sqlx::sqlite::SqliteRow) -> AppResult<RequestLog> {
    let request_params_json: Option<String> = row.try_get("request_params_json")?;
    let response_data_json: Option<String> = row.try_get("response_data_json")?;
    let request_params: Option<Value> = request_params_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| AppError::Internal(format!("decode request_params: {e}")))?;
    let response_data: Option<Value> = response_data_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| AppError::Internal(format!("decode response_data: {e}")))?;

    Ok(RequestLog {
        id: row.try_get("id")?,
        timestamp: row.try_get("timestamp")?,
        client_id: row.try_get("client_id")?,
        client_name: row.try_get("client_name")?,
        server_id: row.try_get("server_id")?,
        server_name: row.try_get("server_name")?,
        request_type: row.try_get("request_type")?,
        request_params,
        response_data,
        response_status: row.try_get("response_status")?,
        duration_ms: row.try_get("duration_ms")?,
        error_message: row.try_get("error_message")?,
    })
}
