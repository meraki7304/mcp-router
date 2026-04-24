import { BrowserWindow } from "electron";
import { getWorkspaceService } from "@/main/modules/workspace/workspace.service";
import type { Workspace } from "@mcp_router/shared";
import {
  SqliteManager,
  setWorkspaceDatabase,
} from "../../infrastructure/database/sqlite-manager";
import { getDatabaseContext } from "./database-context";
import { MainDatabaseMigration } from "../../infrastructure/database/main-database-migration";
import { getSharedConfigManager } from "../../infrastructure/shared-config-manager";
import { McpLoggerRepository } from "../mcp-logger/mcp-logger.repository";
import { McpServerManagerRepository } from "../mcp-server-manager/mcp-server-manager.repository";
import { SettingsRepository } from "../settings/settings.repository";
import { McpAppsManagerRepository } from "../mcp-apps-manager/mcp-apps-manager.repository";
import { WorkspaceRepository } from "./workspace.repository";
import { ServerService } from "@/main/modules/mcp-server-manager/server-service";
import { McpAppsManagerService } from "../mcp-apps-manager/mcp-apps-manager.service";
import { McpLoggerService } from "@/main/modules/mcp-logger/mcp-logger.service";
import { SettingsService } from "../settings/settings.service";
import type { MCPServerManager } from "@/main/modules/mcp-server-manager/mcp-server-manager";
import { WorkflowRepository } from "../workflow/workflow.repository";
import { HookRepository } from "../workflow/hook.repository";
import { WorkflowService } from "../workflow/workflow.service";
import { HookService } from "../workflow/hook.service";

export class PlatformAPIManager {
  private static instance: PlatformAPIManager | null = null;
  private currentWorkspace: Workspace | null = null;
  private currentDatabase: SqliteManager | null = null;
  private mainWindow: BrowserWindow | null = null;
  private getServerManager?: () => MCPServerManager;

  public static getInstance(): PlatformAPIManager {
    if (!PlatformAPIManager.instance) {
      PlatformAPIManager.instance = new PlatformAPIManager();
    }
    return PlatformAPIManager.instance;
  }

  private constructor() {
    getWorkspaceService().onWorkspaceSwitched((workspace: Workspace) => {
      this.handleWorkspaceSwitch(workspace);
    });
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  setServerManagerProvider(provider: () => MCPServerManager): void {
    this.getServerManager = provider;
  }

  /**
   * 初期化
   */
  async initialize(): Promise<void> {
    // Configure database provider to avoid circular dependencies
    getDatabaseContext().setDatabaseProvider(async () => {
      const db = this.getCurrentDatabase();
      if (db) {
        return db;
      }

      const workspaceService = getWorkspaceService();
      const activeWorkspace = await workspaceService.getActiveWorkspace();
      if (!activeWorkspace) {
        throw new Error("No active workspace found");
      }

      return await workspaceService.getWorkspaceDatabase(activeWorkspace.id);
    });

    const activeWorkspace = await getWorkspaceService().getActiveWorkspace();
    if (activeWorkspace) {
      this.currentWorkspace = activeWorkspace;
      await this.configureForWorkspace(activeWorkspace);
    } else {
      await getWorkspaceService().switchWorkspace("local-default");
    }
  }

  private async configureForWorkspace(workspace: Workspace): Promise<void> {
    if (this.currentDatabase) {
      this.currentDatabase.close();
      this.currentDatabase = null;
      setWorkspaceDatabase(null);
    }

    const newDatabase = await getWorkspaceService().getWorkspaceDatabase(
      workspace.id,
    );
    this.currentDatabase = newDatabase;

    getDatabaseContext().setCurrentDatabase(newDatabase);

    setWorkspaceDatabase(newDatabase);

    // 对所有工作区执行数据库迁移
    const migration = new MainDatabaseMigration(newDatabase);
    migration.runMigrations();

    McpLoggerRepository.resetInstance();
    McpServerManagerRepository.resetInstance();
    SettingsRepository.resetInstance();
    McpAppsManagerRepository.resetInstance();
    WorkspaceRepository.resetInstance();
    WorkflowRepository.resetInstance();
    HookRepository.resetInstance();

    ServerService.resetInstance();
    McpAppsManagerService.resetInstance();
    McpLoggerService.resetInstance();
    SettingsService.resetInstance();
    WorkflowService.resetInstance();
    HookService.resetInstance();
    if (this.getServerManager) {
      const serverManager = this.getServerManager();
      if (
        serverManager &&
        typeof serverManager.initializeAsync === "function"
      ) {
        await serverManager.initializeAsync();
      }
    }

    // 获取新工作区的服务器 ID 并同步令牌（通过 Repository 确保表已初始化）
    let serverList: string[] = [];
    try {
      const serverRepo = McpServerManagerRepository.getInstance();
      serverList = serverRepo.getAllServers().map((s) => s.id);
    } catch (e) {
      console.error("Failed to load servers via repository for token sync:", e);
      serverList = [];
    }

    if (serverList.length > 0) {
      getSharedConfigManager().syncTokensWithWorkspaceServers(serverList);
    }
  }

  private async handleWorkspaceSwitch(workspace: Workspace): Promise<void> {
    // 先停止当前工作区的服务器（日志记录到当前 DB）
    if (this.getServerManager) {
      const serverManager = this.getServerManager();
      serverManager.clearAllServers();
    }

    this.currentWorkspace = workspace;
    await this.configureForWorkspace(workspace);

    if (this.mainWindow) {
      this.mainWindow.webContents.send("workspace:switched", workspace);
    }
  }

  getCurrentWorkspace(): Workspace | null {
    return this.currentWorkspace;
  }

  isRemoteWorkspace(): boolean {
    return this.currentWorkspace?.type === "remote";
  }

  getRemoteApiUrl(): string | null {
    if (
      this.isRemoteWorkspace() &&
      this.currentWorkspace?.remoteConfig?.apiUrl
    ) {
      return this.currentWorkspace.remoteConfig.apiUrl;
    }
    return null;
  }

  getCurrentDatabase(): SqliteManager | null {
    return this.currentDatabase;
  }

  async switchWorkspace(workspaceId: string): Promise<void> {
    await getWorkspaceService().switchWorkspace(workspaceId);
  }
}

export function getPlatformAPIManager(): PlatformAPIManager {
  return PlatformAPIManager.getInstance();
}
