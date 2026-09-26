/**
 * 請求「快取鍵指紋」。
 *
 * 用途：上游（gpt-load2 → Ollama Cloud）的前綴快取只認「模型 ＋ 部分請求參數」。當命中率
 * 出現分裂時（例：某型別全 0、另一型別卻 90%），需要一組**與快取鍵同義**的指紋，才能判斷
 * 「是不是請求參數不同」。指紋**不參與請求**，只寫進 AI 紀錄供事後比對。
 *
 * 指紋只納入**實測會影響上游快取鍵**的欄位，否則會製造假警報、讓「同指紋＝同快取鍵」
 * 這個推論失真：
 *
 * 2026-09-26 對閘道器實測（`deepseek-v4.1-flash:cloud`、同一份 system 訊息、單發序列）：
 * - `reasoning_effort` 的值**會**換鍵（`low` 對 `low` 命中、`low` 對不送＝0 命中）→ **納入**。
 * - `response_format`（含 `json_schema` 的 name 與 schema 內容，實測 `day_vote` vs
 *   `public_speech`）、`prompt_scope`、`temperature`、`max_tokens` **都不影響** → **不納入**。
 * - `request_id` 每次唯一，但發言照樣命中 16k–21k → 不影響 → **不納入**。
 * - 真實 `vote` 請求本體（同一份 system）重播 → 命中 15872，證明請求形狀沒問題。
 *
 * 因此指紋＝`model` ＋ `provider` ＋ `reasoningEffort`。若兩個呼叫指紋相同卻命中率分裂，
 * 那就是**請求參數以外**的原因（上游路由、快取存活期、併發時序）。
 *
 * 限制：`reasoning_effort` 由伺服器在 `/api/chat` 依模型附加（`applyReasoningEffort`），
 * 客戶端算指紋時拿不到，故多數情況是空字串。該值是 `(model, env)` 的純函式，同一模型下
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
  reasoningEffort?: string;
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

/** 由請求參數算出指紋；欄位順序固定（正規化後再雜湊），所以組裝方式不影響結果。 */
export function buildCacheKeyInfo(ingredients: CacheKeyIngredients): CacheKeyInfo {
  const normalized: Record<string, string | number | boolean> = {
    model: ingredients.model ?? "",
    provider: ingredients.provider ?? "",
    reasoningEffort: ingredients.reasoningEffort ?? "",
  };
  const canonical = JSON.stringify(normalized);
  return {
    fingerprint: `${fnv1a(canonical, 0x811c9dc5)}${fnv1a(canonical, 0x9e3779b9)}`,
    ingredients: normalized,
  };
}
