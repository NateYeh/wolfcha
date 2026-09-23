import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import { mergeRuleFlags } from "@/lib/rules/flags";
import { applySelfDestructToState } from "@/lib/rules/self-destruct-apply";
import type { GameState } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "self-destruct-flow-key";

setLocale("zh-CN");

const flags = mergeRuleFlags();

/** 座標：找一個指定角色的存活座位（0 基） */
function seatOf(state: GameState, role: string, options?: { aliveOnly?: boolean }): number {
  const player = state.players.find(
    (p) => p.role === role && (options?.aliveOnly === false || p.alive)
  );
  assert.ok(player, `找不到角色 ${role}`);
  return player.seat;
}

/** 第一天的夜晚結算結果（如 resolveNight 會寫入的內容） */
function withFirstNightOutcome(state: GameState, wolfVictim: number, poisonVictim: number): GameState {
  return {
    ...state,
    phase: "DAY_BADGE_SPEECH",
    day: 1,
    nightHistory: {
      ...state.nightHistory,
      1: {
        wolfTarget: wolfVictim,
        witchPoison: poisonVictim,
        deaths: [
          { seat: wolfVictim, reason: "wolf" },
          { seat: poisonVictim, reason: "poison" },
        ],
        resultsAnnounced: false,
      },
    },
    nightActions: { ...state.nightActions, pendingWolfVictim: wolfVictim, pendingPoisonVictim: poisonVictim },
    // resolveNight 會把第一夜死者排入遺言佇列（同一座位只算一次）
    pendingLastWordsSeats: [...new Set([wolfVictim, poisonVictim])],
    badge: {
      ...state.badge,
      holderSeat: null,
      candidates: [seatOf(state, "Werewolf"), seatOf(state, "Seer")],
      electionBooms: 0,
      electionSuspended: false,
    },
  };
}

// 身分與本輪任務已移到 user：斷言 prompt 內容時一律看 system＋user 全文。
const promptText = (p: { system: string; user: string }): string => `${p.system}\n\n${p.user}`;

test("雙爆吞警徽（標準流程）：第一隻狼競選自爆＝公布第一夜死訊＋遺言佇列保留＋競選順延＋警徽還在", () => {
  const base = createSinglePlayerContextAuditState();
  const wolf1 = seatOf(base, "Werewolf");
  const victimSeat = base.players.find((p) => p.alive && p.seat !== wolf1 && p.role === "Villager")!.seat;
  const poisonSeat = base.players.find(
    (p) => p.alive && p.seat !== wolf1 && p.seat !== victimSeat && p.role === "Villager"
  )!.seat;
  const state = withFirstNightOutcome(base, victimSeat, poisonSeat);

  const applied = applySelfDestructToState({
    state,
    boomerSeat: wolf1,
    targetSeat: null,
    originPhase: "DAY_BADGE_SPEECH",
    flags,
  });
  const after = applied.state;

  // 1) 自爆者出局、沒有遺言（不進遺言佇列）
  assert.equal(after.players.find((p) => p.seat === wolf1)?.alive, false);
  assert.ok(after.roleAbilities.boomedSeats.includes(wolf1));
  assert.ok(!applied.pendingLastWordsSeats.includes(wolf1), "自爆者不該有遺言");

  // 2) 公布昨晚（第一夜）死訊
  assert.deepEqual(
    applied.newlyAnnouncedDeaths.map((d) => d.seat).sort(),
    [victimSeat, poisonSeat].sort()
  );
  assert.equal(after.nightHistory?.[1]?.resultsAnnounced, true);
  assert.equal(after.players.find((p) => p.seat === victimSeat)?.alive, false);

  // 3) 第一夜死者的遺言照常發表（佇列保留、依序刀口在前）
  assert.deepEqual(applied.pendingLastWordsSeats, [victimSeat, poisonSeat]);

  // 4) 警徽還沒被吞、競選狀態保留、直接天黑（階段切到 SELF_DESTRUCT）
  assert.equal(applied.outcome.swallowBadge, false);
  assert.equal(applied.outcome.suspendElection, true);
  assert.equal(after.badge.lost, undefined);
  assert.equal(after.badge.holderSeat, null);
  assert.equal(after.badge.electionBooms, 1);
  assert.equal(after.badge.electionSuspended, true);
  assert.equal(after.phase, "SELF_DESTRUCT");
  // 需要時可由警長自己選傳徽／撕徽（此時沒有警長）
  assert.equal(applied.badgeTransferSeat, null);
});

