import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import {
  appendDayHunterShot,
  appendNightHunterShot,
  findHunterShotByShooter,
  findHunterShotByTarget,
  getHunterShots,
  lastHunterShot,
} from "@/lib/rules/hunter-shots";
import type { GameState } from "@/types/game";

/**
 * 開槍紀錄的守衛。
 *
 * 這個欄位以前是單一物件，同一晚的第二槍會覆蓋第一槍——事件紀錄／賽後分析只看得到最後一槍，
 * 而系統訊息與對話每一槍都有，所以外觀上很難察覺。這裡釘住「同一晚多槍要全部留著」。
 */

const state0 = (): GameState => {
  const base = createSinglePlayerContextAuditState();
  return { ...base, day: 2, nightHistory: {}, dayHistory: {} };
};

const shot = (hunterSeat: number, targetSeat: number, reason?: string) => ({
  hunterSeat,
  targetSeat,
  ...(reason ? { reason } : {}),
});

test("同一晚兩槍都會留著（槍打槍不再覆蓋）", () => {
  const first = appendNightHunterShot(state0(), shot(3, 4, "第一槍"));
  const second = appendNightHunterShot(first, shot(4, 5, "被槍打死的人也有槍"));
  assert.deepEqual(getHunterShots(second.nightHistory?.[2]), [shot(3, 4, "第一槍"), shot(4, 5, "被槍打死的人也有槍")]);
});

test("同一輪白天的多槍同樣會累積", () => {
  const first = appendDayHunterShot(state0(), shot(1, 2));
  const second = appendDayHunterShot(first, shot(2, 3));
  assert.equal(getHunterShots(second.dayHistory?.[2]).length, 2);
});

test("夜史與日史各自獨立（互不污染）", () => {
  const state = appendDayHunterShot(appendNightHunterShot(state0(), shot(3, 4)), shot(5, 6));
  assert.deepEqual(getHunterShots(state.nightHistory?.[2]), [shot(3, 4)]);
  assert.deepEqual(getHunterShots(state.dayHistory?.[2]), [shot(5, 6)]);
});

test("append 不會動到其他天數的紀錄", () => {
  const base = state0();
  const withOtherDay: GameState = {
    ...base,
    dayHistory: { 1: { executed: { seat: 7, votes: 4 } } },
  };
  const next = appendDayHunterShot(withOtherDay, shot(1, 2));
  assert.deepEqual(next.dayHistory?.[1], { executed: { seat: 7, votes: 4 } });
  assert.equal(getHunterShots(next.dayHistory?.[1]).length, 0);
});

test("lastHunterShot 回最後一槍、沒有紀錄時 undefined", () => {
  assert.equal(lastHunterShot(undefined), undefined);
  assert.equal(lastHunterShot({}), undefined);
  const state = appendNightHunterShot(appendNightHunterShot(state0(), shot(3, 4)), shot(4, 5));
  assert.equal(lastHunterShot(state.nightHistory?.[2])?.targetSeat, 5);
});

test("findHunterShotByShooter／ByTarget 分得出「誰開的」與「打在誰身上」", () => {
  const record = { hunterShots: [shot(3, 4), shot(4, 5)] };
  assert.equal(findHunterShotByShooter(record, 4)?.targetSeat, 5, "4 號自己開的那一槍");
  assert.equal(findHunterShotByShooter(record, 9), undefined);
  assert.equal(findHunterShotByTarget(record, 4)?.hunterSeat, 3, "打在 4 號身上的那一槍");
  assert.equal(findHunterShotByTarget(record, 9), undefined);
});

test("沒有紀錄時一律回空陣列（呼叫端不必再判 undefined）", () => {
  assert.deepEqual(getHunterShots(undefined), []);
  assert.deepEqual(getHunterShots(null), []);
  assert.deepEqual(getHunterShots({}), []);
});
