import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import {
  applyCharmRevenge,
  getWolfKnifeEligibleSeats,
  canCharmSelf,
  getCharmRevengeSeat,
  getCharmedSeat,
  getWolfBeautyEligibleSeats,
  isWolfBeauty,
  isValidWolfBeautyTarget,
  pickRandomWolfBeautyTarget,
  triggersCharmRevenge,
} from "@/lib/rules/charm";
import { resolveNightDeaths } from "@/lib/rules/night-resolution";
import type { GameState, Player } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "charm-key";

setLocale("zh-CN");

/** 狼美人在 0 號、1 號獵人、其餘村民；可指定額外狀態。 */
function stateWith(roles: Array<[number, Player["role"]]>, patch: Partial<GameState> = {}): GameState {
  const base = createSinglePlayerContextAuditState();
  const map = new Map<number, Player["role"]>([[0, "WolfBeauty"], ...roles]);
  return {
    ...base,
    phase: "NIGHT_WOLF_BEAUTY_ACTION",
    day: 2,
    players: base.players.map((p) => (map.has(p.seat) ? { ...p, role: map.get(p.seat)!, alive: true } : p)),
    nightHistory: {},
    ...patch,
  };
}

test("魅惑不能選自己（能力表即規則）", () => {
  assert.equal(canCharmSelf(), false);
  const state = stateWith([]);
  assert.equal(getWolfBeautyEligibleSeats(state, 0).includes(0), false, "不能魅惑自己");
  assert.equal(isValidWolfBeautyTarget(state, 0, 0), false);
});

test("合法魅惑對象＝存活玩家（不含自己、不含當晚已死的未公布死者）", () => {
  const state = stateWith([], {
    nightActions: { ...stateBase(), pendingWolfVictim: 3, pendingPoisonVictim: 4 },
  });
  const seats = getWolfBeautyEligibleSeats(state, 0);
  assert.equal(seats.includes(0), false, "自己不在名單");
  assert.equal(seats.includes(3), false, "今晚已被刀的人不重複列入");
  assert.equal(seats.includes(4), false, "今晚已被毒的人不重複列入");
  assert.ok(seats.includes(1), "一般存活玩家在名單內");
});

test("狼刀不能刀狼美人（不能自刀）", () => {
  const state = stateWith([], {});
  const knifeSeats = getWolfKnifeEligibleSeats(state);
  assert.equal(knifeSeats.includes(0), false, "狼美人不在狼刀候選裡");
  assert.equal(knifeSeats.includes(1), true, "其他存活玩家照舊可刀");
});

test("狼刀名單同樣排除已死者", () => {
  const base = stateWith([], {});
  const state: GameState = {
    ...base,
    players: base.players.map((p) => (p.seat === 5 ? { ...p, alive: false } : p)),
  };
  assert.equal(getWolfKnifeEligibleSeats(state).includes(5), false);
});

test("死者不在魅惑名單裡", () => {
  const base = stateWith([]);
  const state: GameState = {
    ...base,
    players: base.players.map((p) => (p.seat === 5 ? { ...p, alive: false } : p)),
  };
  assert.equal(getWolfBeautyEligibleSeats(state, 0).includes(5), false);
});

test("沒有合法目標時（只剩自己）回 undefined 而不是硬選", () => {
  const base = stateWith([]);
  const state: GameState = {
    ...base,
    players: base.players.map((p) => ({ ...p, alive: p.seat === 0 })),
  };
  assert.deepEqual(getWolfBeautyEligibleSeats(state, 0), []);
  assert.equal(pickRandomWolfBeautyTarget(state, 0), undefined);
});

test("隨機指定只會落在合法名單內", () => {
  const state = stateWith([]);
  const allowed = new Set(getWolfBeautyEligibleSeats(state, 0));
  for (let i = 0; i < 30; i += 1) {
    const seat = pickRandomWolfBeautyTarget(state, 0);
    assert.ok(seat !== undefined && allowed.has(seat), `亂數結果 ${seat} 必須是合法座位`);
  }
});

test("getCharmedSeat 的讀取順序：今晚 → 前一晚 → 夜史", () => {
  assert.equal(getCharmedSeat(stateWith([], { nightActions: { ...stateBase(), wolfBeautyTarget: 7 } })), 7);
  assert.equal(
    getCharmedSeat(stateWith([], { nightActions: { ...stateBase(), lastWolfBeautyTarget: 8 } })),
    8,
    "今晚還沒決定時，前一晚的魅惑仍然生效"
  );
  assert.equal(
    getCharmedSeat(
      stateWith([], {
        nightActions: { ...stateBase(), wolfBeautyTarget: 7, lastWolfBeautyTarget: 8 },
      })
    ),
    7,
    "今晚的決定優先"
  );
  assert.equal(
    getCharmedSeat(
      stateWith([], {
        nightHistory: { 2: { wolfBeautyTarget: 9 } },
      })
    ),
    9,
    "夜間結算落盤的紀錄也要讀得到"
  );
});

