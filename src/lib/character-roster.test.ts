import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getRosterPool, ROSTER_POOL_IDS, sampleRosterCharacters } from "@/lib/character-roster";
import { setLocale } from "@/i18n/locale-store";

/** 池子人數：改動 src/data/jin-yong-pool.*.json 時一起更新。 */
const POOL_SIZE = 46;

describe("character-roster 角色池", () => {
  it("ROSTER_POOL_IDS 內含金庸池", () => {
    assert.ok(ROSTER_POOL_IDS.includes("jin_yong"));
  });

  it("getRosterPool：有效 id 回對應池、無效 id 退回第一個池", () => {
    assert.equal(getRosterPool("jin_yong").id, "jin_yong");
    assert.equal(getRosterPool("nonexistent").id, ROSTER_POOL_IDS[0]);
    assert.equal(getRosterPool(undefined).id, ROSTER_POOL_IDS[0]);
  });

  it(`金庸池載入 ${POOL_SIZE} 人（不是寫死的固定班底）`, () => {
    const pool = getRosterPool("jin_yong");
    assert.equal(pool.characters.length, POOL_SIZE);
    assert.equal(new Set(pool.characters.map((c) => c.displayName)).size, POOL_SIZE);
  });

  it("sampleRosterCharacters：數量正確且角色不重複（46 人名單抽 11）", () => {
    const sampled = sampleRosterCharacters(11, "jin_yong");
    assert.equal(sampled.length, 11);
    const names = new Set(sampled.map((c) => c.displayName));
    assert.equal(names.size, 11);
  });

  it("sampleRosterCharacters：超出名單時循環補齊且都在池內", () => {
    const pool = getRosterPool("jin_yong");
    const poolNames = new Set(pool.characters.map((c) => c.displayName));
    const sampled = sampleRosterCharacters(60, "jin_yong");
    assert.equal(sampled.length, 60);
    for (const c of sampled) assert.ok(poolNames.has(c.displayName));
  });

  it("抽樣涵蓋全池：連抽 100 次（每次 11 人）所有人都出現過", () => {
    // 池子 46 人抽 11，某角色 100 次都沒被抽到的機率約 1e-12——不會偽陽性，
    // 但若哪天又變回「只有固定幾人可抽」，這個測試會直接紅。
    const pool = getRosterPool("jin_yong");
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      for (const c of sampleRosterCharacters(11, "jin_yong")) seen.add(c.displayName);
    }
    const missing = pool.characters.filter((c) => !seen.has(c.displayName)).map((c) => c.displayName);
    assert.deepEqual(missing, []);
  });

  it("每個角色都具備 prompt 會用到的 persona 欄位與完整 playerMind", () => {
    // prompt-utils 的 buildHiddenCommunicationProfileSection 逐欄 if 判斷才輸出，
    // 欄位缺了不會報錯、只會静默少一段人設——所以這裡守著資料。
    const promptFields = [
      "werewolfExperience", "vocabularyStyle", "reasoningStyle", "speechLengthHabit",
      "pressureStyle", "uncertaintyStyle", "mistakePattern", "wolfDeceptionStyle",
    ] as const;
    for (const poolId of ROSTER_POOL_IDS) {
      const pool = getRosterPool(poolId);
      assert.ok(pool.characters.length > 0);
      for (const c of pool.characters) {
        assert.ok(typeof c.displayName === "string" && c.displayName.length > 0);
        assert.ok(typeof c.persona === "object");
        assert.ok(Array.isArray(c.persona.voiceRules) && c.persona.voiceRules.length > 0);
        assert.ok(typeof c.persona.mbti === "string" && c.persona.mbti.length > 0);
        assert.ok(typeof c.persona.gender === "string");
        assert.ok(typeof c.persona.age === "number");
        for (const field of promptFields) {
          assert.ok(
            typeof c.persona[field] === "string" && c.persona[field]!.length > 0,
            `${c.displayName} 缺 persona.${field}`
          );
        }
        assert.ok(typeof c.playerMind === "object");
        assert.deepEqual(Object.keys(c.playerMind).sort(), [
          "courage", "logicDepth", "memoryBias", "selfProtection", "suspicionThreshold", "tablePresence",
        ]);
      }
    }
  });

  it("繁中池與簡中池逐筆對齊（順序／voiceId／avatarSeed 相同，名字已轉繁）", () => {
    const zhCN = getRosterPool("jin_yong").characters;
    setLocale("zh-TW");
    try {
      const zhTW = getRosterPool("jin_yong").characters;
      assert.equal(zhTW.length, zhCN.length);
      for (let i = 0; i < zhCN.length; i += 1) {
        assert.equal(zhTW[i]!.persona.voiceId, zhCN[i]!.persona.voiceId, `${zhCN[i]!.displayName} voiceId 應跨語系相同`);
        assert.equal(zhTW[i]!.avatarSeed, zhCN[i]!.avatarSeed, `${zhCN[i]!.displayName} avatarSeed 應跨語系相同`);
      }
      // 岳不群是姓氏「岳」，繁中不該變「嶽不群」（OpenCC 過度轉換，已用 overlay 修正）
      const names = zhTW.map((c) => c.displayName);
      assert.ok(names.includes("岳不群"), `繁中池應有岳不群，實際：${names.join("、")}`);
      assert.ok(!names.includes("嶽不群"));
    } finally {
      setLocale("zh-CN");
    }
  });
});
