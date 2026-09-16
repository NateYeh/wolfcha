import assert from "node:assert/strict";
import test from "node:test";
import type { GameScenario } from "@/types/game";
import type { GeneratedCharacter } from "./character-generator";
import {
  CHARACTER_POOL_STORAGE_KEY,
  appendCharactersToPool,
  clearCharacterPool,
  readCharacterPool,
  takeCharactersFromPool,
  unusedCharacterIndexes,
  type CharacterPool,
  type CharacterPoolStorage,
} from "./character-pool";

const makeStorage = (): CharacterPoolStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
};

const scenario = (id: string): GameScenario => ({
  id,
  title: `場景-${id}`,
  description: `描述-${id}`,
  rolesHint: `角色建議-${id}`,
});

const character = (name: string): GeneratedCharacter => ({
  displayName: name,
  persona: {
    voiceRules: ["说话直接"],
    mbti: "INTJ",
    gender: "male",
    age: 30,
    basicInfo: `${name}的職業`,
  },
  playerMind: {
    courage: "敢冲票",
    memoryBias: "记票型",
    suspicionThreshold: "偏高",
    selfProtection: "会自保",
    logicDepth: "愿意展开",
    tablePresence: "中等",
  },
});

const batch = (prefix: string, count: number): GeneratedCharacter[] =>
  Array.from({ length: count }, (_, index) => character(`${prefix}${index + 1}`));

test("角色池：空池抽用回傳 null，且不寫入任何資料", () => {
  const storage = makeStorage();
  assert.equal(readCharacterPool(storage), null);
  assert.equal(takeCharactersFromPool(9, storage), null);
  assert.equal(storage.getItem(CHARACTER_POOL_STORAGE_KEY), null);
});

test("角色池：首次補充會綁定情境，抽用時沿用同一情境", () => {
  const storage = makeStorage();
  const pool = appendCharactersToPool(scenario("high_school_reunion"), batch("甲", 9), storage);
  assert.equal(pool?.scenario.id, "high_school_reunion");

  const taken = takeCharactersFromPool(9, storage);
  assert.equal(taken?.scenario.id, "high_school_reunion");
  assert.equal(taken?.characters.length, 9);
  // 抽樣是隨機順序，只檢查集合相同
  assert.deepEqual(
    new Set(taken?.characters.map((c) => c.displayName)),
    new Set(batch("甲", 9).map((c) => c.displayName)),
  );
});

test("角色池：抽用過的不会在同一輪重複出現，整池用完後重置", () => {
  const storage = makeStorage();
  appendCharactersToPool(scenario("tech_startup"), batch("乙", 4), storage);

  const first = takeCharactersFromPool(3, storage);
  assert.equal(first?.characters.length, 3);
  const firstNames = new Set(first?.characters.map((c) => c.displayName));

  // 只剩 1 個未使用 → 不足即回傳 null，不抽半套
  assert.equal(takeCharactersFromPool(3, storage), null);
  const second = takeCharactersFromPool(1, storage);
  assert.equal(second?.characters.length, 1);
  assert.equal(firstNames.has(second?.characters[0]?.displayName ?? ""), false);

  // 剛好用完 → usedIndexes 重置，下一輪可以再抽滿
  const pool = readCharacterPool(storage);
  assert.deepEqual(pool?.usedIndexes, []);
  assert.equal(unusedCharacterIndexes(pool!).length, 4);
  assert.equal(takeCharactersFromPool(4, storage)?.characters.length, 4);
});

test("角色池：同名角色不重複併入；情境不符時略過補充", () => {
  const storage = makeStorage();
  appendCharactersToPool(scenario("cruise_ship"), batch("丙", 3), storage);
  // 同名（不同批次重複的名字）＋ 一個新名字
  appendCharactersToPool(scenario("cruise_ship"), [...batch("丙", 3), character("新同学")], storage);
  const pool = readCharacterPool(storage);
  assert.equal(pool?.characters.length, 4);

  // 一池綁一個情境：換情境的補充被略過，池內容與情境不變
  const mismatched = appendCharactersToPool(scenario("hospital_oncall"), batch("丁", 3), storage);
  assert.equal(mismatched?.scenario.id, "cruise_ship");
  assert.equal(readCharacterPool(storage)?.characters.length, 4);
});

test("角色池：損毀資料會被丟棄並留警告，不讓壞資料進到遊戲", () => {
  const storage = makeStorage();
  appendCharactersToPool(scenario("detective_noir"), batch("戊", 3), storage);

  storage.setItem(CHARACTER_POOL_STORAGE_KEY, "{ not json");
  assert.equal(readCharacterPool(storage), null);
  assert.equal(storage.getItem(CHARACTER_POOL_STORAGE_KEY), null);

  // 結構不符（缺 persona）同樣丟棄
  appendCharactersToPool(scenario("detective_noir"), batch("己", 3), storage);
  const broken: CharacterPool = {
    version: 1,
    scenario: scenario("detective_noir"),
    characters: [{ displayName: "坏角色" } as unknown as GeneratedCharacter],
    usedIndexes: [],
    updatedAt: Date.now(),
  };
  storage.setItem(CHARACTER_POOL_STORAGE_KEY, JSON.stringify(broken));
  assert.equal(readCharacterPool(storage), null);

  clearCharacterPool(storage);
  assert.equal(readCharacterPool(storage), null);
});

test("角色池：沒有可用儲存空間時安全停用（回傳 null 並留警告）", () => {
  assert.equal(readCharacterPool(null), null);
  assert.equal(appendCharactersToPool(scenario("family_dinner"), batch("庚", 3), null), null);
  assert.equal(takeCharactersFromPool(1, null), null);
});
