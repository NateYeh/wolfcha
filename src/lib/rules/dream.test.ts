import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import { getDreamEligibleSeats, isValidDreamTarget, pickRandomDreamTarget } from "@/lib/rules/dream";
import { resolveNightDeaths } from "@/lib/rules/night-resolution";
import { canUseDeathShot } from "@/lib/rules/death-skills";
import { getBoardById, validateBoardPreset } from "@/lib/rules/boards";
import type { GameState } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "dream-rules-test-key";

setLocale("zh-CN");

/** 攝夢人在 4 號（seat 3），方便測試「不能攝自己」與「攝夢人夜死連帶」 */
function fresh(): GameState {
  const state = createSinglePlayerContextAuditState();
  return {
    ...state,
    day: 2,
    players: state.players.map((player) =>
      player.seat === 3 ? { ...player, role: "Dreamweaver" } : player,
    ),
    messages: [],
    nightHistory: {},
    dayHistory: {},
    nightActions: {},
    dailySummaryFacts: {},
    roleAbilities: { ...state.roleAbilities, witchHealUsed: false, witchPoisonUsed: false },
  };
}

const DREAMER_SEAT = 3;

// ─────────────────────────────────────────────────────────────
// 可攝座位（每晚必須指定、不能選自己、不能指定死訊未公布的死者）
// ─────────────────────────────────────────────────────────────

test("攝夢人可攝座位：排除自己與死訊未公布的死者，其餘存活玩家都可攝", () => {
  const state = fresh();
  const eligible = getDreamEligibleSeats(state, DREAMER_SEAT);
  assert.equal(eligible.includes(DREAMER_SEAT), false, "不能攝自己");
  assert.equal(eligible.includes(1), true, "存活玩家可攝");
  assert.equal(eligible.includes(99), false);

  // 連續兩晚攝同一人是允許的（官方規則：連攝＝該玩家出局），不列入排除條件
  const repeatState: GameState = {
    ...state,
    nightActions: { ...state.nightActions, lastDreamTarget: 5 },
  };
  assert.equal(getDreamEligibleSeats(repeatState, DREAMER_SEAT).includes(5), true, "可以連攝");

  // 死訊未公布（狼刀待公告）的座位邏輯上已經出局：不能攝
  const pendingState: GameState = {
    ...state,
    nightActions: { ...state.nightActions, pendingWolfVictim: 5 },
  };
  assert.equal(getDreamEligibleSeats(pendingState, DREAMER_SEAT).includes(5), false);
  assert.equal(isValidDreamTarget(state, DREAMER_SEAT, DREAMER_SEAT), false);
  assert.equal(isValidDreamTarget(state, DREAMER_SEAT, 1), true);
});

test("未操作則系統隨機指定：候選來自合法座位，沒有合法目標時回 undefined", () => {
  const state = fresh();
  const eligible = getDreamEligibleSeats(state, DREAMER_SEAT);
  for (let i = 0; i < 30; i += 1) {
    const picked = pickRandomDreamTarget(state, DREAMER_SEAT);
    assert.ok(picked !== undefined && eligible.includes(picked), "隨機目標必須落在合法座位內");
  }

  // 只剩攝夢人自己存活：沒有合法目標（此時這一晚沒有夢游者）
  const lonely: GameState = {
    ...state,
    players: state.players.map((player) => ({ ...player, alive: player.seat === DREAMER_SEAT })),
  };
  assert.equal(pickRandomDreamTarget(lonely, DREAMER_SEAT), undefined);
});

// ─────────────────────────────────────────────────────────────
// 夜間結算：免疫、連攝、攝夢人夜死連帶
// ─────────────────────────────────────────────────────────────

