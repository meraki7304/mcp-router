import { getSqliteManager } from "../../infrastructure/database/sqlite-manager";
import { HookModule } from "@mcp_router/shared";
import { v4 as uuidv4 } from "uuid";

/**
 * Hook Module 仓库类，管理 HookModule 的持久化
 */
export class HookRepository {
  private static instance: HookRepository | null = null;

  private constructor() {
    this.initializeTable();
  }

  private initializeTable(): void {
    const db = getSqliteManager();
    try {
      db.execute(`
        CREATE TABLE IF NOT EXISTS hook_modules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          script TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      db.execute(
        "CREATE INDEX IF NOT EXISTS idx_hook_modules_name ON hook_modules(name)",
      );

      console.log("[HookRepository] 表初始化完成");
    } catch (error) {
      console.error("[HookRepository] 表初始化时出错:", error);
      throw error;
    }
  }

  public static getInstance(): HookRepository {
    if (!HookRepository.instance) {
      HookRepository.instance = new HookRepository();
    }
    return HookRepository.instance;
  }

  public static resetInstance(): void {
    HookRepository.instance = null;
  }

  public getAllHookModules(): HookModule[] {
    const db = getSqliteManager();
    const rows = db.all(`
      SELECT id, name, script, created_at, updated_at
      FROM hook_modules
      ORDER BY name ASC
    `);

    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      script: row.script,
    }));
  }

  public getHookModuleById(id: string): HookModule | null {
    const db = getSqliteManager();
    const row = db.get(
      `
      SELECT id, name, script, created_at, updated_at
      FROM hook_modules
      WHERE id = :id
    `,
      { id },
    ) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      script: row.script,
    };
  }

  public getHookModuleByName(name: string): HookModule | null {
    const db = getSqliteManager();
    const row = db.get(
      `
      SELECT id, name, script, created_at, updated_at
      FROM hook_modules
      WHERE name = :name
    `,
      { name },
    ) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      script: row.script,
    };
  }

  public createHookModule(module: Omit<HookModule, "id">): HookModule {
    const db = getSqliteManager();
    const now = Date.now();
    const id = uuidv4();

    const newModule: HookModule = {
      ...module,
      id,
    };

    db.execute(
      `
      INSERT INTO hook_modules (
        id, name, script, created_at, updated_at
      ) VALUES (
        :id, :name, :script, :createdAt, :updatedAt
      )
    `,
      {
        id: newModule.id,
        name: newModule.name,
        script: newModule.script,
        createdAt: now,
        updatedAt: now,
      },
    );

    return newModule;
  }

  public updateHookModule(
    id: string,
    updates: Partial<Omit<HookModule, "id">>,
  ): HookModule | null {
    const existing = this.getHookModuleById(id);
    if (!existing) {
      return null;
    }

    const db = getSqliteManager();
    const updatedModule: HookModule = {
      ...existing,
      ...updates,
      id,
    };

    db.execute(
      `
      UPDATE hook_modules
      SET name = :name,
          script = :script,
          updated_at = :updatedAt
      WHERE id = :id
    `,
      {
        id,
        name: updatedModule.name,
        script: updatedModule.script,
        updatedAt: Date.now(),
      },
    );

    return updatedModule;
  }

  public deleteHookModule(id: string): boolean {
    const db = getSqliteManager();
    const result = db.execute(
      `
      DELETE FROM hook_modules
      WHERE id = :id
    `,
      { id },
    );

    return result.changes > 0;
  }

  public existsByName(name: string): boolean {
    const db = getSqliteManager();
    const row = db.get(
      `
      SELECT COUNT(*) as count
      FROM hook_modules
      WHERE name = :name
    `,
      { name },
    ) as any;

    return row?.count > 0;
  }

  // 导入时自动处理名称冲突（追加数字后缀）
  public importHookModule(module: Omit<HookModule, "id">): HookModule {
    let name = module.name;
    let counter = 1;

    while (this.existsByName(name)) {
      name = `${module.name}_${counter}`;
      counter++;
    }

    return this.createHookModule({
      ...module,
      name,
    });
  }

  public createHookModules(modules: Omit<HookModule, "id">[]): HookModule[] {
    return modules.map((module) => this.createHookModule(module));
  }

  public deleteAllHookModules(): void {
    const db = getSqliteManager();
    db.execute("DELETE FROM hook_modules");
  }
}

export function getHookRepository(): HookRepository {
  return HookRepository.getInstance();
}
