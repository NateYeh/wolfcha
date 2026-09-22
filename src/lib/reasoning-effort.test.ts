import assert from "node:assert/strict";
import test from "node:test";
import { resolveReasoningEffort } from "@/lib/reasoning-effort";

// 使用者裁定：關思考（none）雖然快，但實戰認知明顯變差，因此一律 low，
// 逾時放寬到 120 秒。逐模型差異見 src/lib/reasoning-effort.ts 檔頭實測註解。

test("未設定時：所有模型一律送 low", () => {
  for (const model of [
    "deepseek-v4.1-flash:cloud",
    "glm-5.3-flash:cloud",
    "gemma4:31b-cloud",
    "qwen3-max",
    "DeepSeek-V4-Pro:0813-Cloud",
  ]) {
    assert.equal(resolveReasoningEffort(model, {}), "low", model);
  }
});

test("全域 WOLFCHA_REASONING_EFFORT 覆寫預設值", () => {
  assert.equal(resolveReasoningEffort("deepseek-v4.1-flash:cloud", { WOLFCHA_REASONING_EFFORT: "none" }), "none");
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", { WOLFCHA_REASONING_EFFORT: "medium" }), "medium");
  // 兩側空白與大小寫都容忍
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", { WOLFCHA_REASONING_EFFORT: " HIGH " }), "high");
});

test("全域值無效時 warn 後回退內建 low，不靜默失敗", () => {
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", { WOLFCHA_REASONING_EFFORT: "超高" }), "low");
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", { WOLFCHA_REASONING_EFFORT: "   " }), "low");
});

test("WOLFCHA_REASONING_EFFORT_MAP 逐模型覆寫優先於全域與預設", () => {
  const env = {
    WOLFCHA_REASONING_EFFORT: "low",
    WOLFCHA_REASONING_EFFORT_MAP: "deepseek=none,glm=medium,gemma=minimal,qwen=high",
  };
  assert.equal(resolveReasoningEffort("deepseek-v4.1-flash:cloud", env), "none");
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", env), "medium");
  assert.equal(resolveReasoningEffort("gemma4:31b-cloud", env), "minimal");
  assert.equal(resolveReasoningEffort("qwen3-max", env), "high");
  // 表外的模型才吃全域值
  assert.equal(resolveReasoningEffort("kimi-k2.5", env), "low");
});

test("MAP 的值留空＝該模型不送 reasoning_effort", () => {
  const env = { WOLFCHA_REASONING_EFFORT_MAP: "gemma=,glm=low" };
  assert.equal(resolveReasoningEffort("gemma4:31b-cloud", env), undefined);
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", env), "low");
});

test("MAP 的無效片段忽略，不影響其他片段與後續回退", () => {
  const env = { WOLFCHA_REASONING_EFFORT_MAP: "沒有等號,deepseek=超高,glm=none" };
  // deepseek 的無效值被丟掉 → 回退內建 low
  assert.equal(resolveReasoningEffort("deepseek-v4.1-flash:cloud", env), "low");
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", env), "none");
});

test("MAP 比對不分大小寫，且認得模型名裡的關鍵字", () => {
  const env = { WOLFCHA_REASONING_EFFORT_MAP: "DeepSeek=high" };
  assert.equal(resolveReasoningEffort("deepseek-v4.1-flash:cloud", env), "high");
  assert.equal(resolveReasoningEffort("provider/DEEPSEEK-chat", env), "high");
  assert.equal(resolveReasoningEffort("glm-5.3-flash:cloud", env), "low");
});
