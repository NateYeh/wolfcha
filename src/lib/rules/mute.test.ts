import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import { getBoardById, validateBoardPreset } from "@/lib/rules/boards";
import {
  canSpeakInPhase,
  getMuteEligibleSeats,
  getMutedSeat,
  isMutePublic,
  isMutedSeat,
  isValidMuteTarget,
} from "@/lib/rules/mute";
import { buildGameContextParts } from "@/lib/prompt-utils";
import { getNextSpeechSeat, getSpeechPhaseOrder } from "@/lib/speech-order";
import type { GameState } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "mute-rule-key";

setLocale("zh-CN");

function seatOf(state: GameState, role: string): number {
  const player = state.players.find((p) => p.role === role);
  assert.ok(player, `找不到角色 ${role}`);
  return player.seat;
}

/** 12 人經典盤把白痴換成禁言長老（人數、狼數、警徽都不變） */
function stateWithElder(mutedSeat: number | null = null): { state: GameState; elderSeat: number } {
  const base = createSinglePlayerContextAuditState();
  const target = base.players.find((p) => p.role === "Idiot") ?? base.players[base.players.length - 1];
  const state: GameState = {
    ...base,
    phase: "DAY_SPEECH",
    day: 2,
    fixedRoles: base.players.map((p) => (p.seat === target.seat ? "MuteElder" : p.role)),
    players: base.players.map((p) => (p.seat === target.seat ? { ...p, role: "MuteElder" as const } : p)),
    nightActions: { ...base.nightActions, ...(mutedSeat !== null ? { mutedTarget: mutedSeat } : {}) },
  };
  return { state, elderSeat: target.seat };
}

// 身分與本輪任務已移到 user：斷言 prompt 內容時一律看 system＋user 全文。
const promptText = (p: { system: string; user: string }): string => `${p.system}\n\n${p.user}`;

