import { setupMcpServerHandlers } from "../modules/mcp-server-manager/mcp-server-manager.ipc";
import { setupLogHandlers } from "../modules/mcp-logger/mcp-logger.ipc";
import { setupSettingsHandlers } from "../modules/settings/settings.ipc";
import { setupMcpAppsHandlers } from "../modules/mcp-apps-manager/mcp-apps-manager.ipc";
import { setupSystemHandlers } from "../modules/system/system-handler";
import { setupPackageHandlers } from "../modules/system/package-handlers";
import { setupWorkflowHandlers } from "../modules/workflow/workflow.ipc";
import { setupHookHandlers } from "../modules/workflow/hook.ipc";
import { setupProjectHandlers } from "../modules/projects/projects.ipc";
import type { MCPServerManager } from "@/main/modules/mcp-server-manager/mcp-server-manager";

/**
 * 注册所有 IPC 通信处理器
 * 应用初始化时调用
 */
export function setupIpcHandlers(deps: {
  getServerManager: () => MCPServerManager;
}): void {
  // MCP 服务器相关
  setupMcpServerHandlers(deps.getServerManager);

  // 日志相关
  setupLogHandlers();

  // 设置相关
  setupSettingsHandlers();

  // MCP Apps 相关
  setupMcpAppsHandlers();

  // 系统相关（工具、更新）
  setupSystemHandlers();

  // 包管理器（版本解析与安装）
  setupPackageHandlers();

  // Workflow
  setupWorkflowHandlers();

  // Hook Module
  setupHookHandlers();

  // Projects
  setupProjectHandlers({ getServerManager: deps.getServerManager });
}
