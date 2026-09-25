import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { NIGHT_ACTION_ORDER, type NightActionPhase } from "@/lib/rules/phases";
import {
  NIGHT_STEP,
  actorsForNightStep,
  dreamDecided,
  humanActorPending,
  wolfBeautyDecided,
  isNightActionPhase,
  isNightComplete,
  muteDecided,
  nextPendingNightAction,
  nightStepFor,
  pendingNightActions,
} from "@/lib/rules/night-progress";
import { isWolfRole } from "@/types/game";
import type { GameState, Phase, Player, Role } from "@/types/game";

// 交叉檢查會讀到 store 的轉移表（那條 import 鏈需要這兩個環境變數才不會在載入時拋錯）
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "night-progress-test";

/**
 * 一夜推進的守衛。
 *
 * 這裡釘住四件事：步驟表覆蓋權威順序、每步的決定者與完成判定、補齊查詢（`pendingNightActions`）、
 * 以及「下一步」必須是狀態機允許的轉移。實際的續跑行為（NightPhase／useGameLogic）在 Phase 3-6 接線。
 */

/** 每一步的決定者與「未決定／已決定」的寫法（決定者欄位 → 讓它未決定；空陣列代表沒有這個角色）。 */
const STEP_CASES: { phase: NightActionPhase; actors: Role[]; undecided: Partial<GameState["nightActions"]>; decided: Partial<GameState["nightActions"]> }[] = [
  { phase: "NIGHT_GUARD_ACTION", actors: ["Guard"], undecided: {}, decided: { guardTarget: 1 } },
  { phase: "NIGHT_MUTE_ACTION", actors: ["MuteElder"], undecided: {}, decided: { mutedTarget: 1 } },
  { phase: "NIGHT_DREAM_ACTION", actors: ["Dreamweaver"], undecided: {}, decided: { dreamTarget: 1 } },
  { phase: "NIGHT_WOLF_ACTION", actors: ["Werewolf"], undecided: {}, decided: { wolfTarget: 1 } },
  { phase: "NIGHT_WOLF_BEAUTY_ACTION", actors: ["WolfBeauty"], undecided: {}, decided: { wolfBeautyTarget: 1 } },
  { phase: "NIGHT_WITCH_ACTION", actors: ["Witch"], undecided: {}, decided: { witchPoison: 1 } },
  { phase: "NIGHT_SEER_ACTION", actors: ["Seer"], undecided: {}, decided: { seerTarget: 1 } },
];

/** 以真實板子為底，只保留指定角色（其餘玩家出局），避免測試跟著版型變動。 */
function board(roles: Role[], patch: Partial<GameState> = {}): GameState {
  const base = createSinglePlayerContextAuditState();
  const players = base.players.map((p, i) => {
    const role = roles[i];
    if (!role) return { ...p, alive: false };
    return {
      ...p,
      role,
      alive: true,
      alignment: (isWolfRole(role) ? "wolf" : "village") as Player["alignment"],
    };
  });
  return { ...base, players, nightActions: {}, roleAbilities: { ...base.roleAbilities, witchHealUsed: false, witchPoisonUsed: false }, ...patch };
}

/** 把某個座位改成真人（其餘為 AI）。 */
const humanAt = (state: GameState, seat: number): GameState => ({
  ...state,
  players: state.players.map((p) => ({ ...p, isHuman: p.seat === seat })),
});

/** 全部夜間決定都未做的板子（有守衛、禁言長老、攝夢人、狼、狼美人、女巫、預言家）。 */
const fullBoard = (patch: Partial<GameState> = {}): GameState =>
  board(["Guard", "MuteElder", "Dreamweaver", "Magician", "Werewolf", "WolfBeauty", "Witch", "Seer"], patch);

/** 全部夜間決定都做好的板子。 */
const allDecided = (patch: Partial<GameState> = {}): GameState =>
  fullBoard({ nightActions: { guardTarget: 1, mutedTarget: 1, dreamTarget: 1, magicianSwap: [0, 1], wolfTarget: 1, wolfBeautyTarget: 1, witchPoison: 1, seerTarget: 1 }, ...patch });

