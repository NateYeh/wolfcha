/**
 * AI 调用日志系统
 * 记录所有 AI 调用用于复盘
 */

import type { ApiKeySource, LLMMessage, PromptCacheUsage } from "./llm";
import { extractPromptCacheUsage, resolveApiKeySource } from "./llm";
import { generateUUID } from "./utils";

const LOCAL_LOGS_STORAGE_KEY = "wolfcha_ai_logs";

const MAX_LOCAL_LOGS = 800;
/**
 * localStorage 每個來源只有幾 MB，而 AI 紀錄帶著完整 prompt（單筆約 10KB），
 * 只靠筆數上限會累積到數 MB，把配額吃光後連對局存檔都會失敗，因此再加一道位元組上限。
 * localStorage 以 UTF-16 計算，字元數 × 2 即為位元組估算值。
 */
const MAX_LOCAL_LOG_BYTES = 1_500_000;

// [LOCAL DEV PATCH] 落盤檔名：wolfcha-<YYYYMMDD-HHmmss>-<session 前 6 碼>.log。
// 檔名可排序，伺服器依檔名保留最新 N 局。
const LOG_FILE_PREFIX = "wolfcha";

function buildLogFileName(gameKey?: string | null, startedAt?: number | null): string {
  const date = new Date(typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : Date.now());
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const key = (gameKey ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6)
    || generateUUID().replace(/-/g, "").slice(0, 6);
  return `${LOG_FILE_PREFIX}-${stamp}-${key}.log`;
}

const AI_LOGGER_PAGE_LOAD_CLEAR_FLAG = "__wolfcha_ai_logger_page_load_cleared__";

/**
 * 重試等待。日誌落盤是 best-effort：在 Node（測試／SSR）下把計時器 unref，
 * 否則一串失敗重試（例如測試連續寫 400 筆，每筆 ~0.9s 退避）會讓行程
 * 跑完測試後仍被計時器釘住不退出。瀏覽器的 setTimeout 回傳數字，unref 不存在。
 */
function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms) as unknown as { unref?: () => void };
    timer.unref?.();
  });
}

function canUseStorage(): boolean {
  return process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined";
}

export interface AILogEntry {
  id: string;
  timestamp: number;
  type: "speech" | "vote" 
   | "badge_signup"
   | "badge_vote" 
   | "badge_transfer" 
   | "seer_action" 
   | "wolf_action" 
   | "guard_action" 
   | "witch_action" 
   | "hunter_shoot" | "wwk_boom_decision" | "character_generation" | "daily_summary" | "daily_summary_retry" | "wolf_chat"
  | "game_end_remark" | "self_destruct_decision" | "knight_duel_decision" | "mute_action" | "dream_action" | "wolf_beauty_action" | "analysis";
  request: {
    model: string;
    messages: LLMMessage[];
    apiKeySource?: ApiKeySource;
    temperature?: number;
    player?: {
      playerId: string;
      displayName: string;
      seat: number;
      role: string;
    };
  };
  response: {
    content: string;
    duration: number;
    raw?: string; // Original raw response content before processing
    rawResponse?: string; // Full API response object as JSON string
    finishReason?: string; // finish_reason from API response
    parsed?: unknown; // Parsed/structured result
    cache?: PromptCacheUsage; // Official provider cache counters normalized for reporting
    /** 實際向上游發出幾次請求（關鍵決策逾時會自動重試一次，>1 代表重試過）。 */
    attempts?: number;
    /** 失敗原因：upstream_timeout＝重試後仍逾時（該決策沒成立）；error＝其他錯誤。 */
    failure?: "upstream_timeout" | "error";
  };
  error?: string;
  /** 這筆失敗之後會自動重試，不是最終失敗；控制台降級成 warning 顯示。 */
  retrying?: boolean;
}

export type AILogListener = (entry: AILogEntry) => void | Promise<void>;

