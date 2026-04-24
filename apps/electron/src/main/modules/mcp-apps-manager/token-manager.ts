import crypto from "crypto";
import { McpAppsManagerRepository } from "./mcp-apps-manager.repository";
import {
  Token,
  TokenGenerateOptions,
  TokenValidationResult,
  TokenServerAccess,
} from "@mcp_router/shared";

export class TokenManager {
  public generateToken(options: TokenGenerateOptions): Token {
    const now = Math.floor(Date.now() / 1000);
    const clientId = options.clientId;

    // 若已存在相同 clientId 的 token，则先删除
    const clientTokens =
      McpAppsManagerRepository.getInstance().getTokensByClientId(clientId);
    if (clientTokens.length > 0) {
      McpAppsManagerRepository.getInstance().deleteClientTokens(clientId);
    }

    // 生成更强的随机值（24 字节 = 192 位），转为 URL 安全的 Base64 格式
    const randomBytes = crypto
      .randomBytes(24)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    const token: Token = {
      id: "mcpr_" + randomBytes,
      clientId,
      issuedAt: now,
      serverAccess: options.serverAccess || {},
    };

    McpAppsManagerRepository.getInstance().saveToken(token);
    return token;
  }

  public validateToken(tokenId: string): TokenValidationResult {
    const token = McpAppsManagerRepository.getInstance().getToken(tokenId);

    if (!token) {
      return {
        isValid: false,
        error: "Token not found",
      };
    }

    return {
      isValid: true,
      clientId: token.clientId,
    };
  }

  public getClientIdFromToken(tokenId: string): string | null {
    const validation = this.validateToken(tokenId);
    return validation.isValid ? validation.clientId! : null;
  }

  public deleteToken(tokenId: string): boolean {
    return McpAppsManagerRepository.getInstance().deleteToken(tokenId);
  }

  public deleteClientTokens(clientId: string): number {
    return McpAppsManagerRepository.getInstance().deleteClientTokens(clientId);
  }

  public listTokens(): Token[] {
    return McpAppsManagerRepository.getInstance().listTokens();
  }

  public hasServerAccess(tokenId: string, serverId: string): boolean {
    const token = McpAppsManagerRepository.getInstance().getToken(tokenId);
    if (!token) {
      return false;
    }
    return !!token.serverAccess?.[serverId];
  }

  public updateTokenServerAccess(
    tokenId: string,
    serverAccess: TokenServerAccess,
  ): boolean {
    return McpAppsManagerRepository.getInstance().updateTokenServerAccess(
      tokenId,
      serverAccess || {},
    );
  }
}