test("雙爆吞警徽（標準流程）：第二隻狼再自爆＝警徽流失，且第二夜新死亡沒有遺言", () => {
  const base = createSinglePlayerContextAuditState();
  const wolf1 = seatOf(base, "Werewolf");
  const wolf2 = base.players.filter((p) => p.alive && p.role === "Werewolf" && p.seat !== wolf1)[0].seat;
  const firstVictim = base.players.find((p) => p.alive && p.seat !== wolf1 && p.role === "Villager")!.seat;
  const night2Victim = base.players.find(
    (p) => p.alive && p.seat !== wolf1 && p.seat !== wolf2 && p.seat !== firstVictim && p.role === "Villager"
  )!.seat;

  // 第一爆（第一天競選）
  const afterFirst = applySelfDestructToState({
    state: withFirstNightOutcome(base, firstVictim, firstVictim),
    boomerSeat: wolf1,
    targetSeat: null,
    originPhase: "DAY_BADGE_SPEECH",
    flags,
  }).state;
  assert.equal(afterFirst.badge.electionBooms, 1);
  assert.equal(afterFirst.badge.lost, undefined);

  // 中間經過：第一夜遺言發表完 → 天黑 → 第二夜結算（新死亡）→ 天亮補公布 → 繼續競選
  const withNight2: GameState = {
    ...afterFirst,
    phase: "DAY_BADGE_SPEECH",
    day: 2,
    pendingLastWordsSeats: undefined, // 第一夜遺言已發表完
    nightHistory: {
      ...afterFirst.nightHistory,
      2: {
        wolfTarget: night2Victim,
        deaths: [{ seat: night2Victim, reason: "wolf" }],
        resultsAnnounced: false,
      },
    },
    nightActions: { ...afterFirst.nightActions, pendingWolfVictim: night2Victim },
  };

  // 第二爆（第二天續辦的競選發言）
  const applied = applySelfDestructToState({
    state: withNight2,
    boomerSeat: wolf2,
    targetSeat: null,
    originPhase: "DAY_BADGE_SPEECH",
    flags,
  });
  const after = applied.state;

  // 警徽正式流失
  assert.equal(applied.outcome.swallowBadge, true);
  assert.equal(after.badge.lost, true);
  assert.equal(after.badge.holderSeat, null);
  assert.equal(after.badge.electionSuspended, false, "競選結束，不再續辦");

  // 新的死亡（第二夜）沒有遺言
  assert.deepEqual(applied.newlyAnnouncedDeaths.map((d) => d.seat), [night2Victim]);
  assert.deepEqual(applied.pendingLastWordsSeats, [], "第二夜起夜間死亡者不得進遺言佇列");
  assert.equal(after.pendingLastWordsSeats, undefined);
});

test("白狼王競選自爆：一次就吞警徽（不必等第二爆），且帶走一人", () => {
  const base = createSinglePlayerContextAuditState();
  const wwk = seatOf(base, "WhiteWolfKing");
  const nightVictim = base.players.find((p) => p.alive && p.seat !== wwk && p.role === "Villager")!.seat;
  // 目標必須是「場上存活」的人：挑一個不是第一夜死者的人
  const target = base.players.find(
    (p) => p.alive && p.seat !== wwk && p.seat !== nightVictim && p.role === "Villager"
  )!.seat;
  const state = withFirstNightOutcome(base, nightVictim, nightVictim);

  const applied = applySelfDestructToState({
    state,
    boomerSeat: wwk,
    targetSeat: target,
    originPhase: "DAY_BADGE_SPEECH",
    flags,
  });

  assert.equal(applied.outcome.takesPlayer, true);
  assert.equal(applied.outcome.swallowBadge, true);
  assert.equal(applied.state.badge.lost, true);
  assert.equal(applied.victimSeat, target);
  assert.equal(applied.state.players.find((p) => p.seat === target)?.alive, false);
  // 第一夜死者照常發表遺言（技能只能指向活人，第一夜死者的遺言權不受影響）
  assert.deepEqual(applied.pendingLastWordsSeats, [nightVictim]);
  // 白狼王自己因發動技能而沒有遺言
  assert.ok(!applied.pendingLastWordsSeats.includes(wwk));
});

