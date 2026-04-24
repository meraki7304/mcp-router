import {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  WorkflowHook,
} from "@mcp_router/shared";
import { getHookService } from "./hook.service";

/**
 * WorkflowExecutor — Workflow 执行引擎
 * 解析节点图并按顺序执行各节点
 */
export class WorkflowExecutor {
  private workflow: WorkflowDefinition;
  private hookService = getHookService();

  constructor(workflow: WorkflowDefinition) {
    this.workflow = workflow;
  }

  // 验证 workflow 结构是否合法：必须存在 Start -> MCP Call -> End 的完整路径
  public static isValidWorkflow(workflow: WorkflowDefinition): boolean {
    const nodes = workflow.nodes;
    const edges = workflow.edges;

    const startNode = nodes.find((n) => n.type === "start");
    const endNode = nodes.find((n) => n.type === "end");
    const mcpCallNode = nodes.find((n) => n.type === "mcp-call");

    if (!startNode || !endNode || !mcpCallNode) {
      console.warn(
        `Workflow ${workflow.name} is missing required nodes: start=${!!startNode}, mcp-call=${!!mcpCallNode}, end=${!!endNode}`,
      );
      return false;
    }

    const pathFromStartToMcp = WorkflowExecutor.hasPath(
      edges,
      startNode.id,
      mcpCallNode.id,
    );

    const pathFromMcpToEnd = WorkflowExecutor.hasPath(
      edges,
      mcpCallNode.id,
      endNode.id,
    );

    if (!pathFromStartToMcp || !pathFromMcpToEnd) {
      console.warn(
        `Workflow ${workflow.name} does not have valid connections: start->mcp=${pathFromStartToMcp}, mcp->end=${pathFromMcpToEnd}`,
      );
      return false;
    }

    return true;
  }

  private static hasPath(
    edges: WorkflowEdge[],
    fromId: string,
    toId: string,
  ): boolean {
    const adjacencyList: Record<string, string[]> = {};
    edges.forEach((edge) => {
      if (!adjacencyList[edge.source]) {
        adjacencyList[edge.source] = [];
      }
      adjacencyList[edge.source].push(edge.target);
    });

    // BFS 路径搜索
    const visited = new Set<string>();
    const queue = [fromId];
    visited.add(fromId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current === toId) {
        return true;
      }

      const neighbors = adjacencyList[current] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    return false;
  }

