import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@mcp_router/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mcp_router/ui";
import { Switch } from "@mcp_router/ui";
import { useThemeStore } from "@/renderer/stores";
import { electronPlatformAPI as platformAPI } from "../../platform-api/electron-platform-api";

const Settings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState<boolean>(true);
  const [showWindowOnStartup, setShowWindowOnStartup] = useState<boolean>(true);
  const [lightweightMode, setLightweightMode] = useState<boolean>(false);
  const [serverIdleStopMinutes, setServerIdleStopMinutes] =
    useState<number>(0);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const { theme, setTheme } = useThemeStore();

  const handleLanguageChange = (value: string) => {
    i18n.changeLanguage(value);
  };

  const getCurrentLanguage = () => {
    const currentLang = i18n.language;
    if (currentLang.startsWith("en")) return "en";
    if (currentLang.startsWith("zh")) return "zh";
    return "zh";
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await platformAPI.settings.get();
        setAutoUpdateEnabled(settings.autoUpdateEnabled ?? true);
        setShowWindowOnStartup(settings.showWindowOnStartup ?? true);
        setLightweightMode(settings.lightweightMode ?? false);
        setServerIdleStopMinutes(settings.serverIdleStopMinutes ?? 0);
      } catch {
        console.log("Failed to load settings, using defaults");
      }
    };
    loadSettings();
  }, []);

  const handleAutoUpdateToggle = async (checked: boolean) => {
    setAutoUpdateEnabled(checked);
    setIsSavingSettings(true);
    try {
      const currentSettings = await platformAPI.settings.get();
      await platformAPI.settings.save({
        ...currentSettings,
        autoUpdateEnabled: checked,
      });
    } catch (error) {
      console.error("Failed to save auto update settings:", error);
      setAutoUpdateEnabled(!checked);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleStartupVisibilityToggle = async (checked: boolean) => {
    setShowWindowOnStartup(checked);
    setIsSavingSettings(true);
    try {
      const currentSettings = await platformAPI.settings.get();
      await platformAPI.settings.save({
        ...currentSettings,
        showWindowOnStartup: checked,
      });
    } catch (error) {
      console.error("Failed to save startup visibility settings:", error);
      setShowWindowOnStartup(!checked);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleLightweightModeToggle = async (checked: boolean) => {
    setLightweightMode(checked);
    setIsSavingSettings(true);
    try {
      const currentSettings = await platformAPI.settings.get();
      await platformAPI.settings.save({
        ...currentSettings,
        lightweightMode: checked,
      });
    } catch (error) {
      console.error("Failed to save lightweight mode setting:", error);
      setLightweightMode(!checked);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleIdleStopChange = async (value: string) => {
    const minutes = Number.parseInt(value, 10) || 0;
    setServerIdleStopMinutes(minutes);
    setIsSavingSettings(true);
    try {
      const currentSettings = await platformAPI.settings.get();
      await platformAPI.settings.save({
        ...currentSettings,
        serverIdleStopMinutes: minutes,
      });
    } catch (error) {
      console.error("Failed to save server idle stop setting:", error);
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="text-3xl font-bold">{t("common.settings")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("settings.preferences")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-sm font-medium">
                {t("common.language")}
              </label>
            </div>
            <Select
              value={getCurrentLanguage()}
              onValueChange={handleLanguageChange}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("common.language")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-sm font-medium">
                {t("settings.theme")}
              </label>
            </div>
            <Select
              value={theme}
              onValueChange={(value: "light" | "dark" | "system") =>
                setTheme(value)
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("settings.theme")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">
                  {t("settings.themeLight")}
                </SelectItem>
                <SelectItem value="dark">{t("settings.themeDark")}</SelectItem>
                <SelectItem value="system">
                  {t("settings.themeSystem")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-sm font-medium">
                {t("settings.autoUpdate")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("settings.autoUpdateDescription")}
              </p>
            </div>
            <Switch
              checked={autoUpdateEnabled}
              onCheckedChange={handleAutoUpdateToggle}
              disabled={isSavingSettings}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-sm font-medium">
                {t("settings.showWindowOnStartup")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("settings.showWindowOnStartupDescription")}
              </p>
            </div>
            <Switch
              checked={showWindowOnStartup}
              onCheckedChange={handleStartupVisibilityToggle}
              disabled={isSavingSettings}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-sm font-medium">轻量模式</label>
              <p className="text-xs text-muted-foreground">
                关闭主窗口时销毁渲染进程以释放内存（约 100-300 MB），
                从托盘恢复时再重建窗口。适合长时间后台运行场景。
              </p>
            </div>
            <Switch
              checked={lightweightMode}
              onCheckedChange={handleLightweightModeToggle}
              disabled={isSavingSettings}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-sm font-medium">
                空闲自动停止本地服务器
              </label>
              <p className="text-xs text-muted-foreground">
                指定时间内本地 MCP 服务器无请求时自动停止子进程，
                下次请求时按需冷启动（约 200-1000ms 延迟）。仅对本地 stdio 服务器生效。
              </p>
            </div>
            <Select
              value={String(serverIdleStopMinutes)}
              onValueChange={handleIdleStopChange}
              disabled={isSavingSettings}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">禁用（保持常驻）</SelectItem>
                <SelectItem value="5">5 分钟后</SelectItem>
                <SelectItem value="10">10 分钟后</SelectItem>
                <SelectItem value="30">30 分钟后</SelectItem>
                <SelectItem value="60">60 分钟后</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Settings;
