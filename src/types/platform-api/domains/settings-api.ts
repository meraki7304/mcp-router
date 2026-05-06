/**
 * Settings management domain API
 */

import type { AppSettings } from "../../settings-types";

interface OverlayCountResult {
  success: boolean;
  count: number;
}

export interface SettingsAPI {
  get(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<boolean>;
  incrementOverlayCount(): Promise<OverlayCountResult>;

  /** 查询当前进程是否已注册到 OS 的开机自启项（以系统状态为准，不依赖 settings 缓存）。 */
  isAutoStartEnabled(): Promise<boolean>;
  /** 注册开机自启（写入 registry / LaunchAgent / autostart desktop）。 */
  enableAutoStart(): Promise<void>;
  /** 注销开机自启。 */
  disableAutoStart(): Promise<void>;
}