  /**
   * 执行 Workflow
   * @param context 执行上下文（包含 MCP 请求信息等）
   */
  public async execute(context: any): Promise<any> {
    if (!this.workflow.enabled) {
      throw new Error(`Workflow is disabled: ${this.workflow.id}`);
    }

    const executionOrder = this.determineExecutionOrder();
    const results: Record<string, any> = {};
    let mcpResult: any = undefined;

    try {
      for (const nodeId of executionOrder) {
        const node = this.workflow.nodes.find((n) => n.id === nodeId);
        if (!node) continue;

        const result = await this.executeNode(node, context, results);
        results[nodeId] = result;

        if (node.type === "mcp-call" && result.mcpResponse !== undefined) {
          mcpResult = result.mcpResponse;
        }
      }

      return {
        workflowId: this.workflow.id,
        workflowName: this.workflow.name,
        status: "completed",
        executedAt: Date.now(),
        context,
        results,
        mcpResult,
      };
    } catch (error) {
      console.error(`Error executing workflow ${this.workflow.id}:`, error);
      return {
        workflowId: this.workflow.id,
        workflowName: this.workflow.name,
        status: "error",
        executedAt: Date.now(),
        context,
        results,
        mcpResult,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // 拓扑排序（Kahn 算法）确定 DAG 节点执行顺序
  private determineExecutionOrder(): string[] {
    const nodes = this.workflow.nodes;
    const edges = this.workflow.edges;

    const adjacencyList: Record<string, string[]> = {};
    const inDegree: Record<string, number> = {};

    nodes.forEach((node) => {
      adjacencyList[node.id] = [];
      inDegree[node.id] = 0;
    });

    edges.forEach((edge) => {
      adjacencyList[edge.source].push(edge.target);
      inDegree[edge.target]++;
    });

    const queue: string[] = [];
    const executionOrder: string[] = [];

    Object.keys(inDegree).forEach((nodeId) => {
      if (inDegree[nodeId] === 0) {
        queue.push(nodeId);
      }
    });

    while (queue.length > 0) {
      const currentNode = queue.shift()!;
      executionOrder.push(currentNode);

      adjacencyList[currentNode].forEach((neighbor) => {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) {
          queue.push(neighbor);
        }
      });
    }

    if (executionOrder.length !== nodes.length) {
      throw new Error("Workflow contains a cycle");
    }

    return executionOrder;
  }

  private async executeNode(
    node: WorkflowNode,
    context: any,
    previousResults: Record<string, any>,
  ): Promise<any> {
    console.log(`Executing node: ${node.id} (${node.type})`);

    switch (node.type) {
      case "start":
        return { started: true, timestamp: Date.now() };

      case "end":
        return { completed: true, timestamp: Date.now(), previousResults };

      case "hook":
        return await this.executeHookNode(node, context, previousResults);

      case "mcp-call":
        return await this.executeMcpCallNode(node, context, previousResults);

      default:
        console.warn(`Unknown node type: ${node.type}`);
        return { skipped: true, reason: `Unknown node type: ${node.type}` };
    }
  }

  private async executeMcpCallNode(
    node: WorkflowNode,
    context: any,
    previousResults: Record<string, any>,
  ): Promise<any> {
    console.log(`Executing MCP call node: ${node.id}`);

    const mcpHandler = context.mcpHandler;

    if (!mcpHandler || typeof mcpHandler !== "function") {
      console.error("MCP handler not found in context");
      return {
        type: "mcp-call",
        error: "MCP handler not found",
        timestamp: Date.now(),
      };
    }

    try {
      console.log(`Executing MCP request: ${context.method}`);
      const mcpResponse = await mcpHandler();

      return {
        type: "mcp-call",
        success: true,
        mcpResponse,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Error executing MCP request:`, error);
      return {
        type: "mcp-call",
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
    }
  }

  private async executeHookNode(
    node: WorkflowNode,
    context: any,
    previousResults: Record<string, any>,
  ): Promise<any> {
    const hook = node.data?.hook as WorkflowHook | undefined;

    if (!hook) {
      console.warn(`Hook node ${node.id} has no hook configuration`);
      return { skipped: true, reason: "No hook configuration" };
    }

    const hookContext = {
      ...context,
      workflowId: this.workflow.id,
      workflowName: this.workflow.name,
      nodeId: node.id,
      nodeName: node.data?.label || node.id,
      previousResults,
    };

    try {
      let scriptToExecute: string | undefined;

      if (hook.hookModuleId) {
        const module = await this.hookService.getHookModuleById(
          hook.hookModuleId,
        );
        if (!module) {
          console.error(`Hook module not found: ${hook.hookModuleId}`);
          return {
            success: false,
            error: `Hook module not found: ${hook.hookModuleId}`,
            timestamp: Date.now(),
          };
        }
        scriptToExecute = module.script;
      } else if (hook.script) {
        scriptToExecute = hook.script;
      }

      if (scriptToExecute) {
        const result = await this.hookService.executeHookScript(
          scriptToExecute,
          hookContext,
        );
        return {
          success: true,
          result,
          timestamp: Date.now(),
        };
      } else {
        return {
          skipped: true,
          reason: "No script specified",
        };
      }
    } catch (error) {
      console.error(`Error executing hook node ${node.id}:`, error);

      // 即使出错也继续执行后续节点（可通过配置修改此行为）
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
    }
  }

  // 执行前置 Hook（为未来扩展预留）
  public async executePreHooks(context: any): Promise<any[]> {
    const preHookNodes = this.workflow.nodes.filter(
      (node) => node.type === "hook" && this.isPreHook(node),
    );

    const results = [];
    for (const node of preHookNodes) {
      const result = await this.executeHookNode(node, context, {});
      results.push(result);
    }

    return results;
  }

  // 执行后置 Hook（为未来扩展预留）
  public async executePostHooks(context: any, response: any): Promise<any[]> {
    const postHookNodes = this.workflow.nodes.filter(
      (node) => node.type === "hook" && this.isPostHook(node),
    );

    const hookContext = { ...context, response };
    const results = [];
    for (const node of postHookNodes) {
      const result = await this.executeHookNode(node, hookContext, {});
      results.push(result);
    }

    return results;
  }

  // 判断节点是否为前置 Hook（为未来扩展预留）
  private isPreHook(node: WorkflowNode): boolean {
    const startNode = this.workflow.nodes.find((n) => n.type === "start");
    if (!startNode) return false;

    const edgesFromStart = this.workflow.edges.filter(
      (e) => e.source === startNode.id,
    );
    return edgesFromStart.some((e) => e.target === node.id);
  }

  // 判断节点是否为后置 Hook（为未来扩展预留）
  private isPostHook(node: WorkflowNode): boolean {
    const endNode = this.workflow.nodes.find((n) => n.type === "end");
    if (!endNode) return false;

    const edgesToEnd = this.workflow.edges.filter(
      (e) => e.target === endNode.id,
    );
    return edgesToEnd.some((e) => e.source === node.id);
  }
}