test("步驟表正好覆蓋權威順序（多一個或少一個都會紅）", () => {
  assert.deepEqual([...NIGHT_ACTION_ORDER], ["NIGHT_GUARD_ACTION", "NIGHT_MUTE_ACTION", "NIGHT_DREAM_ACTION", "NIGHT_MAGICIAN_ACTION", "NIGHT_WOLF_ACTION", "NIGHT_WOLF_BEAUTY_ACTION", "NIGHT_WITCH_ACTION", "NIGHT_SEER_ACTION"]);
  const steps = Object.keys(NIGHT_STEP).sort();
  assert.deepEqual(steps, [...NIGHT_ACTION_ORDER].sort(), "NIGHT_STEP 的鍵必須正好是夜間行動階段");
  for (const phase of NIGHT_ACTION_ORDER) {
    assert.equal(NIGHT_STEP[phase].phase, phase, `${phase} 的步驟描述必須指向自己`);
  }
});

test("沒有決定者時：算已完成，且決定者清單為空", () => {
  for (const stepCase of STEP_CASES) {
    const withoutActor = board(["Villager"], { nightActions: {} });
    assert.equal(NIGHT_STEP[stepCase.phase].decided(withoutActor), true, `${stepCase.phase}：沒有決定者時應算完成`);
    assert.equal(actorsForNightStep(withoutActor, stepCase.phase).length, 0);
  }
});

test("有決定者時：未決定為 false、已決定為 true，且決定者就是那個角色", () => {
  for (const stepCase of STEP_CASES) {
    // 加一個村民，讓「有沒有合法目標」不影響這一步（禁言／攝夢只剩自己存活時會自動算完成）
    const withTarget = [...stepCase.actors, "Villager" as Role];
    const pending = board(withTarget, { nightActions: stepCase.undecided });
    assert.equal(NIGHT_STEP[stepCase.phase].decided(pending), false, `${stepCase.phase}：未決定應為 false`);
    const done = board(withTarget, { nightActions: stepCase.decided });
    assert.equal(NIGHT_STEP[stepCase.phase].decided(done), true, `${stepCase.phase}：已決定應為 true`);

    const actors = actorsForNightStep(pending, stepCase.phase);
    assert.equal(actors.length, 1, `${stepCase.phase}：應有 1 位決定者`);
    assert.equal(actors[0].role, stepCase.actors[0]);
  }
});

test("狼刀是團隊決定：所有存活狼人都是決定者", () => {
  const state = board(["Werewolf", "WhiteWolfKing", "Villager"], { nightActions: {} });
  const actors = actorsForNightStep(state, "NIGHT_WOLF_ACTION");
  assert.equal(actors.length, 2);
  assert.deepEqual(actors.map((p) => p.role).sort(), ["Werewolf", "WhiteWolfKing"]);
  // 沒有存活狼人 → 這一步沒東西要決定
  assert.equal(NIGHT_STEP.NIGHT_WOLF_ACTION.decided(board(["Villager"], { nightActions: {} })), true);
});

test("退化情況：沒有合法目標可選時算完成（只剩自己存活）", () => {
  assert.equal(NIGHT_STEP.NIGHT_MUTE_ACTION.decided(board(["MuteElder"], { nightActions: {} })), true);
  assert.equal(NIGHT_STEP.NIGHT_DREAM_ACTION.decided(board(["Dreamweaver"], { nightActions: {} })), true);
  // 但只要有別人活著，就還有東西要決定
  assert.equal(NIGHT_STEP.NIGHT_MUTE_ACTION.decided(board(["MuteElder", "Villager"], { nightActions: {} })), false);
  assert.equal(NIGHT_STEP.NIGHT_DREAM_ACTION.decided(board(["Dreamweaver", "Villager"], { nightActions: {} })), false);
});

