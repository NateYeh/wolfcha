import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import type { GameState, Player } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "badge-signup-test-key";

setLocale("zh-CN");

const makePlayer = (
  playerId: string,
  seat: number,
  role: Player["role"],
  model = "gemma4:31b-cloud"
): Player => ({
  playerId,
  seat,
  displayName: `玩家${seat + 1}`,
  alive: true,
  role,
  alignment: role === "Werewolf" || role === "WhiteWolfKing" ? "wolf" : "village",
  isHuman: false,
  agentProfile: {
    modelRef: { provider: "tokendance", model },
    persona: { voiceRules: [], mbti: "INTJ", gender: "male", age: 30 },
  },
});

const makeState = (players: Player[]): GameState => {
  return {
    gameId: "badge-signup-test",
    phase: "DAY_BADGE_SIGNUP",
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
    nightActions: {
      seerHistory: [{ targetSeat: 1, isWolf: true, day: 1 }],
      lastGuardTarget: 0,
    },
    roleAbilities: {
      witchHealUsed: false,
      witchPoisonUsed: false,
      hunterCanShoot: true,
      idiotRevealed: false,
      boomedSeats: [],
  duelUsedSeats: [],
    },
    winner: null,
  };
};

const requestText = (request: { messages: Array<{ content: string | unknown[] }> }): string =>
  request.messages
    .map((message) => {
      if (typeof message.content === "string") return message.content;
      return message.content
        .map((part) => {
          if (typeof part === "object" && part !== null && "text" in part) {
            return String((part as { text: unknown }).text);
          }
          return "";
        })
        .join("\n");
    })
    .join("\n");

