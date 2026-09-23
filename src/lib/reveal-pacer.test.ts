import assert from "node:assert/strict";
import test from "node:test";
import { createRevealPacer } from "./reveal-pacer";

test("逐票節奏器：先回傳的先顯示，只保證最小間隔", async () => {
  const revealed: number[] = [];
  const revealedAt: number[] = [];
  const pace = createRevealPacer(40);

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
  // 第 1、2 席幾乎同時回傳 → 第 2 席要等最小間隔（>=40ms）才顯示，但不必等第 3 席
  assert.ok(revealedAt[1] - revealedAt[0] >= 40, `相鄰兩票間隔不足：${JSON.stringify(revealedAt)}`);
  assert.ok(revealedAt[1] < 150, `先回傳的票不該等到最後一席才顯示：${JSON.stringify(revealedAt)}`);
  // 第 3 席自己回傳得晚，之後立刻顯示（不受前兩席拖累）
  assert.ok(revealedAt[2] >= 200 && revealedAt[2] - revealedAt[1] >= 40);
});
