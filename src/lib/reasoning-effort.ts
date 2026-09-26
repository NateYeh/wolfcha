/**
 * 推理模型的思考量（reasoning_effort）解析。
 *
 * 自架 gpt-load 閘道器（上游 Ollama Cloud 的 OpenAI 相容端點）實際看的欄位是
 * `reasoning_effort`；`thinking` / `think` / `reasoning.enabled` / `enable_thinking` /
 * `chat_template_kwargs` 實測全是空操作（reasoning 照樣輸出）。
 *
 * 各值實測差異（2026-09-22，約 8–10k tokens prompt、max_tokens 3000、各兩次）：
 * - `none`：deepseek 完全關閉思考（23.6s→1.9s、reasoning 0 字）、glm 反而把思考擠進正文
 *   （31.7s、內容上千字）、gemma 中性。→ 快，但**實戰認知明顯變差**（使用者於對局中裁定不用）。
 * - `low`：glm 2.9s（思考 80–232 字）；deepseek 22.9s（思考仍約 4,000 字）；
 *   gemma 6.9s（本來不思考，送 low 會開啟思考）。
 * - `minimal`：三個模型都幾乎無效。
 *
 * 現行政策（使用者裁定）：**一律 `low`**——關思考雖然快，但 AI 的判斷力掉太多，
 * 寧可慢一點；配合 `API_TIMEOUT_MS` 放寬到 180 秒（src/app/api/chat/route.ts）。
 *
 * 優先序（高→低）：WOLFCHA_REASONING_EFFORT_MAP → WOLFCHA_REASONING_EFFORT → 內建 low。
 */

/** 未指定時的預設思考量；空字串＝不送 reasoning_effort（維持上游預設）。 */
export const DEFAULT_REASONING_EFFORT = "low";

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

/** 讀全域設定（WOLFCHA_REASONING_EFFORT），無效值 warn 後回 undefined。 */
function globalReasoningEffort(raw: string | undefined): string | undefined {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return undefined;
  if (!isEffortValue(value)) {
    console.warn(`[chat] WOLFCHA_REASONING_EFFORT 設定無效（${value}），已忽略`);
    return undefined;
  }
  return value;
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

  const global = globalReasoningEffort(env.WOLFCHA_REASONING_EFFORT);
  if (global) return global;

  return DEFAULT_REASONING_EFFORT;
}
