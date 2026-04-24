/**
 * 离线客户端固定使用本地 Electron Platform API。
 */

import { electronPlatformAPI } from "../electron-platform-api";
import type { PlatformAPI } from "@mcp_router/shared";

export function usePlatformAPI(): PlatformAPI {
  return electronPlatformAPI;
}
