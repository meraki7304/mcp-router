/**
 * Tauri 专用的 PlatformAPI 实现。
 *
 * 通过 invoke 调 src-tauri 的 #[tauri::command]，并在 ts-rs 自动生成的后端类型
 * （snake_case，bigint 等）与渲染端旧 PlatformAPI 类型（camelCase）之间做形状转换。
 *
 * 后端尚未提供等价命令的方法（绝大多数 apps.* / packages.*）以哨兵值返回；
 * 这些将在 Plan 9b（packages/apps stub）与 Plan 10（updater/protocol-url）填齐。
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import type { PlatformAPI } from "../types/platform-api/platform-api";
import type {
  ServerAPI,
  ServerStatus as RendererServerStatus,
} from "../types/platform-api/domains/server-api";
import type { AppAPI } from "../types/platform-api/domains/app-api";
import type { PackageAPI } from "../types/platform-api/domains/package-api";
import type { SettingsAPI } from "../types/platform-api/domains/settings-api";
import type {
  LogAPI,
  LogQueryOptions,
  LogQueryResult,
} from "../types/platform-api/domains/log-api";
import type { WorkflowAPI } from "../types/platform-api/domains/workflow-api";
import type { ProjectsAPI } from "../types/platform-api/domains/projects-api";

import type {
  MCPServer,
  MCPServerConfig,
  MCPInputParam,
} from "../types/mcp-types";
import type { RequestLogEntry } from "../types/log-types";
import type { Project as RendererProject } from "../types/project-types";
import type {
  WorkflowDefinition,
  HookModule as RendererHookModule,
} from "../types/workflow-types";
import type { AppSettings as RendererAppSettings } from "../types/settings-types";

import type { Server as BackendServer } from "../types/generated/Server";
import type { ServerStatus as BackendServerStatus } from "../types/generated/ServerStatus";
import type { NewServer } from "../types/generated/NewServer";
import type { ServerPatch } from "../types/generated/ServerPatch";
import type { Token as BackendToken } from "../types/generated/Token";
import type { Project as BackendProject } from "../types/generated/Project";
import type { NewProject } from "../types/generated/NewProject";
import type { ProjectPatch } from "../types/generated/ProjectPatch";
import type { Workflow as BackendWorkflow } from "../types/generated/Workflow";
import type { NewWorkflow } from "../types/generated/NewWorkflow";
import type { WorkflowPatch } from "../types/generated/WorkflowPatch";
import type { HookModule as BackendHookModule } from "../types/generated/HookModule";
import type { NewHookModule } from "../types/generated/NewHookModule";
import type { HookModulePatch } from "../types/generated/HookModulePatch";
import type { RequestLog as BackendRequestLog } from "../types/generated/RequestLog";
import type { RequestLogPage } from "../types/generated/RequestLogPage";
import type { RequestLogCursor } from "../types/generated/RequestLogCursor";
import type { AppSettings as BackendAppSettings } from "../types/generated/AppSettings";

// ---------- 工具函数：bigint / 时间戳 ----------

function asNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "bigint" ? Number(value) : value;
}

function isoToMillis(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

// ---------- Reshape：Server (backend) -> MCPServer (renderer) ----------

function backendServerToRenderer(s: BackendServer): MCPServer {
  // server_type："local"/"remote" 直接对应；renderer 还有 "remote-streamable"
  // 但后端目前只跟踪 "local"/"remote"，保持原样。
  const serverType = s.server_type as MCPServerConfig["serverType"];

  // input_params: backend 是 unknown（serde JSON），尝试当作 Record<string, MCPInputParam>。
  let inputParams: Record<string, MCPInputParam> | undefined;
  if (s.input_params && typeof s.input_params === "object") {
    inputParams = s.input_params as Record<string, MCPInputParam>;
  }

  // verification_status: backend 为 string|null；renderer 限定 "verified"|"unverified"
  let verificationStatus: MCPServerConfig["verificationStatus"];
  if (s.verification_status === "verified") verificationStatus = "verified";
  else if (s.verification_status === "unverified")
    verificationStatus = "unverified";

  return {
    id: s.id,
    name: s.name,
    serverType,
    description: s.description ?? undefined,
    version: s.version ?? undefined,
    latestVersion: s.latest_version ?? undefined,
    verificationStatus,
    command: s.command ?? undefined,
    args: s.args,
    env: s.env as Record<string, string>,
    remoteUrl: s.remote_url ?? undefined,
    bearerToken: s.bearer_token ?? undefined,
    autoStart: s.auto_start,
    disabled: s.disabled,
    inputParams,
    required: s.required_params,
    toolPermissions: s.tool_permissions as Record<string, boolean>,
    projectId: s.project_id,
    // status 在 MCPServer 上是扁平字符串；初始 stopped，list/get 会单独 fan-out
    // 调 servers_get_status 把活状态写回。
    status: "stopped",
  };
}

// kind ("Stopped"/"Starting"/"Running"/"Failed") → MCPServer.status 字符串
function backendStatusKindToMcpServerStatus(
  kind: BackendServerStatus["kind"],
): MCPServer["status"] {
  switch (kind) {
    case "Stopped":
      return "stopped";
    case "Starting":
      return "starting";
    case "Running":
      return "running";
    case "Failed":
      return "error";
  }
}

// 给一批 backend Server 行批量补 live status；用 Promise.all fan-out
async function attachLiveStatus(rows: BackendServer[]): Promise<MCPServer[]> {
  return Promise.all(
    rows.map(async (row) => {
      const out = backendServerToRenderer(row);
      try {
        const backendStatus = await invoke<BackendServerStatus>(
          "servers_get_status",
          { id: row.id },
        );
        out.status = backendStatusKindToMcpServerStatus(backendStatus.kind);
      } catch {
        // 保持默认 stopped
      }
      return out;
    }),
  );
}

function rendererStatusFromBackend(
  s: BackendServerStatus,
): RendererServerStatus {
  switch (s.kind) {
    case "Stopped":
      return { type: "stopped" };
    case "Starting":
      return { type: "starting" };
    case "Running":
      return { type: "running" };
    case "Failed":
      return { type: "error", error: s.message };
  }
}

// MCPServerConfig (Partial) → ServerPatch
function configPatchToBackend(
  updates: Partial<MCPServerConfig>,
): Record<string, unknown> {
  // 后端 ServerPatch 的字段是 snake_case；缺省字段保持 null。
  // 注意 input_params / required_params / tool_permissions 等。
  const patch: Record<string, unknown> = {
    name: updates.name ?? null,
    description: updates.description ?? null,
    version: updates.version ?? null,
    latest_version: updates.latestVersion ?? null,
    verification_status: updates.verificationStatus ?? null,
    command: updates.command ?? null,
    args: updates.args ?? null,
    env: updates.env ?? null,
    context_path: null, // renderer 没暴露
    remote_url: updates.remoteUrl ?? null,
    bearer_token: updates.bearerToken ?? null,
    auto_start: updates.autoStart ?? null,
    disabled: updates.disabled ?? null,
    auto_approve: null,
    required_params: updates.required ?? null,
    tool_permissions: updates.toolPermissions ?? null,
    project_id: updates.projectId ?? null,
  };
  if (updates.inputParams !== undefined) {
    patch.input_params = updates.inputParams;
  }
  return patch;
}

function configToNewServer(config: MCPServerConfig): NewServer {
  return {
    name: config.name,
    server_type: (config.serverType ?? "local") as NewServer["server_type"],
    description: config.description ?? null,
    command: config.command ?? null,
    args: config.args ?? [],
    env: config.env ?? {},
    context_path: null,
    remote_url: config.remoteUrl ?? null,
    bearer_token: config.bearerToken ?? null,
    auto_start: config.autoStart ?? false,
    disabled: config.disabled ?? false,
    auto_approve: null,
    input_params: config.inputParams ?? null,
    required_params: config.required ?? [],
    tool_permissions: config.toolPermissions ?? {},
    project_id: config.projectId ?? null,
  };
}

// ---------- Project ----------

function backendProjectToRenderer(p: BackendProject): RendererProject {
  return {
    id: p.id,
    name: p.name,
    optimization: (p.optimization ?? null) as RendererProject["optimization"],
    createdAt: isoToMillis(p.created_at),
    updatedAt: isoToMillis(p.updated_at),
  };
}

// ---------- Workflow ----------

function backendWorkflowToRenderer(w: BackendWorkflow): WorkflowDefinition {
  return {
    id: w.id,
    name: w.name,
    description: w.description ?? undefined,
    workflowType:
      (w.workflow_type as WorkflowDefinition["workflowType"]) ?? "tools/list",
    nodes: (w.nodes as WorkflowDefinition["nodes"]) ?? [],
    edges: (w.edges as WorkflowDefinition["edges"]) ?? [],
    enabled: w.enabled,
    createdAt: isoToMillis(w.created_at),
    updatedAt: isoToMillis(w.updated_at),
  };
}

function rendererWorkflowToNew(
  wf: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">,
): NewWorkflow {
  return {
    name: wf.name,
    description: wf.description ?? null,
    workflow_type: wf.workflowType ?? null,
    nodes: wf.nodes as unknown[],
    edges: wf.edges as unknown[],
    enabled: wf.enabled,
  };
}

function rendererWorkflowToPatch(
  updates: Partial<Omit<WorkflowDefinition, "id" | "createdAt">>,
): WorkflowPatch {
  const patch: WorkflowPatch = {
    name: updates.name ?? null,
    description: updates.description ?? null,
    workflow_type: updates.workflowType ?? null,
    enabled: updates.enabled ?? null,
  };
  if (updates.nodes !== undefined) patch.nodes = updates.nodes as unknown[];
  if (updates.edges !== undefined) patch.edges = updates.edges as unknown[];
  return patch;
}

// ---------- Hook Module ----------

function backendHookToRenderer(h: BackendHookModule): RendererHookModule {
  return { id: h.id, name: h.name, script: h.script };
}

function rendererHookToNew(
  m: Omit<RendererHookModule, "id">,
): NewHookModule {
  return { name: m.name, script: m.script };
}

function rendererHookToPatch(
  updates: Partial<Omit<RendererHookModule, "id">>,
): HookModulePatch {
  return {
    name: updates.name ?? null,
    script: updates.script ?? null,
  };
}

// ---------- Settings ----------

function backendSettingsToRenderer(
  s: BackendAppSettings,
): RendererAppSettings {
  return {
    userId: s.userId ?? undefined,
    packageManagerOverlayDisplayCount:
      s.packageManagerOverlayDisplayCount ?? undefined,
    autoUpdateEnabled: s.autoUpdateEnabled ?? undefined,
    showWindowOnStartup: s.showWindowOnStartup ?? undefined,
    theme: s.theme ?? undefined,
    lightweightMode: s.lightweightMode ?? undefined,
    serverIdleStopMinutes: s.serverIdleStopMinutes ?? undefined,
    maxRequestLogRows:
      s.maxRequestLogRows !== null && s.maxRequestLogRows !== undefined
        ? Number(s.maxRequestLogRows)
        : undefined,
  };
}

function rendererSettingsToBackend(
  s: RendererAppSettings,
): BackendAppSettings {
  return {
    userId: s.userId ?? null,
    packageManagerOverlayDisplayCount:
      s.packageManagerOverlayDisplayCount ?? null,
    autoUpdateEnabled: s.autoUpdateEnabled ?? null,
    showWindowOnStartup: s.showWindowOnStartup ?? null,
    theme: s.theme ?? null,
    lightweightMode: s.lightweightMode ?? null,
    serverIdleStopMinutes: s.serverIdleStopMinutes ?? null,
    maxRequestLogRows:
      s.maxRequestLogRows !== undefined && s.maxRequestLogRows !== null
        ? (BigInt(s.maxRequestLogRows) as unknown as bigint)
        : null,
  };
}

// ---------- Logs ----------

/** MCP 规范方法名 → 渲染端 ActivityType 别名。后端写的是 spec method
 *  ("tools/call" 等)，前端 useActivityData 的 ACTIVITY_TYPES 用 PascalCase 别名
 *  ("CallTool" 等) 过滤——必须映射否则全部被滤掉，活动日志页空白。 */
