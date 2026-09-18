process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "character-stats-key";
import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import { aggregateCharacterStats, parseStatLine, serializeStatRecord } from "./character-stats";

setLocale("zh-CN");

test("统计行：合法记录解析、坏行跳过、聚合按名字累计 games/wins/mvps", () => {
  const good = serializeStatRecord({ gameId: "g1", name: "韦小宝", alignment: "wolf", won: true, mvp: true });
  assert.match(good, /"name":"韦小宝"/);

  const parsed = parseStatLine(good);
  assert.ok(parsed);
  assert.equal(parsed.name, "韦小宝");
  assert.equal(parsed.gameId, "g1");
  assert.equal(parsed.won, true);

  // 坏行一律 null，不让单行毁掉整个文件
  assert.equal(parseStatLine(""), null);
  assert.equal(parseStatLine("not json"), null);
  assert.equal(parseStatLine(JSON.stringify({ name: "韦小宝", alignment: "village" })), null);
  assert.equal(parseStatLine(JSON.stringify({ name: "", alignment: "wolf", won: true, mvp: false })), null);
  assert.equal(parseStatLine(JSON.stringify({ name: "韦小宝", alignment: "werewolf", won: true, mvp: false })), null);

  const stats = aggregateCharacterStats([
    parsed,
    { name: "韦小宝", alignment: "wolf", won: false, mvp: false },
    { name: "韦小宝", name2: undefined, alignment: "village", won: true, mvp: false } as never,
    { name: "令狐冲", alignment: "village", won: true, mvp: true },
  ]);
  assert.deepEqual(stats["韦小宝"], { games: 3, wins: 2, mvps: 1 });
  assert.deepEqual(stats["令狐冲"], { games: 1, wins: 1, mvps: 1 });
});

test("聚合：空输入返回空对象（调用方据此静默降级）", () => {
  assert.deepEqual(aggregateCharacterStats([]), {});
});
