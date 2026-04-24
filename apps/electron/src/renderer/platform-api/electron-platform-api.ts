/**
 * Electron 专用的 Platform API 实现（离线本地模式）
 */

import type { PlatformAPI } from "@mcp_router/shared";
import type {
  ServerAPI,
  AppAPI,
  PackageAPI,
  SettingsAPI,
  LogAPI,
  WorkflowAPI,
  ProjectsAPI,
} from "@mcp_router/shared";

class ElectronPlatformAPI implements PlatformAPI {
  servers: ServerAPI;
  apps: AppAPI;
  packages: PackageAPI;
  settings: SettingsAPI;
  logs: LogAPI;
  workflows: WorkflowAPI;
  projects: ProjectsAPI;

  constructor() {
    // servers 域
    this.servers = {
      list: () => window.electronAPI.listMcpServers(),
      listTools: (id) => window.electronAPI.listMcpServerTools(id),
      get: async (id) => {
        const servers = await window.electronAPI.listMcpServers();
        return servers.find((s: any) => s.id === id) || null;
      },
      create: (input) => window.electronAPI.addMcpServer(input),
      update: (id, updates) =>
        window.electronAPI.updateMcpServerConfig(id, updates),
      updateToolPermissions: (id, permissions) =>
        window.electronAPI.updateToolPermissions(id, permissions),
      delete: (id) => window.electronAPI.removeMcpServer(id),
      start: (id) => window.electronAPI.startMcpServer(id),
      stop: (id) => window.electronAPI.stopMcpServer(id),
      getStatus: async (id) => {
        const servers = await window.electronAPI.listMcpServers();
        const server = servers.find((s: any) => s.id === id);
        return server?.status || { type: "stopped" };
      },
      selectFile: (options) => window.electronAPI.serverSelectFile(options),
    };

    // apps 域（含 token 管理）
    this.apps = {
      list: () => window.electronAPI.listMcpApps(),
      create: (appName) => window.electronAPI.addMcpAppConfig(appName),
      delete: (appName) => window.electronAPI.deleteMcpApp(appName),
      updateServerAccess: (appName, serverAccess) =>
        window.electronAPI.updateAppServerAccess(appName, serverAccess),

      // Token 管理占位（Electron 端由 apps 接口直接处理）
      tokens: {
        generate: async () => {
          throw new Error("Token generation not available in Electron");
        },
        revoke: async () => {
          throw new Error("Token revocation not available in Electron");
        },
        list: async () => {
          throw new Error("Token listing not available in Electron");
        },
      },
    };

    // packages 域（含系统工具）
    this.packages = {
      resolveVersions: (argsString, manager) =>
        window.electronAPI.resolvePackageVersionsInArgs(argsString, manager),
      checkUpdates: (args, manager) =>
        window.electronAPI.checkMcpServerPackageUpdates(args, manager),
      checkManagers: () => window.electronAPI.checkPackageManagers(),
      installManagers: () => window.electronAPI.installPackageManagers(),

      system: {
        getPlatform: () => window.electronAPI.getPlatform(),
        checkCommand: (command) =>
          window.electronAPI.checkCommandExists(command),
        restartApp: () => window.electronAPI.restartApp(),
        checkForUpdates: () => window.electronAPI.checkForUpdates(),
        installUpdate: () => window.electronAPI.installUpdate(),
        onUpdateAvailable: (callback) =>
          window.electronAPI.onUpdateAvailable(callback),
        onProtocolUrl: (callback) => window.electronAPI.onProtocolUrl(callback),
      },
    };

    // settings 域
    this.settings = {
      get: () => window.electronAPI.getSettings(),
      save: (settings) => window.electronAPI.saveSettings(settings),
      incrementOverlayCount: () =>
        window.electronAPI.incrementPackageManagerOverlayCount(),
    };

    // logs 域
    this.logs = {
      query: async (options) => {
        const result = await window.electronAPI.getRequestLogs(options);
        return {
          ...result,
          items: result.logs,
        };
      },
    };

    // workflows 域（含 hook modules）
    this.workflows = {
      workflows: {
        list: () => window.electronAPI.listWorkflows(),
        get: (id) => window.electronAPI.getWorkflow(id),
        create: (workflow) => window.electronAPI.createWorkflow(workflow),
        update: (id, updates) => window.electronAPI.updateWorkflow(id, updates),
        delete: (id) => window.electronAPI.deleteWorkflow(id),
        setActive: (id) => window.electronAPI.setActiveWorkflow(id),
        disable: (id) => window.electronAPI.disableWorkflow(id),
        execute: (id, context) =>
          window.electronAPI.executeWorkflow(id, context),
        listEnabled: () => window.electronAPI.getEnabledWorkflows(),
        listByType: (workflowType) =>
          window.electronAPI.getWorkflowsByType(workflowType),
      },

      hooks: {
        list: () => window.electronAPI.listHookModules(),
        get: (id) => window.electronAPI.getHookModule(id),
        create: (module) => window.electronAPI.createHookModule(module),
        update: (id, updates) =>
          window.electronAPI.updateHookModule(id, updates),
        delete: (id) => window.electronAPI.deleteHookModule(id),
        execute: (id, context) =>
          window.electronAPI.executeHookModule(id, context),
        import: (module) => window.electronAPI.importHookModule(module),
        validate: (script) => window.electronAPI.validateHookScript(script),
      },
    };

    // projects 域
    this.projects = {
      list: () => window.electronAPI.listProjects(),
      create: (input) => window.electronAPI.createProject(input),
      update: (id, updates) => window.electronAPI.updateProject(id, updates),
      delete: (id) => window.electronAPI.deleteProject(id),
    };

  }
}

export const electronPlatformAPI = new ElectronPlatformAPI();