function mapRequestTypeToActivity(raw?: string | null): string {
  if (!raw) return "";
  switch (raw) {
    case "tools/call":
      return "CallTool";
    case "tools/list":
      return "ToolDiscovery";
    case "tools/execute":
      return "ToolExecute";
    case "prompts/get":
      return "GetPrompt";
    case "resources/read":
      return "ReadResource";
    default:
      return raw;
  }
}

function backendRequestLogToRenderer(r: BackendRequestLog): RequestLogEntry {
  return {
    id: r.id,
    timestamp: isoToMillis(r.timestamp),
    clientId: r.client_id ?? "",
    clientName: r.client_name ?? "",
    serverId: r.server_id ?? "",
    serverName: r.server_name ?? "",
    requestType: mapRequestTypeToActivity(r.request_type),
    requestParams: r.request_params,
    responseData: r.response_data,
    responseStatus: (r.response_status === "error"
      ? "error"
      : "success") as RequestLogEntry["responseStatus"],
    duration: asNumber(r.duration_ms),
    errorMessage: r.error_message ?? undefined,
  };
}

function decodeLogCursor(cursor?: string): RequestLogCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(atob(cursor));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.timestamp === "string" &&
      typeof parsed.id === "string"
    ) {
      return { timestamp: parsed.timestamp, id: parsed.id };
    }
  } catch {
    /* malformed cursor — 当作空 */
  }
  return null;
}

