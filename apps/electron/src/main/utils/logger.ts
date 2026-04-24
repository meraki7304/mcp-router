import { isDevelopment } from "./environment";

export function logInfo(...args: any[]): void {
  if (isDevelopment()) {
    console.log("[INFO]", JSON.stringify(args));
  }
}

// 错误日志在生产环境中也会输出
export function logError(...args: any[]): void {
  console.error("[ERROR]", ...args);
}