test("女巫：藥都用完算完成，明確不救（witchSave=false）也算完成", () => {
  const witch = board(["Witch", "Villager"], { nightActions: {} });
  assert.equal(NIGHT_STEP.NIGHT_WITCH_ACTION.decided(witch), false);
  assert.equal(NIGHT_STEP.NIGHT_WITCH_ACTION.decided({ ...witch, nightActions: { witchSave: false } }), true);
  const noPotions = { ...witch, roleAbilities: { ...witch.roleAbilities, witchHealUsed: true, witchPoisonUsed: true } };
  assert.equal(NIGHT_STEP.NIGHT_WITCH_ACTION.decided(noPotions), true);
});

test("補齊查詢：還沒完成的步驟依序回傳，缺誰就補誰", () => {
  assert.deepEqual(pendingNightActions(fullBoard()).map((s) => s.phase), [...NIGHT_ACTION_ORDER]);
  assert.deepEqual(pendingNightActions(allDecided()).map((s) => s.phase), []);
  assert.equal(isNightComplete(allDecided()), true);
  assert.equal(isNightComplete(fullBoard()), false);

  // 只有預言家未決定 → 下一個就是預言家
  const onlySeer = fullBoard({ nightActions: { guardTarget: 1, mutedTarget: 1, dreamTarget: 1, magicianSwap: [0, 1], wolfTarget: 1, wolfBeautyTarget: 1, witchPoison: 1 } });
  assert.deepEqual(pendingNightActions(onlySeer).map((s) => s.phase), ["NIGHT_SEER_ACTION"]);
  assert.equal(nextPendingNightAction(onlySeer)?.phase, "NIGHT_SEER_ACTION");

  // 沒有守衛 → 守衛那一步不會出現
  const noGuard = board(["Villager"], { nightActions: {} });
  assert.deepEqual(pendingNightActions(noGuard).map((s) => s.phase), []);
});

test("補齊查詢：after 只看它之後的步驟（跳階時補齊用）", () => {
  const state = fullBoard();
  assert.deepEqual(
    pendingNightActions(state, { after: "NIGHT_DREAM_ACTION" }).map((s) => s.phase),
    ["NIGHT_MAGICIAN_ACTION", "NIGHT_WOLF_ACTION", "NIGHT_WOLF_BEAUTY_ACTION", "NIGHT_WITCH_ACTION", "NIGHT_SEER_ACTION"]
  );
  assert.deepEqual(
    pendingNightActions(state, { after: "NIGHT_SEER_ACTION" }).map((s) => s.phase),
    []
  );
  // 不是夜間行動階段（indexOf = -1）→ 等於從頭看
  for (const phase of ["DAY_SPEECH", "NIGHT_START", "NIGHT_RESOLVE"] as Phase[]) {
    assert.deepEqual(pendingNightActions(state, { after: phase }).map((s) => s.phase), [...NIGHT_ACTION_ORDER]);
  }
  assert.equal(nextPendingNightAction(state, { after: "NIGHT_WITCH_ACTION" })?.phase, "NIGHT_SEER_ACTION");
});

test("順序必須是狀態機允許的轉移（順序表與轉移表不得漂移）", async () => {
  const { VALID_TRANSITIONS } = await import("@/store/game-machine");
  // 相鄰兩步必須是合法轉移；最後一步之後要能進 NIGHT_RESOLVE
  assert.ok(VALID_TRANSITIONS.NIGHT_START.includes(NIGHT_ACTION_ORDER[0]), "第一步必須能從 NIGHT_START 進入");
  for (let i = 0; i < NIGHT_ACTION_ORDER.length; i += 1) {
    const current = NIGHT_ACTION_ORDER[i];
    const next: Phase = NIGHT_ACTION_ORDER[i + 1] ?? "NIGHT_RESOLVE";
    assert.ok(
      VALID_TRANSITIONS[current].includes(next),
      `${current} → ${next} 不在狀態機的合法轉移裡`
    );
  }
});

