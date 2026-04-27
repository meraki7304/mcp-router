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

  // 更新管理
  ipcMain.handle("system:checkForUpdates", () => {
    return {
      updateAvailable: isUpdateAvailable,
    };
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
