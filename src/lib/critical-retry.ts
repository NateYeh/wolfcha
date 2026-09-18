import { isUpstreamTimeoutError } from "./upstream-timeout";

/**
 * 關鍵決策的一次性重試。
 *
 * 守衛、狼刀、女巫用藥（解藥／毒藥）、預言家驗人、警徽移交、獵人開槍、
 * 白狼王自爆，這些都是一次定生死、錯過就沒了的步驟。上游模型逾時
 * （route 等滿 API_TIMEOUT_MS 沒回應）時若直接作廢，等於白送：
 * 實例是獵人被票出去、開槍請求逾時，程式把「沒有回應」當成「不開槍」，
 * 槍就消失了。
 *
 * 因此這些步驟遇逾時會再試一次；其他錯誤（Key 無效、餘額不足、對局過期…）
 * 重試沒有意義，直接往上拋，讓呼叫端走原本的備援。
 */

/** 逾時後重試前的等待：讓上游有機會從瞬時超載恢復。 */
export const CRITICAL_RETRY_DELAY_MS = 1_000;

export interface CriticalRetryOptions {
  /** 總請求次數（含第一次），預設 2 ＝重試一次。 */
  maxAttempts?: number;
  delayMs?: number;
}

export async function withCriticalRetry<T>(
  label: string,
  run: () => Promise<T>,
  options: CriticalRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const delayMs = options.delayMs ?? CRITICAL_RETRY_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isUpstreamTimeoutError(error)) throw error;
      if (attempt >= maxAttempts) break;
      console.warn(
        `[critical-retry] ${label} 上游逾時（第 ${attempt} 次），自動重試一次`,
        error instanceof Error ? error.message : error,
      );
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
