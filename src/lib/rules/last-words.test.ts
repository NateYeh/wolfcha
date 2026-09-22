import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import {
  canNightDeathHaveLastWords,
  getPendingLastWordsSeats,
  takeNextLastWordsSeat,
} from "@/lib/rules/last-words";
import type { GameState, Phase } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "last-words-test-key";

setLocale("zh-CN");

function fresh(phase: Phase): GameState {
  const state = createSinglePlayerContextAuditState();
  return {
    ...state,
    phase,
    day: 2,
    messages: [],
    nightHistory: {},
    dayHistory: {},
    nightActions: {},
    pendingLastWordsSeats: undefined,
    dailySummaries: {},
    dailySummaryFacts: {},
    roleAbilities: { ...state.roleAbilities, hunterCanShoot: true },
    badge: { ...state.badge, holderSeat: null, candidates: [], votes: {} },
  };
}

// ─────────────────────────────────────────────────────────────
// 純規則：只有第一夜死者有遺言
// ─────────────────────────────────────────────────────────────

test("遺言規則：只有第一夜死亡的玩家有遺言（第二天起沒有）", () => {
  assert.equal(canNightDeathHaveLastWords(1), true);
  assert.equal(canNightDeathHaveLastWords(2), false);
  assert.equal(canNightDeathHaveLastWords(3), false);
});

test("遺言佇列：第一夜無論幾個、無論死因全部入列，且自動去重", () => {
  // 刀口 + 毒殺（不同座位）
  assert.deepEqual(
    getPendingLastWordsSeats({ nightDay: 1, deathSeats: [4, 7] }),
    [4, 7],
  );
  // 同一人被刀又被毒（奶穿）只算一次
  assert.deepEqual(getPendingLastWordsSeats({ nightDay: 1, deathSeats: [4, 4] }), [4]);
  // 沒有死亡
  assert.deepEqual(getPendingLastWordsSeats({ nightDay: 1, deathSeats: [] }), []);
  // 第二夜起不新增，但既有未發表的佇列要保留（自爆中斷白天時的補發表）
  assert.deepEqual(
    getPendingLastWordsSeats({ nightDay: 2, deathSeats: [8, 9], pending: [4] }),
    [4],
  );
});

test("遺言佇列：逐位取出並保留剩餘順序", () => {
  assert.deepEqual(takeNextLastWordsSeat([4, 7]), { seat: 4, rest: [7] });
  assert.deepEqual(takeNextLastWordsSeat([7]), { seat: 7, rest: undefined });
  assert.deepEqual(takeNextLastWordsSeat([]), { seat: null, rest: undefined });
  assert.deepEqual(takeNextLastWordsSeat(undefined), { seat: null, rest: undefined });
});

// ─────────────────────────────────────────────────────────────
// 流程：死亡公告後、白天討論前先跑遺言
// ─────────────────────────────────────────────────────────────

type RuntimeEvents = string[];

function makeRuntime(events: RuntimeEvents, captured: { states: GameState[] }) {
  return {
    setGameState: (value: GameState | ((prev: GameState) => GameState)) => {
      if (typeof value !== "function") captured.states.push(value);
    },
    setDialogue: () => {},
    waitForUnpause: async () => {},
    runAISpeech: async () => {
      events.push("discussion");
    },
    onBadgeTransfer: async (s: GameState, _sheriff: unknown, after: (x: GameState) => Promise<void>) => {
      events.push("badgeTransfer");
      await after(s);
    },
    onHunterDeath: async () => {
      events.push("hunterShoot");
    },
    onGameEnd: async () => {
      events.push("gameEnd");
    },
    onStartVote: async () => {},
    onBadgeSpeechEnd: async () => {},
    onPkSpeechEnd: async () => {},
    onSelfDestructCheck: async () => false,
    onKnightDuelCheck: async () => ({ action: "none" as const }),
    onPendingLastWords: async (s: GameState, continuation: (x: GameState) => Promise<void>) => {
      events.push(`lastWords:${(s.pendingLastWordsSeats ?? []).join("+")}`);
      await continuation({ ...s, pendingLastWordsSeats: undefined });
    },
  };
}

test("白天開場：死亡公告後先發表遺言，才進入白天討論", async () => {
  // 先載入 game-master：DaySpeechPhase 與它互相引用，順序反了會踩 TDZ
  await import("@/lib/game-master");
  const { DaySpeechPhase } = await import("@/game/phases/DaySpeechPhase");
  const phase = new DaySpeechPhase();
  const state = fresh("DAY_SPEECH");
  const events: RuntimeEvents = [];
  const captured = { states: [] as GameState[] };
  const runtime = makeRuntime(events, captured);
  const victimSeat = 3;

  await phase.handleAction(
    {
      state: {
        ...state,
        nightActions: { ...state.nightActions, pendingWolfVictim: victimSeat },
        pendingLastWordsSeats: [victimSeat],
      } as GameState,
      phase: "DAY_SPEECH",
      extras: runtime,
    },
    { type: "START_DAY_SPEECH_AFTER_BADGE" },
  );

  assert.deepEqual(events, [`lastWords:${victimSeat}`, "discussion"]);
  // 傳給遺言階段的狀態：死者已判定死亡、遺言佇列仍帶著該座位
  const lastWordsCall = captured.states.find((s) => (s.pendingLastWordsSeats ?? []).length > 0);
  assert.ok(lastWordsCall, "應把待遺言的狀態交給遺言處理器");
  assert.equal(lastWordsCall.players.find((p) => p.seat === victimSeat)?.alive, false);
  // 最終狀態已清空佇列並進入白天討論
  const finalState = captured.states[captured.states.length - 1];
  assert.equal(finalState.phase, "DAY_SPEECH");
  assert.equal(finalState.pendingLastWordsSeats, undefined);
});

test("白天開場：沒有待發表遺言時不呼叫遺言處理器", async () => {
  // 先載入 game-master：DaySpeechPhase 與它互相引用，順序反了會踩 TDZ
  await import("@/lib/game-master");
  const { DaySpeechPhase } = await import("@/game/phases/DaySpeechPhase");
  const phase = new DaySpeechPhase();
  const state = fresh("DAY_SPEECH");
  const events: RuntimeEvents = [];
  const captured = { states: [] as GameState[] };
  const runtime = makeRuntime(events, captured);

  await phase.handleAction(
    { state: { ...state, pendingLastWordsSeats: undefined } as GameState, phase: "DAY_SPEECH", extras: runtime },
    { type: "START_DAY_SPEECH_AFTER_BADGE" },
  );

  assert.deepEqual(events, ["discussion"]);
});
