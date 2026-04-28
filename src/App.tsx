/**
 * Tauri 渲染端根组件：包一层 PlatformAPIProvider 后挂 legacy App。
 *
 * Plan 9a 桥接：i18n 在此处做 side-effect 初始化；platformAPI 注入 React Context。
 */

import "./lib/i18n";

import LegacyApp from "./components/App";
import { PlatformAPIProvider } from "./platform-api/platform-api-context";
import { tauriPlatformAPI } from "./platform-api/tauri-platform-api";

export default function App() {
  return (
    <PlatformAPIProvider platformAPI={tauriPlatformAPI}>
      <LegacyApp />
    </PlatformAPIProvider>
  );
}
