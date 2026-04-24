import { ipcMain } from "electron";
import {
  listMcpApps,
  updateAppServerAccess,
  addApp,
  deleteCustomApp,
} from "./mcp-apps-manager.service";
import type { TokenServerAccess } from "@mcp_router/shared";

export function setupMcpAppsHandlers(): void {
  ipcMain.handle("mcp-apps:list", async () => {
    try {
      return await listMcpApps();
    } catch (error) {
      console.error("Failed to list MCP apps:", error);
      return [];
    }
  });

  ipcMain.handle("mcp-apps:delete", async (_, appName: string) => {
    try {
      return await deleteCustomApp(appName);
    } catch (error) {
      console.error(`Failed to delete app ${appName}:`, error);
      return false;
    }
  });

  ipcMain.handle("mcp-apps:add", async (_, appName: string) => {
    try {
      return await addApp(appName);
    } catch (error) {
      console.error(`Failed to add app ${appName}:`, error);
      return {
        success: false,
        message: `Error adding app ${appName}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  ipcMain.handle(
    "mcp-apps:update-server-access",
    async (_, appName: string, serverAccess: TokenServerAccess) => {
      try {
        return await updateAppServerAccess(appName, serverAccess);
      } catch (error) {
        console.error(`Failed to update server access for ${appName}:`, error);
        return {
          success: false,
          message: `Error updating server access for ${appName}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  );
}
