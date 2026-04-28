/**
 * Tauri 渲染端根组件：HashRouter + PlatformAPIProvider + 标题栏 + 主区。
 *
 * 等价于老 renderer.tsx 的布局：HashRouter 提供路由上下文（Sidebar/路由组件依赖），
 * TitleBar 占顶部条，下面是主区域挂 legacy App。i18n 在此处 side-effect 初始化。
 */

import "./lib/i18n";

import { HashRouter } from "react-router-dom";

import LegacyApp from "./components/App";
import { PlatformAPIProvider } from "./platform-api/platform-api-context";
import { tauriPlatformAPI } from "./platform-api/tauri-platform-api";

export default function App() {
  return (
    <PlatformAPIProvider platformAPI={tauriPlatformAPI}>
      <HashRouter>
        <div className="h-screen flex flex-col">
          <div className="flex-1 overflow-hidden">
            <LegacyApp />
          </div>
        </div>
      </HashRouter>
    </PlatformAPIProvider>
  );
}
