/**
 * Activity Log 相关类型定义
 * 用于可视化 ToolDiscovery / ToolExecute 日志
 */

/**
 * 活动日志种别
 */
export type ActivityType =
  | "ToolDiscovery"
  | "ToolExecute"
  | "CallTool" // 直接ツール呼び出し
  | "GetPrompt" // プロンプト取得
  | "ReadResource"; // リソース読み取り

/**
 * アクティビティログエントリ
 */
export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  clientId: string;
  clientName: string;
  type: ActivityType;
  // ToolDiscoveryの場合
  query?: string[];
  context?: string;
  discoveredTools?: {
    toolKey: string;
    toolName: string;
    serverName: string;
    relevance: number;
  }[];
  // ToolExecuteの場合
  toolKey?: string;
  toolName?: string;
  serverName?: string;
  arguments?: Record<string, unknown>;
  // 共通
  status: "success" | "error";
  duration: number;
  errorMessage?: string;
  // レスポンスデータ
  responseData?: unknown;

  // GetPromptの場合
  promptName?: string;

  // ReadResourceの場合
  resourceUri?: string;
}

/**
 * ToolDiscoveryとその後のToolExecuteをグループ化したセッション
 */
export interface ActivitySession {
  id: string;
  timestamp: number; // セッション開始時刻（ToolDiscoveryの時刻）
  clientId: string;
  clientName: string;
  // ToolDiscovery情報
  discovery: ActivityLogEntry;
  // 関連するToolExecute（発見されたツールを実行したもの）
  executions: ActivityLogEntry[];
}

/**
 * セッションまたは単独のToolExecute
 */
export type ActivityItem =
  | { type: "session"; session: ActivitySession }
  | { type: "standalone"; entry: ActivityLogEntry };
