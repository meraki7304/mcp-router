import { app, nativeTheme } from "electron";
import { AppSettings, Theme } from "@mcp_router/shared";
import { SingletonService } from "../singleton-service";
import { SettingsRepository } from "./settings.repository";

/**
 * Service for managing application settings
 */
export class SettingsService extends SingletonService<
  AppSettings,
  string,
  SettingsService
> {
  /**
   * Constructor
   */
  protected constructor() {
    super();
  }

  /**
   * Get entity name
   */
  protected getEntityName(): string {
    return "Settings";
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SettingsService {
    return (this as any).getInstanceBase();
  }

  /**
   * Reset instance
   * Used when switching workspaces
   */
  public static resetInstance(): void {
    (this as any).resetInstanceBase(SettingsService);
  }

  public getSettings(): AppSettings {
    try {
      return SettingsRepository.getInstance().getSettings();
    } catch (error) {
      return this.handleError("获取设置", error);
    }
  }

  public saveSettings(settings: AppSettings): boolean {
    try {
      const result = SettingsRepository.getInstance().saveSettings(settings);
      if (result) {
        applyLoginItemSettings(settings.showWindowOnStartup ?? true);
        applyThemeSettings(settings.theme);
        // 通过动态 import 让设置即时生效，避免与 main.ts 形成顶层循环依赖
        import("../../../main")
          .then((mod) => {
            mod.applyServerIdleStopMinutes(settings.serverIdleStopMinutes ?? 0);
            mod.applyMaxRequestLogRows(settings.maxRequestLogRows ?? 50000);
          })
          .catch((err) =>
            console.error(
              "Failed to apply runtime settings after save:",
              err,
            ),
          );
      }
      return result;
    } catch (error) {
      return this.handleError("保存设置", error, false);
    }
  }
}

export function getSettingsService(): SettingsService {
  return SettingsService.getInstance();
}

export function applyLoginItemSettings(showWindowOnStartup: boolean): void {
  try {
    const loginItemOptions: Electron.Settings = {
      openAtLogin: true,
    };

    if (process.platform === "darwin") {
      loginItemOptions.openAsHidden = !showWindowOnStartup;
    } else if (process.platform === "win32") {
      loginItemOptions.args = showWindowOnStartup ? [] : ["--hidden"];
    }

    app.setLoginItemSettings(loginItemOptions);
  } catch (error) {
    console.error("Failed to update login item settings:", error);
  }
}

export function applyThemeSettings(theme?: Theme): void {
  try {
    nativeTheme.themeSource = theme ?? "system";
  } catch (error) {
    console.error("Failed to update native theme:", error);
  }
}
