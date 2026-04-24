import { Token, TokenServerAccess } from "@mcp_router/shared";
import { getSharedConfigManager } from "../../infrastructure/shared-config-manager";

export class McpAppsManagerRepository {
  private static instance: McpAppsManagerRepository | null = null;

  private constructor() {
    console.log(
      "[McpAppsManagerRepository] Using SharedConfigManager for token storage",
    );
  }

  public static getInstance(): McpAppsManagerRepository {
    if (!McpAppsManagerRepository.instance) {
      McpAppsManagerRepository.instance = new McpAppsManagerRepository();
    }
    return McpAppsManagerRepository.instance;
  }

  public static resetInstance(): void {
    McpAppsManagerRepository.instance = null;
  }

  public getToken(id: string): Token | null {
    const manager = getSharedConfigManager();
    const token = manager.getToken(id);
    return token || null;
  }

  public saveToken(token: Token): void {
    getSharedConfigManager().saveToken(token);
  }

  public listTokens(): Token[] {
    return getSharedConfigManager().getTokens();
  }

  public deleteToken(id: string): boolean {
    try {
      getSharedConfigManager().deleteToken(id);
      return true;
    } catch (error) {
      console.error(`删除 token ${id} 时发生错误:`, error);
      return false;
    }
  }

  public deleteClientTokens(clientId: string): number {
    try {
      const manager = getSharedConfigManager();
      const beforeCount = manager.getTokensByClientId(clientId).length;
      manager.deleteClientTokens(clientId);
      return beforeCount;
    } catch (error) {
      console.error(
        `删除客户端 ${clientId} 的 token 时发生错误:`,
        error,
      );
      throw error;
    }
  }

  public updateTokenServerAccess(
    id: string,
    serverAccess: TokenServerAccess,
  ): boolean {
    try {
      getSharedConfigManager().updateTokenServerAccess(id, serverAccess);
      return true;
    } catch (error) {
      console.error(`更新 token ${id} 时发生错误:`, error);
      return false;
    }
  }

  public getTokensByClientId(clientId: string): Token[] {
    try {
      return getSharedConfigManager().getTokensByClientId(clientId);
    } catch (error) {
      console.error(
        `获取客户端 ID ${clientId} 的 token 时发生错误:`,
        error,
      );
      throw error;
    }
  }

  // 与 BaseRepository 兼容的方法
  public getById(id: string): Token | undefined {
    const manager = getSharedConfigManager();
    return manager.getToken(id);
  }

  public getAll(): Token[] {
    return this.listTokens();
  }

  public add(token: Token): Token {
    this.saveToken(token);
    return token;
  }

  public update(id: string, token: Token): Token | undefined {
    const existing = this.getById(id);
    if (existing) {
      this.saveToken(token);
      return token;
    }
    return undefined;
  }

  public delete(id: string): boolean {
    return this.deleteToken(id);
  }
}
