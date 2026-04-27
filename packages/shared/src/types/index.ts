// Re-export all domain types
export * from "./mcp-types";
export * from "./log-types";
export * from "./mcp-app-types";
export * from "./pagination";
export * from "./settings-types";
export * from "./token-types";
export * from "./workspace";
export * from "./project-types";
export * from "./tool-catalog-types";
export * from "./activity-types";

// Re-export organized domain types
export * from "./ui";
export * from "./database";
// Export platform-api types except LogEntry to avoid conflict.
// 用 `export type` 让 vite/rollup 的 esbuild 跳过对 re-export 链（platform-api/index.ts 内部走 `export *` 通配）的静态校验。
export type {
  // 通用工具类型
  Unsubscribe,
  // Server API
  ServerAPI,
  ServerStatus,
  CreateServerInput,
  // App API
  AppAPI,
  // Package API
  PackageAPI,
  // Settings API
  SettingsAPI,
  // Log API
  LogAPI,
  LogQueryOptions,
  LogQueryResult,
  // Projects API
  ProjectsAPI,
  // Workflow API
  WorkflowAPI,
  // Main Platform API
  PlatformAPI,
} from "./platform-api";
export type { LogEntry as PlatformLogEntry } from "./platform-api";
export * from "./mcp-apps";
export * from "./utils";
export * from "./workflow-types";
export * from "./shared-config";
