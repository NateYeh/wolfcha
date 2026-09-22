import assert from "node:assert/strict";
import test from "node:test";
import { resolveReasoningEffort } from "@/lib/reasoning-effort";

// 實測基準（約 8–10k tokens prompt、max_tokens 3000、各兩次）：
// deepseek 未設 23.6s → none 1.9s；glm 未設 27.9s → low 2.9s；
// gemma 未設 1.3s，送 low 反而變 6.9s。逐模型值因此寫死在內建表。

test("內建表：deepseek 關思考、glm 降思考、gemma 不送欄位", () => {
  assert.equal(resolveReasoningEffort("deepseek-v4.1-flash:cloud", {}), "none");
  assert.equal(resolveReasoningEffort("deepseek-v4-pro:0813-cloud", {}), "none");
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", {}), "low");
  assert.equal(resolveReasoningEffort("glm-5.3:cloud", {}), "low");
  // gemma 本來就不思考，送 low 會開啟思考並變慢，只能不送。
  assert.equal(resolveReasoningEffort("gemma4:31b-cloud", {}), undefined);
});

test("內建表比對不分大小寫，且認得模型名裡的關鍵字", () => {
  assert.equal(resolveReasoningEffort("DeepSeek-V4.1-Flash:Cloud", {}), "none");
  assert.equal(resolveReasoningEffort("provider/GLM-5.3-Flash", {}), "low");
  assert.equal(resolveReasoningEffort("google/gemma-4-31b-it:free", {}), undefined);
});

test("舊的全域設定只影響內建表沒涵蓋的模型", () => {
  const env = { WOLFCHA_REASONING_EFFORT: "medium" };
  // 內建表優先，深尋仍是 none（全域 medium 不得覆蓋它）。
  assert.equal(resolveReasoningEffort("deepseek-v4.1-flash:cloud", env), "none");
  assert.equal(resolveReasoningEffort("gemma4:31b-cloud", env), undefined);
  // 表外模型才吃全域值。
  assert.equal(resolveReasoningEffort("qwen3-max", env), "medium");
});

test("全域設定值無效時忽略並保留不送欄位", () => {
  assert.equal(resolveReasoningEffort("qwen3-max", { WOLFCHA_REASONING_EFFORT: "超高" }), undefined);
  assert.equal(resolveReasoningEffort("qwen3-max", { WOLFCHA_REASONING_EFFORT: "  " }), undefined);
});

test("WOLFCHA_REASONING_EFFORT_MAP 逐模型覆寫優先於內建表", () => {
  const env = { WOLFCHA_REASONING_EFFORT_MAP: "deepseek=low,glm=none,gemma=minimal,qwen=high" };
  assert.equal(resolveReasoningEffort("deepseek-v4.1-flash:cloud", env), "low");
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", env), "none");
  assert.equal(resolveReasoningEffort("gemma4:31b-cloud", env), "minimal");
  assert.equal(resolveReasoningEffort("qwen3-max", env), "high");
});

test("MAP 的值留空＝該模型不送 reasoning_effort", () => {
  const env = { WOLFCHA_REASONING_EFFORT_MAP: "gemma=,glm=low" };
  assert.equal(resolveReasoningEffort("gemma4:31b-cloud", env), undefined);
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", env), "low");
});

test("MAP 的無效片段忽略，不影響其他片段", () => {
  const env = { WOLFCHA_REASONING_EFFORT_MAP: "沒有等號,deepseek=超高,glm=low" };
  // deepseek 的無效值被丟掉 → 回退內建表（none），而不是整份地圖失效。
  assert.equal(resolveReasoningEffort("deepseek-v4.1-flash:cloud", env), "none");
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", env), "low");
});
