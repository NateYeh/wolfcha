process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "night-resume-key";
import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { NIGHT_ACTION_ORDER, type NightActionPhase } from "@/lib/rules/phases";
import { nightResumePlan, replayCommandFor, type NightResumeCommand } from "./night-resume";
import type { GameState, Role } from "@/types/game";

/**
 * 夜晚續跑計畫表的守衛。
 *
 * 這張表是「存檔恢復／Dev 跳轉／Dev 軟編輯」共用的答案，過去散在三處寫死字串，
 * 而且 wolf 那處寫成 `CONTINUE_NIGHT_AFTER_GUARD`（會把已經決定的禁言／攝夢再問一次 AI）。
 * 這裡把三種結果（往下／重跑／等真人）逐階段釘住，並守住「重跑＝前一步」這條規則。
 */

const BOARD_12_WITH_ALL_NIGHT_ROLES: Role[] = [
  "Guard",
  "MuteElder",
  "Dreamweaver",
  "Werewolf",
  "Witch",
  "Seer",
  "Villager",
  "Villager",
  "Villager",
  "Villager",
  "Villager",
  "Villager",
];

const board = (roles: Role[], nightActions: GameState["nightActions"] = {}): GameState => {
  const base = createSinglePlayerContextAuditState() as unknown as GameState;
  return {
    ...base,
    phase: "NIGHT_START",
    day: 1,
    players: base.players.map((player, index) => ({
      ...player,
      role: roles[index] ?? "Villager",
      isHuman: false,
      alive: index < roles.length,
    })),
    messages: [],
    nightActions,
    // 稽核板子把兩瓶藥都標成用過了，這裡要一份乾淨的預設值（否則女巫永遠算已決定）
    roleAbilities: {
      ...base.roleAbilities,
      witchHealUsed: false,
      witchPoisonUsed: false,
    },
  } as GameState;
};

/** 每一步「決定後」該看到的動作欄位。 */
const DECIDED_ACTIONS: Record<NightActionPhase, GameState["nightActions"]> = {
  NIGHT_GUARD_ACTION: { guardTarget: 5 },
  NIGHT_MUTE_ACTION: { mutedTarget: 5 },
  NIGHT_DREAM_ACTION: { dreamTarget: 5 },
  NIGHT_WOLF_ACTION: { wolfTarget: 5 },
  NIGHT_WITCH_ACTION: { witchSave: false },
  NIGHT_SEER_ACTION: { seerTarget: 5 },
};

/** 每一步「跳過它往下」的指令。 */
const ADVANCE_COMMANDS: Record<NightActionPhase, NightResumeCommand> = {
  NIGHT_GUARD_ACTION: "CONTINUE_NIGHT_AFTER_GUARD",
  NIGHT_MUTE_ACTION: "CONTINUE_NIGHT_AFTER_MUTE",
  NIGHT_DREAM_ACTION: "CONTINUE_NIGHT_AFTER_DREAM",
  NIGHT_WOLF_ACTION: "CONTINUE_NIGHT_AFTER_WOLF",
  NIGHT_WITCH_ACTION: "CONTINUE_NIGHT_AFTER_WITCH",
  NIGHT_SEER_ACTION: "CONTINUE_NIGHT_AFTER_WITCH",
};

/** 把某個階段的行動者換成真人。 */
const withHuman = (state: GameState, seat: number): GameState => ({
  ...state,
  players: state.players.map((player) => ({ ...player, isHuman: player.seat === seat })),
});

test("已完成：跳過這一步往下（預言家完成後直接進結算）", () => {
  for (const phase of NIGHT_ACTION_ORDER) {
    const state = board(BOARD_12_WITH_ALL_NIGHT_ROLES, DECIDED_ACTIONS[phase]);
    const plan = nightResumePlan(state, phase);
    if (phase === "NIGHT_SEER_ACTION") {
      assert.deepEqual(plan, { kind: "resolve" }, `${phase}：預言家完成＝夜間動作做完`);
    } else {
      assert.deepEqual(
        plan,
        { kind: "advance", command: ADVANCE_COMMANDS[phase] },
        `${phase}：已完成應該跳過它往下`
      );
    }
  }
});

test("AI 未決定：從這一步重跑（指令見 REPLAY_COMMAND 的逐項理由）", () => {
  // 禁言／攝夢不能用「前一步的續跑指令」：前一步只是轉呼叫、不改 phase，那一步會被跳過。
  // 這張表的正確性由 night-resume-flow.test.ts 以真實一夜驗證。
  const expected: Record<NightActionPhase, NightResumeCommand> = {
    NIGHT_GUARD_ACTION: "START_NIGHT",
    NIGHT_MUTE_ACTION: "START_NIGHT",
    NIGHT_DREAM_ACTION: "START_NIGHT",
    NIGHT_WOLF_ACTION: "CONTINUE_NIGHT_AFTER_GUARD",
    NIGHT_WITCH_ACTION: "CONTINUE_NIGHT_AFTER_WOLF",
    NIGHT_SEER_ACTION: "CONTINUE_NIGHT_AFTER_WITCH",
  };
  for (const phase of NIGHT_ACTION_ORDER) {
    const state = board(BOARD_12_WITH_ALL_NIGHT_ROLES, {});
    assert.equal(replayCommandFor(phase), expected[phase], `${phase}：重跑指令`);
    assert.deepEqual(
      nightResumePlan(state, phase),
      { kind: "replay", command: expected[phase] },
      `${phase}：AI 沒落盤應該從這一步重跑`
    );
  }
});

