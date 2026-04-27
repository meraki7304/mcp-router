import { ipcMain, app } from "electron";
import { autoUpdater } from "electron-updater";
import { commandExists } from "@/main/utils/env-utils";
import { mainWindow } from "@/main";

let isUpdateAvailable = false;
let isAutoUpdateInProgress = false;

// 监听 autoUpdater 事件
autoUpdater.on("update-downloaded", () => {
  isUpdateAvailable = true;
  // 通知渲染进程有可用更新
  if (mainWindow) {
    mainWindow.webContents.send("update:downloaded", true);
  }
});

export function setupSystemHandlers(): void {
  // 系统信息与命令
  ipcMain.handle("system:getPlatform", () => {
    return process.platform;
  });

  // 检查命令是否存在于用户 shell 环境中
  ipcMain.handle("system:commandExists", async (_, command: string) => {
    const result = await commandExists(command);
    return result;
  });

  // 更新管理：手动触发一次 autoUpdater.checkForUpdates 并返回当前状态
  ipcMain.handle("system:checkForUpdates", async () => {
    const currentVersion = app.getVersion();

    // 未打包（dev 模式）下 autoUpdater 不会真的工作
    if (!app.isPackaged) {
      return {
        updateAvailable: false,
        status: "skipped" as const,
        currentVersion,
        error: "开发模式不支持检查更新",
      };
    }

    // 已经检测到更新且下载完成，等待用户重启
    if (isUpdateAvailable) {
      return {
        updateAvailable: true,
        status: "downloaded" as const,
        currentVersion,
      };
    }

    try {
      const result = await autoUpdater.checkForUpdates();
      const latest = result?.updateInfo?.version;
      if (!latest || latest === currentVersion) {
        return {
          updateAvailable: false,
          status: "no-update" as const,
          currentVersion,
          latestVersion: latest,
        };
      }
      const releaseNotes =
        typeof result?.updateInfo?.releaseNotes === "string"
          ? result.updateInfo.releaseNotes
          : undefined;
      // autoDownload=true 时 checkForUpdates 已经在后台开始下载，
      // 完成后会触发 update-downloaded 事件，UI 通过 onUpdateAvailable 收到通知
      return {
        updateAvailable: false,
        status: "downloading" as const,
        currentVersion,
        latestVersion: latest,
        releaseNotes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        updateAvailable: isUpdateAvailable,
        status: "error" as const,
        currentVersion,
        error: message,
      };
    }
  });

  ipcMain.handle("system:installUpdate", () => {
    if (isUpdateAvailable) {
      isAutoUpdateInProgress = true;
      autoUpdater.quitAndInstall();
      app.quit();
      return true;
    }
    return false;
  });

  // 应用重启
  ipcMain.handle("system:restartApp", () => {
    app.quit();
    return true;
  });
}

export function getIsAutoUpdateInProgress(): boolean {
  return isAutoUpdateInProgress;
}
