import { getSqliteManager } from "../../infrastructure/database/sqlite-manager";
import { WorkflowDefinition } from "@mcp_router/shared";
import { v4 as uuidv4 } from "uuid";

/**
 * Workflow 仓库类，管理 WorkflowDefinition 的持久化
 */
export class WorkflowRepository {
  private static instance: WorkflowRepository | null = null;

  private constructor() {
    this.initializeTable();
  }

  private initializeTable(): void {
    const db = getSqliteManager();
    try {
      db.execute(`
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          workflow_type TEXT NOT NULL,
          nodes TEXT NOT NULL,
          edges TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      db.execute(
        "CREATE INDEX IF NOT EXISTS idx_workflows_enabled ON workflows(enabled)",
      );
      db.execute(
        "CREATE INDEX IF NOT EXISTS idx_workflows_type ON workflows(workflow_type)",
      );

      console.log("[WorkflowRepository] 表初始化完成");
    } catch (error) {
      console.error("[WorkflowRepository] 表初始化时出错:", error);
      throw error;
    }
  }

  public static getInstance(): WorkflowRepository {
    if (!WorkflowRepository.instance) {
      WorkflowRepository.instance = new WorkflowRepository();
    }
    return WorkflowRepository.instance;
  }

  public static resetInstance(): void {
    WorkflowRepository.instance = null;
  }

  public getAllWorkflows(): WorkflowDefinition[] {
    const db = getSqliteManager();
    const rows = db.all(`
      SELECT id, name, description, workflow_type, nodes, edges, 
             enabled, created_at, updated_at
      FROM workflows
      ORDER BY updated_at DESC
    `);

    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      workflowType: row.workflow_type,
      nodes: JSON.parse(row.nodes),
      edges: JSON.parse(row.edges),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public getEnabledWorkflows(): WorkflowDefinition[] {
    const db = getSqliteManager();
    const rows = db.all(`
      SELECT id, name, description, workflow_type, nodes, edges, 
             enabled, created_at, updated_at
      FROM workflows
      WHERE enabled = 1
      ORDER BY updated_at DESC
    `);

    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      workflowType: row.workflow_type,
      nodes: JSON.parse(row.nodes),
      edges: JSON.parse(row.edges),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public getWorkflowById(id: string): WorkflowDefinition | null {
    const db = getSqliteManager();
    const row = db.get(
      `
      SELECT id, name, description, workflow_type, nodes, edges, 
             enabled, created_at, updated_at
      FROM workflows
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
      description: row.description || undefined,
      workflowType: row.workflow_type,
      nodes: JSON.parse(row.nodes),
      edges: JSON.parse(row.edges),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public getWorkflowsByType(workflowType: string): WorkflowDefinition[] {
    const db = getSqliteManager();
    const rows = db.all(
      `
      SELECT id, name, description, workflow_type, nodes, edges, 
             enabled, created_at, updated_at
      FROM workflows
      WHERE workflow_type = :workflowType
      ORDER BY updated_at DESC
    `,
      { workflowType },
    );

    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      workflowType: row.workflow_type,
      nodes: JSON.parse(row.nodes),
      edges: JSON.parse(row.edges),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public createWorkflow(
    workflow: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">,
  ): WorkflowDefinition {
    const db = getSqliteManager();
    const now = Date.now();
    const id = uuidv4();

    const newWorkflow: WorkflowDefinition = {
      ...workflow,
      id,
      createdAt: now,
      updatedAt: now,
    };

    db.execute(
      `
      INSERT INTO workflows (
        id, name, description, workflow_type, nodes, edges, 
        enabled, created_at, updated_at
      ) VALUES (
        :id, :name, :description, :workflowType, :nodes, :edges,
        :enabled, :createdAt, :updatedAt
      )
    `,
      {
        id: newWorkflow.id,
        name: newWorkflow.name,
        description: newWorkflow.description || null,
        workflowType: newWorkflow.workflowType,
        nodes: JSON.stringify(newWorkflow.nodes),
        edges: JSON.stringify(newWorkflow.edges),
        enabled: newWorkflow.enabled ? 1 : 0,
        createdAt: newWorkflow.createdAt,
        updatedAt: newWorkflow.updatedAt,
      },
    );

    return newWorkflow;
  }

  public updateWorkflow(
    id: string,
    updates: Partial<Omit<WorkflowDefinition, "id" | "createdAt">>,
  ): WorkflowDefinition | null {
    const existing = this.getWorkflowById(id);
    if (!existing) {
      return null;
    }

    const db = getSqliteManager();
    const updatedWorkflow: WorkflowDefinition = {
      ...existing,
      ...updates,
      id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };

    db.execute(
      `
      UPDATE workflows
      SET name = :name,
          description = :description,
          workflow_type = :workflowType,
          nodes = :nodes,
          edges = :edges,
          enabled = :enabled,
          updated_at = :updatedAt
      WHERE id = :id
    `,
      {
        id,
        name: updatedWorkflow.name,
        description: updatedWorkflow.description || null,
        workflowType: updatedWorkflow.workflowType,
        nodes: JSON.stringify(updatedWorkflow.nodes),
        edges: JSON.stringify(updatedWorkflow.edges),
        enabled: updatedWorkflow.enabled ? 1 : 0,
        updatedAt: updatedWorkflow.updatedAt,
      },
    );

    return updatedWorkflow;
  }

  // 激活指定 workflow，同时停用同类型的其他 workflow
  public setActiveWorkflow(id: string): boolean {
    const workflow = this.getWorkflowById(id);
    if (!workflow) {
      return false;
    }

    const db = getSqliteManager();

    db.execute(
      `
      UPDATE workflows
      SET enabled = 0,
          updated_at = :updatedAt
      WHERE workflow_type = :workflowType
        AND id != :id
        AND enabled = 1
    `,
      {
        workflowType: workflow.workflowType,
        id,
        updatedAt: Date.now(),
      },
    );

    db.execute(
      `
      UPDATE workflows
      SET enabled = 1,
          updated_at = :updatedAt
      WHERE id = :id
    `,
      {
        id,
        updatedAt: Date.now(),
      },
    );

    return true;
  }

  public disableWorkflow(id: string): boolean {
    const workflow = this.getWorkflowById(id);
    if (!workflow) {
      return false;
    }

    const db = getSqliteManager();

    db.execute(
      `
      UPDATE workflows
      SET enabled = 0,
          updated_at = :updatedAt
      WHERE id = :id
    `,
      {
        id,
        updatedAt: Date.now(),
      },
    );

    return true;
  }

  public deleteWorkflow(id: string): boolean {
    const db = getSqliteManager();
    const result = db.execute(
      `
      DELETE FROM workflows
      WHERE id = :id
    `,
      { id },
    );

    return result.changes > 0;
  }

  public deleteAllWorkflows(): void {
    const db = getSqliteManager();
    db.execute("DELETE FROM workflows");
  }
}

export function getWorkflowRepository(): WorkflowRepository {
  return WorkflowRepository.getInstance();
}
