import { ParsedPaymentError } from "@mcp_router/shared";

/**
 * 错误消息解析工具（离线客户端不再有付费错误，始终返回原文）
 */
export function parseErrorMessage(errorMessage: string): ParsedPaymentError {
  const result: ParsedPaymentError = {
    isPaymentError: false,
    displayMessage: errorMessage,
    originalMessage: errorMessage,
  };

  try {
    const parsed = JSON.parse(errorMessage);
    if (parsed.message) {
      result.displayMessage = parsed.message;
    }
  } catch {
    // 非 JSON，按纯文本处理
  }

  return result;
}
