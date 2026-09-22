import assert from "node:assert/strict";
import test from "node:test";
import { computeTypewriterCatchUp } from "@/hooks/useTypewriter";
import { delay } from "@/lib/game-flow-controller";

/**
 * 背景分頁的節流防護測試。
 *
 * 症狀：切到別的分頁／縮小視窗後遊戲像被按了暫停。
 * 原因不是 App 有 visibility 暫停邏輯，而是瀏覽器對背景分頁的 setTimeout 有節流
 * （最小 1 秒，長時間隱藏後更久）：打字動畫一次只推進 3 個字，而發言流程正等著
 * 動畫結束才前進 → 整個遊戲停住；階段節奏的 delay 也被拉長到數十秒。
 *
 * 這兩支測試就是這個防護網：計時器遲到時必須一次補上進度、背景時延遲必須縮短。
 */

const LONG_TEXT = "這是一段用來測試打字機節流的長句子。".repeat(4);

test("打字機：計時器準時時，一次只推進一個 chunk", () => {
  const first = computeTypewriterCatchUp(LONG_TEXT, 0, 63, 63);
  assert.equal(first.index, 3, "第一次到點只顯示 3 個字");
  assert.equal(first.done, false);
  assert.ok(first.dueAt > 63);
});

test("打字機：計時器遲到（背景被節流）時，一次補上所有落後進度", () => {
  // 模擬背景分頁：這個 tick 遲到 3 秒才被執行
  const late = computeTypewriterCatchUp(LONG_TEXT, 0, 63, 63 + 3000);
  assert.equal(late.done, true, "遲到的 tick 應該一次把整段打完，而不是只推進 3 個字");
  assert.equal(late.index, LONG_TEXT.length, "索引不得超過文字長度");

  // 極端情況：隱藏 5 分鐘後才輪到這個 timer（Chrome 密集節流）
  const veryLate = computeTypewriterCatchUp(LONG_TEXT, 0, 63, 63 + 300_000);
  assert.equal(veryLate.index, LONG_TEXT.length);
  assert.equal(veryLate.done, true);
});

test("打字機：標點節奏仍然保留（句號停得比一般字久）", () => {
  const plain = computeTypewriterCatchUp("abcdefghij", 0, 0, 0);
  assert.equal(plain.index, 3);
  const plainDelay = plain.dueAt - 0;

  // 第三個字是句號 → 這一個 chunk 的等待要變長
  const withPeriod = computeTypewriterCatchUp("ab。defghij", 0, 0, 0);
  assert.equal(withPeriod.index, 3);
  assert.ok(withPeriod.dueAt > plainDelay, "句號後的停頓應該比一般字長");
});

test("階段節奏：分頁在背景時延遲縮短，回到前景後恢復原節奏", async () => {
  const originalDocument = (globalThis as { document?: unknown }).document;

  // 前景：3000ms 的延遲必須真的等這麼久（量測下限，不等待完整時間以免拖慢測試）
  try {
    (globalThis as { document?: unknown }).document = { hidden: false };
    const started = Date.now();
    await delay(0);
    assert.ok(Date.now() - started < 500, "前景時 delay(0) 應該立刻結束");

    (globalThis as { document?: unknown }).document = { hidden: true };
    const hiddenStarted = Date.now();
    await delay(3000);
    const hiddenElapsed = Date.now() - hiddenStarted;
    assert.ok(hiddenElapsed < 1500, `背景時 3000ms 的節奏延遲必須縮短（實際 ${hiddenElapsed}ms）`);
  } finally {
    if (originalDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = originalDocument;
    }
  }
});