/**
 * 階段層（`NightPhase` 續跑鏈）要的是「正在等真人決定」。
 * 這組測試的重點是**與舊寫法的等價性**：舊版是各處自己寫
 * `x?.isHuman && 某欄位 === undefined`，女巫那處還把「藥用完了」重推一次。
 */
test("等真人判定：真人未決定為 true，已決定／AI／沒有決定者為 false", () => {
  for (const stepCase of STEP_CASES) {
    const seats = [...stepCase.actors, "Villager" as Role];
    const aiPending = board(seats, { nightActions: stepCase.undecided });
    const humanPending = humanAt(aiPending, 0);
    assert.equal(humanActorPending(humanPending, stepCase.phase), true, `${stepCase.phase}：真人未決定應為 true`);
    // AI 未決定不代表要等（AI 的決定由階段自己做完）
    assert.equal(humanActorPending(aiPending, stepCase.phase), false, `${stepCase.phase}：AI 不該算等真人`);

    const humanDone = humanAt(board(seats, { nightActions: stepCase.decided }), 0);
    assert.equal(humanActorPending(humanDone, stepCase.phase), false, `${stepCase.phase}：已決定就不等`);

    // 沒有決定者（角色不在場）→ 沒東西可等
    assert.equal(humanActorPending(humanAt(board(["Villager"], { nightActions: {} }), 0), stepCase.phase), false);
  }
});

test("等真人判定：女巫的「藥用完了」也算已決定（舊寫法把這條規則重推了一次）", () => {
  const base = humanAt(board(["Witch", "Villager"], { nightActions: {} }), 0);
  assert.equal(humanActorPending(base, "NIGHT_WITCH_ACTION"), true);
  // 明確不救
  assert.equal(
    humanActorPending({ ...base, nightActions: { witchSave: false } }, "NIGHT_WITCH_ACTION"),
    false
  );
  // 兩瓶藥都用完
  const noPotions = { ...base, roleAbilities: { ...base.roleAbilities, witchHealUsed: true, witchPoisonUsed: true } };
  assert.equal(humanActorPending(noPotions, "NIGHT_WITCH_ACTION"), false);
});

test("等真人判定：狼隊只要有一位真人在且未決定就算等", () => {
  const team = humanAt(board(["Werewolf", "WhiteWolfKing", "Villager"], { nightActions: {} }), 0);
  assert.equal(humanActorPending(team, "NIGHT_WOLF_ACTION"), true);
  assert.equal(
    humanActorPending({ ...team, nightActions: { wolfTarget: 1 } }, "NIGHT_WOLF_ACTION"),
    false
  );
});

test("等真人判定：沒有合法目標時不算等（真人不再卡住）", () => {
  // 只剩真人攝夢人自己存活：規則上這一晚沒有夢游者，階段不應該停在等他選
  const loneHumanDreamer = humanAt(board(["Dreamweaver"], { nightActions: {} }), 0);
  assert.equal(dreamDecided(loneHumanDreamer), true);
  assert.equal(humanActorPending(loneHumanDreamer, "NIGHT_DREAM_ACTION"), false);

  const loneHumanElder = humanAt(board(["MuteElder"], { nightActions: {} }), 0);
  assert.equal(muteDecided(loneHumanElder), true);
  assert.equal(humanActorPending(loneHumanElder, "NIGHT_MUTE_ACTION"), false);
});

test("型別守衛：夜間行動階段與其他階段分得開", () => {
  for (const phase of NIGHT_ACTION_ORDER) {
    assert.equal(isNightActionPhase(phase), true);
    assert.ok(nightStepFor(phase));
  }
  for (const phase of ["LOBBY", "SETUP", "NIGHT_START", "NIGHT_RESOLVE", "DAY_VOTE", "GAME_END"] as Phase[]) {
    assert.equal(isNightActionPhase(phase), false, `${phase} 不是夜間行動階段`);
    assert.equal(nightStepFor(phase), undefined);
    assert.deepEqual(actorsForNightStep(fullBoard(), phase), []);
  }
});