test("警徽报名批处理为每个玩家建立独立 Prompt，并按返回顺序映射结果", async () => {
  const { generateAIBadgeSignupBatch } = await import("./game-master");
  const players = [
    makePlayer("seer", 0, "Seer", "gemma4:31b-cloud"),
    makePlayer("guard", 1, "Guard", "glm-5.3-flash:cloud"),
  ];
  const state = makeState(players);
  const originalFetch = globalThis.fetch;
  const bodies: Array<{
    requests: Array<{
      model?: string;
      messages: Array<{ content: string | unknown[] }>;
      response_format?: { type?: string; json_schema?: { strict?: boolean } };
    }>;
  }> = [];

  globalThis.fetch = async (_input, init) => {
    if (!init?.body) {
      return new Response(JSON.stringify({ active: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(String(init.body)) as {
      requests: Array<{
        model?: string;
        messages: Array<{ content: string | unknown[] }>;
        response_format?: { type?: string; json_schema?: { strict?: boolean } };
      }>;
    };
    bodies.push(body);
    return new Response(JSON.stringify({
      results: body.requests.map((request) => ({
        ok: true,
        data: {
          id: "badge",
          choices: [{
            // 以角色提示判定，不看批內序號：預言家上警、守衛不上警。
            message: { role: "assistant", content: JSON.stringify({ signup: requestText(request).includes("<your_seer_checks>") }) },
            finish_reason: "stop",
          }],
        },
      })),
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await generateAIBadgeSignupBatch(state, players);

    // 前綴快取暖機：先單獨送第一個請求暖快取，其餘再一起送；順序仍與 players 一致。
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].requests.length, 1);
    assert.equal(bodies[1].requests.length, players.length - 1);
    const requests = bodies.flatMap((body) => body.requests);
    assert.equal(requests.length, players.length);
    assert.deepEqual(result, { seer: true, guard: false });
    for (const request of requests) {
      // 只有 deepseek 系模型支援嚴格 json_schema；專案模型可換成 glm/gemma，那時會退回 json_object。
      const wantsStrictSchema = String(request.model ?? "").toLowerCase().startsWith("deepseek");
      assert.equal(request.response_format?.type, wantsStrictSchema ? "json_schema" : "json_object");
      if (wantsStrictSchema) {
        assert.equal(request.response_format?.json_schema?.strict, true);
      }
    }

    const seerPrompt = requestText(requests[0]);
    const guardPrompt = requestText(requests[1]);
    // 警徽報名是角色行為：每個角色用自己的模型（迴歸：這裡曾誤用摘要模型 glm-5.3-flash）。
    assert.equal(requests[0].model, "gemma4:31b-cloud");
    assert.equal(requests[1].model, "glm-5.3-flash:cloud");
    assert.match(seerPrompt, /<your_seer_checks>/);
    assert.doesNotMatch(seerPrompt, /<your_guard_info>/);
    assert.match(guardPrompt, /<your_guard_info>/);
    assert.doesNotMatch(guardPrompt, /<your_seer_checks>/);
    assert.match(seerPrompt, /警徽竞选报名环节/);
    assert.match(guardPrompt, /警徽竞选报名环节/);
    assert.match(seerPrompt, /\{"signup":true,"reason":"/);
    assert.match(guardPrompt, /\{"signup":false,"reason":"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("警徽报名单个响应非法或失败时只将对应玩家判为不上警", async () => {
  const { generateAIBadgeSignupBatch } = await import("./game-master");
  const players = [
    makePlayer("p1", 0, "Villager"),
    makePlayer("p2", 1, "Villager"),
    makePlayer("p3", 2, "Villager"),
  ];
  const state = makeState(players);
  const originalFetch = globalThis.fetch;
  let batchIndex = 0;

  // 回應內容改以「呼叫次數」判定，而不是固定用批內序號：暖機後第一批只剩 1 個請求。
  globalThis.fetch = async () => {
    batchIndex += 1;
    const results = batchIndex === 1
      ? [{
        ok: true,
        data: {
          id: "badge-0",
          choices: [{ message: { role: "assistant", content: '{"signup":true}' }, finish_reason: "stop" }],
        },
      }]
      : [
        {
          ok: true,
          data: {
            id: "badge-1",
            choices: [{ message: { role: "assistant", content: "maybe" }, finish_reason: "stop" }],
          },
        },
        { ok: false, error: "player request failed" },
      ];
    return new Response(JSON.stringify({ results }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await generateAIBadgeSignupBatch(state, players);
    assert.deepEqual(result, { p1: true, p2: false, p3: false });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("警徽报名：reason 一併解析並記進 log", async () => {
  const [{ aiLogger }, { generateAIBadgeSignupBatch }, { getI18n }] = await Promise.all([
    import("./ai-logger"),
    import("./game-master"),
    import("@/i18n/translator"),
  ]);
  getI18n(); // 觸發語系初始化（setLocale 已在檔頭執行）
  const players = [
    makePlayer("p1", 0, "Seer"),
    makePlayer("p2", 1, "Guard"),
  ];
  const state = makeState(players);
  const originalFetch = globalThis.fetch;
  const logs: Array<{ response: { parsed?: { signup?: boolean; reason?: string } } }> = [];
  const unsubscribe = aiLogger.subscribe((entry) => {
    if (entry.type === "badge_signup") logs.push(entry as { response: { parsed?: { signup?: boolean; reason?: string } } });
  });

  let batchIndex = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      requests: Array<{ messages: Array<{ content: string | unknown[] }> }>;
    };
    batchIndex += 1;
    // 暖機後第一批只有 1 個玩家，序號不能當玩家身分用，改以呼叫次數區分。
    const isFirstBatch = batchIndex === 1;
    return new Response(JSON.stringify({
      results: body.requests.map(() => ({
        ok: true,
        data: {
          id: "badge-reason",
          choices: [{
            message: {
              role: "assistant",
              content: JSON.stringify(isFirstBatch
                ? { signup: true, reason: "我有查验要第一时间报" }
                : { signup: false, reason: "手上没东西，先不上警" }),
            },
            finish_reason: "stop",
          }],
        },
      })),
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await generateAIBadgeSignupBatch(state, players);
    assert.deepEqual(result, { p1: true, p2: false });
    assert.equal(logs.length, 2);
    assert.deepEqual(logs[0].response.parsed, { signup: true, reason: "我有查验要第一时间报" });
    assert.deepEqual(logs[1].response.parsed, { signup: false, reason: "手上没东西，先不上警" });
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
  }
});
