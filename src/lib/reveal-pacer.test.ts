import assert from "node:assert/strict";
import test from "node:test";
import { createRevealPacer } from "./reveal-pacer";

/**
 * 計時器抖動容許值（毫秒）。
 *
 * 這條測試量的是 wall-clock：`setTimeout(200)` 在滿載 runner 上會早 1–3ms 觸發
 * （2026-09-26 CI 就紅在 `revealedAt[2] >= 200`），`delay(40)` 同理。節奏器的契約是
 * 「至少 minGapMs，受計時器精度影響」，不是逐毫秒相等，所以斷言一律減掉這個容許值。
 */
const TIMER_JITTER_MS = 10;

const MIN_GAP_MS = 40;

test("逐票節奏器：先回傳的先顯示，只保證最小間隔", async () => {
  const revealed: number[] = [];
  const revealedAt: number[] = [];
  const pace = createRevealPacer(MIN_GAP_MS);

  const start = Date.now();
  // 模擬三席不同時間回傳：0ms、10ms、200ms
  const slow = (delayMs: number, seat: number) =>
    new Promise<void>((resolve) => {
      setTimeout(() => {
        void pace(() => {
          revealed.push(seat);
          revealedAt.push(Date.now() - start);
        }).then(resolve);
      }, delayMs);
    });

  await Promise.all([slow(0, 1), slow(10, 2), slow(200, 3)]);

  // 全部都有顯示，且順序就是回傳順序
  assert.deepEqual(revealed, [1, 2, 3]);
  // 第 1、2 席幾乎同時回傳 → 第 2 席要等最小間隔才顯示，但不必等第 3 席。
  assert.ok(
    revealedAt[1] - revealedAt[0] >= MIN_GAP_MS - TIMER_JITTER_MS,
    `相鄰兩票間隔不足（應 >= ${MIN_GAP_MS}ms，容許 ${TIMER_JITTER_MS}ms 抖動）：${JSON.stringify(revealedAt)}`
  );
  assert.ok(revealedAt[1] < 150, `先回傳的票不該等到最後一席才顯示：${JSON.stringify(revealedAt)}`);
  // 第 3 席自己回傳得晚（setTimeout(200) 可能早幾毫秒觸發），之後立刻顯示、不被前兩席拖累。
  assert.ok(
    revealedAt[2] >= 200 - TIMER_JITTER_MS,
    `第 3 席不該早於自己回傳的時間顯示：${JSON.stringify(revealedAt)}`
  );
  assert.ok(
    revealedAt[2] - revealedAt[1] >= MIN_GAP_MS - TIMER_JITTER_MS,
    `第 3 席與前一票的間隔不足（容許 ${TIMER_JITTER_MS}ms 抖動）：${JSON.stringify(revealedAt)}`
  );
});
