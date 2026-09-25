import assert from "node:assert/strict";
import test from "node:test";
import { resolveNightDeaths } from "@/lib/rules/night-resolution";
import { getMagicianSwap, getSwapEligibleSeats, isValidSwap, pickRandomSwap, redirectSeat } from "@/lib/rules/magician";
import type { GameState } from "@/types/game";

const stateWith = (roles: Array<[number, string]>): GameState =>
  ({
    day: 1,
    players: roles.map(([seat, role]) => ({
      seat, role, alive: true, playerId: `p${seat}`, displayName: `${seat + 1}號`, alignment: role === "Werewolf" ? "wolf" : "village",
    })),
    nightActions: {},
    nightHistory: {},
  }) as unknown as GameState;

test("魔術師：合法組合＝兩人都存活且不相同（可以包含自己）", () => {
  const state = stateWith([[0, "Magician"], [1, "Werewolf"], [2, "Seer"], [3, "Villager"]]);
  assert.deepEqual(getSwapEligibleSeats(state), [0, 1, 2, 3]);
  assert.equal(isValidSwap(state, [0, 1]), true, "可以把自己換進去");
  assert.equal(isValidSwap(state, [1, 2]), true);
  assert.equal(isValidSwap(state, [1, 1]), false, "同一人不合法");
  assert.equal(isValidSwap(state, [1, 9]), false, "死人／不存在的座位不合法");
  assert.equal(isValidSwap(state, undefined), false);
});

test("魔術師：死者不能參與交換；活人不到兩個時沒有合法組合", () => {
  const two = stateWith([[0, "Magician"], [1, "Werewolf"]]);
  two.players[1].alive = false;
  assert.deepEqual(getSwapEligibleSeats(two), [0]);
  assert.equal(isValidSwap(two, [0, 1]), false);
  assert.equal(pickRandomSwap(two), undefined);
});

test("redirectSeat：對稱（換兩次等於還原），不在組合裡的原樣回傳", () => {
  const swap = [2, 7] as const;
  assert.equal(redirectSeat(2, swap), 7);
  assert.equal(redirectSeat(7, swap), 2);
  assert.equal(redirectSeat(2, [7, 2]), 7, "組合順序不影響");
  assert.equal(redirectSeat(5, swap), 5);
  assert.equal(redirectSeat(undefined, swap), undefined);
  assert.equal(redirectSeat(3, undefined), 3);
});

test("getMagicianSwap：形狀不對當作沒有（不丟例外）", () => {
  assert.deepEqual(getMagicianSwap({ magicianSwap: [1, 4] }), [1, 4]);
  assert.equal(getMagicianSwap({ magicianSwap: [1] }), undefined);
  assert.equal(getMagicianSwap({ magicianSwap: ["a", "b"] }), undefined);
  assert.equal(getMagicianSwap({}), undefined);
  assert.equal(getMagicianSwap(null), undefined);
});

test("夜間結算：狼刀被換位 → 死的是被換到的那一個", () => {
  const swapped = resolveNightDeaths({ wolfTarget: 3, magicianSwap: [3, 8], magicianSeat: 0 });
  assert.deepEqual(swapped.deaths, [{ seat: 8, reason: "wolf" }]);
  assert.equal(swapped.wolfVictimSeat, 8);
  // 沒有魔術師 → 原樣
  assert.deepEqual(resolveNightDeaths({ wolfTarget: 3 }).deaths, [{ seat: 3, reason: "wolf" }]);
  // 魔術師已死 → 不生效
  assert.deepEqual(
    resolveNightDeaths({ wolfTarget: 3, magicianSwap: [3, 8], isActorAlive: (a) => a !== "magician" }).deaths,
    [{ seat: 3, reason: "wolf" }]
  );
});

test("夜間結算：毒藥、守護、攝夢、魅惑都跟著換位（守護是使用者裁定要換的）", () => {
  // 毒藥：指 2 號、換到 6 號 → 死的是 6 號
  assert.deepEqual(
    resolveNightDeaths({ witchPoison: 2, magicianSwap: [2, 6], magicianSeat: 0 }).deaths,
    [{ seat: 6, reason: "poison" }]
  );

  // 守護：守 A、狼刀也指 A，A 被換到 B → 守護也改判到 B → B 被守又被救＝毒奶
  assert.deepEqual(
    resolveNightDeaths({ wolfTarget: 5, guardTarget: 5, witchSave: true, magicianSwap: [5, 9], magicianSeat: 0 }).deaths,
    [{ seat: 9, reason: "milk" }]
  );

  // 攝夢連帶：刀指攝夢人（1 號，不在組合裡），夢遊者 4 號被換到 7 號
  // → 攝夢人死 → 夢遊者（改判後的 7 號）一併夢死
  assert.deepEqual(
    resolveNightDeaths({ wolfTarget: 1, dreamTarget: 4, dreamerSeat: 1, magicianSwap: [4, 7], magicianSeat: 0 }).deaths,
    [{ seat: 1, reason: "wolf" }, { seat: 7, reason: "dream" }]
  );

  // 魅惑連帶：刀指狼美人（2 號），她的魅惑對象 6 號被換到 7 號
  // → 狼美人死 → 被魅惑者（改判後的 7 號）殉情
  assert.deepEqual(
    resolveNightDeaths({ wolfTarget: 2, wolfBeautySeat: 2, wolfBeautyTarget: 6, magicianSwap: [6, 7], magicianSeat: 0 }).deaths,
    [{ seat: 2, reason: "wolf" }, { seat: 7, reason: "charm" }]
  );
});

test("夜間結算：換位可以把刀從狼美人身上移走，她就不會殉情（換位＝改判，不是同時發生）", () => {
  const result = resolveNightDeaths({
    wolfTarget: 2, wolfBeautySeat: 2, wolfBeautyTarget: 6, magicianSwap: [2, 6], magicianSeat: 0,
  });
  // 刀從 2 號改判到 6 號：狼美人活著 → 沒有殉情；被魅惑的 6 號反而被刀死
  assert.deepEqual(result.deaths, [{ seat: 6, reason: "wolf" }]);
  assert.equal(result.charmVictimSeat, undefined);
});
