import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import {
  SharedConfig,
  ISharedConfigManager,
  AppSettings,
  Token,
  DEFAULT_APP_SETTINGS,
  TokenServerAccess,
} from "@mcp_router/shared";
import { SqliteManager } from "./database/sqlite-manager";

export class SharedConfigManager implements ISharedConfigManager {
  private static instance: SharedConfigManager | null = null;
  private configPath: string;
  private config: SharedConfig;
  private readonly configFileName = "shared-config.json";

  private constructor() {
    this.configPath = path.join(app.getPath("userData"), this.configFileName);
    this.config = this.loadConfig();
  }

  private cloneToken(token: Token): Token {
    return {
      ...token,
      serverAccess: { ...(token.serverAccess || {}) } as TokenServerAccess,
    };
  }

  public static getInstance(): SharedConfigManager {
    if (!SharedConfigManager.instance) {
      SharedConfigManager.instance = new SharedConfigManager();
    }
    return SharedConfigManager.instance;
  }

  public static resetInstance(): void {
    SharedConfigManager.instance = null;
  }

  private loadConfig(): SharedConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, "utf-8");
        const config = JSON.parse(data);

        // 规范化现有 token 数据（修正迁移后的异常字段）
        if (config.mcpApps?.tokens) {
          config.mcpApps.tokens = config.mcpApps.tokens.map((token: any) => {
            const normalizedToken: Token = {
              id: token.id,
              clientId: token.clientId || token.client_id,
              issuedAt: token.issuedAt || token.issued_at,
              serverAccess: {},
            };

            const serverAccessValue = token.serverAccess || {};
            normalizedToken.serverAccess = {
              ...(serverAccessValue as TokenServerAccess),
            };

            return normalizedToken;
          });
        }

        return config;
      }
    } catch (error) {
      console.error("[SharedConfigManager] Failed to load config:", error);
    }

    return {
      settings: { ...DEFAULT_APP_SETTINGS },
      mcpApps: {
        tokens: [],
      },
      _meta: {
        version: "1.0.0",
        lastModified: new Date().toISOString(),
      },
    };
  }

  private saveConfig(): void {
    try {
      if (!this.config._meta) {
        this.config._meta = {
          version: "1.0.0",
          lastModified: new Date().toISOString(),
        };
      } else {
        this.config._meta.lastModified = new Date().toISOString();
      }

      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        "utf-8",
      );
    } catch (error) {
      console.error("[SharedConfigManager] Failed to save config:", error);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    // 配置文件不存在时，从现有数据库迁移
    if (!fs.existsSync(this.configPath)) {
      await this.migrateFromDatabase("local-default");
    }
  }

  async migrateFromDatabase(workspaceId: string): Promise<void> {
    try {
      const dbPath =
        workspaceId === "local-default"
          ? path.join(app.getPath("userData"), "mcprouter.db")
          : path.join(
              app.getPath("userData"),
              "workspaces",
              workspaceId,
              "database.db",
            );

      if (!fs.existsSync(dbPath)) {
        return;
      }

      const db = new SqliteManager(dbPath);

      const settingsRows = db.all<{ key: string; value: string }>(
        "SELECT key, value FROM settings",
      );

      const settings: AppSettings = { ...DEFAULT_APP_SETTINGS };
      settingsRows.forEach((row) => {
        const key = row.key as keyof AppSettings;
        if (key in settings) {
          try {
            settings[key] = JSON.parse(row.value);
          } catch {
            settings[key] = row.value as any;
          }
        }
      });
      this.config.settings = settings;

      const tokenRows = db.all<any>("SELECT * FROM tokens");

      this.config.mcpApps.tokens = tokenRows.map((row) => {
        const token: Token = {
          id: row.id,
          clientId: row.client_id || row.clientId,
          issuedAt: row.issued_at || row.issuedAt,
          serverAccess: {},
        };

        if (row.serverAccess) {
          token.serverAccess = { ...(row.serverAccess as TokenServerAccess) };
        }

        return token;
      });

      this.config._meta = {
        version: "1.0.0",
        migratedAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      };

      this.saveConfig();

      db.close();
      console.log("[SharedConfigManager] Migration completed successfully");
    } catch (error) {
      console.error("[SharedConfigManager] Migration failed:", error);
      throw error;
    }
  }

  getSettings(): AppSettings {
    return {
      ...DEFAULT_APP_SETTINGS,
      ...this.config.settings,
    };
  }

  saveSettings(settings: AppSettings): void {
    this.config.settings = {
      ...DEFAULT_APP_SETTINGS,
      ...this.config.settings,
      ...settings,
    };
    this.saveConfig();
  }

  getTokens(): Token[] {
    return this.config.mcpApps.tokens.map((token) => this.cloneToken(token));
  }

  getToken(tokenId: string): Token | undefined {
    const token = this.config.mcpApps.tokens.find((t) => t.id === tokenId);
    return token ? this.cloneToken(token) : undefined;
  }

  saveToken(token: Token): void {
    const normalizedToken: Token = {
      ...token,
      serverAccess: token.serverAccess || {},
    };

    const index = this.config.mcpApps.tokens.findIndex(
      (t) => t.id === token.id,
    );
    if (index >= 0) {
      this.config.mcpApps.tokens[index] = normalizedToken;
    } else {
      this.config.mcpApps.tokens.push(normalizedToken);
    }
    this.saveConfig();
  }

  deleteToken(tokenId: string): void {
    this.config.mcpApps.tokens = this.config.mcpApps.tokens.filter(
      (t) => t.id !== tokenId,
    );
    this.saveConfig();
  }

  deleteClientTokens(clientId: string): void {
    this.config.mcpApps.tokens = this.config.mcpApps.tokens.filter(
      (t) => t.clientId !== clientId,
    );
    this.saveConfig();
  }

  getTokensByClientId(clientId: string): Token[] {
    return this.config.mcpApps.tokens
      .filter((t) => t.clientId === clientId)
      .map((token) => this.cloneToken(token));
  }

  updateTokenServerAccess(
    tokenId: string,
    serverAccess: TokenServerAccess,
  ): void {
    const token = this.config.mcpApps.tokens.find((t) => t.id === tokenId);
    if (token) {
      token.serverAccess = serverAccess || {};
      this.saveConfig();
    }
  }

  syncTokensWithWorkspaceServers(serverList: string[]): void {
    let updated = false;

    this.config.mcpApps.tokens.forEach((token) => {
      const map = token.serverAccess || {};
      const initialSize = Object.keys(map).length;
      const nextAccess = { ...map };
      serverList.forEach((id) => {
        if (!(id in nextAccess)) {
          nextAccess[id] = true;
        }
      });
      const nextSize = Object.keys(nextAccess).length;

      if (nextSize > initialSize) {
        token.serverAccess = nextAccess;
        updated = true;
        console.log(
          `[SharedConfigManager] Updated token ${token.id} with ${nextSize - initialSize} new server(s)`,
        );
      }
    });

    if (updated) {
      this.saveConfig();
      console.log(
        "[SharedConfigManager] Tokens synchronized with workspace servers",
      );
    }
  }
}

export function getSharedConfigManager(): SharedConfigManager {
  return SharedConfigManager.getInstance();
}
