import { SqliteManager } from "./sqlite-manager";
import { v4 as uuidv4 } from "uuid";

export abstract class BaseRepository<T extends { id: string }> {
  protected db: SqliteManager;
  protected tableName: string;

  public get database(): SqliteManager {
    return this.db;
  }

  constructor(db: SqliteManager, tableName: string) {
    this.db = db;
    this.tableName = tableName;

    this.initializeTable();
  }

  protected abstract initializeTable(): void;

  public getAll(options: any = {}): T[] {
    try {
      // Check if table exists before query
      const tableExists = this.db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        [this.tableName],
      );

      if (!tableExists) {
        console.warn(
          `Table ${this.tableName} does not exist, returning empty array`,
        );
        return [];
      }

      let sql = `SELECT * FROM ${this.tableName}`;
      const params: any = {};

      if (options.where) {
        const whereClauses = Object.entries(options.where)
          .map(([key]) => `${key} = :${key}`)
          .join(" AND ");

        if (whereClauses) {
          sql += ` WHERE ${whereClauses}`;

          Object.entries(options.where).forEach(([key, value]) => {
            params[key] = value;
          });
        }
      }

      if (options.orderBy) {
        sql += ` ORDER BY ${options.orderBy}`;

        if (options.order) {
          sql += ` ${options.order}`;
        }
      }

      if (options.limit) {
        sql += ` LIMIT :limit`;
        params.limit = options.limit;

        if (options.offset) {
          sql += ` OFFSET :offset`;
          params.offset = options.offset;
        }
      }

      const rows = this.db.all<any>(sql, params);

      return rows.map((row) => this.mapRowToEntity(row));
    } catch (error) {
      console.error(`获取 ${this.tableName} 时发生错误:`, error);
      throw error;
    }
  }

  public getById(id: string): T | undefined {
    try {
      const sql = `SELECT * FROM ${this.tableName} WHERE id = :id`;
      const row = this.db.get<any>(sql, { id });

      if (!row) {
        return undefined;
      }

      return this.mapRowToEntity(row);
    } catch (error) {
      console.error(
        `获取 ${this.tableName} ID:${id} 时发生错误:`,
        error,
      );
      throw error;
    }
  }

  public findOne(whereClause: string, params: any[] = []): T | null {
    try {
      const sql = `SELECT * FROM ${this.tableName} WHERE ${whereClause} LIMIT 1`;
      const row = this.db.get<any>(sql, params);

      if (!row) {
        return null;
      }

      return this.mapRowToEntity(row);
    } catch (error) {
      console.error(`搜索 ${this.tableName} 时发生错误:`, error);
      throw error;
    }
  }

  public findById(id: string): T | null {
    const result = this.getById(id);
    return result || null;
  }

  public add(data: Omit<T, "id">): T {
    try {
      const entityWithId = {
        ...data,
        id: (data as any).id || uuidv4(),
      } as T;

      const row = this.mapEntityToRow(entityWithId);

      const columns = Object.keys(row).join(", ");
      const placeholders = Object.keys(row)
        .map((key) => `:${key}`)
        .join(", ");

      const sql = `INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders})`;

      this.db.execute(sql, row);

      return entityWithId;
    } catch (error) {
      console.error(`向 ${this.tableName} 添加记录时发生错误:`, error);
      throw error;
    }
  }

  public update(id: string, data: Partial<T>): T | undefined {
    try {
      const existingEntity = this.getById(id);
      if (!existingEntity) {
        return undefined;
      }

      const updatedEntity = {
        ...existingEntity,
        ...data,
        id, // 防止 id 被覆盖
      };

      const row = this.mapEntityToRow(updatedEntity);

      const setClauses = Object.keys(row)
        .filter((key) => key !== "id") // 不更新 id
        .map((key) => `${key} = :${key}`)
        .join(", ");

      const sql = `UPDATE ${this.tableName} SET ${setClauses} WHERE id = :id`;

      this.db.execute(sql, row);

      return updatedEntity;
    } catch (error) {
      console.error(
        `更新 ${this.tableName} ID:${id} 时发生错误:`,
        error,
      );
      throw error;
    }
  }

  public delete(id: string): boolean {
    try {
      const sql = `DELETE FROM ${this.tableName} WHERE id = :id`;

      this.db.execute(sql, { id });

      return true;
    } catch (error) {
      console.error(
        `删除 ${this.tableName} ID:${id} 时发生错误:`,
        error,
      );
      return false;
    }
  }

  public count(whereClause?: { [key: string]: any }): number {
    try {
      let sql = `SELECT COUNT(*) as count FROM ${this.tableName}`;
      const params: any = {};

      if (whereClause) {
        const conditions = Object.entries(whereClause)
          .map(([key, _value]) => `${key} = :${key}`)
          .join(" AND ");

        if (conditions) {
          sql += ` WHERE ${conditions}`;

          Object.entries(whereClause).forEach(([key, value]) => {
            params[key] = value;
          });
        }
      }

      const result = this.db.get<{ count: number }>(sql, params);

      return result?.count || 0;
    } catch (error) {
      console.error(
        `获取 ${this.tableName} 计数时发生错误:`,
        error,
      );
      throw error;
    }
  }

  public transaction<R>(callback: () => R): R {
    return this.db.transaction(callback);
  }

  protected abstract mapRowToEntity(row: any): T;

  protected abstract mapEntityToRow(entity: T): Record<string, any>;
}
