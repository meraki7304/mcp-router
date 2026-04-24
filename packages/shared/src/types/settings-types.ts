import type { Theme } from "./ui";

/**
 * 应用设置接口
 */
export interface AppSettings {
  /**
   * 匿名用户 ID（本地随机生成，仅用于区分本地数据）
   */
  userId?: string;

  /**
   * 包管理器安装提示层的显示次数
   */
  packageManagerOverlayDisplayCount?: number;

  /**
   * 是否启用自动更新
   * 默认：true
   */
  autoUpdateEnabled?: boolean;

  /**
   * 系统启动时是否显示主窗口
   * 默认：true
   */
  showWindowOnStartup?: boolean;

  /**
   * 应用主题
   * 默认："system"
   */
  theme?: Theme;
}

/**
 * 默认应用设置
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  userId: "",
  packageManagerOverlayDisplayCount: 0,
  autoUpdateEnabled: true,
  showWindowOnStartup: true,
  theme: "system",
};
