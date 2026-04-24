import { AppSettings } from "@mcp_router/shared";
import { getSharedConfigManager } from "../../infrastructure/shared-config-manager";

export class SettingsRepository {
  private static instance: SettingsRepository | null = null;

  private constructor() {
    console.log(
      "[SettingsRepository] Using SharedConfigManager for settings storage",
    );
  }

  public static getInstance(): SettingsRepository {
    if (!SettingsRepository.instance) {
      SettingsRepository.instance = new SettingsRepository();
    }
    return SettingsRepository.instance;
  }

  public static resetInstance(): void {
    SettingsRepository.instance = null;
  }

  public getSettings(): AppSettings {
    return getSharedConfigManager().getSettings();
  }

  public saveSettings(settings: AppSettings): boolean {
    try {
      getSharedConfigManager().saveSettings(settings);
      return true;
    } catch (error) {
      console.error("保存设置失败:", error);
      return false;
    }
  }
}