function encodeLogCursor(cursor: RequestLogCursor | null): string | undefined {
  if (!cursor) return undefined;
  return btoa(
    JSON.stringify({ timestamp: cursor.timestamp, id: cursor.id }),
  );
}

// ---------- TauriPlatformAPI ----------

class TauriPlatformAPI implements PlatformAPI {
  servers: ServerAPI = {
    list: async () => {
      const rows: BackendServer[] = await invoke("servers_list");
      return attachLiveStatus(rows);
    },
    listTools: async (id) => {
      const tools: unknown[] = await invoke("servers_list_tools", { id });
      // 后端返回 Vec<Value>；按结构推断字段
      return tools.map((t) => {
        const obj = (t ?? {}) as Record<string, unknown>;
        return {
          name: String(obj.name ?? ""),
          description:
            typeof obj.description === "string" ? obj.description : undefined,
          inputSchema: obj.inputSchema ?? obj.input_schema,
        };
      });
    },
    get: async (id) => {
      const row: BackendServer | null = await invoke("servers_get", { id });
      if (!row) return null;
      const [withStatus] = await attachLiveStatus([row]);
      return withStatus;
    },
    create: async (input) => {
      if (!input.config) {
        throw new Error("servers.create: 缺少 config");
      }
      const row: BackendServer = await invoke("servers_create", {
        input: configToNewServer(input.config),
      });
      return backendServerToRenderer(row);
    },
    update: async (id, updates) => {
      const row: BackendServer = await invoke("servers_update", {
        id,
        patch: configPatchToBackend(updates),
      });
      return backendServerToRenderer(row);
    },
    updateToolPermissions: async (id, permissions) => {
      const row: BackendServer = await invoke("servers_update", {
        id,
        patch: configPatchToBackend({ toolPermissions: permissions }),
      });
      return backendServerToRenderer(row);
    },
    delete: async (id) => {
      await invoke<boolean>("servers_delete", { id });
    },
    start: async (id) => {
      await invoke("servers_start", { id });
      return true;
    },
    stop: async (id) => {
      const ok = await invoke<boolean>("servers_stop", { id });
      return ok;
    },
    getStatus: async (id) => {
      const status: BackendServerStatus = await invoke("servers_get_status", {
        id,
      });
      return rendererStatusFromBackend(status);
    },
    selectFile: async (options) => {
      try {
        const path = await openDialog({
          title: options?.title,
          directory: options?.mode === "directory",
          filters: options?.filters,
          multiple: false,
        });
        if (path === null || path === undefined) {
          return { success: false, canceled: true };
        }
        return { success: true, path: String(path) };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  };

  apps: AppAPI = {
    // apps.* 用 tokens 作为底层存储：每个 App 名一一对应一个 Token (clientId == app name)。
    // 没有 OS 级配置文件集成（installed/configPath 为占位）；真整合 (Claude Desktop / Cursor 等
    // 配置写入) 留给后续 plan。
    list: async () => {
      const rows: BackendToken[] = await invoke("tokens_list");
      return rows.map((t) => ({
        name: t.clientId,
        installed: true,
        configPath: "",
        configured: true,
        token: t.id,
        serverAccess: t.serverAccess as Record<string, boolean>,
        isCustom: true,
        hasOtherServers: false,
      }));
    },
    create: async (appName) => {
      const id = (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `tok_${Date.now()}_${Math.floor(Math.random() * 1e9)}`) as string;
      const token: BackendToken = {
        id,
        clientId: appName,
        issuedAt: Date.now() as unknown as bigint,
        serverAccess: {},
      };
      await invoke("tokens_save", { token });
      return {
        success: true,
        message: `App "${appName}" 创建成功`,
        app: {
          name: appName,
          installed: true,
          configPath: "",
          configured: true,
          token: id,
          serverAccess: {},
          isCustom: true,
          hasOtherServers: false,
        },
      };
    },
    delete: async (appName) => {
      const removed: number = await invoke("tokens_delete_client", {
        clientId: appName,
      });
      return removed > 0;
    },
    updateServerAccess: async (appName, serverAccess) => {
      // 找到该 client 的所有 token，逐个更新（通常一个 client 一个 token）
      const rows: BackendToken[] = await invoke("tokens_list");
      const matches = rows.filter((t) => t.clientId === appName);
      if (matches.length === 0) {
        return {
          success: false,
          message: `App "${appName}" 未找到`,
        };
      }
      for (const t of matches) {
        await invoke<boolean>("tokens_update_server_access", {
          id: t.id,
          serverAccess,
        });
      }
      return {
        success: true,
        message: `App "${appName}" 服务器访问权限已更新`,
        app: {
          name: appName,
          installed: true,
          configPath: "",
          configured: true,
          token: matches[0].id,
          serverAccess,
          isCustom: true,
          hasOtherServers: false,
        },
      };
    },

    tokens: {
      list: async () => {
        const rows: BackendToken[] = await invoke("tokens_list");
        return rows.map((t) => ({
          id: t.id,
          name: t.clientId,
          createdAt: new Date(Number(t.issuedAt)),
        }));
      },
      generate: async (options) => {
        // randomUUID 现代 WebView2 支持
        const id = (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `tok_${Date.now()}_${Math.floor(Math.random() * 1e9)}`) as string;
        const token: BackendToken = {
          id,
          clientId: options.name,
          issuedAt: Date.now() as unknown as bigint,
          serverAccess: {},
        };
        await invoke("tokens_save", { token });
        return id;
      },
      revoke: async (tokenId) => {
        await invoke<boolean>("tokens_delete", { id: tokenId });
      },
    },
  };

  packages: PackageAPI = {
    // packages.* 在 Tauri 后端尚无对应实现；Plan 9b 提供哨兵默认值。
    resolveVersions: async () => ({
      success: false,
      error: "未实现 (Plan 9b)",
    }),
    checkUpdates: async () => ({
      success: false,
      error: "未实现 (Plan 9b)",
    }),
    checkManagers: async () => ({ node: true, pnpm: false, uv: false }),
    installManagers: async () => ({
      success: false,
      installed: { node: false, pnpm: false, uv: false },
      errors: {},
    }),

    system: {
      getPlatform: async () => "win32",
      checkCommand: async () => false,
      restartApp: async () => {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
        return true;
      },
      checkForUpdates: async () => {
        const { getVersion } = await import("@tauri-apps/api/app");
        const currentVersion = await getVersion();
        try {
          const { check } = await import("@tauri-apps/plugin-updater");
          const update = await check();
          if (!update) {
            return { updateAvailable: false, status: "no-update", currentVersion };
          }
          // 异步下载安装；完成后触发自定义事件，UI 通过 onUpdateAvailable 收到
          void update
            .downloadAndInstall((event) => {
              if (event.event === "Finished") {
                window.dispatchEvent(new CustomEvent("mcp-update-downloaded"));
              }
            })
            .catch((err) => {
              window.dispatchEvent(
                new CustomEvent("mcp-update-error", {
                  detail: err instanceof Error ? err.message : String(err),
                }),
              );
            });
          return {
            updateAvailable: false,
            status: "downloading",
            currentVersion,
            latestVersion: update.version,
            releaseNotes: update.body,
          };
        } catch (err) {
          return {
            updateAvailable: false,
            status: "error",
            currentVersion,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
      installUpdate: async () => {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
        return true;
      },
      onUpdateAvailable: (callback) => {
        const handler = () => callback(true);
        window.addEventListener("mcp-update-downloaded", handler);
        return () => {
          window.removeEventListener("mcp-update-downloaded", handler);
        };
      },
      onProtocolUrl: () => () => {
        /* noop until Plan 10 wires deep-link */
      },
    },
  };

  settings: SettingsAPI = {
    get: async () => {
      const s: BackendAppSettings = await invoke("settings_get");
      return backendSettingsToRenderer(s);
    },
    save: async (settings) => {
      await invoke("settings_update", {
        settings: rendererSettingsToBackend(settings),
      });
      return true;
    },
    incrementOverlayCount: async () => {
      const current: BackendAppSettings = await invoke("settings_get");
      const newCount =
        (current.packageManagerOverlayDisplayCount ?? 0) + 1;
      const next: BackendAppSettings = {
        ...current,
        packageManagerOverlayDisplayCount: newCount,
      };
      await invoke("settings_update", { settings: next });
      return { success: true, count: newCount };
    },
  };

  logs: LogAPI = {
    query: async (options?: LogQueryOptions): Promise<LogQueryResult> => {
      const before = decodeLogCursor(options?.cursor);
      const limit =
        options?.limit && options.limit > 0 && options.limit <= 500
          ? options.limit
          : 50;
      const page: RequestLogPage = await invoke("logs_query", {
        query: {
          before,
          limit,
          server_id: options?.serverId ?? null,
          client_id: options?.clientId ?? null,
          request_type: options?.requestType ?? null,
          response_status: options?.responseStatus ?? null,
        },
      });
      const items = page.items.map(backendRequestLogToRenderer);
      return {
        items,
        logs: items, // 兼容字段
        total: items.length, // 后端未返回总数；以本页大小占位
        nextCursor: encodeLogCursor(page.next_cursor),
        hasMore: page.has_more,
      };
    },
  };

  workflows: WorkflowAPI = {
    workflows: {
      list: async () => {
        const rows: BackendWorkflow[] = await invoke("workflows_list");
        return rows.map(backendWorkflowToRenderer);
      },
      get: async (id) => {
        const row: BackendWorkflow | null = await invoke("workflows_get", {
          id,
        });
        return row ? backendWorkflowToRenderer(row) : null;
      },
      create: async (workflow) => {
        const row: BackendWorkflow = await invoke("workflows_create", {
          input: rendererWorkflowToNew(workflow),
        });
        return backendWorkflowToRenderer(row);
      },
      update: async (id, updates) => {
        const row: BackendWorkflow = await invoke("workflows_update", {
          id,
          patch: rendererWorkflowToPatch(updates),
        });
        return backendWorkflowToRenderer(row);
      },
      delete: async (id) => {
        const ok = await invoke<boolean>("workflows_delete", { id });
        return ok;
      },
      setActive: async (id) => {
        await invoke("workflows_update", {
          id,
          patch: rendererWorkflowToPatch({ enabled: true }),
        });
        return true;
      },
      disable: async (id) => {
        await invoke("workflows_update", {
          id,
          patch: rendererWorkflowToPatch({ enabled: false }),
        });
        return true;
      },
      execute: async (id, context) => {
        return invoke("workflows_execute", {
          id,
          input: context ?? null,
        });
      },
      listEnabled: async () => {
        const rows: BackendWorkflow[] = await invoke("workflows_list_enabled");
        return rows.map(backendWorkflowToRenderer);
      },
      listByType: async (workflowType) => {
        const rows: BackendWorkflow[] = await invoke(
          "workflows_list_by_type",
          { workflowType },
        );
        return rows.map(backendWorkflowToRenderer);
      },
    },

    hooks: {
      list: async () => {
        const rows: BackendHookModule[] = await invoke("hooks_list");
        return rows.map(backendHookToRenderer);
      },
      get: async (id) => {
        const row: BackendHookModule | null = await invoke("hooks_get", {
          id,
        });
        return row ? backendHookToRenderer(row) : null;
      },
      create: async (module) => {
        const row: BackendHookModule = await invoke("hooks_create", {
          input: rendererHookToNew(module),
        });
        return backendHookToRenderer(row);
      },
      update: async (id, updates) => {
        const row: BackendHookModule = await invoke("hooks_update", {
          id,
          patch: rendererHookToPatch(updates),
        });
        return backendHookToRenderer(row);
      },
      delete: async (id) => {
        const ok = await invoke<boolean>("hooks_delete", { id });
        return ok;
      },
      execute: async (id, context) => {
        return invoke("hooks_run", { id, input: context ?? null });
      },
      import: async (module) => {
        const row: BackendHookModule = await invoke("hooks_create", {
          input: rendererHookToNew(module),
        });
        return backendHookToRenderer(row);
      },
      validate: async (script) => {
        try {
          // eslint-disable-next-line no-new-func
          new Function(script);
          return { valid: true };
        } catch (err) {
          const msg =
            err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : String(err);
          return { valid: false, error: msg };
        }
      },
    },
  };

  projects: ProjectsAPI = {
    list: async () => {
      const rows: BackendProject[] = await invoke("projects_list");
      return rows.map(backendProjectToRenderer);
    },
    create: async ({ name }) => {
      const input: NewProject = { name, optimization: null };
      const row: BackendProject = await invoke("projects_create", { input });
      return backendProjectToRenderer(row);
    },
    update: async (id, updates) => {
      const patch: ProjectPatch = {
        name: updates.name ?? null,
        optimization: updates.optimization ?? null,
      };
      const row: BackendProject = await invoke("projects_update", {
        id,
        patch,
      });
      return backendProjectToRenderer(row);
    },
    delete: async (id) => {
      await invoke<boolean>("projects_delete", { id });
    },
  };
}

export const tauriPlatformAPI = new TauriPlatformAPI();

// 兼容 Plan 1 烟测：旧 App.tsx 直接 import { ping }
export async function ping(name: string): Promise<string> {
  return invoke<string>("ping", { name });
}
