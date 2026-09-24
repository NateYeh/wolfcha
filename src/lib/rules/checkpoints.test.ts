import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { ACTION_PHASES, NIGHT_ACTION_ORDER, PHASE_SEQUENCE } from "@/lib/rules/phases";
import {
  RESTORE_FALLBACK,
  dreamDecided,
  getRestorePhase,
  isCheckpointSafe,
  muteDecided,
} from "@/lib/rules/checkpoints";
import type { GameState, Phase, Player, Role } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "checkpoints-test";

/**
 * 存檔安全與回退點的守衛。
 *
 * 這兩張表過去以 `switch` 寫在 store 裡、都帶 `default`，所以「沒被明示的階段」會同時得到
 * 「不准存檔」與「回退點是自己」——禁言長老與攝夢人就是這樣掉進去的（同族最後一條）。
 * 這裡釘住三件事：
 *   1. 兩個夜間階段的「已決定」語意（含沒有合法目標可選的退化情況）；
 *   2. 不變式：動作階段的回退點不得是自己；
 *   3. 真正的中間態仍然拒絕落盤（避免「順手把不安全變成安全」）。
 */

/** 夜間有行動的角色（fixture 的預設組合）。 */
const NIGHT_ROLES: Role[] = ["Guard", "MuteElder", "Dreamweaver", "Werewolf", "Witch", "Seer"];

/**
 * 以真實板子為底，只保留指定角色（其餘玩家出局），避免測試跟著版型變動。
 * 存檔邏輯只看 `players`／`nightActions`／`roleAbilities`，因此這樣就足以決定語意。
 */
function board(roles: Role[], patch: Partial<GameState> = {}): GameState {
  const base = createSinglePlayerContextAuditState();
  const players = base.players.map((p, i) => {
    const role = roles[i];
    if (!role) return { ...p, alive: false };
    return {
      ...p,
      role,
      alive: true,
      alignment: (role === "Werewolf" || role === "WhiteWolfKing" ? "wolf" : "village") as Player["alignment"],
    };
  });
  return { ...base, players, nightActions: {}, ...patch };
}

/** 全部夜間決定都未做的版本（用來檢查「未完成」那一側）。 */
function undecided(phase: Phase, roles: Role[] = NIGHT_ROLES): GameState {
  return board(roles, { phase, nightActions: {} });
}

/** 全部夜間決定都做好的版本（用來檢查「已完成」那一側）。 */
function decided(phase: Phase, roles: Role[] = NIGHT_ROLES): GameState {
  return board(roles, {
    phase,
    nightActions: {
      guardTarget: 1,
      mutedTarget: 1,
      dreamTarget: 1,
      wolfTarget: 1,
      witchSave: false,
      seerTarget: 1,
    },
  });
}

test("禁言長老：未決定不可落盤，已決定可落盤，不在場可落盤", () => {
  const pending = undecided("NIGHT_MUTE_ACTION");
  assert.equal(muteDecided(pending), false);
  assert.equal(isCheckpointSafe(pending), false);

  const decidedByHuman = { ...pending, nightActions: { mutedTarget: 2 } };
  assert.equal(muteDecided(decidedByHuman), true);
  assert.equal(isCheckpointSafe(decidedByHuman), true);
  assert.equal(getRestorePhase(decidedByHuman), "NIGHT_MUTE_ACTION");

  // 沒有禁言長老的板子（守衛、村民）
  const noElder = board(["Guard", "Villager"], { phase: "NIGHT_MUTE_ACTION" });
  assert.equal(muteDecided(noElder), true);
  assert.equal(isCheckpointSafe(noElder), true);
});

test("攝夢人：未決定不可落盤，已決定可落盤，不在場可落盤", () => {
  const pending = undecided("NIGHT_DREAM_ACTION");
  assert.equal(dreamDecided(pending), false);
  assert.equal(isCheckpointSafe(pending), false);

  const decidedByHuman = { ...pending, nightActions: { dreamTarget: 2 } };
  assert.equal(dreamDecided(decidedByHuman), true);
  assert.equal(isCheckpointSafe(decidedByHuman), true);
  assert.equal(getRestorePhase(decidedByHuman), "NIGHT_DREAM_ACTION");

  const noDreamer = board(["Guard", "Villager"], { phase: "NIGHT_DREAM_ACTION" });
  assert.equal(dreamDecided(noDreamer), true);
});

test("沒有合法目標可選時，這一晚本來就沒有東西要等（不可存檔 → 可存檔）", () => {
  // 只剩禁言長老自己存活：沒有可禁言的對象（getMuteEligibleSeats 為空）
  const loneElder = board(["MuteElder"], { phase: "NIGHT_MUTE_ACTION" });
  assert.equal(muteDecided(loneElder), true);
  assert.equal(isCheckpointSafe(loneElder), true);

  // 只剩攝夢人自己存活：規則的「不能空攝」在此無目標可補
  const loneDreamer = board(["Dreamweaver"], { phase: "NIGHT_DREAM_ACTION" });
  assert.equal(dreamDecided(loneDreamer), true);
  assert.equal(isCheckpointSafe(loneDreamer), true);
});

