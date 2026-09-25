import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import { getBoardById, validateBoardPreset } from "@/lib/rules/boards";
import { mergeRuleFlags } from "@/lib/rules/flags";
import { applyKnightDuelToState } from "@/lib/rules/knight-duel-apply";
import {
  canDuel,
  canTriggerDeathSkill,
  hasAlreadyDueled,
  isKnightDuelPhase,
  resolveKnightDuelOutcome,
} from "@/lib/rules/knight-duel";
import type { GameState } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "knight-duel-key";

setLocale("zh-CN");

const flags = mergeRuleFlags();

/**
 * 12 人經典版型沒有騎士，這裡把「白痴」換成騎士，其餘沿用稽核狀態，
 * 以便在真實 12 人盤面上測決鬥（人數、狼數、警徽、夜間紀錄都不變）。
 */
function auditStateWithKnight(): GameState {
  const base = createSinglePlayerContextAuditState();
  const target = base.players.find((p) => p.role === "Idiot") ?? base.players[base.players.length - 1];
  return {
    ...base,
    fixedRoles: base.players.map((p) => (p.seat === target.seat ? "Knight" : p.role)),
    players: base.players.map((p) => (p.seat === target.seat ? { ...p, role: "Knight" as const } : p)),
  };
}

function seatOf(state: GameState, role: string, aliveOnly = true): number {
  const player = state.players.find((p) => p.role === role && (!aliveOnly || p.alive));
  assert.ok(player, `找不到角色 ${role}`);
  return player.seat;
}

// 身分與本輪任務已移到 user：斷言 prompt 內容時一律看 system＋user 全文。
const promptText = (p: { system: string; user: string }): string => `${p.system}\n\n${p.user}`;

test("決鬥時機：只有白天發言階段可以翻牌；整個警長競選階段與遺言階段都不行", () => {
  assert.equal(isKnightDuelPhase("DAY_SPEECH"), true);
  // 整個警長競選階段都不能發動
  assert.equal(isKnightDuelPhase("DAY_BADGE_SIGNUP"), false);
  assert.equal(isKnightDuelPhase("DAY_BADGE_SPEECH"), false);
  assert.equal(isKnightDuelPhase("DAY_BADGE_ELECTION"), false);
  assert.equal(isKnightDuelPhase("DAY_PK_SPEECH"), false);
  assert.equal(isKnightDuelPhase("DAY_LAST_WORDS"), false);

  assert.equal(canDuel({ phase: "DAY_SPEECH", role: "Knight", flags, seat: 0 }), true);
  for (const phase of ["DAY_BADGE_SIGNUP", "DAY_BADGE_SPEECH", "DAY_BADGE_ELECTION", "DAY_PK_SPEECH", "DAY_LAST_WORDS"] as const) {
    assert.equal(canDuel({ phase, role: "Knight", flags, seat: 0 }), false, `${phase} 不該能翻牌`);
  }
  // 非騎士角色一律不能翻牌
  assert.equal(canDuel({ phase: "DAY_SPEECH", role: "Villager", flags, seat: 0 }), false);
  assert.equal(canDuel({ phase: "DAY_SPEECH", role: "Werewolf", flags, seat: 0 }), false);
  // 一場一次
  assert.equal(canDuel({ phase: "DAY_SPEECH", role: "Knight", flags, seat: 0, duelUsedSeats: [0] }), false);
  assert.equal(hasAlreadyDueled([2], 2), true);
  assert.equal(hasAlreadyDueled(undefined, 2), false);
});

test("決鬥結果：目標是狼人＝狼出局＋直接天黑；目標是好人＝騎士以死謝罪、白天繼續", () => {
  const wolf = resolveKnightDuelOutcome({ targetRole: "Werewolf", flags });
  assert.deepEqual(wolf, {
    targetIsWolf: true,
    targetDies: true,
    duelistDies: false,
    goToNight: true,
    blocksDeathSkill: true,
  });

  const good = resolveKnightDuelOutcome({ targetRole: "Guard", flags });
  assert.deepEqual(good, {
    targetIsWolf: false,
    targetDies: false,
    duelistDies: true,
    goToNight: false,
    blocksDeathSkill: false,
  });
});

test("決鬥死亡的狼人不能發動死亡技能；白狼王只有自爆能帶人", () => {
  assert.equal(canTriggerDeathSkill("duel", "Werewolf", flags), false);
  assert.equal(canTriggerDeathSkill("duel", "WhiteWolfKing", flags), false);
  assert.equal(canTriggerDeathSkill("poison", "Hunter", flags), false);
  assert.equal(canTriggerDeathSkill("boom", "WhiteWolfKing", flags), true);
  // 白狼王其他死因（夜死／被票／被獵人帶走）都不能發動技能
  assert.equal(canTriggerDeathSkill("wolf", "WhiteWolfKing", flags), false);
  assert.equal(canTriggerDeathSkill("vote", "WhiteWolfKing", flags), false);
  assert.equal(canTriggerDeathSkill("hunter", "WhiteWolfKing", flags), false);
});

