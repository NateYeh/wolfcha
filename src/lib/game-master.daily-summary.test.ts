import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "daily-summary-test-key";

/**
 * 日報搬運：欄位清單以 carryDailySummary 為準。
 *
 * 回歸背景：換日那條路徑只搬了 dailySummaries／Facts／VoteData，漏掉 speechAssessment，
 * 實測第 1 天日報已經回報 passiveSeats，但次日的 state 裡查不到這個欄位，
 * 於是「昨天誰在空發言」的提醒永遠不會出現。
 */
test("日報搬運：四個欄位一起過去，其他欄位不受影響", async () => {
  const { carryDailySummary } = await import("@/lib/game-master");
  const { createSinglePlayerContextAuditState } = await import("../../scripts/single-player-context-audit");

  const base = createSinglePlayerContextAuditState();
  const target: GameState = { ...base, day: 2 };
  const source: GameState = {
    ...base,
    day: 1,
    dailySummaries: { 1: ["昨夜平安夜。"] },
    dailySummaryFacts: { 1: [{ fact: "1号被放逐", type: "vote" }] },
    dailySummaryVoteData: { 1: { sheriff_election: { winner: 4, votes: { "4": [0, 1] } } } },
    speechAssessment: { day: 1, passiveSeats: [2, 6] },
  };

  const merged = carryDailySummary(target, source);
  assert.deepEqual(merged.dailySummaries, { 1: ["昨夜平安夜。"] });
  assert.deepEqual(merged.dailySummaryFacts, { 1: [{ fact: "1号被放逐", type: "vote" }] });
  assert.deepEqual(merged.dailySummaryVoteData, { 1: { sheriff_election: { winner: 4, votes: { "4": [0, 1] } } } });
  assert.deepEqual(merged.speechAssessment, { day: 1, passiveSeats: [2, 6] });
  // 目標狀態自己的東西不能被日報搬運覆蓋掉
  assert.equal(merged.day, 2);
  assert.equal(merged.phase, target.phase);
  assert.equal(merged.players.length, target.players.length);
});

test("日報搬運：來源沒有發言評估時保留目標原有的評估", async () => {
  const { carryDailySummary } = await import("@/lib/game-master");
  const { createSinglePlayerContextAuditState } = await import("../../scripts/single-player-context-audit");

  const base = createSinglePlayerContextAuditState();
  const target = { ...base, speechAssessment: { day: 1, passiveSeats: [3] } };
  const source = { ...base, speechAssessment: undefined, dailySummaries: { 1: ["摘要"] } };

  const merged = carryDailySummary(target, source);
  assert.deepEqual(merged.speechAssessment, { day: 1, passiveSeats: [3] });
});

test("消極座位正規化：1 基轉 0 基、去重、排除出局與被禁言者", async () => {
  const { normalizePassiveSeats } = await import("@/lib/game-master");
  const { createSinglePlayerContextAuditState } = await import("../../scripts/single-player-context-audit");

  const state = createSinglePlayerContextAuditState();
  state.day = 1;
  state.players = state.players.map((player) =>
    player.seat === 3 ? { ...player, alive: false } : player
  );
  // 禁言只存在 nightActions（天亮公告之前就提早生成日報的情形）
  state.dayHistory = {};
  state.nightActions = { ...state.nightActions, mutedTarget: 5 };

  assert.deepEqual(
    normalizePassiveSeats([2, "2", 8, 4, 6, 99, "x", 0], state),
    [1, 7],
    "8 號保留、重複的 2 號去重、4 號已出局排除、6 號被禁言排除、99 與 0 越界排除"
  );
  assert.deepEqual(normalizePassiveSeats(undefined, state), []);
});
