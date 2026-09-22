import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import type { GameState, Player } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "vote-warmup-test-key";

setLocale("zh-CN");

const makePlayer = (playerId: string, seat: number, role: Player["role"]): Player => ({
  playerId,
  seat,
  displayName: `玩家${seat + 1}`,
  alive: true,
  role,
  alignment: role === "Werewolf" || role === "WhiteWolfKing" ? "wolf" : "village",
  isHuman: false,
  agentProfile: {
    modelRef: { provider: "tokendance", model: "deepseek-v4.1-flash:cloud" },
    persona: { voiceRules: [], mbti: "INTJ", gender: "male", age: 30 },
  },
});

const makeState = (players: Player[]): GameState => ({
  gameId: "vote-warmup-test",
  phase: "DAY_VOTE",
  day: 2,
  difficulty: "normal",
  players,
  events: [],
  messages: [],
  currentSpeakerSeat: null,
  daySpeechStartSeat: null,
  badge: {
    holderSeat: 1,
    candidates: [],
    signup: {},
    votes: {},
    allVotes: {},
    history: {},
    revoteCount: 0,
  },
  votes: {},
  voteHistory: {},
  dailySummaries: {},
  dailySummaryFacts: {},
  nightActions: { seerHistory: [], lastGuardTarget: 0 },
  roleAbilities: {
    witchHealUsed: false,
    witchPoisonUsed: false,
    hunterCanShoot: true,
    idiotRevealed: false,
    boomedSeats: [],
  },
  winner: null,
});

type CapturedBody = {
  max_tokens?: number;
  messages: Array<{ role: string; content: string | unknown[] }>;
  response_format?: unknown;
};

const requestText = (body: CapturedBody): string =>
  body.messages
    .map((message) => {
      if (typeof message.content === "string") return message.content;
      return message.content
        .map((part) => (typeof part === "object" && part !== null && "text" in part
          ? String((part as { text: unknown }).text)
          : ""))
        .join("\n");
    })
    .join("\n");

/** 攔截 /api/chat 單發請求；回傳合法 JSON 讓 generateAIVote／generateAIBadgeVote 能走完。 */
function stubFetch(bodies: CapturedBody[], content = JSON.stringify({ seat: 2, reason: "测试" })): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (!init?.body) {
      return new Response(JSON.stringify({ active: false }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init.body)) as CapturedBody & { requests?: unknown };
    if (!body.requests) bodies.push(body);
    return new Response(JSON.stringify({
      id: "warmup",
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return () => { globalThis.fetch = original; };
}

test("放逐投票暖機：送一發 max_tokens=1，且前綴與正式投票請求逐字相同", async () => {
  const { generateAIVote, warmUpVotePrompt } = await import("./game-master");
  const players = [makePlayer("a", 0, "Villager"), makePlayer("b", 1, "Werewolf"), makePlayer("c", 2, "Seer")];
  const state = makeState(players);
  const bodies: CapturedBody[] = [];
  const restore = stubFetch(bodies);
  try {
    await warmUpVotePrompt(state, players[0]);
    assert.equal(bodies.length, 1, "暖機只送一發");
    // generateCompletion 會把 max_tokens 下限夾到 16（見 llm.ts），因此暖機的實際值就是下限。
    assert.equal(bodies[0].max_tokens, 16, "暖機只取輸出下限，不浪費輸出預算");

    await generateAIVote(state, players[0]);
    assert.equal(bodies.length, 2, "暖機不影響正式投票請求");
    assert.notEqual(bodies[1].max_tokens, 1);

    // 前綴快取只在公共前綴逐字相同時命中：system+user 必須完全一致。
    assert.equal(requestText(bodies[0]), requestText(bodies[1]));
    assert.deepEqual(bodies[0].response_format, bodies[1].response_format);
  } finally {
    restore();
  }
});

test("放逐投票暖機失敗只回報，不往上拋（不能讓暖機擋住投票）", async () => {
  const { warmUpVotePrompt } = await import("./game-master");
  const players = [makePlayer("a", 0, "Villager"), makePlayer("b", 1, "Villager")];
  const state = makeState(players);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("warmup network down"); };
  try {
    await assert.doesNotReject(() => warmUpVotePrompt(state, players[0]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("無可投對象時暖機直接略過，不發請求", async () => {
  const { warmUpVotePrompt } = await import("./game-master");
  const players = [makePlayer("a", 0, "Villager")];
  const state = makeState(players);
  const bodies: CapturedBody[] = [];
  const restore = stubFetch(bodies);
  try {
    // 只有自己一個存活玩家 → 沒有合法票口。
    await warmUpVotePrompt(state, players[0]);
    assert.equal(bodies.length, 0);
  } finally {
    restore();
  }
});

test("警徽投票暖機：同樣只送一發，前綴與正式警徽投票相同", async () => {
  const { generateAIBadgeVote, warmUpBadgeVotePrompt } = await import("./game-master");
  const players = [makePlayer("a", 0, "Villager"), makePlayer("b", 1, "Werewolf"), makePlayer("c", 2, "Seer")];
  const state = makeState(players);
  state.phase = "DAY_BADGE_ELECTION";
  state.badge.candidates = [0, 2];
  const bodies: CapturedBody[] = [];
  const restore = stubFetch(bodies);
  try {
    await warmUpBadgeVotePrompt(state, players[0]);
    await generateAIBadgeVote(state, players[0]);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].max_tokens, 16);
    assert.equal(requestText(bodies[0]), requestText(bodies[1]));
  } finally {
    restore();
  }
});
