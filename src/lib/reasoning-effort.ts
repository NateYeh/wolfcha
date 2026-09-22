/**
 * 推理模型的思考量（reasoning_effort）解析。
 *
 * 自架 gpt-load 閘道器（上游 Ollama Cloud 的 OpenAI 相容端點）實際看的欄位是
 * `reasoning_effort`；`thinking` / `think` / `reasoning.enabled` / `enable_thinking` /
 * `chat_template_kwargs` 實測全是空操作（reasoning 照樣輸出）。
 *
 * 而且「有效值」逐模型不同（2026-09-22 實測，約 8–10k tokens prompt、max_tokens 3000、各兩次）：
 * - deepseek-v4.1-flash：none＝完全關閉思考（23.6s→1.9s、reasoning 0 字）；
 *   low/minimal 幾乎無效（22.9s／19.5s，思考仍近 4,000 字）。
 * - glm-5.3-flash：low 最有效（27.9s→2.9s、思考 80–232 字）；
 *   none 反而把思考擠進正文（31.7s、內容上千字）；minimal 無效。
 * - gemma4:31b：本來就不思考；送 low 反而開啟思考（1.3s→6.9s），只能不送。
 *
 * 因此預設值必須逐模型給，不能全域一個值；設定優先序（高→低）：
 *   1. WOLFCHA_REASONING_EFFORT_MAP（逐模型覆寫，格式見下）
 *   2. 內建表 DEFAULT_MODEL_REASONING_EFFORTS
 *   3. WOLFCHA_REASONING_EFFORT（舊的全域值，只影響內建表沒涵蓋的模型）
 */

/** 依模型名稱樣式給預設思考量；空字串＝不送 reasoning_effort（維持上游預設）。 */
export const DEFAULT_MODEL_REASONING_EFFORTS: ReadonlyArray<{ pattern: RegExp; effort: string }> = [
  { pattern: /deepseek/i, effort: "none" },
  { pattern: /glm|kimi/i, effort: "low" },
  { pattern: /gemma/i, effort: "" },
];

/** 上游接受的 reasoning_effort 值。 */
export const REASONING_EFFORT_VALUES: ReadonlyArray<string> = ["none", "minimal", "low", "medium", "high"];

export type ReasoningEffortEnv = Readonly<Record<string, string | undefined>>;

const isEffortValue = (value: string): boolean => REASONING_EFFORT_VALUES.includes(value);

/**
 * 解析逐模型覆寫表：`deepseek=none,glm=low,gemma=`
 * 值留空代表「這個模型不送 reasoning_effort」。
 */
function parseEffortMap(raw: string | undefined): ReadonlyArray<{ keyword: string; effort: string }> {
  const entries: Array<{ keyword: string; effort: string }> = [];
  for (const chunk of (raw ?? "").split(",")) {
    const item = chunk.trim();
    if (!item) continue;
    const separator = item.indexOf("=");
    if (separator <= 0) {
      console.warn(`[chat] WOLFCHA_REASONING_EFFORT_MAP 片段無效（${item}），已忽略`);
      continue;
    }
    const keyword = item.slice(0, separator).trim().toLowerCase();
    const value = item.slice(separator + 1).trim().toLowerCase();
    if (!keyword) {
      console.warn(`[chat] WOLFCHA_REASONING_EFFORT_MAP 片段缺少模型關鍵字（${item}），已忽略`);
      continue;
    }
    if (value !== "" && !isEffortValue(value)) {
      console.warn(`[chat] WOLFCHA_REASONING_EFFORT_MAP 的值無效（${item}），已忽略`);
      continue;
    }
    entries.push({ keyword, effort: value });
  }
  return entries;
}

/**
 * 決定某個模型要送出的 reasoning_effort；回傳 undefined 表示不送這個欄位。
 * env 以參數注入，方便測試。
 */
export function resolveReasoningEffort(
  model: string,
  env: ReasoningEffortEnv = process.env,
): string | undefined {
  const name = String(model ?? "").toLowerCase();

  const mapped = parseEffortMap(env.WOLFCHA_REASONING_EFFORT_MAP)
    .find((entry) => name.includes(entry.keyword));
  if (mapped) return mapped.effort === "" ? undefined : mapped.effort;

  const builtin = DEFAULT_MODEL_REASONING_EFFORTS.find((entry) => entry.pattern.test(name));
  if (builtin) return builtin.effort === "" ? undefined : builtin.effort;

  // 內建表沒涵蓋的模型（例如日後新增的別名）才吃舊的全域設定。
  const global = (env.WOLFCHA_REASONING_EFFORT ?? "").trim().toLowerCase();
  if (global === "") return undefined;
  if (!isEffortValue(global)) {
    console.warn(`[chat] WOLFCHA_REASONING_EFFORT 設定無效（${global}），已忽略`);
    return undefined;
  }
  return global;
}
