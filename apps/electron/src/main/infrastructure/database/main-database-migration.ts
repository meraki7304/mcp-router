import { SqliteManager } from "./sqlite-manager";
import { Migration } from "@mcp_router/shared";

export class MainDatabaseMigration {
  private migrations: Migration[] = [];

  public constructor(private db: SqliteManager) {
    this.registerMigrations();
  }

  /**
   * 注册所有需要执行的迁移。新增迁移时在此追加。
   */
  private registerMigrations(): void {
    // ServerRepository 相关迁移
    this.migrations.push({
      id: "20250601_add_server_type_column",
      description: "Add server_type column to servers table",
      execute: (db) => this.migrateAddServerTypeColumn(db),
    });

    this.migrations.push({
      id: "20250602_add_remote_url_column",
      description: "Add remote_url column to servers table",
      execute: (db) => this.migrateAddRemoteUrlColumn(db),
    });

    this.migrations.push({
      id: "20250603_add_bearer_token_column",
      description: "Add bearer_token column to servers table",
      execute: (db) => this.migrateAddBearerTokenColumn(db),
    });

    this.migrations.push({
      id: "20250604_add_input_params_column",
      description: "Add input_params column to servers table",
      execute: (db) => this.migrateAddInputParamsColumn(db),
    });

    this.migrations.push({
      id: "20250605_add_description_column",
      description: "Add description column to servers table",
      execute: (db) => this.migrateAddDescriptionColumn(db),
    });

    this.migrations.push({
      id: "20250606_add_version_column",
      description: "Add version column to servers table",
      execute: (db) => this.migrateAddVersionColumn(db),
    });

    this.migrations.push({
      id: "20250607_add_latest_version_column",
      description: "Add latest_version column to servers table",
      execute: (db) => this.migrateAddLatestVersionColumn(db),
    });

    this.migrations.push({
      id: "20250608_add_verification_status_column",
      description: "Add verification_status column to servers table",
      execute: (db) => this.migrateAddVerificationStatusColumn(db),
    });

    this.migrations.push({
      id: "20250609_add_required_params_column",
      description: "Add required_params column to servers table",
      execute: (db) => this.migrateAddRequiredParamsColumn(db),
    });

    this.migrations.push({
      id: "20251210_add_tool_permissions_column",
      description: "Add tool_permissions column to servers table",
      execute: (db) => this.migrateAddToolPermissionsColumn(db),
    });

    // Projects feature: servers.project_id 列与索引
    this.migrations.push({
      id: "20251101_projects_bootstrap",
      description: "Ensure servers.project_id column and index",
      execute: (db) => this.migrateProjectsBootstrap(db),
    });

    // 确保 tokens 表在主数据库中存在
    this.migrations.push({
      id: "20250627_ensure_tokens_table_in_main_db",
      description:
        "Ensure tokens table exists in main database for workspace sharing",
      execute: (db) => this.migrateEnsureTokensTableInMainDb(db),
    });

    // 添加 hooks 表
    this.migrations.push({
      id: "20250805_add_hooks_table",
      description: "Add hooks table for MCP request/response hooks",
      execute: (db) => this.migrateAddHooksTable(db),
    });

    // 添加 projects.optimization 列
    this.migrations.push({
      id: "20260120_add_project_optimization_column",
      description: "Add optimization column to projects table",
      execute: (db) => this.migrateAddProjectOptimizationColumn(db),
    });

    // 添加 agent_paths 表
    this.migrations.push({
      id: "20260124_add_agent_paths_table",
      description: "Add agent_paths table for custom symlink targets",
      execute: (db) => this.migrateAddAgentPathsTable(db),
    });
  }

  public runMigrations(): void {
    try {
      const db = this.db;

      this.initMigrationTable();

      const completedMigrations = this.getCompletedMigrations();

      for (const migration of this.migrations) {
        if (completedMigrations.has(migration.id)) {
          continue;
        }

        console.log(
          `Running migration ${migration.id}: ${migration.description}`,
        );

        try {
          migration.execute(db);

          this.markMigrationComplete(migration.id);
        } catch (error) {
          throw error;
        }
      }
    } catch (error) {
      throw error;
    }
  }

