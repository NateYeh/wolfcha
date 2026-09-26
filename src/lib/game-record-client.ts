import type { GameAnalysisData } from "@/types/analysis";
import { getAuthHeaders } from "@/lib/auth-headers";
import { withTimeout } from "@/lib/request-timeout";

/**
 * 遊玩紀錄的客戶端寫入。
 *
 * 在**完賽且賽後分析完成後**呼叫——紀錄就是賽後分析本身（整局對話、夜晚行動、角色身分），
 * 因此不會多花任何模型呼叫。重複觸發（例如分析重跑）是同一個 gameId，伺服器覆蓋同一筆。
 */

const SAVE_TIMEOUT_MS = 15_000;

export type SaveGameRecordResult = { ok: true } | { ok: false; reason: string };

export async function saveGameRecord(
  analysis: GameAnalysisData,
  options: { difficulty?: string } = {},
): Promise<SaveGameRecordResult> {
  try {
    const headers = await getAuthHeaders();
    const response = await withTimeout(
      fetch("/api/game-records", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ analysis, difficulty: options.difficulty }),
      }),
      SAVE_TIMEOUT_MS,
    );

    if (!response.ok) {
      // 不靜默：把狀態與伺服器訊息留在 console，失敗仍不影響遊戲（紀錄是本機外的備份）。
      const detail = await response.text().catch(() => "");
      console.warn(`[game-records] 存檔失敗（HTTP ${response.status}）: ${detail.slice(0, 200)}`);
      return { ok: false, reason: `http_${response.status}` };
    }

    return { ok: true };
  } catch (error) {
    console.warn("[game-records] 存檔失敗（連線或逾時）:", error);
    return { ok: false, reason: "network" };
  }
}
