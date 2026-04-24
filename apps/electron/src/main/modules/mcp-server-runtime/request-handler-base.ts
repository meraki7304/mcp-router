import { TokenValidator } from "./token-validator";
import { getLogService } from "@/main/modules/mcp-logger/mcp-logger.service";
import { McpManagerRequestLogEntry as RequestLogEntry } from "@mcp_router/shared";

/**
 * Base class for request handlers with common error handling patterns
 */
export abstract class RequestHandlerBase {
  protected tokenValidator: TokenValidator;

  constructor(tokenValidator: TokenValidator) {
    this.tokenValidator = tokenValidator;
  }

  /**
   * Extract client ID from token
   */
  protected getClientId(token?: string): string {
    return token
      ? this.tokenValidator.validateToken(token).clientId || "unknownClient"
      : "unknownClient";
  }

  /**
   * Execute a request
   */
  protected async executeWithHooks<T>(
    method: string,
    params: any,
    clientId: string,
    handler: () => Promise<T>,
    additionalMetadata?: Record<string, any>,
  ): Promise<T> {
    try {
      const { getWorkflowService } =
        await import("../workflow/workflow.service");
      const { WorkflowExecutor } =
        await import("../workflow/workflow-executor");
      const workflowService = getWorkflowService();

      const workflowType = method; // "tools/list" or "tools/call"
      const workflows = await workflowService.getWorkflowsByType(workflowType);

      // 筛选已启用且结构有效的 Workflow
      const validWorkflows = workflows.filter((w) => {
        if (!w.enabled) {
          return false;
        }

        const isValid = WorkflowExecutor.isValidWorkflow(w);
        if (!isValid) {
          console.warn(
            `Workflow ${w.name} (${w.id}) is not valid for execution`,
          );
        }
        return isValid;
      });

      const context = {
        method,
        params,
        clientId,
        timestamp: Date.now(),
        mcpHandler: handler,
        ...additionalMetadata,
      };

      if (validWorkflows.length > 0) {
        console.log(
          `Found ${validWorkflows.length} valid workflows for ${method}`,
        );

        // TODO: 复数 Workflow 时的执行策略待定
        const workflow = validWorkflows[0];

        try {
          console.log(`Executing workflow: ${workflow.name} (${workflow.id})`);
          const result = await workflowService.executeWorkflow(
            workflow.id,
            context,
          );

          if (result.mcpResult !== undefined) {
            console.log(`Workflow execution successful, returning MCP result`);
            return result.mcpResult as T;
          }

          console.error(
            `Workflow ${workflow.name} did not execute MCP request`,
          );
          throw new Error(
            `Workflow ${workflow.name} did not execute MCP request`,
          );
        } catch (error) {
          console.error(`Failed to execute workflow ${workflow.name}:`, error);
          console.log(`Falling back to direct handler execution`);
          return await handler();
        }
      } else {
        console.log(`No valid workflows found for ${method}`);
      }
    } catch (error) {
      // Workflow 配置错误只记录日志，不中断 MCP 请求
      console.error(`Error setting up workflows for ${method}:`, error);
    }

    console.log(`Executing handler directly without workflow`);
    return await handler();
  }

  /**
   * Execute a request with logging
   */
  protected async executeWithHooksAndLogging<T>(
    method: string,
    params: any,
    clientId: string,
    serverName: string,
    requestType: string,
    handler: () => Promise<T>,
    additionalMetadata?: Record<string, any>,
  ): Promise<T> {
    // Create log entry
    const logEntry: RequestLogEntry = {
      timestamp: new Date().toISOString(),
      requestType,
      params,
      result: "success",
      duration: 0,
      clientId,
    };

    try {
      // Execute the actual handler
      const result = await handler();

      // Log success
      logEntry.response = result;
      logEntry.duration = Date.now() - new Date(logEntry.timestamp).getTime();
      getLogService().recordMcpRequestLog(logEntry, serverName);

      return result;
    } catch (error: any) {
      // Log error
      logEntry.result = "error";
      logEntry.errorMessage = error.message || String(error);
      logEntry.duration = Date.now() - new Date(logEntry.timestamp).getTime();
      getLogService().recordMcpRequestLog(logEntry, serverName);

      // Re-throw the original error
      throw error;
    }
  }
}
