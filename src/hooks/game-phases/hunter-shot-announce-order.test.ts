import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 開槍公告的順序守衛（2026-09-26 個案）。
 *
 * 兩個開槍路徑（AI 的 `useSpecialEvents` 與真人的 `useGameLogic`）原本都**先播殉情、
 * 後播開槍**，畫面上變成「12號 隨狼美人殉情出局」出現在「11號 開槍帶走了 1號」之前——
 * 還沒開槍就有人跟著死。殉情是「槍打死狼美人」的**後果**，公告必須排在槍之後；
 * 死因也必須是 `shot`（`carried` 專指自爆帶走）。
 *
 * 這裡用原始碼契約檢查：這是 React hook，行為要跑完整場對局才觀察得到；但
 * 「哪一句先播」「死因寫什麼」在原始碼裡就能判定，而一旦被改回去，玩家立刻看得到錯。
 */
const FILES = [
  "src/hooks/game-phases/useSpecialEvents.ts",
  "src/hooks/useGameLogic.ts",
] as const;

test("自爆帶走狼美人也要帶走被魅惑者（白天三條連帶之一）", () => {
  const source = readFileSync("src/hooks/useGameLogic.ts", "utf8");
  const revenge = 'applyCharmRevenge(currentState, applied.victimSeat, "carried")';
  const announced = 'system.selfDestructWithTarget';
  assert.ok(
    source.includes(revenge),
    "自爆帶走狼美人的連帶殉情沒有接上：docs/board-variants-catalog.md 明列白天三條路都要帶走被魅惑者"
  );
  assert.ok(
    source.indexOf(announced) < source.indexOf(revenge),
    "殉情公告要排在自爆公告之後（殉情是被帶走者的後果）"
  );
});

test("開槍公告必須排在殉情公告之前，且死因是 shot", () => {
  for (const file of FILES) {
    const source = readFileSync(file, "utf8");
    const calls = [
      ...source.matchAll(/applyCharmRevenge\(currentState, targetSeat, "(shot|carried)"\)/g),
    ];
    assert.ok(calls.length > 0, `${file} 找不到「槍打死狼美人」的殉情呼叫`);
    for (const call of calls) {
      const at = call.index ?? 0;
      assert.equal(call[1], "shot", `${file}：被槍打死狼美人的死因要用 shot，不是 carried`);
      const before = source.slice(Math.max(0, at - 1200), at);
      assert.ok(before.includes("hunterShoot("), `${file}：殉情之前必須先播開槍公告`);
    }
  }
});
