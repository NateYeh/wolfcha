import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import { getBoardById, validateBoardPreset } from "@/lib/rules/boards";
import {
  canUseDeathShot,
  getChainedShooter,
  getDeathShotKind,
  getDeathShotTargets,
} from "@/lib/rules/death-skills";
import type { GameState, Player } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "death-skills-key";

setLocale("zh-CN");

/** 把 12 人盤的兩個座位換成「狼王」與「獵人」以便測槍 */
function stateWith(roles: Array<[number, Player["role"]]>): GameState {
  const base = createSinglePlayerContextAuditState();
  const map = new Map(roles);
  return {
    ...base,
    phase: "DAY_VOTE",
    day: 2,
    players: base.players.map((p) => (map.has(p.seat) ? { ...p, role: map.get(p.seat)!, alive: true } : p)),
  };
}

// 身分與本輪任務已移到 user：斷言 prompt 內容時一律看 system＋user 全文。
const promptText = (p: { system: string; user: string }): string => `${p.system}\n\n${p.user}`;

test("槍打槍：獵人打死獵人，被帶走的那個還能開槍（八獵四狼的基礎）", () => {
  const state = stateWith([[0, "Hunter"], [1, "Hunter"], [2, "WolfKing"]]);
  const chained = getChainedShooter(state, 1);
  assert.equal(chained?.seat, 1, "被打死的獵人自己要接著開");
  assert.equal(getChainedShooter(state, 0)?.seat, 0, "打到自己以外的獵人一樣成立");
});

test("槍打槍：狼王被打死不能接著開（狼王槍只能被放逐）；平民沒有槍", () => {
  const state = stateWith([[0, "Hunter"], [2, "WolfKing"]]);
  assert.equal(getChainedShooter(state, 2), null, "狼王被技能帶走不開槍");
  assert.equal(getChainedShooter(state, 3), null, "平民沒有死亡技能");
  assert.equal(getChainedShooter(state, 99), null, "不存在的座位回 null");
});

test("槍打槍：被毒死的獵人不能接著開，全域開關關掉時也不能", () => {
  const poisoned = {
    ...stateWith([[0, "Hunter"], [1, "Hunter"]]),
    nightHistory: {
      1: {
        deaths: [{ seat: 1, reason: "poison" as const }],
      },
    },
  } as unknown as GameState;
  assert.equal(getChainedShooter(poisoned, 1), null, "毒史封槍");

  const switchedOff = {
    ...stateWith([[1, "Hunter"]]),
    roleAbilities: { ...createSinglePlayerContextAuditState().roleAbilities, hunterCanShoot: false },
  } as GameState;
  assert.equal(getChainedShooter(switchedOff, 1), null, "總開關關掉就不開槍");
});

test("死亡技能歸屬：只有獵人與狼王有槍", () => {
  assert.equal(getDeathShotKind("Hunter"), "hunter_gun");
  assert.equal(getDeathShotKind("WolfKing"), "wolf_gun");
  for (const role of ["Villager", "Seer", "Witch", "Guard", "Idiot", "Werewolf", "WhiteWolfKing", "Knight", "MuteElder"]) {
    assert.equal(getDeathShotKind(role), "none", `${role} 不該有死亡技能`);
  }
});

test("獵人槍：放逐／夜刀／被自爆帶走都能開；被毒死不能開", () => {
  const state = stateWith([[0, "Hunter"]]);
  for (const cause of ["exile", "night_kill", "carried"] as const) {
    assert.equal(canUseDeathShot({ state, role: "Hunter", seat: 0, cause }), true, `獵人 ${cause} 應能開槍`);
  }
  assert.equal(canUseDeathShot({ state, role: "Hunter", seat: 0, cause: "poison" }), false);
  assert.equal(canUseDeathShot({ state, role: "Hunter", seat: 0, cause: "duel" }), false, "決鬥出局一律不能開槍");
});

test("狼王槍：只有白天被放逐能開；夜死／被毒／被帶走／被決鬥都不行", () => {
  const state = stateWith([[0, "WolfKing"]]);
  assert.equal(canUseDeathShot({ state, role: "WolfKing", seat: 0, cause: "exile" }), true);
  for (const cause of ["night_kill", "poison", "carried", "duel"] as const) {
    assert.equal(canUseDeathShot({ state, role: "WolfKing", seat: 0, cause }), false, `狼王 ${cause} 不該能開槍`);
  }
});

test("狼王槍：只剩他這一隻狼時不開窗（出局即終局）", () => {
  const base = stateWith([[0, "WolfKing"]]);
  // 先讓其他狼都出局（只留狼王）
  const lastWolf: GameState = {
    ...base,
    players: base.players.map((p) =>
      p.role === "Werewolf" || (p.role === "WhiteWolfKing" && p.seat !== 0) ? { ...p, alive: false } : p
    ),
  };
  assert.equal(canUseDeathShot({ state: lastWolf, role: "WolfKing", seat: 0, cause: "exile" }), false);

  // 只要還有一隻狼活著就能開槍
  const withCompany: GameState = {
    ...lastWolf,
    players: lastWolf.players.map((p) => (p.role === "Werewolf" ? { ...p, alive: true } : p)),
  };
  assert.equal(canUseDeathShot({ state: withCompany, role: "WolfKing", seat: 0, cause: "exile" }), true);
});

