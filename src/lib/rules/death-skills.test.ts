import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import { getBoardById, validateBoardPreset } from "@/lib/rules/boards";
import { getRoleCapabilities } from "@/lib/rules/roles";
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

test("槍打槍：獵人打死獵人，被槍打死的還能開槍（八獵四狼的基礎）", () => {
  const state = stateWith([[0, "Hunter"], [1, "Hunter"], [2, "WolfKing"]]);
  const chained = getChainedShooter(state, 1, "shot");
  assert.equal(chained?.seat, 1, "被打死的獵人自己要接著開");
  assert.equal(getChainedShooter(state, 0, "shot")?.seat, 0, "打到自己以外的獵人一樣成立");
  assert.equal(getChainedShooter(state, 1, "carried"), null, "被自爆帶走的獵人不開槍（2026-09-26 校訂）");
});

test("槍打槍：被自爆帶走的不開、被槍打死的狼王要反擊；平民沒有槍", () => {
  const state = stateWith([[0, "Hunter"], [2, "WolfKing"]]);
  assert.equal(getChainedShooter(state, 2, "carried"), null, "狼王被自爆帶走不開槍");
  assert.equal(
    getChainedShooter(state, 2, "shot")?.seat,
    2,
    "狼王被獵人槍打死要反擊（2026-09-26：獵人與狼王互打，兩邊都開）",
  );
  assert.equal(getChainedShooter(state, 3, "shot"), null, "平民沒有死亡技能");
  assert.equal(getChainedShooter(state, 99, "shot"), null, "不存在的座位回 null");
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
  assert.equal(getChainedShooter(poisoned, 1, "shot"), null, "毒史封槍");

  // 每人只有一把槍：已經開過槍的人不能再開（防「獵人↔狼王」互打無限往復）
  const alreadyShot = {
    ...stateWith([[0, "Hunter"], [1, "Hunter"]]),
    nightHistory: { 1: { hunterShots: [{ hunterSeat: 1, targetSeat: 0 }] } },
  } as unknown as GameState;
  assert.equal(getChainedShooter(alreadyShot, 1, "shot"), null, "開過槍的不再開第二次");

  const switchedOff = {
    ...stateWith([[1, "Hunter"]]),
    roleAbilities: { ...createSinglePlayerContextAuditState().roleAbilities, hunterCanShoot: false },
  } as GameState;
  assert.equal(getChainedShooter(switchedOff, 1, "shot"), null, "總開關關掉就不開槍");
});

test("死亡技能歸屬：只有獵人與狼王有槍", () => {
  assert.equal(getDeathShotKind("Hunter"), "hunter_gun");
  assert.equal(getDeathShotKind("WolfKing"), "wolf_gun");
  for (const role of ["Villager", "Seer", "Witch", "Guard", "Idiot", "Werewolf", "WhiteWolfKing", "Knight", "MuteElder"]) {
    assert.equal(getDeathShotKind(role), "none", `${role} 不該有死亡技能`);
  }
});

test("獵人槍：放逐／夜刀／槍打槍都能開；被毒死與被自爆帶走不能開", () => {
  const state = stateWith([[0, "Hunter"]]);
  for (const cause of ["exile", "night_kill", "shot"] as const) {
    assert.equal(canUseDeathShot({ state, role: "Hunter", seat: 0, cause }), true, `獵人 ${cause} 應能開槍`);
  }
  assert.equal(canUseDeathShot({ state, role: "Hunter", seat: 0, cause: "carried" }), false, "被自爆帶走不能開槍");
  assert.equal(canUseDeathShot({ state, role: "Hunter", seat: 0, cause: "poison" }), false);
  assert.equal(canUseDeathShot({ state, role: "Hunter", seat: 0, cause: "duel" }), false, "決鬥出局一律不能開槍");
});

test("狼王槍：被放逐／被狼刀／被槍打死都能開；被毒／被自爆帶走／自爆／被決鬥都不行", () => {
  const state = stateWith([[0, "WolfKing"]]);
  assert.equal(canUseDeathShot({ state, role: "WolfKing", seat: 0, cause: "exile" }), true, "被放逐能開槍");
  assert.equal(canUseDeathShot({ state, role: "WolfKing", seat: 0, cause: "night_kill" }), true, "夜裡被狼刀能開槍");
  assert.equal(canUseDeathShot({ state, role: "WolfKing", seat: 0, cause: "shot" }), true, "被獵人槍打死能反擊");
  for (const cause of ["poison", "carried", "self_destruct", "duel"] as const) {
    assert.equal(canUseDeathShot({ state, role: "WolfKing", seat: 0, cause }), false, `狼王 ${cause} 不該能開槍`);
  }
});

