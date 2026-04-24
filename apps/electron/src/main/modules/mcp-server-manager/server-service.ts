import { SingletonService } from "@/main/modules/singleton-service";
import { MCPServer, MCPServerConfig } from "@mcp_router/shared";
import { logInfo } from "@/main/utils/logger";
import { McpServerManagerRepository } from "./mcp-server-manager.repository";
import { TokenManager } from "@/main/modules/mcp-apps-manager/token-manager";

/**
 * Service class for managing server information
 */
export class ServerService extends SingletonService<
  MCPServer,
  string,
  ServerService
> {
  /**
   * Constructor
   */
  protected constructor() {
    super();
  }

  /**
   * Get entity name
   */
  protected getEntityName(): string {
    return "Server";
  }

  /**
   * Get singleton instance of ServerService
   */
  public static getInstance(): ServerService {
    return (this as any).getInstanceBase();
  }

  /**
   * Reset instance (used when switching workspaces)
   */
  public static resetInstance(): void {
    this.resetInstanceBase(ServerService);
  }

  /**
   * 添加服务器信息
   * @param serverConfig 服务器配置
   * @returns 已添加的服务器信息
   */
  public addServer(serverConfig: MCPServerConfig): MCPServer {
    try {
      const server =
        McpServerManagerRepository.getInstance().addServer(serverConfig);

      // Give all MCP clients access to this new server
      try {
        const tokenManager = new TokenManager();
        const allTokens = tokenManager.listTokens();

        // For each token, add this server's ID to its access list
        allTokens.forEach((token) => {
          const serverAccess = token.serverAccess || {};
          // Add the new server when it doesn't exist in the access map
          if (!(server.id in serverAccess)) {
            const updatedServerAccess = {
              ...serverAccess,
              [server.id]: true,
            };
            tokenManager.updateTokenServerAccess(token.id, updatedServerAccess);
          }
        });
      } catch (error) {
        // Log error but don't interrupt the server creation process
        console.error("Error updating tokens for new server access:", error);
      }

      return server;
    } catch (error) {
      return this.handleError("添加", error);
    }
  }

  /**
   * 获取所有服务器信息
   * @returns 服务器信息数组
   */
  public getAllServers(): MCPServer[] {
    try {
      return McpServerManagerRepository.getInstance().getAllServers();
    } catch (error) {
      return this.handleError("获取", error, []);
    }
  }

  /**
   * 根据 ID 获取服务器信息
   * @param id 服务器 ID
   * @returns 服务器信息（不存在时返回 undefined）
   */
  public getServerById(id: string): MCPServer | undefined {
    try {
      return McpServerManagerRepository.getInstance().getServerById(id);
    } catch (error) {
      return this.handleError(`获取 ID:${id}`, error, undefined);
    }
  }

  /**
   * 更新服务器信息
   * @param id 服务器 ID
   * @param config 要更新的服务器配置
   * @returns 更新后的服务器信息（不存在时返回 undefined）
   */
  public updateServer(
    id: string,
    config: Partial<MCPServerConfig>,
  ): MCPServer | undefined {
    try {
      const result = McpServerManagerRepository.getInstance().updateServer(
        id,
        config,
      );
      if (result) {
        logInfo(`服务器 "${result.name}" 已更新 (ID: ${id})`);
      }
      return result;
    } catch (error) {
      return this.handleError(`更新 ID:${id}`, error, undefined);
    }
  }

  /**
   * 删除服务器信息
   * @param id 服务器 ID
   * @returns 删除成功返回 true，失败返回 false
   */
  public deleteServer(id: string): boolean {
    try {
      const server = this.getServerById(id);
      const result = McpServerManagerRepository.getInstance().deleteServer(id);

      if (result && server) {
        logInfo(`服务器 "${server.name}" 已删除 (ID: ${id})`);
      }

      return result;
    } catch (error) {
      return this.handleError(`删除 ID:${id}`, error, false);
    }
  }
}

/**
 * 获取 ServerService 单例实例
 */
export function getServerService(): ServerService {
  return ServerService.getInstance();
}
