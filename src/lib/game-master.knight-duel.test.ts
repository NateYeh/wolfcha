import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import type { GameState, Player } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "knight-duel-llm-key";

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
    modelRef: { provider: "tokendance", model: "gemma4:31b-cloud" },
    persona: { voiceRules: [], mbti: "INTJ", gender: "male", age: 30 },
  },
});

const makeState = (players: Player[], phase: GameState["phase"] = "DAY_SPEECH"): GameState => ({
  gameId: "knight-duel-llm-test",
  phase,
  day: 1,
  difficulty: "normal",
  players,
  events: [],
  messages: [],
  currentSpeakerSeat: null,
  daySpeechStartSeat: null,
  badge: {
    holderSeat: null,
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
  nightActions: {},
  roleAbilities: {
    witchHealUsed: false,
    witchPoisonUsed: false,
    hunterCanShoot: true,
    idiotRevealed: false,
    boomedSeats: [],
    duelUsedSeats: [],
  },
  winner: null,
});

const requestText = (request: { messages: Array<{ content: string | unknown[] }> }): string =>
  request.messages
    .map((message) => {
      if (typeof message.content === "string") return message.content;
      return message.content
        .map((part) => (typeof part === "object" && part !== null && "text" in part ? String((part as { text: unknown }).text) : ""))
        .join("\n");
    })
    .join("\n");

type CapturedRequest = { model?: string; messages: Array<{ content: string | unknown[] }>; response_format?: { type?: string } };

/** 用單一模型回應替換全域 fetch，回傳所有送出的請求本體 */
function stubFetch(content: string): { bodies: CapturedRequest[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const bodies: CapturedRequest[] = [];
  globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
    if (!init?.body) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init.body)) as CapturedRequest & { requests?: CapturedRequest[] };
    if (Array.isArray(body.requests)) {
      bodies.push(...body.requests);
    } else {
      bodies.push(body);
    }
    return new Response(JSON.stringify({
      id: "knight-duel",
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { bodies, restore: () => { globalThis.fetch = originalFetch; } };
}

test("騎士決鬥決策：模型回傳 duel＋座位時換算成 0 基座位，並寫 knight_duel_decision log", async () => {
  const { generateKnightDuelDecision } = await import("./game-master");
  const { aiLogger } = await import("./ai-logger");
  const players = [
    makePlayer("knight", 0, "Knight"),
    makePlayer("wolf", 1, "Werewolf"),
    makePlayer("villager", 2, "Villager"),
  ];
  const state = makeState(players);
  const knight = players[0];
  const logged: Array<{ type: string; response?: { parsed?: unknown } }> = [];
  const originalLog = aiLogger.log.bind(aiLogger);
  aiLogger.log = (async (entry: Parameters<typeof originalLog>[0]) => {
    logged.push(entry as unknown as { type: string });
    return await originalLog(entry);
  }) as typeof aiLogger.log;
  const { bodies, restore } = stubFetch(JSON.stringify({ action: "duel", seat: 2, reason: "他发言像狼" }));

  try {
    const decision = await generateKnightDuelDecision(state, knight);
    assert.deepEqual(decision, { duel: true, targetSeat: 1, reason: "他发言像狼" });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].model, "gemma4:31b-cloud");
    assert.equal(bodies[0].response_format?.type, "json_object");
    const promptText = requestText(bodies[0]);
    assert.match(promptText, /翻牌决斗/);
    assert.match(promptText, /存活玩家: 2号/);
    assert.doesNotMatch(promptText, /存活玩家: 1号/, "不能把自己列進目標");
    assert.equal(logged[0]?.type, "knight_duel_decision");
    assert.deepEqual(logged[0]?.response?.parsed, { duel: true, targetSeat: 1, attempts: 1, reason: "他发言像狼" });
  } finally {
    restore();
    aiLogger.log = originalLog as typeof aiLogger.log;
  }
});

test("騎士決鬥決策：模型回傳 pass 時不發動，且只送一次請求", async () => {
  const { generateKnightDuelDecision } = await import("./game-master");
  const players = [makePlayer("knight", 0, "Knight"), makePlayer("wolf", 1, "Werewolf")];
  const { bodies, restore } = stubFetch(JSON.stringify({ action: "pass" }));

  try {
    const decision = await generateKnightDuelDecision(makeState(players), players[0]);
    assert.equal(decision.duel, false);
    assert.equal(decision.targetSeat, null);
    assert.equal(bodies.length, 1);
  } finally {
    restore();
  }
});

test("騎士決鬥決策：座位不在存活名單（含未公布死者）時視為不發動", async () => {
  const { generateKnightDuelDecision } = await import("./game-master");
  const players = [
    makePlayer("knight", 0, "Knight"),
    makePlayer("wolf", 1, "Werewolf"),
    makePlayer("villager", 2, "Villager"),
  ];
  const state = makeState(players);
  // 2 號是「已死但死訊未公布」的第一夜死者：不能挑戰
  state.nightActions = { pendingWolfVictim: 2 };
  const { bodies, restore } = stubFetch(JSON.stringify({ action: "duel", seat: 3 }));

  try {
    const decision = await generateKnightDuelDecision(state, players[0]);
    assert.equal(decision.duel, false);
    assert.equal(decision.targetSeat, null);
    // withCriticalRetry 只在「上游逾時」重試，解析失敗不重試（一次請求即可）
    assert.equal(bodies.length, 1);
  } finally {
    restore();
  }
});

test("騎士決鬥決策：非決鬥階段或已用過技能時完全不送請求", async () => {
  const { generateKnightDuelDecision } = await import("./game-master");
  const players = [makePlayer("knight", 0, "Knight"), makePlayer("wolf", 1, "Werewolf")];

  // 警上 PK 發言階段不能翻牌
  const pkState = makeState(players, "DAY_PK_SPEECH");
  const pk = stubFetch(JSON.stringify({ action: "duel", seat: 2 }));
  try {
    const decision = await generateKnightDuelDecision(pkState, players[0]);
    assert.equal(decision.duel, false);
    assert.equal(pk.bodies.length, 0);
  } finally {
    pk.restore();
  }

  // 一場一次：已經用過就不再問
  const usedState = makeState(players);
  usedState.roleAbilities.duelUsedSeats = [0];
  const used = stubFetch(JSON.stringify({ action: "duel", seat: 2 }));
  try {
    const decision = await generateKnightDuelDecision(usedState, players[0]);
    assert.equal(decision.duel, false);
    assert.equal(used.bodies.length, 0);
  } finally {
    used.restore();
  }
});
