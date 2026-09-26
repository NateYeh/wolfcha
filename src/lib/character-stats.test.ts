process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "character-stats-key";
import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateCharacterStats,
  parseStatLine,
  resolveCharacterKey,
  serializeStatRecord,
} from "./character-stats";

test("统计行：合法记录解析、坏行跳过、聚合按角色 id 累计 games/wins/mvps/svps", () => {
  const good = serializeStatRecord({
    gameId: "g1",
    characterId: "wei-xiao-bao",
    name: "韦小宝",
    alignment: "wolf",
    won: true,
    mvp: true,
    svp: false,
  });
  assert.match(good, /"characterId":"wei-xiao-bao"/);

  const parsed = parseStatLine(good);
  assert.ok(parsed);
  assert.equal(parsed.name, "韦小宝");
  assert.equal(parsed.characterId, "wei-xiao-bao");
  assert.equal(parsed.gameId, "g1");
  assert.equal(parsed.won, true);
  assert.equal(parsed.svp, false);

  // 旧格式（无 characterId／svp 欄位）向後相容：svp 視為 false，聚合時用名字反查 id
  const legacy = parseStatLine(JSON.stringify({ gameId: "g0", name: "令狐冲", alignment: "village", won: true, mvp: false }));
  assert.ok(legacy);
  assert.equal(legacy.svp, false);
  assert.equal(legacy.characterId, undefined);
  assert.equal(resolveCharacterKey(legacy), "ling-hu-chong");

  // 繁简不同写法都会反查到同一个角色 id
  assert.equal(resolveCharacterKey({ name: "韋小寶" }), "wei-xiao-bao");
  assert.equal(resolveCharacterKey({ name: "韦小宝" }), "wei-xiao-bao");
  assert.equal(resolveCharacterKey({ name: "Wei Xiaobao" }), "wei-xiao-bao");
  // 不在角色池的名字（例如人類玩家）原樣保留
  assert.equal(resolveCharacterKey({ name: "小明" }), "小明");

  // 坏行一律 null，不让单行毁掉整个文件
  assert.equal(parseStatLine(""), null);
  assert.equal(parseStatLine("not json"), null);
  assert.equal(parseStatLine(JSON.stringify({ name: "韦小宝", alignment: "village" })), null);
  assert.equal(parseStatLine(JSON.stringify({ name: "", alignment: "wolf", won: true, mvp: false })), null);
  assert.equal(parseStatLine(JSON.stringify({ name: "韦小宝", alignment: "werewolf", won: true, mvp: false })), null);

  const stats = aggregateCharacterStats([
    parsed,
    { name: "韋小寶", alignment: "wolf", won: false, mvp: false, svp: true },
    { name: "韦小宝", name2: undefined, alignment: "village", won: true, mvp: false, svp: true } as never,
    { characterId: "ling-hu-chong", name: "令狐沖", alignment: "village", won: true, mvp: true, svp: false },
  ]);
  assert.deepEqual(stats["wei-xiao-bao"], {
    games: 3,
    wins: 2,
    mvps: 1,
    svps: 2,
    // 陣營分開算：狼人 2 場 1 勝、好人 1 場 1 勝
    villageGames: 1,
    villageWins: 1,
    wolfGames: 2,
    wolfWins: 1,
  });
  assert.deepEqual(stats["ling-hu-chong"], {
    games: 1,
    wins: 1,
    mvps: 1,
    svps: 0,
    villageGames: 1,
    villageWins: 1,
    wolfGames: 0,
    wolfWins: 0,
  });
  assert.equal(Object.keys(stats).length, 2);
});

test("聚合：空输入返回空对象（调用方据此静默降级）", () => {
  assert.deepEqual(aggregateCharacterStats([]), {});
});