function parseCacheUsageFromRawResponse(rawResponse: string | undefined): PromptCacheUsage | undefined {
  if (!rawResponse) return undefined;
  try {
    const parsed = JSON.parse(rawResponse) as { usage?: unknown };
    const usage = parsed && typeof parsed === "object" ? parsed.usage : undefined;
    return extractPromptCacheUsage(usage as Parameters<typeof extractPromptCacheUsage>[0]);
  } catch {
    return undefined;
  }
}

class AILogger {
  private localCache: AILogEntry[] | null = null;
  private logFile: string | null = null;
  /** 檔案寫入序列鏈：批次事件（警徽報名一次 9 筆）會同時觸發多筆 POST，序列化避免爆量。 */
  private fileWriteChain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<AILogListener>();

  subscribe(listener: AILogListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private shouldPrint(): boolean {
    return typeof window !== "undefined" && process.env.NODE_ENV !== "production";
  }

  private loadLocalLogs(): AILogEntry[] {
    if (!canUseStorage()) return [];
    if (this.localCache) return this.localCache;
    try {
      const raw = window.localStorage.getItem(LOCAL_LOGS_STORAGE_KEY);
      if (!raw) {
        this.localCache = [];
        return this.localCache;
      }
      const parsed = JSON.parse(raw);
      this.localCache = Array.isArray(parsed) ? (parsed as AILogEntry[]) : [];
      return this.localCache;
    } catch {
      this.localCache = [];
      return this.localCache;
    }
  }

  private appendLocal(entry: AILogEntry) {
    if (!canUseStorage()) return;
    const logs = this.loadLocalLogs();
    logs.push(entry);

    let trimmed = logs.length > MAX_LOCAL_LOGS ? logs.slice(logs.length - MAX_LOCAL_LOGS) : logs;
    let serialized = JSON.stringify(trimmed);
    while (trimmed.length > 1 && serialized.length * 2 > MAX_LOCAL_LOG_BYTES) {
      trimmed = trimmed.slice(Math.max(1, Math.floor(trimmed.length / 4)));
      serialized = JSON.stringify(trimmed);
    }

    // 其他 key 佔用過多時仍有機會寫不進去，再丟掉一半最舊紀錄重試，
    // 避免 AI 紀錄把配額吃光後連對局存檔都一起失敗。
    for (;;) {
      try {
        window.localStorage.setItem(LOCAL_LOGS_STORAGE_KEY, serialized);
        break;
      } catch (error) {
        if (trimmed.length <= 1) {
          console.warn("[ai-logger] localStorage 寫入 AI 紀錄失敗，已放棄本次紀錄:", error);
          this.localCache = trimmed;
          return;
        }
        console.warn("[ai-logger] localStorage 配額不足，捨棄較舊的 AI 紀錄後重試:", error);
        trimmed = trimmed.slice(Math.max(1, Math.floor(trimmed.length / 2)));
        serialized = JSON.stringify(trimmed);
      }
    }

    this.localCache = trimmed;
  }

  async log(entry: Omit<AILogEntry, "id" | "timestamp">) {
    const fullEntry: AILogEntry = {
      ...entry,
      request: {
        ...entry.request,
        apiKeySource:
          entry.request.apiKeySource ??
          (typeof entry.request.model === "string" && entry.request.model.trim()
            ? resolveApiKeySource(entry.request.model)
            : undefined),
      },
      response: {
        ...entry.response,
        cache: entry.response.cache ?? parseCacheUsageFromRawResponse(entry.response.rawResponse),
      },
      id: generateUUID(),
      timestamp: Date.now(),
    };

    this.printToConsole(fullEntry);
    this.appendLocal(fullEntry);
    this.appendToFile(fullEntry);
    this.notify(fullEntry);

    return fullEntry;
  }

  /**
   * [LOCAL DEV PATCH] 指定本局要寫入的落盤檔名。同一局重複呼叫（例如重整後
   * 恢復）會算出相同檔名，因此會接續寫在同一個檔案。
   */
  startGameLog(gameKey?: string | null, startedAt?: number | null) {
    this.logFile = buildLogFileName(gameKey, startedAt);
  }

  /**
   * [LOCAL DEV PATCH] 將紀錄追加到本機日誌檔，讓紀錄能跨頁面重整保留。
   * 實際寫入位置由伺服器的 WOLFCHA_AI_LOG_DIR 決定；寫入失敗不影響遊戲。
   *
   * 不用 keepalive、逐筆排隊、失敗重試兩次：keepalive 請求同時在途有 64KB 上限，
   * 批次事件（例如警徽報名一次 log 9 筆）超量的請求會被瀏覽器靜默丟棄，
   * 導致每局的報名紀錄固定掉了後面幾筆；序列化＋重試讓紀錄完整落地。
   */
  private appendToFile(entry: AILogEntry) {
    if (!canUseStorage()) return;
    if (!this.logFile) this.logFile = buildLogFileName(null, null);
    const payload = JSON.stringify({ file: this.logFile, entry });
    this.fileWriteChain = this.fileWriteChain
      .then(() => this.postEntryWithRetry(payload))
      .catch(() => {
        // 檔案紀錄失敗時靜默處理，不干擾對局
      });
  }

  /** 逐筆 POST，失敗重試兩次（不阻擋後續寫入）。 */
  private async postEntryWithRetry(payload: string, attempt = 0): Promise<void> {
    try {
      await fetch("/api/dev-ai-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
    } catch {
      if (attempt < 2) {
        await waitForRetry(300 * (attempt + 1));
        return this.postEntryWithRetry(payload, attempt + 1);
      }
    }
  }

  private notify(entry: AILogEntry) {
    for (const listener of [...this.listeners]) {
      try {
        void Promise.resolve(listener(entry)).catch(() => {
          // ignore listener failures
        });
      } catch {
        // ignore listener failures
      }
    }
  }

  private printToConsole(entry: AILogEntry) {
    if (!this.shouldPrint()) return;

    const typeColors: Record<string, string> = {
      speech: "#4CAF50",
      vote: "#2196F3",
      badge_vote: "#B8860B",
      badge_transfer: "#DAA520",
      seer_action: "#9C27B0",
      wolf_action: "#f44336",
      wolf_chat: "#8D6E63",
      guard_action: "#00BCD4",
      witch_action: "#E91E63",
      hunter_shoot: "#FF5722",
      character_generation: "#FF9800",
      daily_summary: "#795548",
      analysis: "#009688",
    };

    const color = typeColors[entry.type] || "#666";
    
    console.groupCollapsed(
      `%c[AI] ${entry.type.toUpperCase()}`,
      `color: ${color}; font-weight: bold;`,
      entry.request.player?.displayName || "System",
      `(${entry.response.duration}ms)`
    );
    
    console.log("Model:", entry.request.model);
    console.log("API Key Source:", entry.request.apiKeySource);
    console.log("Messages:", entry.request.messages);
    console.log("Response:", entry.response.content);
    if (entry.response.raw && entry.response.raw !== entry.response.content) {
      console.log("Raw Response:", entry.response.raw);
    }
    if (entry.response.parsed) {
      console.log("Parsed Result:", entry.response.parsed);
    }
    if (entry.response.cache) {
      console.log("Prompt Cache:", entry.response.cache);
    }
    console.log("Duration:", `${entry.response.duration}ms`);
    if (entry.error) {
      if (entry.retrying) console.warn("Error（即将自动重试）:", entry.error);
      else console.error("Error:", entry.error);
    }
    console.groupEnd();
  }

  async getLogs(): Promise<AILogEntry[]> {
    return this.loadLocalLogs();
  }

  async clearLogs() {
    if (canUseStorage()) {
      try {
        window.localStorage.removeItem(LOCAL_LOGS_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    this.localCache = [];
  }

  async clearLogsOncePerPageLoad() {
    if (typeof window === "undefined") return;
    const w = window as unknown as Record<string, unknown>;
    if (w[AI_LOGGER_PAGE_LOAD_CLEAR_FLAG] === true) return;
    w[AI_LOGGER_PAGE_LOAD_CLEAR_FLAG] = true;
    await this.clearLogs();
  }
}

export const aiLogger = new AILogger();
