import * as path from "path";
import { app } from "electron";
import Database, {
  type Database as DatabaseType,
  RunResult,
} from "better-sqlite3";

export class SqliteManager {
  private db: DatabaseType;
  private dbPath: string;

  /**
   * @param dbNameOrPath 数据库名称或完整路径
   */
  constructor(dbNameOrPath: string) {
    // 传入绝对路径时直接使用，否则放到 userData 目录下
    if (path.isAbsolute(dbNameOrPath)) {
      this.dbPath = dbNameOrPath;
    } else {
      const dbDir = app.getPath("userData");
      this.dbPath = path.join(dbDir, `${dbNameOrPath}.db`);
    }

    try {
      const fs = require("fs");
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
    } catch (error) {
      console.error("创建数据库目录失败:", error);
      throw error;
    }

    try {
      this.db = new Database(this.dbPath);

      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
    } catch (error) {
      console.error(
        `初始化数据库 '${dbNameOrPath}' 失败:`,
        error,
      );
      throw error;
    }
  }

  public getConnection(): DatabaseType {
    return this.db;
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  public execute(sql: string, params: any = {}): RunResult {
    try {
      return this.db.prepare(sql).run(params);
    } catch (error) {
      console.error("执行 SQL 查询失败:", error);
      throw error;
    }
  }

  public get<T>(sql: string, params: any = {}): T | undefined {
    try {
      return this.db.prepare(sql).get(params) as T | undefined;
    } catch (error) {
      console.error("执行 SQL 查询失败:", error);
      throw error;
    }
  }

  public all<T>(sql: string, params: any = {}): T[] {
    try {
      return this.db.prepare(sql).all(params) as T[];
    } catch (error) {
      console.error("执行 SQL 查询失败:", error);
      throw error;
    }
  }

  public transaction<T>(callback: () => T): T {
    try {
      const transaction = this.db.transaction(callback);
      return transaction();
    } catch (error) {
      console.error("执行事务失败:", error);
      throw error;
    }
  }

  public close(): void {
    try {
      this.db.close();
    } catch (error) {
      console.error("关闭数据库连接失败:", error);
      throw error;
    }
  }

  public prepare(sql: string): any {
    try {
      return this.db.prepare(sql);
    } catch (error) {
      console.error("准备 SQL 语句失败:", error);
      throw error;
    }
  }

  public exec(sql: string): void {
    try {
      this.db.exec(sql);
    } catch (error) {
      console.error("执行 SQL 失败:", error);
      throw error;
    }
  }
}

class SqliteManagerSingleton {
  private static instance: SqliteManager | null = null;

  public static getInstance(dbName = "mcprouter"): SqliteManager {
    if (!SqliteManagerSingleton.instance) {
      SqliteManagerSingleton.instance = new SqliteManager(dbName);
    }
    return SqliteManagerSingleton.instance;
  }
}

let currentWorkspaceDb: SqliteManager | null = null;

/**
 * 设置工作区数据库（由 PlatformAPIManager 调用）
 */
export function setWorkspaceDatabase(db: SqliteManager | null): void {
  console.log(
    "[setWorkspaceDatabase] Setting workspace DB:",
    db ? "Set" : "Cleared",
  );
  currentWorkspaceDb = db;
}

/**
 * 获取当前工作区的 SqliteManager 实例，支持工作区切换。
 * @param dbName 数据库名称
 * @param forceMain 为 true 时始终返回主数据库，忽略当前工作区设置
 */
export function getSqliteManager(
  dbName = "mcprouter",
  forceMain = false,
): SqliteManager {
  if (forceMain) {
    return SqliteManagerSingleton.getInstance(dbName);
  }

  // 工作区数据库已设置时优先使用；注意：工作区模式下 dbName 参数会被忽略
  if (currentWorkspaceDb) {
    // console.log("[getSqliteManager] Returning workspace DB (ignoring dbName:", dbName, ")");
    return currentWorkspaceDb;
  }

  // 降级：使用旧的单例模式（仅限初始化阶段）
  console.log(
    "[getSqliteManager] WARNING: No workspace DB set, falling back to singleton DB:",
    dbName,
  );
  return SqliteManagerSingleton.getInstance(dbName);
}
