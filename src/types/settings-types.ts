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
   * 开机自启路径下是否显示主窗口（仅在通过 --silent 参数静默拉起时生效）。
   * 手动启动时永远显示窗口，不受此开关影响。
   * 默认：true
   */
  showWindowOnStartup?: boolean;

  /**
   * 是否注册到操作系统的开机自启列表（registry / LaunchAgent / autostart desktop）。
   * 与 showWindowOnStartup 组合：
   *   - autoStartEnabled=true & showWindowOnStartup=true  → 开机时拉起并显示主窗口
   *   - autoStartEnabled=true & showWindowOnStartup=false → 开机时静默后台启动（仅托盘）
   *   - autoStartEnabled=false                            → 不参与开机
   * 默认：false
   */
  autoStartEnabled?: boolean;

  /**
   * 应用主题
   * 默认："system"
   */
  theme?: Theme;

  /**
   * 轻量模式：关闭主窗口时销毁渲染进程以释放内存（约 100-300 MB），
   * 从托盘恢复时再重建。适合长时间后台运行场景。
   * 默认：false
   */
  lightweightMode?: boolean;

  /**
   * 本地 MCP 服务器子进程闲置自动停止的分钟数，
   * 0 表示禁用（保持常驻），大于 0 时若该服务器在指定分钟内无任何请求即停止子进程，
   * 下次请求时按需冷启动。
   * 默认：0
   */
  serverIdleStopMinutes?: number;

  /**
   * 请求日志最大保留行数，启动时和写入时按此上限裁剪最旧的记录。
   * 默认：50000
   */
  maxRequestLogRows?: number;
}

/**
 * 默认应用设置
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  userId: "",
  packageManagerOverlayDisplayCount: 0,
  autoUpdateEnabled: true,
  showWindowOnStartup: true,
  autoStartEnabled: false,
  theme: "system",
  lightweightMode: false,
  serverIdleStopMinutes: 0,
  maxRequestLogRows: 50000,
};