test("夢游者免疫夜間傷害：狼刀與毒藥都落空，技能視為已使用", () => {
  // 刀口落在夢游者身上、沒有守護也沒有解藥 → 平安夜（免疫）
  const knifed = resolveNightDeaths({ wolfTarget: 5, dreamTarget: 5, dreamerSeat: DREAMER_SEAT });
  assert.deepEqual(knifed.deaths, []);
  assert.equal(knifed.wolfKillSuccessful, false);
  assert.equal(knifed.wolfVictimSeat, undefined);

  // 毒藥落在夢游者身上 → 落空（毒藥仍由呼叫端記為已使用）
  const poisoned = resolveNightDeaths({ witchPoison: 5, dreamTarget: 5, dreamerSeat: DREAMER_SEAT });
  assert.deepEqual(poisoned.deaths, []);
  assert.equal(poisoned.poisonVictimSeat, undefined);

  // 刀口落在別人身上：夢游者免疫不影響別人
  const other = resolveNightDeaths({ wolfTarget: 6, dreamTarget: 5, dreamerSeat: DREAMER_SEAT });
  assert.deepEqual(other.deaths, [{ seat: 6, reason: "wolf" }]);
});

test("連續兩晚被攝：夢游者一并出局（夢死，解藥救不活）", () => {
  const result = resolveNightDeaths({
    wolfTarget: 7,
    witchSave: true,
    dreamTarget: 5,
    dreamerSeat: DREAMER_SEAT,
    previousDreamTarget: 5,
  });
  assert.equal(result.dreamVictimSeat, 5);
  assert.deepEqual(result.deaths, [{ seat: 5, reason: "dream" }]);
  // 連攝死者不吃解藥：即使女巫當晚救了 5 號，仍然出局（解藥只作用在刀口，且刀口是 7 號）
  const savedDreamer = resolveNightDeaths({
    wolfTarget: 5,
    witchSave: true,
    dreamTarget: 5,
    dreamerSeat: DREAMER_SEAT,
    previousDreamTarget: 5,
  });
  assert.deepEqual(savedDreamer.deaths, [{ seat: 5, reason: "dream" }]);
});

test("攝夢人夜間出局：當晚夢游者一并出局", () => {
  // 攝夢人被刀 → 夢游者與他一起出局
  const knifedDreamer = resolveNightDeaths({
    wolfTarget: DREAMER_SEAT,
    dreamTarget: 5,
    dreamerSeat: DREAMER_SEAT,
  });
  assert.deepEqual(knifedDreamer.deaths, [
    { seat: DREAMER_SEAT, reason: "wolf" },
    { seat: 5, reason: "dream" },
  ]);

  // 攝夢人被毒 → 同樣連帶
  const poisonedDreamer = resolveNightDeaths({
    witchPoison: DREAMER_SEAT,
    dreamTarget: 5,
    dreamerSeat: DREAMER_SEAT,
  });
  assert.deepEqual(poisonedDreamer.deaths, [
    { seat: DREAMER_SEAT, reason: "poison" },
    { seat: 5, reason: "dream" },
  ]);

  // 攝夢人被刀但女巫救活 → 他沒死，夢游者也不連帶
  const savedDreamer = resolveNightDeaths({
    wolfTarget: DREAMER_SEAT,
    witchSave: true,
    dreamTarget: 5,
    dreamerSeat: DREAMER_SEAT,
  });
  assert.deepEqual(savedDreamer.deaths, []);
});

test("攝夢人已出局（不在場）時沒有夢游者：刀口照常結算", () => {
  const result = resolveNightDeaths({
    wolfTarget: 5,
    dreamTarget: 5,
    dreamerSeat: DREAMER_SEAT,
    isActorAlive: (actor) => actor !== "dreamweaver",
  });
  assert.deepEqual(result.deaths, [{ seat: 5, reason: "wolf" }]);
  assert.equal(result.dreamedSeat, undefined);
});

