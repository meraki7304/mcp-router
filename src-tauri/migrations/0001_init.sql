-- Plan 1 placeholder: real schema arrives in Plan 2 (persistence).
-- This migration ensures the sqlx migrator runs cleanly with at least one file.

CREATE TABLE IF NOT EXISTS _meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR REPLACE INTO _meta(key, value) VALUES ('schema_introduced_at', strftime('%Y-%m-%d', 'now'));
