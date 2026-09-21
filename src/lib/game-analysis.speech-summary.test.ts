import assert from "node:assert/strict";
import test from "node:test";

import type { GameState, Player, Role } from "@/types/game";

// @/lib/game-analysis 會連帶載入 supabase 客戶端，必須先設定 env 再動態載入。
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "speech-summary-test-key";

const loadAnalysis = () => import("@/lib/game-analysis");

function makePlayer(seat: number, displayName: string): Player {
  return {
    playerId: `p${seat}`,
    seat,
    displayName,
    alive: true,
    role: "Villager" as Role,
    alignment: "village",
    isHuman: false,
  };
}

const players = [makePlayer(0, "謝煙客"), makePlayer(1, "木婉清"), makePlayer(11, "范蠡")];

function makeState(): GameState {
  return { players } as unknown as GameState;
}

test("發言摘要以 1-based 座位號對應正確玩家，不位移也不產生幽靈座位", async () => {
  const { formatSpeechSummaries } = await loadAnalysis();
  const text = formatSpeechSummaries(
    {
      discussion: {
        1: [
          { seat: 1, content: "我是1號的發言" },
          { seat: 12, content: "我是12號的發言" },
        ],
      },
      election: {},
      daySummaries: {},
    },
    makeState(),
  );

  assert.equal(
    text,
    ["第1天：", "- 1号 謝煙客：我是1號的發言", "- 12号 范蠡：我是12號的發言"].join("\n"),
  );
  assert.doesNotMatch(text, /13号/);
});

test("超出玩家範圍的座位號（AI 幻覺）會被略過，不印出幽靈座位", async () => {
  const { formatSpeechSummaries } = await loadAnalysis();
  const text = formatSpeechSummaries(
    { discussion: { 1: [{ seat: 13, content: "幽靈座位" }] }, election: {}, daySummaries: {} },
    makeState(),
  );
  assert.equal(text, "（无发言记录）");
});

test("無發言摘要時回傳固定字串", async () => {
  const { formatSpeechSummaries } = await loadAnalysis();
  assert.equal(
    formatSpeechSummaries({ discussion: {}, election: {}, daySummaries: {} }, makeState()),
    "（无发言记录）",
  );
});
