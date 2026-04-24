import { ipcMain } from "electron";
import { getWorkspaceService } from "@/main/modules/workspace/workspace.service";
import type { WorkspaceCreateConfig } from "@mcp_router/shared";

export function setupWorkspaceHandlers(): void {
  ipcMain.handle("workspace:list", async () => {
    return getWorkspaceService().list();
  });

  ipcMain.handle(
    "workspace:create",
    async (_, config: WorkspaceCreateConfig) => {
      return getWorkspaceService().create(config);
    },
  );

  ipcMain.handle("workspace:update", async (_, id: string, updates: any) => {
    await getWorkspaceService().update(id, updates);
    return { success: true };
  });

  ipcMain.handle("workspace:delete", async (_, id: string) => {
    await getWorkspaceService().delete(id);
    return { success: true };
  });

  ipcMain.handle("workspace:switch", async (_, workspaceId: string) => {
    await getWorkspaceService().switchWorkspace(workspaceId);

    return { success: true };
  });

  ipcMain.handle("workspace:current", async () => {
    return getWorkspaceService().getActiveWorkspace();
  });

  ipcMain.handle(
    "workspace:get-credentials",
    async (_, workspaceId: string) => {
      const token =
        await getWorkspaceService().getWorkspaceCredentials(workspaceId);
      return { token };
    },
  );
}
