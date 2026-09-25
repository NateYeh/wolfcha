import assert from "node:assert/strict";
import test from "node:test";
import { resolveNightDeaths, toPendingVictims } from "@/lib/rules/night-resolution";

/**
 * 「待公布死亡」是白天開場公告、當日禁言、以及獵人／狼王開槍窗口的唯一讀取來源，
 * 必須由夜間結算結果推導（`toPendingVictims`），真實路徑與 DevTools 跳轉路徑共用。
 */
test("待公布死亡：刀口真的死了才算（被救／被守就沒有）", () => {
  const killed = resolveNightDeaths({ wolfTarget: 4 });
  assert.deepEqual(toPendingVictims(killed), {
    pendingWolfVictim: 4,
    pendingPoisonVictim: undefined,
    pendingDreamVictim: undefined,
  });

  // 女巫解藥 → 沒有狼刀死者，但仍是「這一晚的結算」
  const saved = resolveNightDeaths({ wolfTarget: 4, witchSave: true });
  assert.deepEqual(toPendingVictims(saved), {
    pendingWolfVictim: undefined,
    pendingPoisonVictim: undefined,
    pendingDreamVictim: undefined,
  });

  // 守護守住 → 也沒有人死於狼刀
  const guarded = resolveNightDeaths({ wolfTarget: 4, guardTarget: 4 });
  assert.equal(toPendingVictims(guarded).pendingWolfVictim, undefined);
});

test("待公布死亡：毒藥與攝夢連帶各進自己那一格（開槍封槍判斷靠它）", () => {
  const poisoned = resolveNightDeaths({ witchPoison: 6 });
  assert.deepEqual(toPendingVictims(poisoned), {
    pendingWolfVictim: undefined,
    pendingPoisonVictim: 6,
    pendingDreamVictim: undefined,
  });

  // 刀攝夢人 → 夢游者一併夢死（兩筆死亡各歸各的欄位）
  const dreamed = resolveNightDeaths({ wolfTarget: 1, dreamTarget: 4, dreamerSeat: 1 });
  assert.deepEqual(toPendingVictims(dreamed), {
    pendingWolfVictim: 1,
    pendingPoisonVictim: undefined,
    pendingDreamVictim: 4,
  });
});

test("待公布死亡：換位之後的刀口要用『實際死掉的那個人』", () => {
  // 狼刀指 3 號、魔術師把 3 換到 8 → 實際死的是 8 號（公告與開槍都該看 8）
  const swapped = resolveNightDeaths({ wolfTarget: 3, magicianSwap: [3, 8], magicianSeat: 0 });
  assert.deepEqual(swapped.deaths, [{ seat: 8, reason: "wolf" }]);
  assert.equal(toPendingVictims(swapped).pendingWolfVictim, 8);
});

test("待公布死亡：狼刀打中被魅惑者的殉情不進狼刀欄位（不會誤開槍）", () => {
  // 狼美人（0）被刀 → 被魅惑的 5 號殉情；狼刀死者只有 0
  const charmed = resolveNightDeaths({ wolfTarget: 0, wolfBeautyTarget: 5, wolfBeautySeat: 0 });
  const pendings = toPendingVictims(charmed);
  assert.equal(pendings.pendingWolfVictim, 0);
  assert.ok(
    charmed.deaths.some((death) => death.seat === 5 && death.reason === "charm"),
    `殉情要留在 deaths 裡，實際：${JSON.stringify(charmed.deaths)}`
  );
});
