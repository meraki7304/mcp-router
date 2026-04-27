import React, { useEffect, useState } from "react";
import { Button } from "@mcp_router/ui";
import { usePlatformAPI } from "@/renderer/platform-api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@mcp_router/ui";
import { useTranslation } from "react-i18next";
import { Input } from "@mcp_router/ui";
import { Checkbox } from "@mcp_router/ui";
import { Label } from "@mcp_router/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@mcp_router/ui";
import { toast } from "sonner";
import { ScrollArea, ScrollBar } from "@mcp_router/ui";
import {
  IconCopy,
  IconKey,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react";

import {
  McpApp,
  McpAppsManagerResult,
  TokenServerAccess,
} from "@mcp_router/shared";
import {
  UNASSIGNED_PROJECT_ID,
  useProjectStore,
} from "@/renderer/stores/project-store";

// Streamable HTTP 端点（与 main.ts 中 MCPHttpServer 端口保持一致）
const MCP_ENDPOINT = "http://localhost:3282/mcp";

const McpAppsManager: React.FC = () => {
  const { t } = useTranslation();
  const platformAPI = usePlatformAPI();
  const [apps, setApps] = useState<McpApp[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [customAppName, setCustomAppName] = useState<string>("");
  const [servers, setServers] = useState<any[]>([]);
  const [selectedApp, setSelectedApp] = useState<McpApp | null>(null);
  const [selectedServerAccess, setSelectedServerAccess] =
    useState<TokenServerAccess>({});
  const [isAccessControlDialogOpen, setIsAccessControlDialogOpen] =
    useState<boolean>(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const [appToDelete, setAppToDelete] = useState<McpApp | null>(null);
  const { projects, list: listProjects } = useProjectStore();

  useEffect(() => {
    loadApps();
    loadServers();
  }, []);

  useEffect(() => {
    listProjects();
  }, [listProjects]);

  const openAccessControlDialog = (app: McpApp) => {
    setSelectedApp(app);
    const appServerAccess = app.serverAccess || {};
    setSelectedServerAccess({ ...appServerAccess });
    setIsAccessControlDialogOpen(true);
  };

  const handleServerCheckboxChange = (serverId: string, checked: boolean) => {
    setSelectedServerAccess((prev) => ({
      ...prev,
      [serverId]: checked,
    }));
  };

  const handleProjectCheckboxChange = (projectId: string, checked: boolean) => {
    setSelectedServerAccess((prev) => {
      const next = { ...prev };
      const targetProjectId = projectId || UNASSIGNED_PROJECT_ID;
      const value = !!checked;

      servers.forEach((server) => {
        const serverProjectId =
          server.projectId === null || server.projectId === undefined
            ? UNASSIGNED_PROJECT_ID
            : server.projectId;

        if (serverProjectId === targetProjectId) {
          next[server.id] = value;
        }
      });

      return next;
    });
  };

  const saveAccessControl = async () => {
    if (!selectedApp) return;

    try {
      const serverResult = await platformAPI.apps.updateServerAccess(
        selectedApp.name,
        selectedServerAccess,
      );

      if (!serverResult.success) {
        toast.error(serverResult.message);
        return;
      }

      if (serverResult.app) {
        setApps((prevApps) =>
          prevApps.map((app) =>
            app.name === selectedApp.name
              ? { ...serverResult.app!, isCustom: app.isCustom }
              : app,
          ),
        );
      }

      toast.success(t("mcpApps.accessControlSaved"));
    } catch (error: any) {
      console.error(
        `Failed to update access control for ${selectedApp.name}:`,
        error,
      );
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsAccessControlDialogOpen(false);
    }
  };

  const loadServers = async () => {
    try {
      const serverList = await platformAPI.servers.list();
      setServers(serverList);
    } catch (error) {
      console.error("Failed to load MCP servers:", error);
    }
  };

  const loadApps = async () => {
    setLoading(true);
    try {
      const appsList = await platformAPI.apps.list();
      setApps(appsList);
    } catch (error) {
      console.error("Failed to load MCP apps:", error);
      toast.error("Error loading apps");
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustomApp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customAppName.trim()) {
      toast.error(t("mcpApps.enterValidName"));
      return;
    }

    try {
      const result: McpAppsManagerResult =
        await platformAPI.apps.create(customAppName);

      if (result.success && result.app) {
        setApps((prevApps) => [...prevApps, result.app!]);
        toast.success(result.message);
        setCustomAppName("");
      } else {
        toast.error(result.message);
      }
    } catch (error: any) {
      console.error("Failed to add app:", error);
      toast.error(`Error: ${error.message}`);
    }
  };

  const openDeleteDialog = (app: McpApp) => {
    setAppToDelete(app);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteApp = async () => {
    if (!appToDelete) return;

    try {
      const success = await platformAPI.apps.delete(appToDelete.name);

      if (success) {
        setApps((prevApps) =>
          prevApps.filter((app) => app.name !== appToDelete.name),
        );
        toast.success(t("mcpApps.deleteSuccess"));
      } else {
        toast.error(t("mcpApps.deleteFailed"));
      }
    } catch (error: any) {
      console.error(`Failed to delete app ${appToDelete.name}:`, error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsDeleteDialogOpen(false);
      setAppToDelete(null);
    }
  };

  const handleCopyToken = async (token?: string) => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.success(t("mcpApps.tokenCopied"));
    } catch (error) {
      console.error("Failed to copy token:", error);
      toast.error(t("mcpApps.tokenCopyFailed"));
    }
  };

  const projectSections = (() => {
    if (!servers || servers.length === 0) return [];

    const projectMap = new Map<string, { id: string; name: string }>();
    projects.forEach((p) => projectMap.set(p.id, { id: p.id, name: p.name }));

    const grouped: Record<
      string,
      { projectId: string; name: string; servers: any[] }
    > = {};

    servers.forEach((server) => {
      const projectId =
        server.projectId === null || server.projectId === undefined
          ? UNASSIGNED_PROJECT_ID
          : server.projectId;

      if (!grouped[projectId]) {
        const project = projectMap.get(projectId);
        grouped[projectId] = {
          projectId,
          name:
            project?.name ||
            (projectId === UNASSIGNED_PROJECT_ID
              ? t("projects.unassigned")
              : projectId),
          servers: [],
        };
      }

      grouped[projectId].servers.push(server);
    });

    return Object.values(grouped).sort((a, b) => {
      if (a.projectId === UNASSIGNED_PROJECT_ID) return -1;
      if (b.projectId === UNASSIGNED_PROJECT_ID) return 1;
      return a.name.localeCompare(b.name);
    });
  })();

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <h2 className="text-2xl font-bold">{t("mcpApps.title")}</h2>
        <p className="text-muted-foreground">{t("mcpApps.description")}</p>
      </div>

      {/* Streamable HTTP 连接说明 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("mcpApps.howToConnect")}
          </CardTitle>
          <CardDescription>{t("mcpApps.streamableHttpDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm space-y-2">
            <div>
              <span className="text-muted-foreground">Endpoint: </span>
              <code className="bg-muted px-2 py-0.5 rounded">
                {MCP_ENDPOINT}
              </code>
            </div>
            <div>
              <span className="text-muted-foreground">Header: </span>
              <code className="bg-muted px-2 py-0.5 rounded">
                Authorization: Bearer &lt;MCPR_TOKEN&gt;
              </code>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 添加 Token */}
      <Card>
        <CardHeader>
          <CardTitle>{t("mcpApps.addCustomApp")}</CardTitle>
          <CardDescription>{t("mcpApps.customAppDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddCustomApp} className="flex gap-4 items-end">
            <div className="flex-1">
              <Input
                id="customAppName"
                value={customAppName}
                onChange={(e) => setCustomAppName(e.target.value)}
                placeholder={t("mcpApps.enterAppName")}
              />
            </div>
            <Button type="submit">{t("mcpApps.addCustomApp")}</Button>
          </form>
        </CardContent>
      </Card>

      {/* Token 列表 */}
      {loading ? (
        <></>
      ) : apps.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          {t("mcpApps.empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {apps.map((app) => {
            const accessibleCount = Object.values(
              app.serverAccess || {},
            ).filter(Boolean).length;
            const tokenPreview = app.token
              ? `${app.token.slice(0, 8)}…${app.token.slice(-4)}`
              : "—";

            return (
              <Card key={app.name}>
                <CardContent className="flex items-center justify-between py-4 gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <IconKey className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{app.name}</div>
                      <div className="text-xs text-muted-foreground flex gap-3">
                        <span>
                          Token: <code>{tokenPreview}</code>
                        </span>
                        <span>
                          {t("mcpApps.accessibleServers")}: {accessibleCount}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyToken(app.token)}
                      disabled={!app.token}
                    >
                      <IconCopy className="h-4 w-4 mr-1" />
                      {t("mcpApps.copyToken")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openAccessControlDialog(app)}
                    >
                      <IconSettings className="h-4 w-4 mr-1" />
                      {t("mcpApps.serverAccess")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => openDeleteDialog(app)}
                    >
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 访问控制弹窗 */}
      <Dialog
        open={isAccessControlDialogOpen}
        onOpenChange={setIsAccessControlDialogOpen}
      >
        <DialogContent className="max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {t("mcpApps.serverAccess")} - {selectedApp?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-4">
              {t("mcpApps.selectServers")}
            </p>
            <ScrollArea className="h-[60vh] pr-4">
              <div className="space-y-4 pr-2">
                {projectSections.map((section) => {
                  const totalServers = section.servers.length;
                  const selectedCount = section.servers.filter(
                    (server) => selectedServerAccess[server.id] === true,
                  ).length;
                  const allSelected =
                    totalServers > 0 && selectedCount === totalServers;

                  return (
                    <div
                      key={section.projectId}
                      className="space-y-2 border-b last:border-b-0 pb-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`project-${section.projectId}`}
                            checked={allSelected}
                            onCheckedChange={(checked) =>
                              handleProjectCheckboxChange(
                                section.projectId,
                                !!checked,
                              )
                            }
                          />
                          <Label htmlFor={`project-${section.projectId}`}>
                            {section.name}
                          </Label>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {selectedCount}/{totalServers}
                        </span>
                      </div>
                      <div className="space-y-1 pl-6">
                        {section.servers.map((server) => (
                          <div
                            key={server.id}
                            className="flex items-center space-x-3"
                          >
                            <Checkbox
                              id={`server-${server.id}`}
                              checked={selectedServerAccess[server.id] === true}
                              onCheckedChange={(checked) =>
                                handleServerCheckboxChange(server.id, !!checked)
                              }
                            />
                            <Label htmlFor={`server-${server.id}`}>
                              {server.name}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <ScrollBar orientation="vertical" />
            </ScrollArea>
          </div>

          <DialogFooter>
            <Button
              onClick={() => setIsAccessControlDialogOpen(false)}
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={saveAccessControl}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("mcpApps.confirmDelete")} - {appToDelete?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-4">
              {t("mcpApps.deleteWarning")}
            </p>
          </div>

          <DialogFooter>
            <Button
              onClick={() => setIsDeleteDialogOpen(false)}
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleDeleteApp} variant="destructive">
              {t("mcpApps.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default McpAppsManager;
