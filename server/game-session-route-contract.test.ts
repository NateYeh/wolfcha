import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/app/api/game-sessions/route.ts"), "utf8");

/**
 * 真正的 create／update handler 從 `effectiveUserId` 之後才開始。
 * 檔案前面另有一個 `isLocalDemoMode()` 的本地開發分支，也叫同樣的 action 名稱；
 * 用「首次出現」切區塊會切到那個 4 行小區塊，斷言就在錯誤的位置上驗證而靜默失效。
 * 因此先確認錨點存在再切片：錨點消失時要大聲失敗，不能退回錯誤區塊。
 */
const handlerAnchor = source.indexOf("const effectiveUserId");
const createAnchor = source.indexOf('if (payload.action === "create")', handlerAnchor);
const updateAnchor = source.indexOf('if (payload.action === "update")', handlerAnchor);

test("原始碼錨點存在（契約失效時要大聲失敗，不驗錯區塊）", () => {
  assert.ok(handlerAnchor > 0, "找不到 effectiveUserId 錨點");
  assert.ok(createAnchor > handlerAnchor, "找不到 create handler");
  assert.ok(updateAnchor > createAnchor, "找不到 update handler");
});

const createBlock = source.slice(createAnchor, updateAnchor);
const updateBlock = source.slice(updateAnchor);

test("游戏会话更新写入生命周期和起止时间，不接收客户端 AI 统计", () => {
  assert.match(updateBlock, /lifecycle_status: payload\.lifecycleStatus/);
  assert.match(createBlock, /started_at: nowIso/);
  assert.match(updateBlock, /ended_at: isTerminal \? nowIso : null/);
  assert.match(updateBlock, /canTransitionLifecycle/);
  assert.match(updateBlock, /\.eq\("lifecycle_status", currentStatus\)/);
  assert.match(updateBlock, /Game session changed concurrently/);
  assert.doesNotMatch(source, /recordGameSessionEvent/);
  for (const field of [
    "aiCallsCount",
    "aiInputChars",
    "aiOutputChars",
    "aiPromptTokens",
    "aiCompletionTokens",
  ]) {
    assert.doesNotMatch(updateBlock, new RegExp(`\\b${field}\\b`));
  }
});