test("決鬥成功：狼人出局、直接進入黑夜（不動競選狀態）", () => {
  const base = auditStateWithKnight();
  const knight = seatOf(base, "Knight");
  const wolf = seatOf(base, "Werewolf");
  const nightVictim = base.players.find((p) => p.alive && p.seat !== knight && p.seat !== wolf && p.role === "Villager")!.seat;
  const state: GameState = {
    ...base,
    phase: "DAY_SPEECH",
    day: 2,
    nightHistory: {
      2: {
        wolfTarget: nightVictim,
        deaths: [{ seat: nightVictim, reason: "wolf" as const }],
        resultsAnnounced: false,
      },
    },
    nightActions: { ...base.nightActions, pendingWolfVictim: nightVictim },
    pendingLastWordsSeats: [],
    badge: { ...base.badge, holderSeat: 6, electionBooms: 0, electionSuspended: false },
  };

  const applied = applyKnightDuelToState({ state, duelistSeat: knight, targetSeat: wolf, originPhase: "DAY_SPEECH", flags });
  const after = applied.state;

  assert.equal(applied.outcome?.targetDies, true);
  assert.equal(applied.deadSeat, wolf);
  assert.equal(after.players.find((p) => p.seat === wolf)?.alive, false, "狼人出局");
  assert.equal(after.players.find((p) => p.seat === knight)?.alive, true, "騎士存活");
  assert.equal(after.phase, "KNIGHT_DUEL", "階段交回流程層續跑天黑");
  assert.deepEqual(after.roleAbilities.duelUsedSeats, [knight], "一場一次");
  // 補公布第一夜死訊＋遺言照常排入
  assert.deepEqual(applied.newlyAnnouncedDeaths.map((d) => d.seat), [nightVictim]);
  // 防禦性補公布：即使還有未宣布的夜間死亡，也會被套用並標記已公布
  // （決鬥只能在白天發言階段發生，正常流程這時死訊早已公布）
  // 但第二夜起的夜間死亡沒有遺言，所以佇列不會增加
  assert.deepEqual(applied.pendingLastWordsSeats, []);
  assert.equal(after.nightHistory?.[2]?.resultsAnnounced, true);
  // 決鬥只能發生在白天發言階段（競選早已結束），不動任何競選狀態
  assert.equal(after.badge.electionSuspended, false, "決鬥不動競選狀態");
  assert.equal(after.badge.electionBooms, 0);
  assert.equal(after.badge.holderSeat, 6);
  assert.equal(after.badge.lost, undefined);
  // 決鬥紀錄
  assert.equal(after.dayHistory?.[2]?.knightDuel?.targetIsWolf, true);
  assert.equal(after.dayHistory?.[2]?.knightDuel?.goToNight, true);
});

test("決鬥失敗：騎士出局、白天繼續、技能消耗、沒有遺言", () => {
  const base = auditStateWithKnight();
  const knight = seatOf(base, "Knight");
  const good = base.players.find((p) => p.alive && p.seat !== knight && p.role === "Villager")!.seat;
  const state: GameState = {
    ...base,
    phase: "DAY_SPEECH",
    day: 2,
    nightHistory: {},
    nightActions: {},
    pendingLastWordsSeats: undefined,
    badge: { ...base.badge, holderSeat: null },
  };

  const applied = applyKnightDuelToState({ state, duelistSeat: knight, targetSeat: good, originPhase: "DAY_SPEECH", flags });
  const after = applied.state;

  assert.equal(applied.outcome?.duelistDies, true);
  assert.equal(applied.deadSeat, knight);
  assert.equal(after.players.find((p) => p.seat === knight)?.alive, false, "騎士以死謝罪");
  assert.equal(after.players.find((p) => p.seat === good)?.alive, true, "好人不受影響");
  assert.equal(after.phase, "DAY_SPEECH", "白天流程照走");
  assert.deepEqual(after.roleAbilities.duelUsedSeats, [knight], "技能已消耗");
  assert.deepEqual(applied.pendingLastWordsSeats, [], "決鬥死亡沒有遺言");
  assert.equal(after.dayHistory?.[2]?.knightDuel?.targetIsWolf, false);
  assert.equal(after.dayHistory?.[2]?.knightDuel?.goToNight, false);
});