test("使用者校訂的槍規則（2026-09-25、2026-09-26）", () => {
  const state = stateWith([[0, "Hunter"], [1, "WolfKing"]]);

  // ① 夜晚被狼刀死：兩把槍都能開
  for (const [seat, role] of [[0, "Hunter"], [1, "WolfKing"]] as const) {
    assert.equal(
      canUseDeathShot({ state, role, seat, cause: "night_kill" }),
      true,
      `${role} 夜裡被狼刀死應該能開槍`
    );
  }

  // ② 夜晚被女巫毒死：兩把槍都不能開
  for (const [seat, role] of [[0, "Hunter"], [1, "WolfKing"]] as const) {
    assert.equal(
      canUseDeathShot({ state, role, seat, cause: "poison" }),
      false,
      `${role} 被毒死不能開槍`
    );
  }

  // ④ 槍打槍：被別的槍打死時兩把槍都能開；被自爆帶走則兩把都不能（2026-09-26 校訂）
  for (const [seat, role] of [[0, "Hunter"], [1, "WolfKing"]] as const) {
    assert.equal(
      canUseDeathShot({ state, role, seat, cause: "shot" }),
      true,
      `${role} 被槍打死應該能開槍`
    );
    assert.equal(
      canUseDeathShot({ state, role, seat, cause: "carried" }),
      false,
      `${role} 被自爆帶走不能開槍`
    );
  }

  // ③ 自己自爆：沒有開槍窗口（狼王、白狼王都一樣）
  const boomers = state.players.filter((p) => getRoleCapabilities(p.role).canBoom);
  assert.ok(boomers.length > 0, "這張盤至少要有一個能自爆的角色");
  for (const boomer of boomers) {
    assert.equal(
      canUseDeathShot({ state, role: boomer.role, seat: boomer.seat, cause: "self_destruct" }),
      false,
      `${boomer.role} 自爆後不能開槍`
    );
  }
  for (const role of ["WolfKing", "WhiteWolfKing", "Hunter"] as const) {
    assert.equal(
      canUseDeathShot({ state: stateWith([[0, role]]), role, seat: 0, cause: "self_destruct" }),
      false,
      `${role} 自爆不能開槍`
    );
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
  assert.match(promptText(wolfPrompt), /被\*\*白天投票放逐\*\*、或被\*\*狼人夜刀杀死\*\*时可以开枪/);
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
  // 2026-09-25 校訂：夜裡被狼刀死也能開槍
  assert.match(shared, /被狼人夜刀杀死时可以开枪带走一名存活玩家/);
  assert.match(getRoleText("WolfKing"), /被放逐或被夜刀杀死时可开枪带走一人/);
  // 勝負條件是公開資訊，統一放在 <public_role_configuration>（不再逐角色塞進個人區）
  const { buildPublicRoleConfiguration } = await import("@/lib/prompt-utils");
  const publicConfig = buildPublicRoleConfiguration(stateWith([[0, "WolfKing"]]));
  assert.match(publicConfig, /【获胜条件】/);
  assert.match(publicConfig, /狼人数量 >= 好人数量 时获胜/);
  assert.match(publicConfig, /放逐所有狼人时获胜/);
});

test("開槍窗口的閘門不得寫死角色（真人狼王也要拿得到確認鈕與放棄開槍）", () => {
  // 實機踩過：BottomActionPanel 用 role === "Hunter" 當閘門，真人狼王在底部面板
  // 拿不到開槍確認鈕（只有對話框那條路能開），與 DialogArea 的 getDeathShotKind 分岔。
  const roots = ["src/components", "src/app"];
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      fs.readFileSync(path.join(process.cwd(), rel), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (line.includes("HUNTER_SHOOT") && /===\s*"Hunter"/.test(line)) {
            offenders.push(`${rel}:${index + 1} → ${line.trim()}`);
          }
        });
    }
  };
  roots.forEach(walk);
  assert.deepEqual(offenders, [], `開槍閘門請改用 getDeathShotKind()（死亡技能單一真相）：\n${offenders.join("\n")}`);
});
