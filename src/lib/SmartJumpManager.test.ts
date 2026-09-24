import assert from "node:assert/strict";
import test from "node:test";

// SmartJumpManager 間接載入 supabase.ts（llm → game-session-tracker），
// 缺環境變數會在 import 時直接丟錯；這裡沿用其他測試的作法先塞假值。
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "smart-jump-manager-test-key";

/**
 * 跳階順序守衛。
 *
 * `getPhaseIndex` 原本查的是這個檔案自己手寫的 `PHASE_ORDER`，漏了 `DAY_PK_SPEECH`：
 * `indexOf` 回 -1，於是「PK 發言比大廳更早」，跳階方向、跨日清理與補全清單全部跟著失準。
 * 現在順序取自 `@/lib/rules/phases` 的 `PHASE_SEQUENCE`。
 */

test("順序表涵蓋所有階段，任何階段都不得回 -1", async () => {
  const { getPhaseIndex } = await import("@/lib/SmartJumpManager");
  const { PHASE_SEQUENCE } = await import("@/lib/rules/phases");
  const missing = PHASE_SEQUENCE.filter((phase) => getPhaseIndex(phase) < 0);
  assert.deepEqual(missing, [], `以下階段不在跳階順序表內：${missing.join(", ")}`);
});

test("PK 發言晚於警徽評選、早於白天發言", async () => {
  const { getPhaseIndex } = await import("@/lib/SmartJumpManager");
  assert.ok(
    getPhaseIndex("DAY_BADGE_ELECTION") < getPhaseIndex("DAY_PK_SPEECH"),
    "警徽評選應早於 PK 發言",
  );
  assert.ok(
    getPhaseIndex("DAY_PK_SPEECH") < getPhaseIndex("DAY_SPEECH"),
    "PK 發言應早於白天發言",
  );
});

test("同一天的先後比較不得把 PK 發言判成比大廳更早", async () => {
  const { compareTimePoints } = await import("@/lib/SmartJumpManager");
  const pk = { day: 1, phase: "DAY_PK_SPEECH" as const };
  const election = { day: 1, phase: "DAY_BADGE_ELECTION" as const };
  assert.ok(compareTimePoints(election, pk) < 0, "警徽評選應早於 PK 發言");
  assert.ok(compareTimePoints(pk, election) > 0, "PK 發言應晚於警徽評選");
  assert.ok(
    compareTimePoints(pk, { day: 1, phase: "LOBBY" }) > 0,
    "PK 發言不該比大廳更早（這是 indexOf 回 -1 的症狀）",
  );
});