test("版型：預女獵禁＝預言家/女巫/獵人/禁言長老＋4 平民＋4 狼人", () => {
  const board = getBoardById("official-12-seer-witch-hunter-mute");
  assert.ok(board, "應收錄預女獵禁版型");
  assert.equal(board.playerCount, 12);
  assert.deepEqual(board.roles.filter((r) => r === "Werewolf").length, 4);
  assert.deepEqual(board.roles.filter((r) => r === "Villager").length, 4);
  for (const role of ["Seer", "Witch", "Hunter", "MuteElder"]) {
    assert.equal(board.roles.filter((r) => r === role).length, 1, `應有 1 名 ${role}`);
  }
  assert.equal(board.roles.includes("Guard"), false);
  assert.equal(board.roles.includes("WhiteWolfKing"), false);
  const { errors, warnings } = validateBoardPreset(board);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("禁言目標：只能選存活玩家、不能選自己、不能選死訊未公布的死者", () => {
  const { state, elderSeat } = stateWithElder();
  const eligible = getMuteEligibleSeats(state, elderSeat);
  assert.equal(eligible.includes(elderSeat), false, "不能禁言自己");
  const pendingCount = Object.values({
    wolf: state.nightActions.pendingWolfVictim,
    poison: state.nightActions.pendingPoisonVictim,
  }).filter((seat) => typeof seat === "number" && seat !== elderSeat).length;
  assert.equal(
    eligible.length,
    state.players.filter((p) => p.alive && p.seat !== elderSeat).length - pendingCount,
    "存活玩家扣掉自己與死訊未公布的死者"
  );

  // 死訊未公布的第一夜死者不能當目標
  const victim = state.players.find((p) => p.alive && p.seat !== elderSeat)!.seat;
  const pendingState: GameState = {
    ...state,
    nightActions: { ...state.nightActions, pendingWolfVictim: victim },
  };
  assert.equal(getMuteEligibleSeats(pendingState, elderSeat).includes(victim), false);
  assert.equal(isValidMuteTarget(pendingState, elderSeat, victim), false);
  assert.equal(isValidMuteTarget(state, elderSeat, elderSeat), false);
  assert.equal(isValidMuteTarget(state, elderSeat, eligible[0]), true);

  // 已出局者也不能當目標
  const deadSeat = eligible[0];
  const deadState: GameState = {
    ...state,
    players: state.players.map((p) => (p.seat === deadSeat ? { ...p, alive: false } : p)),
  };
  assert.equal(isValidMuteTarget(deadState, elderSeat, deadSeat), false);
});

test("禁言效果：只擋發言（含競選發言），不擋遺言與投票", () => {
  const { state, elderSeat } = stateWithElder();
  const mutedSeat = state.players.find((p) => p.seat !== elderSeat)!.seat;
  const muted: GameState = { ...state, nightActions: { ...state.nightActions, mutedTarget: mutedSeat } };

  assert.equal(getMutedSeat(muted), mutedSeat);
  assert.equal(isMutedSeat(muted, mutedSeat), true);
  assert.equal(isMutedSeat(muted, elderSeat), false);

  for (const phase of ["DAY_SPEECH", "DAY_BADGE_SPEECH", "DAY_PK_SPEECH"] as const) {
    assert.equal(canSpeakInPhase(muted, mutedSeat, phase), false, `${phase} 應被禁言擋下`);
  }
  // 遺言與投票（投票由 VotePhase 處理，這裡確認發言判斷不誤擋遺言）
  assert.equal(canSpeakInPhase(muted, mutedSeat, "DAY_LAST_WORDS"), true, "禁言不擋遺言");
  assert.equal(canSpeakInPhase(muted, elderSeat, "DAY_SPEECH"), true);

  // 不傳階段時以狀態自帶的階段為準（挑發言者的呼叫端都這樣用）
  const inSpeech: GameState = { ...muted, phase: "DAY_BADGE_SPEECH" };
  assert.equal(canSpeakInPhase(inSpeech, mutedSeat), false);
  const inLastWords: GameState = { ...muted, phase: "DAY_LAST_WORDS" };
  assert.equal(canSpeakInPhase(inLastWords, mutedSeat), true);
});

test("發言順序：被禁言者不在當日輪次內，也不影響遺言輪", () => {
  const { state, elderSeat } = stateWithElder();
  const mutedSeat = state.players.find((p) => p.seat !== elderSeat)!.seat;
  const muted: GameState = {
    ...state,
    currentSpeakerSeat: null,
    daySpeechStartSeat: state.players.find((p) => p.alive)!.seat,
    nightActions: { ...state.nightActions, mutedTarget: mutedSeat },
  };

  const order = getSpeechPhaseOrder(muted);
  assert.equal(order.includes(mutedSeat), false, "白天發言輪不得包含被禁言者");
  assert.equal(order.length, muted.players.filter((p) => p.alive).length - 1);

  // 競選發言：被禁言的候選人也不能發言（但仍保留競選投票）
  const campaign: GameState = {
    ...muted,
    phase: "DAY_BADGE_SPEECH",
    badge: { ...muted.badge, candidates: muted.players.filter((p) => p.alive).map((p) => p.seat) },
  };
  assert.equal(getSpeechPhaseOrder(campaign).includes(mutedSeat), false);
  assert.equal(campaign.badge.candidates.includes(mutedSeat), true, "被禁言仍可上警");

  // 遺言階段不受影響（該階段順序就是當前發言者）
  const lastWords: GameState = { ...muted, phase: "DAY_LAST_WORDS", currentSpeakerSeat: mutedSeat };
  assert.deepEqual(getSpeechPhaseOrder(lastWords), [mutedSeat]);

  // 推進時要跳過被禁言者
  const beforeMuted: GameState = {
    ...muted,
    currentSpeakerSeat: state.players.filter((p) => p.alive && p.seat < mutedSeat).map((p) => p.seat).pop() ?? null,
  };
  const next = getNextSpeechSeat(beforeMuted);
  assert.notEqual(next, mutedSeat, "不得把發言輪交給被禁言者");
});

test("夜間順序：禁言長老在守衛之後、狼人之前", async () => {
  // 動態載入：game-machine 會拉起 supabase，必須在 env 設定之後才 import
  const { isValidTransition } = await import("@/store/game-machine");
  assert.equal(isValidTransition("NIGHT_START", "NIGHT_MUTE_ACTION"), true);
  assert.equal(isValidTransition("NIGHT_GUARD_ACTION", "NIGHT_MUTE_ACTION"), true);
  assert.equal(isValidTransition("NIGHT_MUTE_ACTION", "NIGHT_WOLF_ACTION"), true);
  assert.equal(isValidTransition("NIGHT_MUTE_ACTION", "NIGHT_WITCH_ACTION"), false);
  assert.equal(isValidTransition("NIGHT_WOLF_ACTION", "NIGHT_MUTE_ACTION"), false);
});

test("禁言長老 prompt（AI 契約）與公共資訊", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("@/game/core/PhaseManager");
  const { buildGameContext } = await import("@/lib/prompt-utils");
  const { state: dayState, elderSeat } = stateWithElder();
  const state: GameState = { ...dayState, phase: "NIGHT_MUTE_ACTION" };
  const actor = state.players.find((p) => p.seat === elderSeat)!;
  const prompt = new PhaseManager().getPrompt("NIGHT_MUTE_ACTION", { state }, actor)!;

  const optionLine = promptText(prompt).split("\n").find((line) => line.startsWith("存活玩家: ")) ?? "";
  assert.ok(optionLine.length > 0, "應列出可禁言玩家");
  assert.doesNotMatch(optionLine, new RegExp(`${elderSeat + 1}号`), "不能禁言自己");
  assert.match(promptText(prompt), /不能指定自己/);
  assert.match(promptText(prompt), /仍然可以投票/);
  assert.match(promptText(prompt), /（警徽竞选投票、放逐投票）|可以留遗言/);

  // 禁言是公開資訊，但只在天亮宣佈之後（白天）揭露：白天看得到、夜裡看不到
  const mutedSeat = state.players.find((p) => p.seat !== elderSeat)!.seat;
  const pendingMute = { ...state.nightActions, mutedTarget: mutedSeat };
  const dayContext = buildGameContext({ ...state, phase: "DAY_SPEECH", nightActions: pendingMute }, actor);
  assert.match(dayContext, new RegExp(`muted: \\[${mutedSeat + 1}\\]`));
  const nightContext = buildGameContext({ ...state, nightActions: pendingMute }, actor);
  assert.doesNotMatch(nightContext, /muted: \[/, "夜間不揭露禁言（否則狼隊夜裡就知道長老禁了誰）");
});

test("禁言長老 AI 決策：合法座位換算成 0 基並記 mute_action log；非法座位＝不發動", async () => {
  const { generateMuteAction } = await import("@/lib/game-master");
  const { aiLogger } = await import("@/lib/ai-logger");
  const { state, elderSeat } = stateWithElder();
  const actor = state.players.find((p) => p.seat === elderSeat)!;
  const targetSeat = state.players.filter((p) => p.alive && p.seat !== elderSeat)[0].seat;
  const originalFetch = globalThis.fetch;
  const logs: string[] = [];
  const unsubscribe = aiLogger.subscribe((entry) => { logs.push(entry.type); });
  const stub = (content: string) => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: "mute",
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof globalThis.fetch;
  };

  try {
    stub(JSON.stringify({ seat: targetSeat + 1, reason: "他白天最会带节奏" }));
    const outcome = await generateMuteAction(state, actor);
    assert.deepEqual(outcome, { targetSeat, reason: "他白天最会带节奏" });
    assert.equal(logs.at(-1), "mute_action");

    // 非法座位（自己／不在名單內）→ 不發動
    stub(JSON.stringify({ seat: elderSeat + 1, reason: "想禁言自己" }));
    assert.equal(await generateMuteAction(state, actor), undefined);
    stub(JSON.stringify({ seat: 99, reason: "不存在" }));
    assert.equal(await generateMuteAction(state, actor), undefined);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
  }
});

test("天亮公告之後仍然禁言：狀態改讀當日紀錄，不因 mutedTarget 清空而失效", () => {
  const { state, elderSeat } = stateWithElder();
  const mutedSeat = state.players.find((p) => p.seat !== elderSeat)!.seat;
  // 公告完成後的狀態：mutedTarget 已消耗清空，只剩當日紀錄
  const announced: GameState = {
    ...state,
    currentSpeakerSeat: null,
    daySpeechStartSeat: state.players.find((p) => p.alive)!.seat,
    nightActions: { ...state.nightActions, mutedTarget: undefined },
    dayHistory: { ...(state.dayHistory || {}), [state.day]: { muted: { seat: mutedSeat } } },
  };

  assert.equal(getMutedSeat(announced), mutedSeat, "公告後仍要查得到禁言");
  assert.equal(isMutedSeat(announced, mutedSeat), true);
  assert.equal(canSpeakInPhase(announced, mutedSeat, "DAY_SPEECH"), false);
  assert.equal(getSpeechPhaseOrder(announced).includes(mutedSeat), false, "公告後發言輪仍須排除被禁言者");
  assert.equal(canSpeakInPhase(announced, mutedSeat, "DAY_LAST_WORDS"), true, "禁言不擋遺言");
});

test("禁言不跨日：隔天沒有當日紀錄就自動失效", () => {
  const { state, elderSeat } = stateWithElder();
  const mutedSeat = state.players.find((p) => p.seat !== elderSeat)!.seat;
  const nextDay: GameState = {
    ...state,
    day: state.day + 1,
    nightActions: { ...state.nightActions, mutedTarget: undefined },
    dayHistory: { ...(state.dayHistory || {}), [state.day]: { muted: { seat: mutedSeat } } },
  };

  assert.equal(getMutedSeat(nextDay), null);
  assert.equal(isMutedSeat(nextDay, mutedSeat), false);
  assert.equal(getSpeechPhaseOrder(nextDay).includes(mutedSeat), true);
});

test("禁言公開時機：夜間不揭露，白天（含競選、投票、自爆決鬥）才公開", () => {
  const { state, elderSeat } = stateWithElder();
  const mutedSeat = state.players.find((p) => p.seat !== elderSeat)!.seat;
  const base: GameState = {
    ...state,
    nightActions: { ...state.nightActions, mutedTarget: mutedSeat },
    dayHistory: { ...(state.dayHistory || {}), [state.day]: { muted: { seat: mutedSeat } } },
  };

  for (const phase of [
    "DAY_BADGE_ELECTION",
    "DAY_BADGE_SPEECH",
    "DAY_PK_SPEECH",
    "DAY_SPEECH",
    "DAY_VOTE",
    "DAY_LAST_WORDS",
    "SELF_DESTRUCT",
    "KNIGHT_DUEL",
  ] as const) {
    assert.equal(isMutePublic({ ...base, phase }), true, `${phase} 應公開禁言資訊`);
  }
  for (const phase of ["NIGHT_START", "NIGHT_MUTE_ACTION", "NIGHT_WOLF_ACTION", "HUNTER_SHOOT"] as const) {
    assert.equal(isMutePublic({ ...base, phase }), false, `${phase} 不該揭露禁言資訊（夜裡狼隊不該看到）`);
  }

  // 公共 prompt：白天看得到 muted，夜間看不到
  const dayContext = buildGameContextParts({ ...base, phase: "DAY_SPEECH" }, base.players[0]).shared;
  assert.match(dayContext, /muted: \[\d+\]/, "白天公共區塊應揭露禁言");
  const nightContext = buildGameContextParts({ ...base, phase: "NIGHT_WOLF_ACTION" }, base.players[0]).shared;
  assert.doesNotMatch(nightContext, /muted: \[/, "夜間公共區塊不該揭露禁言");
});
