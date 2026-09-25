import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import { ALL_ROLE_KEYS } from "@/lib/rules/boards";
import {
  NIGHT_SEAT_ACTION_PHASES,
  SEAT_ACTION_CONFIRM_PHASES,
  TWO_SEAT_ACTION_PHASES,
  canHumanConfirmSeatAction,
  isSeatActionConfirmPhase,
  requiresTwoSeats,
  seatActionPickCount,
  seatActionRole,
} from "@/lib/rules/human-input";
import { PHASE_SEQUENCE } from "@/lib/rules/phases";
import type { GameState, Player, Role } from "@/types/game";

// PHASE_CONFIGS 會間接載入 supabase.ts，缺環境變數在 import 時就丟錯，
// 所以先塞假值再用動態 import（沿用其他測試的作法）。
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "human-input-key";

setLocale("zh-CN");

/**
 * 「真人要行動」與「UI 接得住」必須一致。
 *
 * 這個檔案是被實機測試逼出來的：真人狼美人的階段停在原地不動，查下去才發現
 * 確認面板的階段清單漏了她（面板根本不出現），而真人攝夢人是另一邊漏了
 * （面板出現、按下去沒反應）。兩種都**不會有任何錯誤訊息**，只能靠這種結構檢查攔。
 */

/** 自帶專屬面板、不走「點座位→確認」的夜間階段（女巫的救／毒面板）。 */
const OWN_PANEL_PHASES: readonly string[] = ["NIGHT_WITCH_ACTION"];

const freshState = (): GameState => {
  const base = createSinglePlayerContextAuditState();
  // 夜間行動一律清空：面板條件包含「還沒決定」，用殘留的盤面會問出不存在的缺口
  return { ...base, phase: "NIGHT_START", day: 1, nightActions: {}, nightHistory: {}, dayHistory: {} };
};

/** 稽核盤面沒有真人，直接把 0 號當成真人來問規則。 */
const humanWith = (state: GameState, role: Role): Player => ({
  ...state.players[0]!,
  role,
  alive: true,
  isHuman: true,
  alignment: "wolf",
});

test("狀態機要求真人行動的夜間階段，確認面板一定要接得住", async () => {
  const { PHASE_CONFIGS } = await import("@/store/game-machine");
  const broken: string[] = [];
  for (const phase of PHASE_SEQUENCE) {
    const config = PHASE_CONFIGS[phase];
    if (config.actionType !== "night_action" || OWN_PANEL_PHASES.includes(phase)) continue;
    const state = freshState();
    for (const role of ALL_ROLE_KEYS) {
      const human = humanWith(state, role);
      if (config.requiresHumanInput?.(human, state)) {
        if (!isSeatActionConfirmPhase(phase)) broken.push(`${phase}（路由漏了）`);
        if (!canHumanConfirmSeatAction(phase, human, state)) broken.push(`${phase}／${role}（面板漏了）`);
      }
    }
  }
  assert.deepEqual(broken, [], "狀態機說真人要行動，但 UI 沒接手");
});

test("有專屬面板的階段不會同時開「點座位→確認」面板", () => {
  for (const phase of OWN_PANEL_PHASES as readonly GameState["phase"][]) {
    assert.equal(isSeatActionConfirmPhase(phase), false, `${phase} 不該走座位確認`);
    const state = freshState();
    for (const role of ALL_ROLE_KEYS) {
      assert.equal(canHumanConfirmSeatAction(phase, humanWith(state, role), state), false);
    }
  }
});

test("路由清單與夜間清單的關係（夜間是路由的子集）", () => {
  for (const phase of NIGHT_SEAT_ACTION_PHASES) {
    assert.ok(SEAT_ACTION_CONFIRM_PHASES.includes(phase), `${phase} 應在路由清單內`);
    assert.ok(phase.startsWith("NIGHT_"), `${phase} 命名為夜間階段`);
  }
  // 魔術師補上之後是 7 個（守衛、禁言、攝夢、魔術師、狼人、狼美人、預言家）
  assert.equal(NIGHT_SEAT_ACTION_PHASES.length, 7);
});

