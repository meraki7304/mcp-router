import { BaseRepository } from "../../infrastructure/database/base-repository";
import {
  SqliteManager,
  getSqliteManager,
} from "../../infrastructure/database/sqlite-manager";
import {
  RequestLogEntry,
  RequestLogEntryInput,
  RequestLogQueryOptions,
  RequestLogQueryResult,
} from "@mcp_router/shared";
import { encodeCursor, decodeCursor } from "@/renderer/utils/cursor";

// 动态 retention 上限：main.ts 启动时与设置保存时同步。
// 0 或负值表示禁用裁剪。模块级变量避免与 settings.service 形成循环依赖。
let dynamicMaxRequestLogRows = 50000;

export function setMaxRequestLogRows(maxRows: number): void {
  dynamicMaxRequestLogRows = Number.isFinite(maxRows) ? Math.floor(maxRows) : 0;
}

function getCurrentMaxRequestLogRows(): number {
  return dynamicMaxRequestLogRows;
}

export class McpLoggerRepository extends BaseRepository<RequestLogEntry> {
  private static instance: McpLoggerRepository | null = null;
  private writeSinceTrim = 0;
  private static readonly TRIM_BATCH_INTERVAL = 100;
  private static readonly CREATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS requestLogs (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      client_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      server_id TEXT NOT NULL,
      server_name TEXT NOT NULL,
      request_type TEXT NOT NULL,
      request_params TEXT,
      response_data TEXT,
      response_status TEXT NOT NULL,
      duration INTEGER NOT NULL,
      error_message TEXT
    )
  `;

  private static readonly INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON requestLogs(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_request_logs_client_id ON requestLogs(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_request_logs_server_id ON requestLogs(server_id)",
    "CREATE INDEX IF NOT EXISTS idx_request_logs_request_type ON requestLogs(request_type)",
    "CREATE INDEX IF NOT EXISTS idx_request_logs_response_status ON requestLogs(response_status)",
  ];

  private constructor(db: SqliteManager) {
    super(db, "requestLogs");
    console.log(
      "[LogRepository] Constructor called with database:",
      db?.getDbPath?.() || "database instance",
    );
  }

  public static getInstance(): McpLoggerRepository {
    const db = getSqliteManager();
    if (
      !McpLoggerRepository.instance ||
      McpLoggerRepository.instance.db !== db
    ) {
      McpLoggerRepository.instance = new McpLoggerRepository(db);
    }
    return McpLoggerRepository.instance;
  }

  public static resetInstance(): void {
    McpLoggerRepository.instance = null;
  }

  protected initializeTable(): void {
    try {
      this.db.execute(McpLoggerRepository.CREATE_TABLE_SQL);

      McpLoggerRepository.INDEXES.forEach((indexSQL) => {
        this.db.execute(indexSQL);
      });

      console.log("[LogRepository] 表初始化完成");
    } catch (error) {
      console.error("[LogRepository] 表初始化时发生错误:", error);
      throw error;
    }
  }

  protected mapRowToEntity(row: any): RequestLogEntry {
    try {
      // 直接进行 JSON 解析（无加密）
      let requestParams: any = undefined;
      if (row.request_params) {
        requestParams = JSON.parse(row.request_params);
      }

      let responseData: any = undefined;
      if (row.response_data) {
        responseData = JSON.parse(row.response_data);
      }

      const errorMessage: string | undefined = row.error_message;

      return {
        id: row.id,
        timestamp: row.timestamp,
        clientId: row.client_id,
        clientName: row.client_name,
        serverId: row.server_id,
        serverName: row.server_name,
        requestType: row.request_type,
        requestParams: requestParams,
        responseStatus: row.response_status,
        responseData: responseData,
        duration: row.duration,
        errorMessage: errorMessage,
      };
    } catch (error) {
      console.error("日志数据转换时发生错误:", error);
      throw error;
    }
  }

  protected mapEntityToRow(entity: RequestLogEntry): Record<string, any> {
    try {
      // 仅进行 JSON 序列化（无加密）
      const requestParams = entity.requestParams
        ? JSON.stringify(entity.requestParams)
        : null;

      const responseData = entity.responseData
        ? JSON.stringify(entity.responseData)
        : null;

      const errorMessage = entity.errorMessage || null;

      return {
        id: entity.id,
        timestamp: entity.timestamp,
        client_id: entity.clientId,
        client_name: entity.clientName,
        server_id: entity.serverId,
        server_name: entity.serverName,
        request_type: entity.requestType,
        request_params: requestParams,
        response_status: entity.responseStatus,
        response_data: responseData,
        duration: entity.duration,
        error_message: errorMessage,
      };
    } catch (error) {
      console.error("日志数据转换时发生错误:", error);
      throw error;
    }
  }

  /**
   * @param entry 要添加的日志条目
   */
  public async addRequestLog(
    entry: RequestLogEntryInput,
  ): Promise<RequestLogEntry> {
    try {
      const timestamp = Date.now();

      const logEntry: RequestLogEntry = {
        ...entry,
        id: "", // 由 BaseRepository#add() 自动生成
        timestamp,
      };

      const addedEntry = this.add(logEntry);

      // 每写入 N 次触发一次 retention 裁剪，避免每写都扫表
      this.writeSinceTrim += 1;
      if (this.writeSinceTrim >= McpLoggerRepository.TRIM_BATCH_INTERVAL) {
        this.writeSinceTrim = 0;
        try {
          this.trimToMaxRows(getCurrentMaxRequestLogRows());
        } catch (trimError) {
          console.error("[LogRepository] retention 裁剪失败:", trimError);
        }
      }

      return addedEntry;
    } catch (error) {
      console.error("添加请求日志时发生错误:", error);
      throw error;
    }
  }

  /**
   * 把 requestLogs 表裁剪到最多 maxRows 条最新记录。
   * 总数 <= maxRows 时不执行删除。maxRows <= 0 视为无限制。
   */
  public trimToMaxRows(maxRows: number): number {
    if (!maxRows || maxRows <= 0) return 0;
    try {
      const result = this.db.execute(
        `DELETE FROM ${this.tableName} WHERE timestamp < (
           SELECT timestamp FROM ${this.tableName}
           ORDER BY timestamp DESC LIMIT 1 OFFSET :maxRows
         )`,
        { maxRows },
      );
      return result?.changes ?? 0;
    } catch (error) {
      console.error("[LogRepository] trimToMaxRows 失败:", error);
      return 0;
    }
  }

  public async getRequestLogs(
    options: RequestLogQueryOptions = {},
  ): Promise<RequestLogQueryResult> {
    try {
      const {
        clientId,
        serverId,
        requestType,
        startDate,
        endDate,
        responseStatus,
        cursor,
        limit = 50,
      } = options;

      let sql = `SELECT * FROM ${this.tableName} WHERE 1=1`;
      const params: any = {};

      const cursorData = cursor ? decodeCursor(cursor) : null;
      const cursorTimestamp = cursorData?.timestamp || null;
      const cursorId = cursorData?.id || null;

      if (cursorTimestamp && cursorId) {
        sql +=
          " AND (timestamp < :cursorTimestamp OR (timestamp = :cursorTimestamp AND id < :cursorId))";
        params.cursorTimestamp = cursorTimestamp;
        params.cursorId = cursorId;
      }

      if (clientId) {
        sql += " AND client_id = :clientId";
        params.clientId = clientId;
      }

      if (serverId) {
        sql += " AND server_id = :serverId";
        params.serverId = serverId;
      }

      if (requestType) {
        sql += " AND request_type = :requestType";
        params.requestType = requestType;
      }

      if (responseStatus) {
        sql += " AND response_status = :responseStatus";
        params.responseStatus = responseStatus;
      }

      if (startDate) {
        const startTime = startDate.getTime();
        sql += " AND timestamp >= :startTime";
        params.startTime = startTime;
      }

      if (endDate) {
        const endTime = new Date(
          endDate.getTime() + 24 * 60 * 60 * 1000 - 1,
        ).getTime(); // 结束日期的 23:59:59
        sql += " AND timestamp <= :endTime";
        params.endTime = endTime;
      }

      // 统计总数（排除游标条件）
      let countSql = sql.replace("SELECT *", "SELECT COUNT(*) as count");
      const countParams = { ...params };
      if (cursorTimestamp && cursorId) {
        countSql = countSql.replace(
          / AND \(timestamp < :cursorTimestamp OR \(timestamp = :cursorTimestamp AND id < :cursorId\)\)/,
          "",
        );
        delete countParams.cursorTimestamp;
        delete countParams.cursorId;
      }
      const countResult = this.db.get<{ count: number }>(countSql, countParams);
      const total = countResult?.count || 0;

      // 添加排序和 LIMIT（多取 1 条用于判断 hasMore）
      sql += " ORDER BY timestamp DESC, id DESC LIMIT :limit";
      params.limit = limit + 1;

      const rows = this.db.all<any>(sql, params);

      const hasMore = rows.length > limit;
      if (hasMore) {
        rows.pop(); // 删除多取的 1 条
      }

      const logs = rows.map((row) => this.mapRowToEntity(row));

      let nextCursor: string | undefined;
      if (hasMore && logs.length > 0) {
        const lastLog = logs[logs.length - 1];
        nextCursor = encodeCursor({
          timestamp: lastLog.timestamp,
          id: lastLog.id,
        });
      }

      return { items: logs, logs, total, nextCursor, hasMore };
    } catch (error) {
      console.error("获取请求日志时发生错误:", error);
      return { items: [], logs: [], total: 0, hasMore: false };
    }
  }
}