test("夢死封槍：被夢帶走的獵人不能開槍（比照被毒）", () => {
  const state = fresh();
  const hunterSeat = 5;
  const withDreamDeath: GameState = {
    ...state,
    players: state.players.map((player) =>
      player.seat === hunterSeat ? { ...player, role: "Hunter" } : player,
    ),
    nightHistory: {
      2: { dreamTarget: hunterSeat, deaths: [{ seat: hunterSeat, reason: "dream" }] },
    },
  };
  assert.equal(
    canUseDeathShot({ state: withDreamDeath, role: "Hunter", seat: hunterSeat, cause: "night_kill" }),
    false,
    "被夢帶走 → 封槍",
  );
  // 對照：正常被刀可以開槍
  const withWolfDeath: GameState = {
    ...withDreamDeath,
    nightHistory: { 2: { deaths: [{ seat: hunterSeat, reason: "wolf" }] } },
  };
  assert.equal(
    canUseDeathShot({ state: withWolfDeath, role: "Hunter", seat: hunterSeat, cause: "night_kill" }),
    true,
  );
});

// ─────────────────────────────────────────────────────────────
// 階段機：攝夢人接在禁言長老之後、狼人之前
// ─────────────────────────────────────────────────────────────

test("階段機：NIGHT_DREAM_ACTION 排在禁言長老之後、狼人之前，且只有真人攝夢人需要輸入", async () => {
  const { PHASE_CONFIGS, VALID_TRANSITIONS } = await import("@/store/game-machine");
  assert.deepEqual(VALID_TRANSITIONS.NIGHT_MUTE_ACTION, ["NIGHT_DREAM_ACTION", "NIGHT_MAGICIAN_ACTION", "NIGHT_WOLF_BEAUTY_ACTION", "NIGHT_WOLF_ACTION"]);
  assert.deepEqual(VALID_TRANSITIONS.NIGHT_DREAM_ACTION, ["NIGHT_MAGICIAN_ACTION", "NIGHT_WOLF_BEAUTY_ACTION", "NIGHT_WOLF_ACTION"]);

  const state = fresh();
  const config = PHASE_CONFIGS.NIGHT_DREAM_ACTION;
  const dreamer = state.players.find((player) => player.seat === DREAMER_SEAT)!;
  // 慣例：呼叫端一律傳「真人玩家」進來（isHuman 由呼叫端保證），這裡只判角色與存活。
  assert.equal(config.requiresHumanInput({ ...dreamer, isHuman: true }, state), true);
  assert.equal(config.requiresHumanInput({ ...dreamer, isHuman: true, alive: false }, state), false);
  const villager = state.players.find((player) => player.seat === 1)!;
  assert.equal(config.requiresHumanInput({ ...villager, isHuman: true }, state), false);
  // 不能點自己、不能點死訊未公布的死者
  assert.equal(config.canSelectPlayer({ ...dreamer, isHuman: true }, dreamer, state), false);
  assert.equal(
    config.canSelectPlayer({ ...dreamer, isHuman: true }, state.players.find((p) => p.seat === 1)!, state),
    true,
  );
  assert.equal(
    config.canSelectPlayer(
      { ...dreamer, isHuman: true },
      state.players.find((p) => p.seat === 5)!,
      { ...state, nightActions: { ...state.nightActions, pendingWolfVictim: 5 } },
    ),
    false,
  );
});

// ─────────────────────────────────────────────────────────────
// 版型：狼王攝夢人
// ─────────────────────────────────────────────────────────────

test("版型：狼王摄梦人 12 人局組成正確且通過驗證", () => {
  const board = getBoardById("official-12-wolf-king-dreamweaver");
  assert.ok(board, "版型必須存在");
  assert.equal(board.playerCount, 12);
  assert.deepEqual(validateBoardPreset(board).errors, []);
  const count = (role: string) => board.roles.filter((item) => item === role).length;
  assert.equal(count("Werewolf"), 3);
  assert.equal(count("WolfKing"), 1);
  for (const god of ["Seer", "Witch", "Dreamweaver", "Hunter"]) {
    assert.equal(count(god), 1, `神職 ${god} 一人`);
  }
  assert.equal(count("Villager"), 4);
  assert.equal(board.tags.includes("進階"), false);
  assert.deepEqual(board.tags, ["狼王攝夢", "12人"]);
});
