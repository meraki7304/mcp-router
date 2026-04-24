import express from "express";
import cors from "cors";
import * as http from "http";
import { MCPServerManager } from "../../mcp-server-manager/mcp-server-manager";
import { AggregatorServer } from "../aggregator-server";
import { getPlatformAPIManager } from "../../workspace/platform-api-manager";
import { TokenValidator } from "../token-validator";
import { ProjectRepository } from "../../projects/projects.repository";
import { PROJECT_HEADER, UNASSIGNED_PROJECT_ID } from "@mcp_router/shared";

/**
 * 通过 Streamable HTTP 对外暴露聚合后的 MCP 服务
 */
export class MCPHttpServer {
  private app: express.Application;
  private server: http.Server | null = null;
  private port: number;
  private aggregatorServer: AggregatorServer;
  private tokenValidator: TokenValidator;

  constructor(
    serverManager: MCPServerManager,
    port: number,
    aggregatorServer?: AggregatorServer,
  ) {
    this.aggregatorServer =
      aggregatorServer || new AggregatorServer(serverManager);
    this.port = port;
    this.app = express();
    // TokenValidator 需要维护服务器名称和 ID 的映射
    this.tokenValidator = new TokenValidator(new Map());
    this.configureMiddleware();
    this.configureRoutes();
  }

  /**
   * 配置 Express 中间件
   */
  private configureMiddleware(): void {
    // 解析 JSON 请求体
    this.app.use(express.json());

    // 启用 CORS
    this.app.use(cors());

    // 鉴权中间件
    const authMiddleware = (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const token = req.headers["authorization"];
      // 处理 Bearer token 格式
      if (token && token.startsWith("Bearer ")) {
        req.headers["authorization"] = token.substring(7);
      }

      if (!token) {
        res.status(401).json({
          error: "Authentication required. Please provide a valid token.",
        });
        return;
      }

      const tokenId =
        typeof token === "string"
          ? token.startsWith("Bearer ")
            ? token.substring(7)
            : token
          : "";
      const validation = this.tokenValidator.validateToken(tokenId);

      if (!validation.isValid) {
        res.status(401).json({
          error: validation.error || "Invalid token. Authentication failed.",
        });
        return;
      }

      next();
    };

    // Streamable HTTP 端点鉴权
    this.app.use("/mcp", authMiddleware);
  }

  /**
   * 配置 API 路由
   */
  private configureRoutes(): void {
    this.configureMcpRoute();
  }

  private resolveProjectFilter(
    req: express.Request,
    options?: { skipValidation?: boolean },
  ): { projectId: string | null; provided: boolean } {
    const headerValue = req.headers[PROJECT_HEADER];
    if (headerValue === undefined) {
      return { projectId: null, provided: false };
    }

    const rawValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const value = rawValue?.trim();

    if (!value) {
      return { projectId: null, provided: true };
    }

    if (value === UNASSIGNED_PROJECT_ID) {
      return { projectId: null, provided: true };
    }

    if (options?.skipValidation) {
      return { projectId: value, provided: true };
    }

    const repo = ProjectRepository.getInstance();
    const byName = repo.findByName(value);
    if (byName) {
      return { projectId: byName.id, provided: true };
    }

    const error = new Error(`Project "${value}" not found`);
    (error as any).status = 400;
    throw error;
  }

  private attachRequestMetadata(
    payload: any,
    tokenHeader: string | string[] | undefined,
    projectId: string | null,
  ): void {
    const tokenValue = Array.isArray(tokenHeader)
      ? tokenHeader[0]
      : tokenHeader;

    if (payload.params && typeof payload.params === "object") {
      payload.params._meta = {
        ...(payload.params._meta || {}),
        token: tokenValue,
        projectId,
      };
    } else if (payload.params === undefined) {
      payload.params = {
        _meta: {
          token: tokenValue,
          projectId,
        },
      };
    }
  }

  /**
   * 配置 Streamable HTTP 的 /mcp 路由（POST 处理 JSON-RPC 请求，
   * 由聚合器的 transport 负责可选 SSE 响应流）
   */
  private configureMcpRoute(): void {
    this.app.post("/mcp", async (req, res) => {
      const modifiedBody = { ...req.body };

      try {
        const platformManager = getPlatformAPIManager();
        let projectFilter: string | null;
        try {
          const resolution = this.resolveProjectFilter(req, {
            skipValidation: platformManager.isRemoteWorkspace(),
          });
          projectFilter = resolution.projectId;
        } catch (error: any) {
          if (!res.headersSent) {
            res.status(error?.status || 400).json({
              jsonrpc: "2.0",
              error: {
                code: -32602,
                message:
                  error instanceof Error
                    ? error.message
                    : "Invalid project header",
              },
              id: modifiedBody.id || null,
            });
          }
          return;
        }

        const token = req.headers["authorization"];
        this.attachRequestMetadata(modifiedBody, token, projectFilter);
        await this.aggregatorServer
          .getTransport()
          .handleRequest(req, res, modifiedBody);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error",
            },
            id: null,
          });
        }
      }
    });
  }

  /**
   * 启动 HTTP 服务
   */
  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          resolve();
        });

        this.server.on("error", (error: Error) => {
          console.error("HTTP Server error:", error);
          reject(error);
        });
      } catch (error) {
        console.error("Failed to start HTTP Server:", error);
        reject(error);
      }
    });
  }

  /**
   * 停止 HTTP 服务
   */
  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error?: Error) => {
        if (error) {
          console.error("Error stopping HTTP Server:", error);
          reject(error);
          return;
        }

        this.server = null;
        resolve();
      });
    });
  }
}
