import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "test-publishable-key";

import type { GameScenario } from "@/types/game";
import type { GeneratedCharacter } from "./character-generator";
import {
  CHARACTER_POOL_ROUNDS,
  readCharacterPool,
  takeCharactersFromPool,
  unusedCharacterIndexes,
  type CharacterPoolStorage,
} from "./character-pool";
// character-generator（間接）會載入 supabase，必須等環境變數設好再動態載入。
const loadRefill = () => import("./character-pool-refill");

const makeStorage = (): CharacterPoolStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
};

const scenario: GameScenario = {
  id: "tech_startup",
  title: "创业公司",
  description: "创业公司团建",
  rolesHint: "创始人、程序员、产品经理",
};

const character = (name: string): GeneratedCharacter => ({
  displayName: name,
  persona: { voiceRules: ["说话很快"], mbti: "ENFP", gender: "female", age: 27, basicInfo: "产品经理" },
  playerMind: {
    courage: "敢冲票",
    memoryBias: "记听感",
    suspicionThreshold: "偏低",
    selfProtection: "先反问",
    logicDepth: "点到为止",
    tablePresence: "高",
  },
});

const batch = (prefix: string, count: number): GeneratedCharacter[] =>
  Array.from({ length: count }, (_, index) => character(`${prefix}${index + 1}`));

test("角色池補充：未達標時生成一局份並綁定情境；達標後不再生成", async () => {
  const { refillCharacterPoolOnce } = await loadRefill();
  const storage = makeStorage();
  const calls: number[] = [];
  const usedScenarios: GameScenario[] = [];
  const generator = async (count: number, used: GameScenario) => {
    calls.push(count);
    usedScenarios.push(used);
    return batch(`批${calls.length}-`, count);
  };

  const first = await refillCharacterPoolOnce(9, storage, generator);
  assert.equal(first, "refilled");
  assert.deepEqual(calls, [9]);
  // 首次建立時抽一個情境，池就綁定該情境
  const boundScenarioId = readCharacterPool(storage)?.scenario.id;
  assert.equal(typeof boundScenarioId, "string");
  assert.equal(usedScenarios[0]?.id, boundScenarioId);

  const second = await refillCharacterPoolOnce(9, storage, generator);
  assert.equal(second, "refilled");
  assert.equal(readCharacterPool(storage)?.characters.length, 18);
  // 後續補充沿用池的情境
  assert.equal(usedScenarios[1]?.id, boundScenarioId);

  const third = await refillCharacterPoolOnce(9, storage, generator);
  assert.equal(third, "refilled");

  // 已達三局份目標 → skipped，且不再呼叫生成
  const fourth = await refillCharacterPoolOnce(9, storage, generator);
  assert.equal(fourth, "skipped");
  assert.deepEqual(calls, [9, 9, 9]);
  assert.equal(readCharacterPool(storage)?.characters.length, 9 * CHARACTER_POOL_ROUNDS);

  // 抽掉一局後又低於目標，會再補
  assert.equal(takeCharactersFromPool(9, storage)?.characters.length, 9);
  const fifth = await refillCharacterPoolOnce(9, storage, generator);
  assert.equal(fifth, "refilled");
  assert.equal(unusedCharacterIndexes(readCharacterPool(storage)!).length, 27);
});

test("角色池補充：生成失敗或空結果時池維持不變（不寫入半套）", async () => {
  const { refillCharacterPoolOnce } = await loadRefill();
  const storage = makeStorage();
  const failing = async () => {
    throw new Error("上游 500");
  };
  const empty = async () => [];

  assert.equal(await refillCharacterPoolOnce(9, storage, failing), "failed");
  assert.equal(readCharacterPool(storage), null);

  assert.equal(await refillCharacterPoolOnce(9, storage, empty), "failed");
  assert.equal(readCharacterPool(storage), null);

  // 成功一次建立池後，失敗的批次不會破壞既有內容
  assert.equal(await refillCharacterPoolOnce(9, storage, async (_c, _s) => batch("丙", 9)), "refilled");
  assert.equal(await refillCharacterPoolOnce(9, storage, failing), "failed");
  assert.equal(readCharacterPool(storage)?.characters.length, 9);
});

test("角色池狀態：回報未使用數、總數、情境與目標容量", async () => {
  const { getCharacterPoolStatus, refillCharacterPoolOnce } = await loadRefill();
  const storage = makeStorage();
  const before = getCharacterPoolStatus(9, storage);
  assert.deepEqual(before, { unused: 0, total: 0, scenarioTitle: null, target: 27, refilling: false });

  await refillCharacterPoolOnce(9, storage, async (_c, _s) => batch("丁", 9));
  const after = getCharacterPoolStatus(9, storage);
  assert.equal(after.unused, 9);
  assert.equal(after.total, 9);
  assert.equal(after.scenarioTitle, readCharacterPool(storage)?.scenario.title);
  assert.equal(after.target, 27);
});

test("角色池重建：清空後下一次補充以新情境重新建立", async () => {
  const { refillCharacterPoolOnce, resetCharacterPoolScenario } = await loadRefill();
  const storage = makeStorage();
  await refillCharacterPoolOnce(9, storage, async () => batch("戊", 9));
  resetCharacterPoolScenario(storage);
  assert.equal(readCharacterPool(storage), null);

  const results = await refillCharacterPoolOnce(9, storage, async () => batch("己", 9));
  assert.equal(results, "refilled");
  assert.equal(readCharacterPool(storage)?.characters.length, 9);
});