test("真人狼美人：面板會出現，魅惑過就不再出現（回歸：以前完全不會出現）", () => {
  const state = freshState();
  const beauty = humanWith(state, "WolfBeauty");
  assert.equal(canHumanConfirmSeatAction("NIGHT_WOLF_BEAUTY_ACTION", beauty, state), true);
  assert.equal(
    canHumanConfirmSeatAction("NIGHT_WOLF_BEAUTY_ACTION", beauty, {
      ...state,
      nightActions: { ...state.nightActions, wolfBeautyTarget: 3 },
    }),
    false,
    "已寫入魅惑目標後不該再要求確認"
  );
  assert.equal(canHumanConfirmSeatAction("NIGHT_WOLF_BEAUTY_ACTION", { ...beauty, alive: false }, state), false);
});

test("真人攝夢人：面板與路由都在（回歸：面板在、路由漏了）", () => {
  const state = freshState();
  const dreamer = humanWith(state, "Dreamweaver");
  assert.equal(isSeatActionConfirmPhase("NIGHT_DREAM_ACTION"), true);
  assert.equal(canHumanConfirmSeatAction("NIGHT_DREAM_ACTION", dreamer, state), true);
});

test("狼陣營都能確認出刀（狼王、狼美人都算）", () => {
  const state = freshState();
  for (const role of ["Werewolf", "WolfKing", "WolfBeauty"] as const) {
    assert.equal(
      canHumanConfirmSeatAction("NIGHT_WOLF_ACTION", humanWith(state, role), state),
      true,
      `${role} 屬於狼陣營，應該能一起出刀`
    );
  }
  assert.equal(canHumanConfirmSeatAction("NIGHT_WOLF_ACTION", humanWith(state, "Seer"), state), false);
});

test("每個夜間階段都對應到一個行動角色，且該角色真的能開面板", () => {
  const missing: string[] = [];
  for (const phase of NIGHT_SEAT_ACTION_PHASES) {
    const role = seatActionRole(phase);
    if (!role) {
      missing.push(`${phase} 沒有對應角色`);
      continue;
    }
    if (!canHumanConfirmSeatAction(phase, humanWith(freshState(), role), freshState())) {
      missing.push(`${phase}／${role} 開不出面板`);
    }
  }
  assert.deepEqual(missing, []);
});

test("真人魔術師：面板與路由都在，換過就不再出現（兩張卡的階段）", () => {
  const state = freshState();
  const magician = humanWith(state, "Magician");
  assert.equal(isSeatActionConfirmPhase("NIGHT_MAGICIAN_ACTION"), true, "路由要接得住");
  assert.equal(canHumanConfirmSeatAction("NIGHT_MAGICIAN_ACTION", magician, state), true);
  assert.equal(
    canHumanConfirmSeatAction("NIGHT_MAGICIAN_ACTION", magician, {
      ...state,
      nightActions: { ...state.nightActions, magicianSwap: [0, 1] },
    }),
    false,
    "已寫入換位組合後不該再要求確認"
  );
  assert.equal(canHumanConfirmSeatAction("NIGHT_MAGICIAN_ACTION", { ...magician, alive: false }, state), false);
  assert.equal(canHumanConfirmSeatAction("NIGHT_MAGICIAN_ACTION", humanWith(state, "Seer"), state), false, "不是魔術師就不該出現");
});

test("需要兩張卡的階段：一定同時在路由清單與兩段式清單裡（少一邊＝按了沒反應）", () => {
  const broken: string[] = [];
  for (const phase of TWO_SEAT_ACTION_PHASES) {
    if (seatActionPickCount(phase) !== 2) broken.push(`${phase}：pickCount 不是 2`);
    if (!requiresTwoSeats(phase)) broken.push(`${phase}：requiresTwoSeats 說不用兩張`);
    if (!SEAT_ACTION_CONFIRM_PHASES.includes(phase)) broken.push(`${phase}：路由漏了`);
    if (!phase.startsWith("NIGHT_")) broken.push(`${phase}：兩段式選取目前只用在夜間`);
    if (!seatActionRole(phase)) broken.push(`${phase}：沒有對應角色`);
  }
  assert.deepEqual(broken, []);
  // 其餘階段一律是單座位——避免有人把 TWO_SEAT 清單越加越大卻沒接 UI
  for (const phase of SEAT_ACTION_CONFIRM_PHASES) {
    assert.equal(seatActionPickCount(phase), TWO_SEAT_ACTION_PHASES.includes(phase) ? 2 : 1, `${phase} 的張數`);
  }
});