test("騎士決鬥不發動殉情，其餘死因都發動", () => {
  assert.equal(triggersCharmRevenge("duel"), false);
  for (const cause of ["exile", "night_kill", "poison", "milk", "dream", "carried"] as const) {
    assert.equal(triggersCharmRevenge(cause), true, `${cause} 應該發動殉情`);
  }
});

test("狼美人出局 → 被魅惑者一起走（放逐／夜死／毒／被帶走都算）", () => {
  for (const cause of ["exile", "night_kill", "poison", "carried"] as const) {
    const state = stateWith([], { nightActions: { ...stateBase(), wolfBeautyTarget: 5 } });
    assert.equal(getCharmRevengeSeat(state, 0, cause), 5, `${cause} 要帶走 5 號`);
  }
});

test("騎士決鬥出局不帶走任何人", () => {
  const state = stateWith([], { nightActions: { ...stateBase(), wolfBeautyTarget: 5 } });
  assert.equal(getCharmRevengeSeat(state, 0, "duel"), null);
});

test("不是狼美人出局就不發動", () => {
  const state = stateWith([], { nightActions: { ...stateBase(), wolfBeautyTarget: 5 } });
  assert.equal(getCharmRevengeSeat(state, 1, "exile"), null, "獵人出局不會帶走人");
});

test("被魅惑者若已先出局，殉情不再成立（屍體不會再死一次）", () => {
  const base = stateWith([], { nightActions: { ...stateBase(), wolfBeautyTarget: 5 } });
  const state: GameState = {
    ...base,
    players: base.players.map((p) => (p.seat === 5 ? { ...p, alive: false } : p)),
  };
  assert.equal(getCharmRevengeSeat(state, 0, "exile"), null);
});

test("沒有魅惑對象（或魅惑到自己）時不發動", () => {
  assert.equal(getCharmRevengeSeat(stateWith([]), 0, "exile"), null, "這一晚沒有魅惑對象");
  assert.equal(
    getCharmRevengeSeat(stateWith([], { nightActions: { ...stateBase(), wolfBeautyTarget: 0 } }), 0, "exile"),
    null,
    "資料異常（魅惑自己）時不發動"
  );
});

test("applyCharmRevenge 只改存活狀態，不動其他玩家", () => {
  const state = stateWith([], { nightActions: { ...stateBase(), wolfBeautyTarget: 5 } });
  const { state: next, victimSeat } = applyCharmRevenge(state, 0, "exile");
  assert.equal(victimSeat, 5);
  assert.equal(next.players.find((p) => p.seat === 5)?.alive, false);
  assert.equal(next.players.find((p) => p.seat === 0)?.alive, true, "狼美人本人的死亡由呼叫端負責");
  assert.equal(
    next.players.filter((p) => !p.alive).length,
    1,
    "除了被魅惑者以外沒有人被動到"
  );
});

test("applyCharmRevenge 不發動時原樣回傳", () => {
  const state = stateWith([]);
  const { state: next, victimSeat } = applyCharmRevenge(state, 0, "duel");
  assert.equal(victimSeat, null);
  assert.equal(next, state, "沒有連帶時不建立新狀態");
});

test("isWolfBeauty", () => {
  assert.equal(isWolfBeauty("WolfBeauty"), true);
  assert.equal(isWolfBeauty("Werewolf"), false);
  assert.equal(isWolfBeauty(undefined), false);
});

/** 乾淨的夜間行動預設值（避免每個測試都重寫一次）。 */
function stateBase(): GameState["nightActions"] {
  return { ...createSinglePlayerContextAuditState().nightActions };
}

// ─────────────────────────────────────────────────────────────
// 夜間結算：狼美人夜死 → 被魅惑者殉情
// ─────────────────────────────────────────────────────────────

