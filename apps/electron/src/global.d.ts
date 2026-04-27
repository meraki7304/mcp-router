/**
 * Augment the global Window interface so TypeScript knows about "window.electronAPI".
 */

import type {
  AppSettings,
  MCPTool,
  MCPServer,
  Project,
  ProjectOptimization,
  TokenServerAccess,
} from "@mcp_router/shared";
import {
  CreateServerInput,
  WorkflowDefinition,
  HookModule,
} from "@mcp_router/shared";
import { McpAppsManagerResult, McpApp } from "@/main/modules/mcp-apps-service";
import { ServerPackageUpdates } from "./lib/utils/backend/package-version-resolver";

declare global {
  interface Window {
    electronAPI: {
      listMcpServers: () => Promise<any>;
      startMcpServer: (id: string) => Promise<boolean>;
      stopMcpServer: (id: string) => Promise<boolean>;
      addMcpServer: (input: CreateServerInput) => Promise<any>;
      serverSelectFile: (options: any) => Promise<any>;
      removeMcpServer: (id: string) => Promise<any>;
      updateMcpServerConfig: (id: string, config: any) => Promise<any>;
      listMcpServerTools: (id: string) => Promise<MCPTool[]>;
      updateToolPermissions: (
        id: string,
        permissions: Record<string, boolean>,
      ) => Promise<MCPServer>;

      getRequestLogs: (options?: {
        clientId?: string;
        serverId?: string;
        requestType?: string;
        startDate?: Date;
        endDate?: Date;
        responseStatus?: "success" | "error";
        cursor?: string;
        limit?: number;
      }) => Promise<{
        logs: any[];
        total: number;
        nextCursor?: string;
        hasMore: boolean;
      }>;

      // Settings Management
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<boolean>;
      incrementPackageManagerOverlayCount: () => Promise<{
        success: boolean;
        count: number;
      }>;

      // MCP Apps Management
      listMcpApps: () => Promise<McpApp[]>;
      addMcpAppConfig: (appName: string) => Promise<McpAppsManagerResult>;
      deleteMcpApp: (appName: string) => Promise<boolean>;
      [key: string]: any;
      updateAppServerAccess: (
        appName: string,
        serverAccess: TokenServerAccess,
      ) => Promise<McpAppsManagerResult>;

      // Command checking
      checkCommandExists: (command: string) => Promise<boolean>;

      // Package Version Resolution
      resolvePackageVersionsInArgs: (
        argsString: string,
        packageManager: "pnpm" | "uvx",
      ) => Promise<{ success: boolean; resolvedArgs?: string; error?: string }>;
      checkMcpServerPackageUpdates: (
        args: string[],
        packageManager: "pnpm" | "uvx",
      ) => Promise<{
        success: boolean;
        updates?: ServerPackageUpdates;
      }>;

      // Update Management
      checkForUpdates: () => Promise<{
        updateAvailable: boolean;
        status: "no-update" | "downloading" | "downloaded" | "error" | "skipped";
        currentVersion: string;
        latestVersion?: string;
        releaseNotes?: string;
        error?: string;
      }>;
      installUpdate: () => Promise<boolean>;
      onUpdateAvailable: (callback: (available: boolean) => void) => () => void;

      // Protocol URL handling
      onProtocolUrl: (callback: (url: string) => void) => () => void;

      // Package Manager Management
      checkPackageManagers: () => Promise<{
        node: boolean;
        pnpm: boolean;
        uv: boolean;
      }>;
      installPackageManagers: () => Promise<{
        success: boolean;
        installed: { node: boolean; pnpm: boolean; uv: boolean };
        errors?: { node?: string; pnpm?: string; uv?: string };
      }>;
      restartApp: () => Promise<boolean>;

      // Projects Management
      listProjects: () => Promise<Project[]>;
      createProject: (input: { name: string }) => Promise<Project>;
      updateProject: (
        id: string,
        updates: {
          name?: string;
          optimization?: ProjectOptimization;
        },
      ) => Promise<Project>;
      deleteProject: (id: string) => Promise<void>;

      // Workflow Management
      listWorkflows: () => Promise<WorkflowDefinition[]>;
      getWorkflow: (id: string) => Promise<WorkflowDefinition | null>;
      createWorkflow: (
        workflow: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">,
      ) => Promise<WorkflowDefinition>;
      updateWorkflow: (
        id: string,
        updates: Partial<Omit<WorkflowDefinition, "id" | "createdAt">>,
      ) => Promise<WorkflowDefinition | null>;
      deleteWorkflow: (id: string) => Promise<boolean>;
      setActiveWorkflow: (id: string) => Promise<boolean>;
      disableWorkflow: (id: string) => Promise<boolean>;
      executeWorkflow: (id: string, context?: any) => Promise<any>;
      getEnabledWorkflows: () => Promise<WorkflowDefinition[]>;
      getWorkflowsByType: (
        workflowType: string,
      ) => Promise<WorkflowDefinition[]>;

      // Hook Module Management
      listHookModules: () => Promise<HookModule[]>;
      getHookModule: (id: string) => Promise<HookModule | null>;
      createHookModule: (module: Omit<HookModule, "id">) => Promise<HookModule>;
      updateHookModule: (
        id: string,
        updates: Partial<Omit<HookModule, "id">>,
      ) => Promise<HookModule | null>;
      deleteHookModule: (id: string) => Promise<boolean>;
      executeHookModule: (id: string, context: any) => Promise<any>;
      importHookModule: (module: Omit<HookModule, "id">) => Promise<HookModule>;
      validateHookScript: (
        script: string,
      ) => Promise<{ valid: boolean; error?: string }>;

    };
  }
}