  // ==========================================================================
  // ServerRepository 相关迁移
  // ==========================================================================

  private migrateAddServerTypeColumn(db: SqliteManager): void {
    try {
      const tableExists = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'servers'",
        {},
      );

      if (!tableExists) {
        console.log("servers table does not exist, skipping this migration");
        return;
      }

      const tableInfo = db.all("PRAGMA table_info(servers)");

      const columnNames = tableInfo.map((col: any) => col.name);

      if (!columnNames.includes("server_type")) {
        console.log("Adding server_type column to servers");
        db.execute(
          "ALTER TABLE servers ADD COLUMN server_type TEXT NOT NULL DEFAULT 'local'",
        );
        console.log("server_type column added");
      } else {
        console.log("server_type column already exists, skipping");
      }
    } catch (error) {
      console.error("Error while adding server_type column:", error);
      throw error;
    }
  }

  private migrateAddRemoteUrlColumn(db: SqliteManager): void {
    try {
      const tableExists = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'servers'",
        {},
      );

      if (!tableExists) {
        console.log("servers table does not exist, skipping this migration");
        return;
      }

      const tableInfo = db.all("PRAGMA table_info(servers)");

      const columnNames = tableInfo.map((col: any) => col.name);

      if (!columnNames.includes("remote_url")) {
        console.log("Adding remote_url column to servers");
        db.execute("ALTER TABLE servers ADD COLUMN remote_url TEXT");
        console.log("remote_url column added");
      } else {
        console.log("remote_url column already exists, skipping");
      }
    } catch (error) {
      console.error("Error while adding remote_url column:", error);
      throw error;
    }
  }

  private migrateAddBearerTokenColumn(db: SqliteManager): void {
    try {
      const tableExists = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'servers'",
        {},
      );

      if (!tableExists) {
        console.log("servers table does not exist, skipping this migration");
        return;
      }

      const tableInfo = db.all("PRAGMA table_info(servers)");

      const columnNames = tableInfo.map((col: any) => col.name);

      if (!columnNames.includes("bearer_token")) {
        console.log("Adding bearer_token column to servers");
        db.execute("ALTER TABLE servers ADD COLUMN bearer_token TEXT");
        console.log("bearer_token column added");
      } else {
        console.log("bearer_token column already exists, skipping");
      }
    } catch (error) {
      console.error("Error while adding bearer_token column:", error);
      throw error;
    }
  }

  private migrateAddInputParamsColumn(db: SqliteManager): void {
    try {
      const tableExists = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'servers'",
        {},
      );

      if (!tableExists) {
        console.log("servers table does not exist, skipping this migration");
        return;
      }

      const tableInfo = db.all("PRAGMA table_info(servers)");

      const columnNames = tableInfo.map((col: any) => col.name);

      if (!columnNames.includes("input_params")) {
        console.log("Adding input_params column to servers");
        db.execute("ALTER TABLE servers ADD COLUMN input_params TEXT");
        console.log("input_params column added");
      } else {
        console.log("input_params column already exists, skipping");
      }
    } catch (error) {
      console.error("Error while adding input_params column:", error);
      throw error;
    }
  }

  private migrateAddDescriptionColumn(db: SqliteManager): void {
    try {
      const tableExists = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'servers'",
        {},
      );

      if (!tableExists) {
        console.log("servers table does not exist, skipping this migration");
        return;
      }

      const tableInfo = db.all("PRAGMA table_info(servers)");

      const columnNames = tableInfo.map((col: any) => col.name);

      if (!columnNames.includes("description")) {
        console.log("Adding description column to servers");
        db.execute("ALTER TABLE servers ADD COLUMN description TEXT");
        console.log("description column added");
      } else {
        console.log("description column already exists, skipping");
      }
    } catch (error) {
      console.error("Error while adding description column:", error);
      throw error;
    }
  }

  private migrateAddVersionColumn(db: SqliteManager): void {
    try {
      const tableExists = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'servers'",
        {},
      );

      if (!tableExists) {
        console.log("servers table does not exist, skipping this migration");
        return;
      }

      const tableInfo = db.all("PRAGMA table_info(servers)");

      const columnNames = tableInfo.map((col: any) => col.name);

      if (!columnNames.includes("version")) {
        console.log("Adding version column to servers");
        db.execute("ALTER TABLE servers ADD COLUMN version TEXT");
        console.log("version column added");
      } else {
        console.log("version column already exists, skipping");
      }
    } catch (error) {
      console.error("Error while adding version column:", error);
      throw error;
    }
  }

  private migrateAddLatestVersionColumn(db: SqliteManager): void {
    try {
      const tableExists = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'servers'",
        {},
      );

      if (!tableExists) {
        console.log("servers table does not exist, skipping this migration");
        return;
      }

      const tableInfo = db.all("PRAGMA table_info(servers)");

      const columnNames = tableInfo.map((col: any) => col.name);

      if (!columnNames.includes("latest_version")) {
        console.log("Adding latest_version column to servers");
        db.execute("ALTER TABLE servers ADD COLUMN latest_version TEXT");
        console.log("latest_version column added");
      } else {
        console.log("latest_version column already exists, skipping");
      }
    } catch (error) {
      console.error("Error while adding latest_version column:", error);
      throw error;
    }
  }

  private migrateAddVerificationStatusColumn(db: SqliteManager): void {
    try {
      const tableExists = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'servers'",
        {},
      );

      if (!tableExists) {
        console.log("servers table does not exist, skipping this migration");
        return;
      }

      const tableInfo = db.all("PRAGMA table_info(servers)");

      const columnNames = tableInfo.map((col: any) => col.name);

      if (!columnNames.includes("verification_status")) {
        console.log("Adding verification_status column to servers");
        db.execute("ALTER TABLE servers ADD COLUMN verification_status TEXT");
        console.log("verification_status column added");
      } else {
        console.log("verification_status column already exists, skipping");
      }
    } catch (error) {
      console.error("Error while adding verification_status column:", error);
      throw error;
    }
  }

  private migrateAddRequiredParamsColumn(db: SqliteManager): void {
    try {
      const tableExists = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'servers'",
        {},
      );

      if (!tableExists) {
        console.log("servers table does not exist, skipping this migration");
        return;
      }

      const tableInfo = db.all("PRAGMA table_info(servers)");

      const columnNames = tableInfo.map((col: any) => col.name);

      if (!columnNames.includes("required_params")) {
        console.log("Adding required_params column to servers");
        db.execute("ALTER TABLE servers ADD COLUMN required_params TEXT");
        console.log("required_params column added");
      } else {
        console.log("required_params column already exists, skipping");
      }
    } catch (error) {
      console.error("Error while adding required_params column:", error);
      throw error;
    }
  }

  private migrateAddToolPermissionsColumn(db: SqliteManager): void {
    try {
      const tableExists = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'servers'",
        {},
      );

      if (!tableExists) {
        console.log("servers table does not exist, skipping this migration");
        return;
      }

      const tableInfo = db.all("PRAGMA table_info(servers)");
      const columnNames = tableInfo.map((col: any) => col.name);

      if (!columnNames.includes("tool_permissions")) {
        console.log("Adding tool_permissions column to servers");
        db.execute("ALTER TABLE servers ADD COLUMN tool_permissions TEXT");
        console.log("tool_permissions column added");
      } else {
        console.log("tool_permissions column already exists, skipping");
      }
    } catch (error) {
      console.error("Error while adding tool_permissions column:", error);
      throw error;
    }
  }

  private migrateEnsureTokensTableInMainDb(db: SqliteManager): void {
    try {
      // tokens 表的创建由 TokenRepository 负责，此处无需操作
      console.log("Creation of tokens table is delegated to TokenRepository");
    } catch (error) {
      console.error(
        "Error while ensuring tokens table in main database:",
        error,
      );
      throw error;
    }
  }

  // ==========================================================================
  // 迁移管理工具方法
  // ==========================================================================

  private initMigrationTable(): void {
    const db = this.db;

    db.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        executed_at INTEGER NOT NULL
      )
    `);
  }

  private getCompletedMigrations(): Set<string> {
    const db = this.db;

    const rows = db.all<{ id: string }>("SELECT id FROM migrations");

    return new Set(rows.map((row: any) => row.id));
  }

  private markMigrationComplete(migrationId: string): void {
    const db = this.db;

    db.execute(
      "INSERT INTO migrations (id, executed_at) VALUES (:id, :executedAt)",
      {
        id: migrationId,
        executedAt: Math.floor(Date.now() / 1000),
      },
    );
  }

  private migrateAddHooksTable(db: SqliteManager): void {
    try {
      // hooks 表的创建由 HookRepository 在首次调用时负责，此处无需操作
      console.log("Creation of hooks table is delegated to HookRepository");
    } catch (error) {
      console.error("Error occurred during hooks table migration:", error);
      throw error;
    }
  }

  /**
   * Projects 相关迁移：
   * - 添加 servers.project_id 列（如不存在）
   * - 创建 servers(project_id) 索引（如不存在）
   *
   * 注意：projects 表的创建由 ProjectRepository.initializeTable() 负责
   */
  private migrateProjectsBootstrap(db: SqliteManager): void {
    try {
      // Ensure servers.project_id exists
      const serversTable = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'servers'",
        {},
      );
      if (serversTable) {
        const tableInfo = db.all("PRAGMA table_info(servers)");
        const columnNames = tableInfo.map((col: any) => col.name);
        if (!columnNames.includes("project_id")) {
          db.execute("ALTER TABLE servers ADD COLUMN project_id TEXT");
        }

        // Ensure index on servers(project_id)
        db.execute(
          "CREATE INDEX IF NOT EXISTS idx_servers_project_id ON servers(project_id)",
        );
      }
    } catch (error) {
      console.error("Error while ensuring servers.project_id:", error);
      throw error;
    }
  }

  private migrateAddProjectOptimizationColumn(db: SqliteManager): void {
    try {
      const tableExists = db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'projects'",
        {},
      );

      if (!tableExists) {
        console.log("projects table does not exist, skipping this migration");
        return;
      }

      const tableInfo = db.all("PRAGMA table_info(projects)");
      const columnNames = tableInfo.map((col: any) => col.name);

      if (!columnNames.includes("optimization")) {
        console.log("Adding optimization column to projects");
        db.execute("ALTER TABLE projects ADD COLUMN optimization TEXT");
        console.log("optimization column added");
      } else {
        console.log("optimization column already exists, skipping");
      }
    } catch (error) {
      console.error("Error while adding optimization column:", error);
      throw error;
    }
  }

  /**
   * 创建 agent_paths 表，并插入 5 个默认 agent 的初始数据
   */
  private migrateAddAgentPathsTable(db: SqliteManager): void {
    try {
      db.execute(`
        CREATE TABLE IF NOT EXISTS agent_paths (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          path TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      console.log("agent_paths table created");

      const now = Date.now();
      const defaultAgents = [
        { name: "claude-code", path: "~/.claude/skills" },
        { name: "codex", path: "~/.codex/skills" },
        { name: "copilot", path: "~/.copilot/skills" },
        { name: "cline", path: "~/.cline/skills" },
        { name: "opencode", path: "~/.config/opencode/skill" },
      ];

      for (const agent of defaultAgents) {
        const id = crypto.randomUUID();
        db.execute(
          `INSERT OR IGNORE INTO agent_paths (id, name, path, created_at, updated_at)
           VALUES (:id, :name, :path, :createdAt, :updatedAt)`,
          {
            id,
            name: agent.name,
            path: agent.path,
            createdAt: now,
            updatedAt: now,
          },
        );
      }
      console.log("Default agent paths inserted");
    } catch (error) {
      console.error("Error while creating agent_paths table:", error);
      throw error;
    }
  }
}