/** 各階段行動者的座位（板子順序見 BOARD_12_WITH_ALL_NIGHT_ROLES）。 */
const ACTOR_SEAT: Record<NightActionPhase, number> = {
  NIGHT_GUARD_ACTION: 0,
  NIGHT_MUTE_ACTION: 1,
  NIGHT_DREAM_ACTION: 2,
  NIGHT_WOLF_ACTION: 3,
  NIGHT_WITCH_ACTION: 4,
  NIGHT_SEER_ACTION: 5,
};

test("真人未決定：停在該階段等輸入（不是重跑、也不是往下）", () => {
  for (const phase of NIGHT_ACTION_ORDER) {
    const state = withHuman(board(BOARD_12_WITH_ALL_NIGHT_ROLES, {}), ACTOR_SEAT[phase]);
    assert.deepEqual(nightResumePlan(state, phase), { kind: "wait" }, `${phase}：真人未決定要等`);
  }
});

test("真人已決定：照樣往下（不會因為是真人就一直等）", () => {
  for (const phase of NIGHT_ACTION_ORDER) {
    const state = withHuman(
      board(BOARD_12_WITH_ALL_NIGHT_ROLES, DECIDED_ACTIONS[phase]),
      ACTOR_SEAT[phase]
    );
    const plan = nightResumePlan(state, phase);
    assert.ok(
      plan.kind === "advance" || plan.kind === "resolve",
      `${phase}：真人已決定應該往下，實際 ${plan.kind}`
    );
  }
});

test("沒有這個角色：視為已完成（不會卡在一個沒有動作者的階段）", () => {
  // 只有一個村民的板子：六個夜間角色都不在場
  for (const phase of NIGHT_ACTION_ORDER) {
    const plan = nightResumePlan(board(["Villager"]), phase);
    assert.ok(
      plan.kind === "advance" || plan.kind === "resolve",
      `${phase}：沒有動作者應該直接被跳過，實際 ${plan.kind}`
    );
  }
});

test("沒有合法目標的退化情況（只剩自己存活）也算已完成", () => {
  const loneElder = board(["MuteElder"]);
  assert.deepEqual(nightResumePlan(loneElder, "NIGHT_MUTE_ACTION"), {
    kind: "advance",
    command: "CONTINUE_NIGHT_AFTER_MUTE",
  });
  const loneDreamer = board(["Dreamweaver"]);
  assert.deepEqual(nightResumePlan(loneDreamer, "NIGHT_DREAM_ACTION"), {
    kind: "advance",
    command: "CONTINUE_NIGHT_AFTER_DREAM",
  });
});

test("女巫：兩瓶藥用完就算已完成（不必再等任何人）", () => {
  const state = board(BOARD_12_WITH_ALL_NIGHT_ROLES, {});
  const outOfPotions: GameState = {
    ...state,
    roleAbilities: { ...state.roleAbilities, witchHealUsed: true, witchPoisonUsed: true },
  };
  assert.deepEqual(nightResumePlan(outOfPotions, "NIGHT_WITCH_ACTION"), {
    kind: "advance",
    command: "CONTINUE_NIGHT_AFTER_WITCH",
  });
  // 真人女巫但沒藥了：不是「等輸入」，是直接往下
  const humanOutOfPotions = withHuman(outOfPotions, ACTOR_SEAT.NIGHT_WITCH_ACTION);
  assert.equal(nightResumePlan(humanOutOfPotions, "NIGHT_WITCH_ACTION").kind, "advance");
});

test("重跑與跳過不能是同一個指令（否則等於沒重跑）", () => {
  for (const phase of NIGHT_ACTION_ORDER) {
    if (phase === "NIGHT_SEER_ACTION") continue; // 預言家的「往下」是結算，不是指令
    assert.notEqual(replayCommandFor(phase), ADVANCE_COMMANDS[phase], `${phase}：重跑≠跳過`);
  }
  // 重跑指令必須是鏈上真的存在的指令之一（不是任意字串）
  const known: NightResumeCommand[] = [
    "START_NIGHT",
    "CONTINUE_NIGHT_AFTER_GUARD",
    "CONTINUE_NIGHT_AFTER_MUTE",
    "CONTINUE_NIGHT_AFTER_DREAM",
    "CONTINUE_NIGHT_AFTER_WOLF",
    "CONTINUE_NIGHT_AFTER_WITCH",
  ];
  for (const phase of NIGHT_ACTION_ORDER) {
    assert.ok(known.includes(replayCommandFor(phase)), `${phase}：重跑指令必須是已知指令`);
  }
});

test("不是夜間行動階段就明確報錯，不靜默回一個錯的計畫", () => {
  const state = board(BOARD_12_WITH_ALL_NIGHT_ROLES, {});
  assert.throws(() => nightResumePlan(state, "NIGHT_RESOLVE"), /只接受夜間行動階段/);
});

test("每一步的重跑與跳過是不同指令（否則等於沒跳到／或重跑錯步）", () => {
  for (const phase of NIGHT_ACTION_ORDER) {
    if (phase === "NIGHT_SEER_ACTION") continue; // 預言家的「往下」是結算，不是指令
    assert.notEqual(
      replayCommandFor(phase),
      ADVANCE_COMMANDS[phase],
      `${phase}：重跑與跳過不該是同一個指令`
    );
  }
});
