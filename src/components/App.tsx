import React, { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import PageLayout from "./layout/PageLayout";
import { Sonner } from "@mcp_router/ui";
import DiscoverWrapper from "@/renderer/components/mcp/server/DiscoverWrapper";
import Home from "./Home";
import { useTranslation } from "react-i18next";
import SidebarComponent from "./Sidebar";
import { SidebarProvider } from "@mcp_router/ui";
import McpAppsManager from "@/renderer/components/mcp/apps/McpAppsManager";
import LogViewer from "@/renderer/components/mcp/log/LogViewer";
import Settings from "./setting/Settings";
import { useServerStore, initializeStores } from "../stores";
import { usePlatformAPI } from "@/renderer/platform-api";
import { IconProgress } from "@tabler/icons-react";
import WorkflowManager from "./workflow/WorkflowManager";

const App: React.FC = () => {
  const { t } = useTranslation();
  const platformAPI = usePlatformAPI();

  const { refreshServers } = useServerStore();
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 初始化所有 store
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await initializeStores();
      } catch (error) {
        console.error("Failed to initialize app:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  // 订阅 protocol URL 事件（当前仅用于主窗口激活/前置）
  useEffect(() => {
    const unsubscribe = platformAPI.packages.system.onProtocolUrl(() => {
      // 离线客户端下暂不处理任何自定义协议动作
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // 首次挂载时刷新服务器列表
  useEffect(() => {
    refreshServers();
  }, [refreshServers]);

  // 每 3 秒轮询一次服务器状态
  useEffect(() => {
    const id = setInterval(() => {
      refreshServers().catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [refreshServers]);

  // 监听后端 server-status-changed 事件，立即刷一次（替代/补充 3 秒轮询）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("server-status-changed", () => {
          refreshServers().catch(() => {});
        });
      } catch (e) {
        console.error("listen server-status-changed failed", e);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshServers]);

  const LoadingIndicator = () => (
    <div className="flex h-full items-center justify-center bg-content-light">
      <div className="text-center">
        <IconProgress className="h-10 w-10 mx-auto animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">{t("common.loading")}</p>
      </div>
    </div>
  );

  if (isLoading) {
    return <LoadingIndicator />;
  }

  return (
    <SidebarProvider defaultOpen={true} className="h-full">
      <Sonner />

      <SidebarComponent />
      <main className="flex flex-col flex-1 w-full min-w-0 overflow-auto">
        <div className="flex flex-col flex-1 pt-2">
          <Routes>
            <Route element={<PageLayout />}>
              <Route path="/" element={<Navigate to="/servers" replace />} />
              <Route path="/servers" element={<Home />} />
              <Route path="/servers/add" element={<DiscoverWrapper />} />
              <Route path="/clients" element={<McpAppsManager />} />
              <Route path="/logs" element={<LogViewer />} />
              <Route
                path="/hooks"
                element={<Navigate to="/workflows" replace />}
              />
              <Route path="/workflows" element={<WorkflowManager />} />
              <Route
                path="/workflows/:workflowId"
                element={<WorkflowManager />}
              />
              <Route path="/settings" element={<Settings />} />
            </Route>

            <Route path="*" element={<Navigate to="/servers" />} />
          </Routes>
        </div>
      </main>
    </SidebarProvider>
  );
};

export default App;