test("狼美人被女巫毒死：被魅惑者一并殉情（死因記 charm）", () => {
  // 實戰中狼美人不會被自家狼刀（不能自刀），夜間出局最常見的就是被女巫毒死；
  // 使用者 2026-09-26 裁定：這種夜間出局一樣要發動魅惑。
  const result = resolveNightDeaths({
    wolfTarget: 3,
    witchPoison: 0,
    wolfBeautySeat: 0,
    wolfBeautyTarget: 5,
  });
  assert.equal(result.charmVictimSeat, 5);
  assert.ok(result.deaths.some((death) => death.seat === 0 && death.reason === "poison"));
  assert.ok(result.deaths.some((death) => death.seat === 5 && death.reason === "charm"));
});

test("狼美人夜間出局：被魅惑者一并殉情（死因記 charm）", () => {
  const result = resolveNightDeaths({
    wolfTarget: 0,
    wolfBeautySeat: 0,
    wolfBeautyTarget: 5,
  });
  assert.equal(result.charmVictimSeat, 5);
  assert.deepEqual(result.deaths, [
    { seat: 0, reason: "wolf" },
    { seat: 5, reason: "charm" },
  ]);
});

test("狼美人沒出局：魅惑對象安然無事", () => {
  const result = resolveNightDeaths({
    wolfTarget: 3,
    wolfBeautySeat: 0,
    wolfBeautyTarget: 5,
  });
  assert.equal(result.charmVictimSeat, undefined);
  assert.deepEqual(result.deaths, [{ seat: 3, reason: "wolf" }]);
});

test("守護擋不住殉情（魅惑不是狼刀）", () => {
  const result = resolveNightDeaths({
    wolfTarget: 0,
    guardTarget: 5,
    wolfBeautySeat: 0,
    wolfBeautyTarget: 5,
  });
  assert.equal(result.charmVictimSeat, 5, "被魅惑者即使被守護也照樣殉情");
  assert.deepEqual(result.deaths, [
    { seat: 0, reason: "wolf" },
    { seat: 5, reason: "charm" },
  ]);
});

test("被魅惑者當晚已因其他死因出局：不覆蓋既有死因", () => {
  const result = resolveNightDeaths({
    wolfTarget: 0,
    witchPoison: 5,
    wolfBeautySeat: 0,
    wolfBeautyTarget: 5,
  });
  assert.deepEqual(
    result.deaths,
    [
      { seat: 0, reason: "wolf" },
      { seat: 5, reason: "poison" },
    ],
    "同一個座位只記一次、且以既有死因為準（封槍與公告都看它）"
  );
});

test("回放時狼美人當時不在場：不發動殉情", () => {
  const result = resolveNightDeaths({
    wolfTarget: 3,
    wolfBeautySeat: 0,
    wolfBeautyTarget: 5,
    isActorAlive: (actor) => actor !== "wolfBeauty",
  });
  assert.equal(result.charmVictimSeat, undefined);
  assert.deepEqual(result.deaths, [{ seat: 3, reason: "wolf" }]);
});

// ─────────────────────────────────────────────────────────────
// 階段機：魅惑排在魔術師之後、狼人之前
// ─────────────────────────────────────────────────────────────

test("階段機：魅惑排在魔術師之後、狼人之前；只有真人狼美人需要輸入", async () => {
  const { PHASE_CONFIGS, VALID_TRANSITIONS } = await import("@/store/game-machine");
  assert.deepEqual(VALID_TRANSITIONS.NIGHT_WOLF_BEAUTY_ACTION, [
    "NIGHT_WOLF_ACTION",
    "NIGHT_WITCH_ACTION",
  ]);
  assert.deepEqual(VALID_TRANSITIONS.NIGHT_WOLF_ACTION, ["NIGHT_WITCH_ACTION"]);

  const state = stateWith([]);
  const config = PHASE_CONFIGS.NIGHT_WOLF_BEAUTY_ACTION;
  const beauty = state.players.find((player) => player.seat === 0)!;
  const villager = state.players.find((player) => player.seat === 1)!;
  // 慣例：呼叫端一律傳「真人玩家」進來（isHuman 由呼叫端保證）
  assert.equal(config.requiresHumanInput({ ...beauty, isHuman: true }, state), true);
  assert.equal(config.requiresHumanInput({ ...beauty, isHuman: true, alive: false }, state), false);
  assert.equal(config.requiresHumanInput({ ...villager, isHuman: true }, state), false);
  // UI 可點選＝合法魅惑目標：不能選自己，其他人可以
  assert.equal(config.canSelectPlayer({ ...beauty, isHuman: true }, beauty, state), false);
  assert.equal(config.canSelectPlayer({ ...beauty, isHuman: true }, villager, state), true);
  // 不是狼美人（例如村民的回合）不能操作這一階段
  assert.equal(config.canSelectPlayer({ ...villager, isHuman: true }, beauty, state), false);
});
