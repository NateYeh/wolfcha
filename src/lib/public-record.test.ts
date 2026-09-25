process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "public-record-key";
import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import type { GameState } from "@/types/game";

setLocale("zh-CN");

test("賽後公開記錄：只列主持人公布過的客觀結果，玩家說詞不得進入", async () => {
  const { buildPublicRecordForRemark } = await import("@/lib/public-record");
  const { createSinglePlayerContextAuditState } = await import(
    "../../scripts/single-player-context-audit"
  );
  const state = createSinglePlayerContextAuditState() as unknown as GameState;
  state.nightHistory = {
    1: { deaths: [], resultsAnnounced: true },
    2: {
      deaths: [
        { seat: 10, reason: "wolf" },
        { seat: 9, reason: "poison" },
      ],
      resultsAnnounced: true,
    },
  };
  state.dayHistory = {
    1: { selfDestruct: { boomSeat: 4, targetSeat: 7, reason: "票台要出我队友，炸掉作废投票" } },
    2: { executed: { seat: 5, votes: 6.5 }, hunterShots: [{ hunterSeat: 1, targetSeat: 3, reason: "他死保假预言家" }] },
  };
  state.dailySummaries = { 1: ["1号当时声称他是预言家，10号是唯一没被对跳的预言家线"] };

  const text = buildPublicRecordForRemark(state).join("\n");

  assert.match(text, /第1夜：平安夜/);
  assert.match(text, /第2夜：11号、10号出局（死因未公开）/);
  assert.match(text, /第1天：5号自爆，带走8号/);
  assert.match(text, /第1天：狼人自爆作废当日放逐投票，无人被放逐/);
  // 公開紀錄不揭露槍種（規則 2026-09-25）：只說誰開槍帶走誰
  assert.match(text, /第2天：2号开枪带走4号/);
  assert.doesNotMatch(text, /猎人|狼王/);
  assert.match(text, /第2天：6号被放逐（6.5票）/);
  // 摘要裡的玩家主張（含錯誤主張）不得被升級成公開事實
  assert.doesNotMatch(text, /预言家/);
  assert.doesNotMatch(text, /声称/);
});

test("賽後公開記錄：locale 切換後用該語系輸出", async () => {
  const { buildPublicRecordForRemark } = await import("@/lib/public-record");
  const { createSinglePlayerContextAuditState } = await import(
    "../../scripts/single-player-context-audit"
  );
  const state = createSinglePlayerContextAuditState() as unknown as GameState;
  state.nightHistory = { 1: { deaths: [], resultsAnnounced: true } };
  state.dayHistory = { 1: {} };

  try {
    setLocale("en");
    const text = buildPublicRecordForRemark(state).join("\n");
    assert.match(text, /Night 1: peaceful night/);
  } finally {
    setLocale("zh-CN");
  }
});

test("賽後公開記錄：記錄缺失的夜晚不亂報平安夜", async () => {
  const { buildPublicRecordForRemark } = await import("@/lib/public-record");
  const { createSinglePlayerContextAuditState } = await import(
    "../../scripts/single-player-context-audit"
  );
  const state = createSinglePlayerContextAuditState() as unknown as GameState;
  state.nightHistory = { 1: { deaths: [] } };
  state.dayHistory = {};

  const text = buildPublicRecordForRemark(state).join("\n");
  assert.match(text, /第1夜：平安夜/);
  // 沒有白天記錄的日子不憑空生事件
  assert.doesNotMatch(text, /未放逐|放逐投票/);
});