test("白狼王指定第一夜死者（死訊未公布）→ 技能無效，第一夜死者遺言權不受影響", () => {
  const base = createSinglePlayerContextAuditState();
  const wwk = seatOf(base, "WhiteWolfKing");
  const nightVictim = base.players.find((p) => p.alive && p.seat !== wwk && p.role === "Villager")!.seat;
  const poisonVictim = base.players.find(
    (p) => p.alive && p.seat !== wwk && p.seat !== nightVictim && p.role === "Villager"
  )!.seat;
  const state = withFirstNightOutcome(base, nightVictim, poisonVictim);

  const applied = applySelfDestructToState({
    state,
    boomerSeat: wwk,
    targetSeat: nightVictim, // 硬要指定第一夜死者
    originPhase: "DAY_SPEECH",
    flags,
  });

  assert.equal(applied.victimSeat, undefined, "不能帶走已出局的人");
  assert.equal(applied.voidedTargetSeat, nightVictim, "應記錄技能無效的目標");
  // 技能無效：這次自爆沒有造成額外死亡；第一夜死者的出局來自「夜晚結算＋死訊公布」而非自爆
  assert.deepEqual(applied.newlyAnnouncedDeaths.map((d) => d.seat), [nightVictim, poisonVictim]);
  assert.equal(applied.state.players.find((p) => p.seat === nightVictim)?.alive, false);
  // 白狼王自己仍然出局且沒有遺言
  assert.equal(applied.state.players.find((p) => p.seat === wwk)?.alive, false);
  assert.ok(!applied.pendingLastWordsSeats.includes(wwk));
  assert.deepEqual(applied.pendingLastWordsSeats, [nightVictim, poisonVictim], "第一夜死者遺言照常排入");
});

test("白狼王自爆 prompt：目標名單不得包含死訊未公布的第一夜死者", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("@/game/core/PhaseManager");
  const base = createSinglePlayerContextAuditState();
  const wwk = seatOf(base, "WhiteWolfKing");
  const nightVictim = base.players.find((p) => p.alive && p.seat !== wwk && p.role === "Villager")!.seat;
  const state = withFirstNightOutcome(base, nightVictim, nightVictim);

  const actor = state.players.find((p) => p.seat === wwk)!;
  const prompt = new PhaseManager().getPrompt("SELF_DESTRUCT", { state }, actor)!;
  const optionLine = promptText(prompt).split("\n").find((line) => line.startsWith("存活玩家: ")) ?? "";
  assert.ok(optionLine.length > 0, "應列出存活玩家");
  assert.doesNotMatch(optionLine, new RegExp(`${nightVictim + 1}号`), "第一夜死者不得出現在目標名單");
  assert.match(promptText(prompt), /已经出局的人不能带走/);
});

test("非競選階段自爆：不吞警徽、不順延競選，第二夜起死亡也沒有遺言", () => {
  const base = createSinglePlayerContextAuditState();
  const wolf = seatOf(base, "Werewolf");
  const state: GameState = {
    ...base,
    phase: "DAY_SPEECH",
    day: 2,
    nightHistory: {
      2: { deaths: [{ seat: seatOf(base, "Villager"), reason: "wolf" }], resultsAnnounced: false },
    },
    nightActions: { ...base.nightActions, pendingWolfVictim: seatOf(base, "Villager") },
    badge: { ...base.badge, holderSeat: null, electionBooms: 0 },
  };

  const applied = applySelfDestructToState({
    state,
    boomerSeat: wolf,
    targetSeat: null,
    originPhase: "DAY_SPEECH",
    flags,
  });

  assert.equal(applied.outcome.swallowBadge, false);
  assert.equal(applied.outcome.suspendElection, false);
  assert.equal(applied.state.badge.lost, undefined);
  assert.equal(applied.state.badge.electionBooms, 0);
  assert.deepEqual(applied.pendingLastWordsSeats, []);
});

test("自爆導致警長死亡：交出移交權（不自動撕毀）", () => {
  const base = createSinglePlayerContextAuditState();
  const wwk = seatOf(base, "WhiteWolfKing");
  const sheriffSeat = base.players.find((p) => p.alive && p.seat !== wwk && p.role === "Villager")!.seat;
  const state: GameState = {
    ...base,
    phase: "DAY_SPEECH",
    day: 2,
    nightHistory: {},
    nightActions: {},
    pendingLastWordsSeats: undefined,
    badge: { ...base.badge, holderSeat: sheriffSeat },
  };

  const applied = applySelfDestructToState({
    state,
    boomerSeat: wwk,
    targetSeat: sheriffSeat,
    originPhase: "DAY_SPEECH",
    flags,
  });

  assert.equal(applied.victimSeat, sheriffSeat);
  assert.equal(applied.badgeTransferSeat, sheriffSeat, "應交出移交權讓警長自己選傳徽或撕徽");
  assert.equal(applied.state.badge.holderSeat, sheriffSeat, "移交決定前警徽仍在警長身上");
});
