import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { getSettingsService } from "@/main/modules/settings/settings.service";
import { isProduction } from "@/main/utils/environment";

/**
 * 启用 electron-updater 的自动更新检查。
 * - 仅在 production + packaged + 用户未关闭 autoUpdate 时启用
 * - 抓住所有错误：未签名 / 无网络 / publish 配置缺失 都不应崩溃主进程
 * - feed 配置走 electron-builder.yml 的 publish 字段，runtime 不需要额外设置
 */
export function setupAutoUpdate(): void {
  try {
    const settings = getSettingsService().getSettings();
    const autoUpdateEnabled = settings.autoUpdateEnabled ?? true;
    const shouldEnable = isProduction() && app.isPackaged && autoUpdateEnabled;

    if (!shouldEnable) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("error", (err) => {
      console.error("[AutoUpdate] error:", err);
    });

    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("[AutoUpdate] checkForUpdatesAndNotify failed:", err);
    });
  } catch (err) {
    console.error("[AutoUpdate] setup failed:", err);
  }
}