test("回退點：退到前一個『已決定』的階段，都沒有才退到 NIGHT_START", () => {
  const mutePending = undecided("NIGHT_MUTE_ACTION");
  assert.equal(getRestorePhase(mutePending), "NIGHT_START");
  assert.equal(
    getRestorePhase({ ...mutePending, nightActions: { guardTarget: 1 } }),
    "NIGHT_GUARD_ACTION"
  );

  const dreamPending = undecided("NIGHT_DREAM_ACTION");
  // 禁言與守衛都還沒決定 → 沒有任何穩定點可用，退到 NIGHT_START
  // （注意：不能退到「禁言未決定」的階段自己，那不是穩定點）
  assert.equal(getRestorePhase(dreamPending), "NIGHT_START");
  // 禁言已決定、守衛也決定 → 退到禁言階段（最後一個穩定點）
  assert.equal(
    getRestorePhase({ ...dreamPending, nightActions: { mutedTarget: 1, guardTarget: 1 } }),
    "NIGHT_MUTE_ACTION"
  );
  // 沒有禁言長老的板子：禁言階段本身已完成（沒東西要決定），所以它就是最後一個穩定點
  // （與 WOLF 在「沒有守衛」時回退到 NIGHT_GUARD_ACTION 的處理一致：回退後會自動續跑）
  const noElder = board(["Guard", "Dreamweaver"], { phase: "NIGHT_DREAM_ACTION" });
  assert.equal(getRestorePhase(noElder), "NIGHT_MUTE_ACTION");
  assert.equal(
    getRestorePhase({ ...noElder, nightActions: { guardTarget: 1 } }),
    "NIGHT_MUTE_ACTION"
  );

  // 只剩攝夢人自己存活：攝夢階段本身已完成（沒有合法目標可選）→ 直接回到當前階段
  const noElderNoGuard = board(["Dreamweaver"], { phase: "NIGHT_DREAM_ACTION" });
  assert.equal(getRestorePhase(noElderNoGuard), "NIGHT_DREAM_ACTION");
});

test("不變式：動作階段的回退點不得是自己（完成與未完成兩側都檢查）", () => {
  const failures: string[] = [];
  for (const phase of ACTION_PHASES) {
    for (const [label, state] of [
      ["未完成", undecided(phase)],
      ["已完成", decided(phase)],
      ["只有守衛", board(["Guard"], { phase })],
    ] as const) {
      const fallback = RESTORE_FALLBACK[phase](state);
      if (fallback === phase) failures.push(`${phase}（${label}）回退到自己`);
      if (!PHASE_SEQUENCE.includes(fallback)) failures.push(`${phase}（${label}）回退到非法階段 ${fallback}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("不變式：夜間回退點不得往前跳（會形成迴圈）", () => {
  const failures: string[] = [];
  for (const phase of NIGHT_ACTION_ORDER) {
    const index = NIGHT_ACTION_ORDER.indexOf(phase);
    for (const state of [undecided(phase), decided(phase), board(["Guard"], { phase })]) {
      const fallback = RESTORE_FALLBACK[phase](state);
      if (fallback === "NIGHT_START") continue;
      const targetIndex = NIGHT_ACTION_ORDER.indexOf(fallback);
      if (targetIndex > index) failures.push(`${phase} 回退到更後面的 ${fallback}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("不變式：回退目標自身必須是穩定點（動作階段）", () => {
  const failures: string[] = [];
  for (const phase of ACTION_PHASES) {
    for (const [label, state] of [
      ["未完成", undecided(phase)],
      ["已完成", decided(phase)],
      ["只有守衛", board(["Guard"], { phase })],
      ["只有長老", board(["MuteElder"], { phase })],
    ] as const) {
      const fallback = RESTORE_FALLBACK[phase](state);
      const target = { ...state, phase: fallback };
      // 回退到一個「當時存不下來」的點，等於把不完整狀態當成穩定點（MUTE／DREAM 過去的病）
      if (!isCheckpointSafe(target)) {
        failures.push(`${phase}（${label}）回退到不穩定的 ${fallback}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("真正的中間態仍然拒絕落盤（不可順手把不安全變成安全）", () => {
  const midStates: Phase[] = [
    "LOBBY",
    "SETUP",
    "NIGHT_RESOLVE",
    "DAY_RESOLVE",
    "BADGE_TRANSFER",
    "HUNTER_SHOOT",
    "SELF_DESTRUCT",
    "KNIGHT_DUEL",
    "GAME_END",
  ];
  for (const phase of midStates) {
    const state = board(["Guard", "Werewolf"], { phase });
    assert.equal(isCheckpointSafe(state), false, `${phase} 不該可落盤`);
  }
});

test("已完成的階段：還原時直接回到當前階段（不會被回退表影響）", () => {
  const safeStates: GameState[] = [
    board(["Guard"], { phase: "NIGHT_START" }),
    decided("NIGHT_GUARD_ACTION"),
    decided("NIGHT_MUTE_ACTION"),
    decided("NIGHT_DREAM_ACTION"),
    decided("NIGHT_WOLF_ACTION"),
    decided("NIGHT_WITCH_ACTION"),
    decided("NIGHT_SEER_ACTION"),
    board(["Guard"], { phase: "DAY_START" }),
    board(["Guard"], { phase: "DAY_BADGE_SIGNUP" }),
    board(["Guard"], { phase: "DAY_BADGE_SPEECH" }),
    board(["Guard"], { phase: "DAY_BADGE_ELECTION" }),
    board(["Guard"], { phase: "DAY_PK_SPEECH" }),
    board(["Guard"], { phase: "DAY_SPEECH" }),
    board(["Guard"], { phase: "DAY_LAST_WORDS" }),
    board(["Guard"], { phase: "DAY_VOTE" }),
  ];
  for (const state of safeStates) {
    assert.equal(isCheckpointSafe(state), true, `${state.phase} 應該可落盤`);
    assert.equal(getRestorePhase(state), state.phase);
  }
});

