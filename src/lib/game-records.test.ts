import assert from "node:assert/strict";
import test from "node:test";
import type { GameAnalysisData, PlayerSnapshot } from "@/types/analysis";
import type { Role } from "@/types/game";
import {
  buildGameRecordMeta,
  countRecordDays,
  findHumanPlayer,
  isGameRecordMeta,
  isValidRecordId,
  sanitizeRecordId,
  sortGameRecordMetas,
  type GameRecordMeta,
} from "@/lib/game-records";

/** 最小的合法賽後分析；只填測試關心的欄位，其餘給出形狀正確的空值。 */
function buildAnalysis(overrides: Partial<GameAnalysisData> = {}): GameAnalysisData {
  const players: PlayerSnapshot[] = [
    {
      playerId: "p1",
      seat: 3,
      name: "我",
      avatar: "",
      role: "Villager" as Role,
      alignment: "village",
      isAlive: false,
      deathDay: 2,
      deathCause: "killed",
      isHumanPlayer: true,
    },
    {
      playerId: "p2",
      seat: 0,
      characterId: "char-1",
      name: "狼一",
      avatar: "",
      role: "Werewolf" as Role,
      alignment: "wolf",
      isAlive: true,
    },
  ];

  return {
    gameId: "game-123",
    timestamp: 1_700_000_000_000,
    duration: 754,
    playerCount: 9,
    result: "wolf_win",
    awards: { mvp: [], svp: [] },
    timeline: [
      { day: 1, summary: "", nightEvents: [], dayEvents: [] },
      { day: 2, summary: "", nightEvents: [], dayEvents: [] },
    ],
    players,
    roundStates: [
      { day: 1, phase: "night", aliveCount: { village: 6, wolf: 3 }, players },
      { day: 3, phase: "day", aliveCount: { village: 5, wolf: 3 }, players },
    ],
    personalStats: {
      role: "Villager" as Role,
      userName: "我",
      avatar: "",
      alignment: "village",
      tags: [],
      radarStats: { logic: 1, speech: 1, survival: 1, skillOrHide: 1, voteOrTicket: 1 },
      highlightQuote: "",
      totalScore: 0,
    },
    reviews: [],
    ...overrides,
  };
}

test("真人玩家由 isHumanPlayer 判定，不靠座位或名字", () => {
  const human = findHumanPlayer(buildAnalysis());
  assert.equal(human?.seat, 3);
  assert.equal(findHumanPlayer(buildAnalysis({ players: [] })), null);
});

test("天數取 timeline 與 roundStates 的最大值（缺一天也不會少算）", () => {
  assert.equal(countRecordDays(buildAnalysis()), 3);
  assert.equal(countRecordDays(buildAnalysis({ timeline: [], roundStates: [] })), 0);
});

test("中繼資料完整帶出清單需要的欄位", () => {
  const meta = buildGameRecordMeta(buildAnalysis(), { difficulty: "hard", savedAt: 42 });

  assert.equal(meta.id, "game-123");
  assert.equal(meta.savedAt, 42);
  assert.equal(meta.finishedAt, 1_700_000_000_000);
  assert.equal(meta.result, "wolf_win");
  assert.equal(meta.dayCount, 3);
  assert.equal(meta.durationSeconds, 754);
  assert.equal(meta.difficulty, "hard");
  assert.equal(meta.humanSeat, 3);
  assert.equal(meta.humanRole, "Villager");
  assert.equal(meta.humanSurvived, false);
});

test("MVP 名字帶進中繼資料，空名字不列", () => {
  const analysis = buildAnalysis({
    awards: {
      mvp: [
        { playerId: "p2", playerName: "狼一", reason: "", avatar: "", role: "Werewolf" as Role },
        { playerId: "p3", playerName: "", reason: "", avatar: "", role: "Seer" as Role },
      ],
      svp: [],
    },
  });
  assert.deepEqual(buildGameRecordMeta(analysis).mvpNames, ["狼一"]);
});

test("沒有真人玩家時欄位為 null，不猜座位", () => {
  const meta = buildGameRecordMeta(buildAnalysis({ players: [] }));
  assert.equal(meta.humanSeat, null);
  assert.equal(meta.humanRole, null);
  assert.equal(meta.humanSurvived, null);
});

test("gameId 淨化：路徑成分與特殊字元都擋掉", () => {
  assert.equal(sanitizeRecordId("../../etc/passwd"), "etc-passwd");
  assert.equal(sanitizeRecordId("a b*c"), "a-b-c");
  assert.equal(sanitizeRecordId("", 7), "record-7");
  assert.equal(sanitizeRecordId("!!!", 9), "record-9");
  assert.equal(sanitizeRecordId("x".repeat(200)).length, 64);
});

test("讀取時的 id 驗證拒絕路徑成分", () => {
  assert.equal(isValidRecordId("game-123"), true);
  assert.equal(isValidRecordId("../../etc/passwd"), false);
  assert.equal(isValidRecordId(""), false);
  assert.equal(isValidRecordId("a b"), false);
  assert.equal(isValidRecordId("x".repeat(65)), false);
});

test("索引形狀驗證會擋掉缺欄位與壞字面值", () => {
  const meta = buildGameRecordMeta(buildAnalysis());
  assert.equal(isGameRecordMeta(meta), true);
  assert.equal(isGameRecordMeta({ ...meta, result: "draw" }), false);
  assert.equal(isGameRecordMeta({ ...meta, id: "../x" }), false);
  assert.equal(isGameRecordMeta({ id: "a" }), false);
  assert.equal(isGameRecordMeta(null), false);
  assert.equal(isGameRecordMeta("nope"), false);
});

test("清單排序：新到舊，同時間以 id 穩定排序", () => {
  const base = buildGameRecordMeta(buildAnalysis());
  const metas: GameRecordMeta[] = [
    { ...base, id: "b", savedAt: 100 },
    { ...base, id: "c", savedAt: 300 },
    { ...base, id: "a", savedAt: 100 },
  ];
  assert.deepEqual(sortGameRecordMetas(metas).map((m) => m.id), ["c", "a", "b"]);
});
