/**
 * Tauri 渲染端固定使用本地 TauriPlatformAPI（invoke 翻译层）。
 */

import { tauriPlatformAPI } from "../tauri-platform-api";
import type { PlatformAPI } from "../../types/platform-api/platform-api";

export function usePlatformAPI(): PlatformAPI {
  return tauriPlatformAPI;
}
