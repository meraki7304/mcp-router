import { BaseRepository } from "../../infrastructure/database/base-repository";
import {
  SqliteManager,
  getSqliteManager,
} from "../../infrastructure/database/sqlite-manager";
import { MCPServer, MCPServerConfig } from "@mcp_router/shared";
import { v4 as uuidv4 } from "uuid";

/**
 * 服务器信息仓储类，使用 BetterSQLite3 管理服务器数据
 */
export class McpServerManagerRepository extends BaseRepository<MCPServer> {
  private static instance: McpServerManagerRepository | null = null;
  /**
   * 建表 SQL
   */
  private static readonly CREATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      command TEXT,
      args TEXT,
      env TEXT,
      auto_start INTEGER NOT NULL,
      disabled INTEGER NOT NULL,
      auto_approve TEXT,
      context_path TEXT,
      server_type TEXT NOT NULL DEFAULT 'local',
      remote_url TEXT,
      bearer_token TEXT,
      input_params TEXT,
      description TEXT,
      version TEXT,
      latest_version TEXT,
      verification_status TEXT,
      required_params TEXT,
      project_id TEXT,
      tool_permissions TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `;

  /**
   * 建索引 SQL
   */
  private static readonly INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_servers_name ON servers(name)",
    "CREATE INDEX IF NOT EXISTS idx_servers_project_id ON servers(project_id)",
  ];

  /**
   * 构造函数
   * @param db SqliteManager 实例
   */
  private constructor(db: SqliteManager) {
    super(db, "servers");
    console.log(
      "[ServerRepository] Initialized with database:",
      db ? "Present" : "Missing",
    );
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): McpServerManagerRepository {
    const db = getSqliteManager();
    if (
      !McpServerManagerRepository.instance ||
      McpServerManagerRepository.instance.db !== db
    ) {
      McpServerManagerRepository.instance = new McpServerManagerRepository(db);
    }
    return McpServerManagerRepository.instance;
  }

  /**
   * 使用指定数据库创建仓储实例
   */
  public static createForDatabase(
    db: SqliteManager,
  ): McpServerManagerRepository {
    return new McpServerManagerRepository(db);
  }

  /**
   * 重置实例
   */
  public static resetInstance(): void {
    McpServerManagerRepository.instance = null;
  }

  /**
   * 初始化表（实现 BaseRepository 抽象方法）
   */
  protected initializeTable(): void {
    try {
      // 创建表
      this.db.execute(McpServerManagerRepository.CREATE_TABLE_SQL);

      // 创建索引
      McpServerManagerRepository.INDEXES.forEach((indexSQL) => {
        this.db.execute(indexSQL);
      });
    } catch (error) {
      console.error("[ServerRepository] 初始化表时出错:", error);
      throw error;
    }
  }

  /**
   * 安全地解析 JSON 字符串
   * @param jsonString JSON 字符串
   * @param errorLabel 错误消息标签
   * @param defaultValue 解析失败时的默认值
   * @returns 解析后的对象
   */
  private safeParseJSON<T>(
    jsonString: string | null,
    errorLabel: string,
    defaultValue: T,
  ): T {
    if (!jsonString) return defaultValue;

    try {
      return JSON.parse(jsonString) as T;
    } catch (error) {
      console.error(`${errorLabel} 的 JSON 解析失败:`, error);
      return defaultValue;
    }
  }

  /**
   * 将数据库行转换为实体对象
   */
  protected mapRowToEntity(row: any): MCPServer {
    try {
      // 解析数据
      const env = this.safeParseJSON<Record<string, any>>(
        row.env,
        "环境变量",
        {},
      );
      const requiredParams: string[] = row.required_params
        ? JSON.parse(row.required_params)
        : [];
      const command = row.command;
      const bearerToken = row.bearer_token;
      const inputParams = this.safeParseJSON<any>(
        row.input_params,
        "输入参数",
        undefined,
      );
      const args = this.safeParseJSON<any[]>(row.args, "参数", []);
      const remoteUrl = row.remote_url;
      const toolPermissions = this.safeParseJSON<Record<string, boolean>>(
        row.tool_permissions,
        "工具权限",
        {},
      );

      // 构建实体对象
      return {
        id: row.id,
        name: row.name,
        command: command || "",
        args: args,
        env: env,
        autoStart: !!row.auto_start,
        disabled: !!row.disabled,
        serverType: row.server_type || "local",
        remoteUrl: remoteUrl || undefined,
        bearerToken: bearerToken || undefined,
        inputParams: inputParams,
        description: row.description || undefined,
        version: row.version || undefined,
        latestVersion: row.latest_version || undefined,
        verificationStatus: row.verification_status || undefined,
        required: requiredParams,
        projectId: row.project_id || null,
        toolPermissions,
        status: "stopped",
        logs: [],
      };
    } catch (error) {
      console.error("转换服务器数据时出错 1:", error);
      throw error;
    }
  }

  /**
   * 将实体数据序列化为 JSON 字符串
   * @param entity 服务器实体
   * @returns 序列化后的数据对象
   */
  private serializeEntityData(entity: MCPServer) {
    return {
      bearerToken: entity.bearerToken || null,
      env: JSON.stringify(entity.env || {}),
      inputParams: entity.inputParams
        ? JSON.stringify(entity.inputParams)
        : null,
      toolPermissions: entity.toolPermissions
        ? JSON.stringify(entity.toolPermissions)
        : null,
      command: entity.command || null,
      args: JSON.stringify(entity.args || []),
      remoteUrl: entity.remoteUrl || null,
    };
  }

  /**
   * 将实体转换为数据库行
   */
  protected mapEntityToRow(entity: MCPServer): Record<string, any> {
    try {
      const now = Date.now();

      // 序列化数据
      const {
        bearerToken,
        env,
        inputParams,
        command,
        args,
        remoteUrl,
        toolPermissions,
      } = this.serializeEntityData(entity);

      // 构建数据库行对象
      return {
        id: entity.id,
        name: entity.name,
        // For remote servers, command can be null
        command: command,
        args: args,
        env: env,
        auto_start: entity.autoStart ? 1 : 0,
        disabled: entity.disabled ? 1 : 0,
        server_type: entity.serverType,
        remote_url: remoteUrl,
        bearer_token: bearerToken,
        input_params: inputParams,
        project_id: entity.projectId ?? null,
        tool_permissions: toolPermissions,
        description: entity.description || null,
        version: entity.version || null,
        latest_version: entity.latestVersion || null,
        verification_status: entity.verificationStatus || null,
        required_params: JSON.stringify(entity.required || []),
        created_at: now,
        updated_at: now,
      };
    } catch (error) {
      console.error("转换服务器数据时出错 2:", error);
      throw error;
    }
  }

  /**
   * 添加服务器信息
   * @param serverConfig 服务器配置
   * @returns 已添加的服务器信息
   */
  public addServer(serverConfig: MCPServerConfig): MCPServer {
    try {
      const id = serverConfig.id || uuidv4();

      // 创建 MCPServer 对象
      const server: MCPServer = {
        ...serverConfig,
        id,
        status: "stopped",
        logs: [],
        toolPermissions: serverConfig.toolPermissions || {},
      };

      // 添加到仓储
      this.add(server);

      return server;
    } catch (error) {
      console.error("添加服务器时出错:", error);
      throw error;
    }
  }

  /**
   * 获取所有服务器信息
   * @returns 服务器信息数组
   */
  public getAllServers(): MCPServer[] {
    try {
      return this.getAll();
    } catch (error) {
      console.error("获取服务器信息时出错:", error);
      throw error;
    }
  }

  /**
   * 根据 ID 获取服务器信息
   * @param id 服务器 ID
   * @returns 服务器信息（不存在时返回 undefined）
   */
  public getServerById(id: string): MCPServer | undefined {
    try {
      return this.getById(id);
    } catch (error) {
      console.error(
        `获取 ID: ${id} 的服务器信息时出错:`,
        error,
      );
      throw error;
    }
  }

  /**
   * 将实体转换为数据库行（用于更新，可指定时间戳）
   */
  private mapEntityToRowForUpdate(
    entity: MCPServer,
    createdAt: number,
  ): Record<string, any> {
    try {
      // 序列化数据
      const {
        bearerToken,
        env,
        inputParams,
        command,
        args,
        remoteUrl,
        toolPermissions,
      } = this.serializeEntityData(entity);

      // 构建数据库行对象
      return {
        id: entity.id,
        name: entity.name,
        // For remote servers, command can be null
        command: command,
        args: args,
        env: env,
        auto_start: entity.autoStart ? 1 : 0,
        disabled: entity.disabled ? 1 : 0,
        server_type: entity.serverType,
        remote_url: remoteUrl,
        bearer_token: bearerToken,
        input_params: inputParams,
        project_id: entity.projectId ?? null,
        tool_permissions: toolPermissions,
        description: entity.description || null,
        version: entity.version || null,
        latest_version: entity.latestVersion || null,
        verification_status: entity.verificationStatus || null,
        required_params: JSON.stringify(entity.required || []),
        created_at: createdAt,
        updated_at: Date.now(),
      };
    } catch (error) {
      console.error("转换服务器数据时出错 3:", error);
      throw error;
    }
  }

  /**
   * 更新服务器信息
   * @param id 服务器 ID
   * @param config 要更新的服务器配置
   * @returns 更新后的服务器信息（不存在时返回 undefined）
   */
  public updateServer(
    id: string,
    config: Partial<MCPServerConfig>,
  ): MCPServer | undefined {
    try {
      // 获取现有服务器信息
      const existingServer = this.getById(id);
      if (!existingServer) {
        return undefined;
      }

      // 获取现有 createdAt
      const createdAtResult = this.db.get<{ created_at: number }>(
        `SELECT created_at FROM ${this.tableName} WHERE id = :id`,
        { id },
      );
      const createdAt = createdAtResult?.created_at || Date.now();

      // 设置要更新的字段
      const updatedServer: MCPServer = {
        ...existingServer,
        ...config,
        // Preserve fields that are not part of MCPServerConfig
        status: existingServer.status,
        logs: existingServer.logs,
        errorMessage: existingServer.errorMessage,
        tools: existingServer.tools,
        resources: existingServer.resources,
        prompts: existingServer.prompts,
      };

      // 生成行数据
      const row = this.mapEntityToRowForUpdate(updatedServer, createdAt);

      // 生成 SET 子句
      const setClauses = Object.keys(row)
        .filter((key) => key !== "id") // ID 不更新
        .map((key) => `${key} = :${key}`)
        .join(", ");

      // 构建 SQL 语句
      const sql = `UPDATE ${this.tableName} SET ${setClauses} WHERE id = :id`;

      // 执行查询
      this.db.execute(sql, row);
      return updatedServer;
    } catch (error) {
      console.error(
        `更新 ID: ${id} 的服务器信息时出错:`,
        error,
      );
      throw error;
    }
  }

  /**
   * 删除服务器信息
   * @param id 服务器 ID
   * @returns 删除成功返回 true，失败返回 false
   */
  public deleteServer(id: string): boolean {
    try {
      const server = this.getById(id);
      if (!server) {
        return false;
      }

      const result = this.delete(id);

      if (result) {
        console.log(`服务器 "${server.name}" 已删除 (ID: ${id})`);
      }

      return result;
    } catch (error) {
      console.error(
        `删除 ID: ${id} 的服务器信息时出错:`,
        error,
      );
      throw error;
    }
  }
}
