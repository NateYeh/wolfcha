/**
 * 請求「快取鍵指紋」。
 *
 * 用途：上游（gpt-load2 → Ollama Cloud）的前綴快取只認「模型 ＋ 部分請求參數」。當命中率
 * 出現分裂時（例：放逐投票 18/18 全 0，發言卻 26/27 命中 16k–21k），需要一組可比對的欄位
 * 指紋，才能判斷「是不是請求參數不同」。指紋**不參與請求**，只寫進 AI 紀錄供事後比對。
 *
 * 2026-09-26 對閘道器實測（`deepseek-v4.1-flash:cloud`、同一份 system 訊息、單發序列）：
 * - `reasoning_effort` 的值**會**換鍵：`low` 對 `low` 命中、`low` 對不送＝0 命中。
 * - `response_format`（含 `json_schema` 的 name 與 schema 內容，實測 `day_vote` vs
 *   `public_speech`）、`prompt_scope`、`temperature`、`max_tokens` **都不影響**命中。
 * 也就是說：指紋裡的欄位不一定全是快取鍵，但只要是「呼叫類型之間可能不同」的參數就納入，
 * 這樣任一欄位漂移都會在比對時直接現形。
 *
 * 限制：`reasoning_effort` 由伺服器在 `/api/chat` 依模型附加（`applyReasoningEffort`），
 * 客戶端算指紋時拿不到，因此**不納入**指紋。該值是 `(model, env)` 的純函式，同一個模型下
 * 所有呼叫必然同值，不影響「偵測呼叫類型之間的差異」這個用途。
 */

/** 指紋與其來源欄位。 */
export interface CacheKeyInfo {
  /** 16 碼十六進位（兩組 32-bit 雜湊）。同鍵同值、不同鍵不同值。 */
  fingerprint: string;
  /** 產生指紋的正規化欄位；並排比較時可直接看出是哪一欄不同。 */
  ingredients: Record<string, string | number | boolean>;
}

export interface CacheKeyIngredients {
  model?: string;
  provider?: string;
  promptScope?: string;
  reasoningEffort?: string;
  responseFormat?: unknown;
  temperature?: number;
  maxTokens?: number;
  hasRequestId?: boolean;
}

/** 32-bit FNV-1a，種子可換；不依賴 `node:crypto`，瀏覽器與伺服器都能算。 */
function fnv1a(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 把 `response_format` 收斂成可比較的字串：`json_schema:day_vote`／`json_object`／`none`。
 * 只取型別與名稱，不含 schema 內容（實測內容不影響上游快取鍵）。
 */
export function describeResponseFormat(responseFormat: unknown): string {
  if (!responseFormat || typeof responseFormat !== "object") return "none";
  const record = responseFormat as { type?: unknown; json_schema?: { name?: unknown } };
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "json_schema") {
    const name = record.json_schema?.name;
    return `json_schema:${typeof name === "string" && name ? name : "unnamed"}`;
  }
  return type || "none";
}

/** 由請求參數算出指紋；欄位順序固定（正規化後再雜湊），所以組裝方式不影響結果。 */
export function buildCacheKeyInfo(ingredients: CacheKeyIngredients): CacheKeyInfo {
  const normalized: Record<string, string | number | boolean> = {
    model: ingredients.model ?? "",
    provider: ingredients.provider ?? "",
    promptScope: ingredients.promptScope ?? "",
    reasoningEffort: ingredients.reasoningEffort ?? "",
    responseFormat: describeResponseFormat(ingredients.responseFormat),
    temperature: ingredients.temperature ?? "",
    maxTokens: ingredients.maxTokens ?? "",
    hasRequestId: ingredients.hasRequestId === true,
  };
  const canonical = JSON.stringify(normalized);
  return {
    fingerprint: `${fnv1a(canonical, 0x811c9dc5)}${fnv1a(canonical, 0x9e3779b9)}`,
    ingredients: normalized,
  };
}