test("毒史封槍：夜史有 poison/milk 紀錄的座位不能開槍，且不影響其他人", () => {
  const base = stateWith([[0, "WolfKing"], [1, "Hunter"]]);
  // 夜 1：狼王被毒奶（同刀同毒）→ 死因紀錄為 poison
  const state: GameState = {
    ...base,
    nightHistory: { 1: { deaths: [{ seat: 0, reason: "poison" }] } },
  };
  assert.equal(canUseDeathShot({ state, role: "WolfKing", seat: 0, cause: "exile" }), false, "被毒死的狼王不能開槍");
  // milk 紀錄同樣封槍
  const milkState: GameState = { ...base, nightHistory: { 1: { deaths: [{ seat: 0, reason: "milk" }] } } };
  assert.equal(canUseDeathShot({ state: milkState, role: "WolfKing", seat: 0, cause: "night_kill" }), false, "毒奶死的不能開槍");
  // 無毒史的狼王照常可開
  assert.equal(canUseDeathShot({ state: base, role: "WolfKing", seat: 0, cause: "exile" }), true);
});

test("毒死獵人不誤傷狼王：獵人被毒出局後，狼王隔天被票出仍能開槍", () => {
  const base = stateWith([[0, "WolfKing"], [1, "Hunter"]]);
  // 夜 1：女巫毒死獵人（毒史只封獵人自己，不再全域關槍）
  const state: GameState = {
    ...base,
    nightHistory: { 1: { deaths: [{ seat: 1, reason: "poison" }] } },
  };
  assert.equal(canUseDeathShot({ state, role: "Hunter", seat: 1, cause: "exile" }), false, "被毒死的獵人自己不能開");
  assert.equal(canUseDeathShot({ state, role: "WolfKing", seat: 0, cause: "exile" }), true, "毒死獵人不影響狼王被票出開槍");
});

test("開槍目標：場上存活、不含自己", () => {
  const base = stateWith([[0, "WolfKing"]]);
  const deadSeat = base.players.find((p) => p.seat !== 0)!.seat;
  const state: GameState = {
    ...base,
    players: base.players.map((p) => (p.seat === deadSeat ? { ...p, alive: false } : p)),
  };
  const targets = getDeathShotTargets(state, 0);
  assert.equal(targets.includes(0), false, "不能打自己");
  assert.equal(targets.includes(deadSeat), false, "不能打已出局的人");
  assert.equal(targets.length, state.players.filter((p) => p.alive).length - 1);
});

test("狼王守衛版型：3 小狼＋狼王＋預女守獵＋4 平民", () => {
  const board = getBoardById("official-12-wolf-king-guard");
  assert.ok(board, "應收錄狼王守衛版型");
  assert.equal(board.playerCount, 12);
  assert.equal(board.roles.filter((r) => r === "WolfKing").length, 1);
  assert.equal(board.roles.filter((r) => r === "Werewolf").length, 3);
  assert.equal(board.roles.filter((r) => r === "Villager").length, 4);
  for (const role of ["Seer", "Witch", "Guard", "Hunter"]) {
    assert.equal(board.roles.filter((r) => r === role).length, 1, `應有 1 名 ${role}`);
  }
  assert.equal(board.roles.includes("WhiteWolfKing"), false);
  assert.equal(board.roles.includes("Idiot"), false);
  const { errors, warnings } = validateBoardPreset(board);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("開槍窗口 prompt：狼王看到的是狼槍任務與狼隊思路，獵人看到獵人版", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("@/game/core/PhaseManager");
  const manager = new PhaseManager();

  const wolfState = stateWith([[0, "WolfKing"]]);
  const wolfPrompt = manager.getPrompt("HUNTER_SHOOT", { state: { ...wolfState, phase: "HUNTER_SHOOT" } }, wolfState.players[0])!;
  assert.match(promptText(wolfPrompt), /狼王技能（狼枪）/);
  assert.match(promptText(wolfPrompt), /只有\*\*白天被投票放逐\*\*时可开枪/);
  assert.match(promptText(wolfPrompt), /别打队友/);
  assert.doesNotMatch(promptText(wolfPrompt), /你是死前唯一能带走一个人的好人/);

  const hunterState = stateWith([[0, "Hunter"]]);
  const hunterPrompt = manager.getPrompt("HUNTER_SHOOT", { state: { ...hunterState, phase: "HUNTER_SHOOT" } }, hunterState.players[0])!;
  assert.match(promptText(hunterPrompt), /猎人技能/);
  assert.doesNotMatch(promptText(hunterPrompt), /【狼王技能（狼枪）】/);
});

test("公開規則：狼王的技能寫進 roleSkills 與 roleText（AI 才不會照舊規則打）", async () => {
  const { getSharedPromptRules, getRoleText } = await import("@/lib/prompt-utils");
  const shared = getSharedPromptRules();
  assert.match(shared, /狼王/);
  assert.match(shared, /狼枪|开枪带走一名存活玩家/);
  assert.match(getRoleText("WolfKing"), /狼王/);
  // 勝負條件是公開資訊，統一放在 <public_role_configuration>（不再逐角色塞進個人區）
  const { buildPublicRoleConfiguration } = await import("@/lib/prompt-utils");
  const publicConfig = buildPublicRoleConfiguration(stateWith([[0, "WolfKing"]]));
  assert.match(publicConfig, /【获胜条件】/);
  assert.match(publicConfig, /狼人数量 >= 好人数量 时获胜/);
  assert.match(publicConfig, /放逐所有狼人时获胜/);
});
