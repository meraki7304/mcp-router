import { WorkflowDefinition } from "@mcp_router/shared";
import {
  getWorkflowRepository,
  WorkflowRepository,
} from "./workflow.repository";

/**
 * Workflow 领域服务
 * 提供 Workflow 的业务逻辑与后端服务
 */
export class WorkflowService {
  private static instance: WorkflowService | null = null;
  private repository: WorkflowRepository;

  private constructor() {
    this.repository = getWorkflowRepository();
  }

  public static getInstance(): WorkflowService {
    if (!WorkflowService.instance) {
      WorkflowService.instance = new WorkflowService();
    }
    return WorkflowService.instance;
  }

  public static resetInstance(): void {
    WorkflowService.instance = null;
  }

  public async getAllWorkflows(): Promise<WorkflowDefinition[]> {
    return this.repository.getAllWorkflows();
  }

  public async getEnabledWorkflows(): Promise<WorkflowDefinition[]> {
    return this.repository.getEnabledWorkflows();
  }

  public async getWorkflowById(id: string): Promise<WorkflowDefinition | null> {
    return this.repository.getWorkflowById(id);
  }

  public async getWorkflowsByType(
    workflowType: string,
  ): Promise<WorkflowDefinition[]> {
    return this.repository.getWorkflowsByType(workflowType);
  }

  public async createWorkflow(
    workflow: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">,
  ): Promise<WorkflowDefinition> {
    this.validateWorkflow(workflow);

    return this.repository.createWorkflow(workflow);
  }

  public async updateWorkflow(
    id: string,
    updates: Partial<Omit<WorkflowDefinition, "id" | "createdAt">>,
  ): Promise<WorkflowDefinition | null> {
    if (updates.nodes !== undefined || updates.edges !== undefined) {
      const existing = await this.getWorkflowById(id);
      if (existing) {
        const merged = { ...existing, ...updates };
        this.validateWorkflow(merged);
      }
    }

    return this.repository.updateWorkflow(id, updates);
  }

  // 激活指定 workflow，同时停用同类型的其他 workflow
  public async setActiveWorkflow(id: string): Promise<boolean> {
    const workflow = await this.getWorkflowById(id);
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`);
    }

    const { WorkflowExecutor } = await import("./workflow-executor");
    const isValid = WorkflowExecutor.isValidWorkflow(workflow);

    if (!isValid) {
      throw new Error(
        `Workflow "${workflow.name}" is not valid. ` +
          `Ensure it has Start -> MCP Call -> End nodes properly connected.`,
      );
    }

    return this.repository.setActiveWorkflow(id);
  }

  public async disableWorkflow(id: string): Promise<boolean> {
    return this.repository.disableWorkflow(id);
  }

  public async deleteWorkflow(id: string): Promise<boolean> {
    return this.repository.deleteWorkflow(id);
  }

  // TODO: 待迁移至 WorkflowExecutor 类
  public async executeWorkflow(id: string, context?: any): Promise<any> {
    const workflow = await this.getWorkflowById(id);
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`);
    }

    if (!workflow.enabled) {
      throw new Error(`Workflow is disabled: ${id}`);
    }

    const { WorkflowExecutor } = await import("./workflow-executor");
    const executor = new WorkflowExecutor(workflow);

    try {
      const result = await executor.execute(context);
      console.log(`Workflow executed successfully: ${workflow.name}`, result);
      return result;
    } catch (error) {
      console.error(`Failed to execute workflow: ${workflow.name}`, error);
      throw error;
    }
  }

  private validateWorkflow(workflow: any): void {
    if (!workflow.name || workflow.name.trim().length === 0) {
      throw new Error("Workflow name is required");
    }

    if (!workflow.workflowType) {
      throw new Error("Workflow type is required");
    }

    if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
      throw new Error("Workflow must have at least one node");
    }

    if (!Array.isArray(workflow.edges)) {
      throw new Error("Workflow edges must be an array");
    }

    const hasStartNode = workflow.nodes.some(
      (node: any) => node.type === "start",
    );
    if (!hasStartNode) {
      throw new Error("Workflow must have a start node");
    }

    const hasEndNode = workflow.nodes.some((node: any) => node.type === "end");
    if (!hasEndNode) {
      throw new Error("Workflow must have an end node");
    }
  }
}

export function getWorkflowService(): WorkflowService {
  return WorkflowService.getInstance();
}
