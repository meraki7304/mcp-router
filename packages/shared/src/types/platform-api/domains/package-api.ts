/**
 * Package management domain API (includes system utilities)
 */

import type { ServerPackageUpdates } from "../../mcp-app-types";
import type { Unsubscribe } from "./auth-api";

type PackageManager = "pnpm" | "uvx";
type Platform = "darwin" | "win32" | "linux";

interface ResolveResult {
  success: boolean;
  resolvedArgs?: string;
  error?: string;
}

interface UpdateResult {
  success: boolean;
  updates?: ServerPackageUpdates;
  error?: string;
}

interface ManagerStatus {
  node: boolean;
  pnpm: boolean;
  uv: boolean;
}

interface InstallResult {
  success: boolean;
  installed: ManagerStatus;
  errors?: {
    node?: string;
    pnpm?: string;
    uv?: string;
  };
}

type UpdateCheckStatus =
  | "no-update"
  | "downloading"
  | "downloaded"
  | "error"
  | "skipped";

interface UpdateInfo {
  /** 是否有已下载完成、等待重启安装的更新 */
  updateAvailable: boolean;
  /** 本次检查的结果状态 */
  status: UpdateCheckStatus;
  /** 当前运行的应用版本 */
  currentVersion: string;
  /** 远端发现的最新版本（与当前一致或检查失败时可能为空） */
  latestVersion?: string;
  /** 发现的更新发布说明（若 release 提供） */
  releaseNotes?: string;
  /** 检查失败 / skipped 时的提示信息 */
  error?: string;
}

export interface PackageAPI {
  // Package management
  resolveVersions(
    argsString: string,
    manager: PackageManager,
  ): Promise<ResolveResult>;
  checkUpdates(args: string[], manager: PackageManager): Promise<UpdateResult>;
  checkManagers(): Promise<ManagerStatus>;
  installManagers(): Promise<InstallResult>;

  // System utilities
  system: {
    getPlatform(): Promise<Platform>;
    checkCommand(command: string): Promise<boolean>;
    restartApp(): Promise<boolean>;
    checkForUpdates(): Promise<UpdateInfo>;
    installUpdate(): Promise<boolean>;
    onUpdateAvailable(callback: (available: boolean) => void): Unsubscribe;
    onProtocolUrl(callback: (url: string) => void): Unsubscribe;
  };
}