test("決鬥不能挑戰已出局的人（含死訊未公布的第一夜死者）＝技能無效且不消耗", () => {
  const base = auditStateWithKnight();
  const knight = seatOf(base, "Knight");
  const nightVictim = base.players.find((p) => p.alive && p.seat !== knight && p.role === "Villager")!.seat;
  const state: GameState = {
    ...base,
    phase: "DAY_SPEECH",
    day: 1,
    nightHistory: { 1: { deaths: [{ seat: nightVictim, reason: "wolf" as const }], resultsAnnounced: false } },
    nightActions: { ...base.nightActions, pendingWolfVictim: nightVictim },
    badge: { ...base.badge, holderSeat: null },
  };

  const applied = applyKnightDuelToState({ state, duelistSeat: knight, targetSeat: nightVictim, originPhase: "DAY_SPEECH", flags });

  assert.equal(applied.voidedTargetSeat, nightVictim);
  assert.equal(applied.deadSeat, undefined, "沒有人出局");
  assert.equal(applied.state.players.find((p) => p.seat === nightVictim)?.alive, true, "狀態未被改動");
  assert.deepEqual(applied.state.roleAbilities.duelUsedSeats, [], "技能無效＝不消耗");
  // 已出局（真正 alive=false）的人也不能挑戰
  const deadSeat = base.players.find((p) => p.alive && p.seat !== knight && p.seat !== nightVictim)!.seat;
  const stateWithDead: GameState = {
    ...state,
    nightActions: {},
    players: state.players.map((p) => (p.seat === deadSeat ? { ...p, alive: false } : p)),
  };
  const applied2 = applyKnightDuelToState({ state: stateWithDead, duelistSeat: knight, targetSeat: deadSeat, originPhase: "DAY_SPEECH", flags });
  assert.equal(applied2.voidedTargetSeat, deadSeat);
  assert.deepEqual(applied2.state.roleAbilities.duelUsedSeats, []);
});

test("決鬥讓警長死亡：交出移交權（不自動撕毀）", () => {
  const base = auditStateWithKnight();
  const knight = seatOf(base, "Knight");
  const good = base.players.find((p) => p.alive && p.seat !== knight && p.role === "Villager")!.seat;
  const state: GameState = {
    ...base,
    phase: "DAY_SPEECH",
    day: 2,
    nightHistory: {},
    nightActions: {},
    badge: { ...base.badge, holderSeat: knight },
  };

  const applied = applyKnightDuelToState({ state, duelistSeat: knight, targetSeat: good, originPhase: "DAY_SPEECH", flags });

  assert.equal(applied.badgeTransferSeat, knight, "騎士（警長）死亡 → 由他自己選傳徽或撕徽");
  assert.equal(applied.state.badge.holderSeat, knight, "移交決定前警徽仍在身上");
});

test("白狼騎士版型：12 人、4 狼（含白狼王）、騎士在場，且通過版型驗證", () => {
  const board = getBoardById("official-12-white-wolf-knight");
  assert.ok(board, "應收錄白狼騎士版型");
  assert.equal(board.playerCount, 12);
  assert.equal(board.roles.filter((r) => r === "Knight").length, 1);
  assert.equal(board.roles.filter((r) => r === "Villager").length, 4);
  assert.equal(board.roles.filter((r) => r === "WhiteWolfKing").length, 1);
  assert.deepEqual(
    ["Seer", "Witch", "Hunter", "Knight"].every((role) => board.roles.includes(role as never)),
    true
  );
  const validation = validateBoardPreset(board);
  assert.deepEqual(validation.errors, []);
});

test("騎士 prompt（AI 契約）：列出存活玩家、排除未公布死者、包含決鬥規則", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("@/game/core/PhaseManager");
  const base = auditStateWithKnight();
  const knight = seatOf(base, "Knight");
  const nightVictim = base.players.find((p) => p.alive && p.seat !== knight && p.role === "Villager")!.seat;
  const state: GameState = {
    ...base,
    phase: "DAY_SPEECH",
    day: 1,
    nightActions: { ...base.nightActions, pendingWolfVictim: nightVictim },
    badge: { ...base.badge, holderSeat: null },
  };
  const actor = state.players.find((p) => p.seat === knight)!;
  const prompt = new PhaseManager().getPrompt("KNIGHT_DUEL", { state }, actor)!;

  const optionLine = promptText(prompt).split("\n").find((line) => line.startsWith("存活玩家: ")) ?? "";
  assert.ok(optionLine.length > 0, "應列出存活玩家");
  assert.doesNotMatch(optionLine, new RegExp(`${nightVictim + 1}号`), "未公布死者不得出現在目標名單");
  assert.doesNotMatch(optionLine, new RegExp(`${knight + 1}号`), "不能挑戰自己");
  assert.match(promptText(prompt), /翻牌决斗/);
  assert.match(promptText(prompt), /直接进入黑夜/);
  assert.match(promptText(prompt), /以死谢罪/);
  // user 訊息也要帶規則，且要求嚴格 JSON
  assert.match(prompt.user, /是否翻牌决斗/);
});
