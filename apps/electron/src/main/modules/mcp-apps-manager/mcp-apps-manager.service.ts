import { getServerService } from "@/main/modules/mcp-server-manager/server-service";
import { SingletonService } from "@/main/modules/singleton-service";
import {
  Token,
  TokenGenerateOptions,
  TokenValidationResult,
  McpApp,
  McpAppsManagerResult,
  MCPServerConfig,
  MCPConnectionResult,
  MCPInputParam,
  TokenServerAccess,
} from "@mcp_router/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// 内部模块
import { TokenManager } from "./token-manager";
import { MCPClient } from "./mcp-client";

/**
 * MCP Apps Service —— 离线客户端下仅负责 Token 管理与访问控制。
 * 每个"App"现在就是一个 MCPR_TOKEN + serverAccess 列表。
 * 不再检测/写入任何预设客户端（Claude/Cursor/Cline 等）的系统配置文件。
 */
export class McpAppsManagerService extends SingletonService<
  Token,
  string,
  McpAppsManagerService
> {
  private tokenManager: TokenManager;
  private mcpClient: MCPClient;

  protected constructor() {
    super();
    this.tokenManager = new TokenManager();
    this.mcpClient = new MCPClient();
  }

  protected getEntityName(): string {
    return "McpApps";
  }

  public static getInstance(): McpAppsManagerService {
    return (this as any).getInstanceBase();
  }

  public static resetInstance(): void {
    // Token 在多个 workspace 间共享，不重置
    console.log(
      "[McpAppsService] Skip reset - tokens are shared across workspaces",
    );
  }

  // ========== Token 方法 ==========

  public generateToken(options: TokenGenerateOptions): Token {
    try {
      return this.tokenManager.generateToken(options);
    } catch (error) {
      return this.handleError("Token 生成", error);
    }
  }

  public validateToken(tokenId: string): TokenValidationResult {
    try {
      return this.tokenManager.validateToken(tokenId);
    } catch (error) {
      return this.handleError("Token 校验", error, {
        isValid: false,
        error: `校验过程中发生错误: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  public getClientIdFromToken(tokenId: string): string | null {
    try {
      return this.tokenManager.getClientIdFromToken(tokenId);
    } catch (error) {
      this.handleError("从 Token 获取 Client ID", error);
      return null;
    }
  }

  public deleteToken(tokenId: string): boolean {
    try {
      return this.tokenManager.deleteToken(tokenId);
    } catch (error) {
      return this.handleError(`删除 Token ${tokenId}`, error, false);
    }
  }

  public deleteClientTokens(clientId: string): number {
    try {
      return this.tokenManager.deleteClientTokens(clientId);
    } catch (error) {
      return this.handleError(`删除客户端 ${clientId} 的 Token`, error, 0);
    }
  }

  public listTokens(): Token[] {
    try {
      return this.tokenManager.listTokens();
    } catch (error) {
      return this.handleError("Token 列表获取", error, []);
    }
  }

  public hasServerAccess(tokenId: string, serverId: string): boolean {
    try {
      return this.tokenManager.hasServerAccess(tokenId, serverId);
    } catch (error) {
      return this.handleError("服务器访问权限检查", error, false);
    }
  }

  public updateTokenServerAccess(
    tokenId: string,
    serverAccess: TokenServerAccess,
  ): boolean {
    try {
      return this.tokenManager.updateTokenServerAccess(tokenId, serverAccess);
    } catch (error) {
      return this.handleError("服务器访问权限更新", error, false);
    }
  }

  // ========== Client 工具方法 ==========

  public async connectToMCPServer(
    server: MCPServerConfig,
    clientName = "mcp-client",
  ): Promise<MCPConnectionResult> {
    return this.mcpClient.connectToMCPServer(server, clientName);
  }

  public async fetchServerTools(client: Client): Promise<any[]> {
    return this.mcpClient.fetchServerTools(client);
  }

  public async fetchServerResources(client: Client): Promise<any[]> {
    return this.mcpClient.fetchServerResources(client);
  }

  public async readServerResource(
    client: Client,
    resourceUri: string,
  ): Promise<any> {
    return this.mcpClient.readServerResource(client, resourceUri);
  }

  public substituteArgsParameters(
    argsTemplate: string[],
    env: Record<string, string>,
    inputParams: Record<string, MCPInputParam>,
  ): string[] {
    return this.mcpClient.substituteArgsParameters(
      argsTemplate,
      env,
      inputParams,
    );
  }

  // ========== App 管理方法 ==========

  /**
   * 将 Token 映射为 McpApp（离线版本不再有"预设应用"概念）
   */
  private tokenToApp(token: Token): McpApp {
    return {
      name: token.clientId,
      installed: true,
      configPath: "",
      configured: true,
      token: token.id,
      serverAccess: token.serverAccess,
      isCustom: true,
    };
  }

  /**
   * 列出所有 Token（等价于 App 列表）
   */
  public async listMcpApps(): Promise<McpApp[]> {
    return this.listTokens().map((token) => this.tokenToApp(token));
  }

  /**
   * 添加新的 App（生成 Token，默认允许访问所有现有服务器）
   */
  public async addApp(name: string): Promise<McpAppsManagerResult> {
    try {
      const trimmed = name?.trim() ?? "";
      if (!trimmed) {
        return {
          success: false,
          message: "App name cannot be empty",
        };
      }

      const clientId = trimmed.toLowerCase();

      // 查重
      const existing = this.listTokens().some(
        (token) => token.clientId === clientId,
      );
      if (existing) {
        return {
          success: false,
          message: `An app with the name "${trimmed}" already exists`,
        };
      }

      // 默认允许访问全部已有服务器
      const serverService = getServerService();
      const servers = serverService.getAllServers();
      const serverAccess: TokenServerAccess = {};
      servers.forEach((server: { id: string }) => {
        serverAccess[server.id] = true;
      });

      const token = this.generateToken({
        clientId,
        serverAccess,
      });

      return {
        success: true,
        message: `Successfully added app "${trimmed}" with token`,
        app: this.tokenToApp(token),
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to add app: ${error.message}`,
      };
    }
  }

  /**
   * 更新某个 App 的服务器访问权限
   */
  public async updateAppServerAccess(
    appName: string,
    serverAccess: TokenServerAccess,
  ): Promise<McpAppsManagerResult> {
    try {
      const clientId = appName.toLowerCase();
      const token = this.listTokens().find((t) => t.clientId === clientId);

      if (!token) {
        return {
          success: false,
          message: `No token found for app "${appName}".`,
        };
      }

      const success = this.updateTokenServerAccess(
        token.id,
        serverAccess || {},
      );
      if (!success) {
        return {
          success: false,
          message: `Failed to update server access for "${appName}"`,
        };
      }

      const refreshed =
        this.listTokens().find((t) => t.id === token.id) ??
        ({ ...token, serverAccess: serverAccess || {} } as Token);

      return {
        success: true,
        message: `Successfully updated server access for "${appName}"`,
        app: this.tokenToApp(refreshed),
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to update server access: ${error.message}`,
      };
    }
  }

  /**
   * 删除 App（等价于删除该 App 的所有 Token）
   */
  public async deleteCustomApp(appName: string): Promise<boolean> {
    try {
      const clientId = appName.toLowerCase();
      const deletedCount = this.deleteClientTokens(clientId);
      return deletedCount > 0;
    } catch (error: any) {
      console.error(`Failed to delete app ${appName}:`, error);
      return false;
    }
  }
}

export function getMcpAppsService(): McpAppsManagerService {
  return McpAppsManagerService.getInstance();
}

// ========== 对外导出的独立函数（兼容旧调用点）==========

export async function listMcpApps(): Promise<McpApp[]> {
  return getMcpAppsService().listMcpApps();
}

export async function addApp(name: string): Promise<McpAppsManagerResult> {
  return getMcpAppsService().addApp(name);
}

export async function updateAppServerAccess(
  appName: string,
  serverAccess: TokenServerAccess,
): Promise<McpAppsManagerResult> {
  return getMcpAppsService().updateAppServerAccess(appName, serverAccess);
}

export async function deleteCustomApp(appName: string): Promise<boolean> {
  return getMcpAppsService().deleteCustomApp(appName);
}

// MCP Client 工具导出
export async function connectToMCPServer(
  server: MCPServerConfig,
  clientName = "mcp-client",
): Promise<MCPConnectionResult> {
  return getMcpAppsService().connectToMCPServer(server, clientName);
}

export async function fetchServerTools(client: Client): Promise<any[]> {
  return getMcpAppsService().fetchServerTools(client);
}

export async function fetchServerResources(client: Client): Promise<any[]> {
  return getMcpAppsService().fetchServerResources(client);
}

export async function readServerResource(
  client: Client,
  resourceUri: string,
): Promise<any> {
  return getMcpAppsService().readServerResource(client, resourceUri);
}

export function substituteArgsParameters(
  argsTemplate: string[],
  env: Record<string, string>,
  inputParams: Record<string, MCPInputParam>,
): string[] {
  return getMcpAppsService().substituteArgsParameters(
    argsTemplate,
    env,
    inputParams,
  );
}

