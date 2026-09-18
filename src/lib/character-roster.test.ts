import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getRosterPool, ROSTER_POOL_IDS, sampleRosterCharacters } from "@/lib/character-roster";

describe("character-roster 角色池", () => {
  it("ROSTER_POOL_IDS 內含金庸池", () => {
    assert.ok(ROSTER_POOL_IDS.includes("jin_yong"));
  });

  it("getRosterPool：有效 id 回對應池、無效 id 退回第一個池", () => {
    assert.equal(getRosterPool("jin_yong").id, "jin_yong");
    assert.equal(getRosterPool("nonexistent").id, ROSTER_POOL_IDS[0]);
    assert.equal(getRosterPool(undefined).id, ROSTER_POOL_IDS[0]);
  });

  it("sampleRosterCharacters：數量正確且角色不重複（12 人名單抽 9）", () => {
    const sampled = sampleRosterCharacters(9, "jin_yong");
    assert.equal(sampled.length, 9);
    const names = new Set(sampled.map((c) => c.displayName));
    assert.equal(names.size, 9);
  });

  it("sampleRosterCharacters：超出名單時循環補齊且都在池內", () => {
    const pool = getRosterPool("jin_yong");
    const poolNames = new Set(pool.characters.map((c) => c.displayName));
    const sampled = sampleRosterCharacters(15, "jin_yong");
    assert.equal(sampled.length, 15);
    for (const c of sampled) assert.ok(poolNames.has(c.displayName));
  });

  it("每個角色都具備完整 persona 與 playerMind", () => {
    for (const poolId of ROSTER_POOL_IDS) {
      const pool = getRosterPool(poolId);
      assert.ok(pool.characters.length > 0);
      for (const c of pool.characters) {
        assert.ok(typeof c.displayName === "string" && c.displayName.length > 0);
        assert.ok(typeof c.persona === "object");
        assert.ok(typeof c.playerMind === "object");
      }
    }
  });
});