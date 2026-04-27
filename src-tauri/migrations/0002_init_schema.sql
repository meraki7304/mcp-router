-- Plan 2: full domain schema for Tauri rewrite.
-- Standardizes on:
--   * id TEXT PRIMARY KEY (uuid v7 strings populated by application)
--   * created_at / updated_at TEXT NOT NULL (ISO 8601 UTC)
--   * booleans as INTEGER with CHECK (col IN (0,1))
--   * JSON blob columns suffixed _json
--   * Foreign keys with ON DELETE CASCADE where it makes sense

-- ============================================================================
-- projects
-- ============================================================================
CREATE TABLE projects (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL COLLATE NOCASE,
    optimization TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_projects_name_unique ON projects(name COLLATE NOCASE);

-- ============================================================================
-- servers (MCP server configs)
-- ============================================================================
CREATE TABLE servers (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    server_type           TEXT NOT NULL DEFAULT 'local',  -- 'local' | 'remote'
    description           TEXT,
    version               TEXT,
    latest_version        TEXT,
    verification_status   TEXT,
    -- local server fields
    command               TEXT,
    args_json             TEXT NOT NULL DEFAULT '[]',
    env_json              TEXT NOT NULL DEFAULT '{}',
    context_path          TEXT,
    -- remote server fields
    remote_url            TEXT,
    bearer_token          TEXT,
    -- runtime config
    auto_start            INTEGER NOT NULL DEFAULT 0 CHECK (auto_start IN (0,1)),
    disabled              INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
    auto_approve          TEXT,
    input_params_json     TEXT NOT NULL DEFAULT '{}',
    required_params_json  TEXT NOT NULL DEFAULT '[]',
    tool_permissions_json TEXT NOT NULL DEFAULT '{}',
    project_id            TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX idx_servers_name       ON servers(name);
CREATE INDEX idx_servers_project_id ON servers(project_id);

-- ============================================================================
-- request_logs (renamed from Electron's "requestLogs")
-- ============================================================================
CREATE TABLE request_logs (
    id                  TEXT PRIMARY KEY,
    timestamp           TEXT NOT NULL,
    client_id           TEXT,
    client_name         TEXT,
    server_id           TEXT,
    server_name         TEXT,
    request_type        TEXT,
    request_params_json TEXT,
    response_data_json  TEXT,
    response_status     TEXT,
    duration_ms         INTEGER,
    error_message       TEXT
);
CREATE INDEX idx_request_logs_timestamp        ON request_logs(timestamp);
CREATE INDEX idx_request_logs_client_id        ON request_logs(client_id);
CREATE INDEX idx_request_logs_server_id        ON request_logs(server_id);
CREATE INDEX idx_request_logs_request_type     ON request_logs(request_type);
CREATE INDEX idx_request_logs_response_status  ON request_logs(response_status);

-- ============================================================================
-- workspaces
-- ============================================================================
CREATE TABLE workspaces (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    workspace_type     TEXT NOT NULL CHECK (workspace_type IN ('local','remote')),
    is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
    local_config_json  TEXT,
    remote_config_json TEXT,
    display_info_json  TEXT,
    created_at         TEXT NOT NULL,
    last_used_at       TEXT NOT NULL
);
CREATE INDEX idx_workspaces_active     ON workspaces(is_active);
CREATE INDEX idx_workspaces_type       ON workspaces(workspace_type);
CREATE INDEX idx_workspaces_last_used  ON workspaces(last_used_at);

-- ============================================================================
-- workflows
-- ============================================================================
CREATE TABLE workflows (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT,
    workflow_type TEXT,
    nodes_json    TEXT NOT NULL DEFAULT '[]',
    edges_json    TEXT NOT NULL DEFAULT '[]',
    enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX idx_workflows_enabled ON workflows(enabled);
CREATE INDEX idx_workflows_type    ON workflows(workflow_type);

-- ============================================================================
-- hook_modules
-- ============================================================================
CREATE TABLE hook_modules (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    script     TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_hook_modules_name ON hook_modules(name);

-- ============================================================================
-- agent_paths
-- ============================================================================
CREATE TABLE agent_paths (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    path       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
