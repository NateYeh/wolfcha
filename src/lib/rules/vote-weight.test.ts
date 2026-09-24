import assert from "node:assert/strict";
import test from "node:test";
import {
  REGULAR_VOTE_WEIGHT,
  SHERIFF_VOTE_WEIGHT,
  voteWeightByPlayerId,
  voteWeightBySeat,
  voteWeightFor,
} from "@/lib/rules/vote-weight";

/**
 * 票值規則守衛。
 *
 * 這條規則原本重寫在七處（引擎、階段、prompt、兩個 UI）；這裡釘住規則本身，
 * 各呼叫端是否用同一條規則則由型別與既有對局測試（10.5 票等案例）守住。
 */

test("票值：警長 1.5、其他人 1", () => {
  assert.equal(SHERIFF_VOTE_WEIGHT, 1.5);
  assert.equal(REGULAR_VOTE_WEIGHT, 1);
  assert.equal(voteWeightFor(true), 1.5);
  assert.equal(voteWeightFor(false), 1);
});

test("以 playerId 判定：同一人加權，不同人不加權", () => {
  assert.equal(voteWeightByPlayerId("p-sheriff", "p-sheriff"), 1.5);
  assert.equal(voteWeightByPlayerId("p-other", "p-sheriff"), 1);
});

test("以座位判定：同一座位加權，不同座位不加權", () => {
  assert.equal(voteWeightBySeat(3, 3), 1.5);
  assert.equal(voteWeightBySeat(4, 3), 1);
  assert.equal(voteWeightBySeat(0, 0), 1.5);
});

test("沒有警長時誰都不加權（undefined 不得變成「全員加權」）", () => {
  for (const empty of [null, undefined, ""]) {
    assert.equal(voteWeightByPlayerId("p-1", empty), 1);
    assert.equal(voteWeightBySeat(1, empty as number | null | undefined), 1);
  }
});
