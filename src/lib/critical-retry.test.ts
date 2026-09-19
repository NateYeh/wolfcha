import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import { UPSTREAM_TIMEOUT_CODE, UPSTREAM_TIMEOUT_HEADER } from "@/lib/upstream-timeout";
import type { GameState, Player } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "critical-retry-test-key";
setLocale("zh-CN");

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

/** 建立測試環境（window / localStorage / supabase session），回傳還原函式。 */
async function setupBrowserEnv() {
  const { supabase } = await import("@/lib/supabase");
  const originalGetSession = supabase.auth.getSession.bind(supabase.auth);
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    },
  });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(supabase.auth, "getSession", {
    configurable: true,
    value: async () => ({
      data: { session: { access_token: "test-access-token", user: { id: "user-1" } } },
      error: null,
    }),
  });

  return async () => {
    Object.defineProperty(supabase.auth, "getSession", { configurable: true, value: originalGetSession });
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    if (originalLocalStorage === undefined) Reflect.deleteProperty(globalThis, "localStorage");
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  };
}

const makePlayer = (seat: number, role: Player["role"]): Player => ({
  playerId: `player-${seat}`,
  seat,
  displayName: `玩家${seat + 1}`,
  alive: true,
  role,
  alignment: "village",
  isHuman: false,
  agentProfile: {
    modelRef: { provider: "tokendance", model: "glm-5.3-flash:cloud" },
    persona: {
      mbti: "INTJ",
      gender: "female",
      age: 25,
      voiceRules: ["简洁发言"],
    },
  },
});

const makeState = (players: Player[]): GameState => ({
  gameId: "critical-retry-test",
  phase: "NIGHT_GUARD_ACTION",
  day: 1,
  difficulty: "normal",
  players,
  events: [],
  messages: [],
  currentSpeakerSeat: 0,
  daySpeechStartSeat: 0,
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
    whiteWolfKingBoomUsed: false,
  },
  winner: null,
});

/** 上游逾時回應：route 逾時時就是這個形狀（504 + 標頭 + 錯誤碼）。 */
function timeoutResponse(): Response {
  return new Response(
    JSON.stringify({ error: "上游模型无响应（超时 60s）", code: UPSTREAM_TIMEOUT_CODE }),
    { status: 504, headers: { "content-type": "application/json", [UPSTREAM_TIMEOUT_HEADER]: "60000" } },
  );
}

function okResponse(content: string): Response {
  return Response.json({
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: {},
  });
}

const isChatRequest = (input: RequestInfo | URL): boolean =>
  String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).includes("/api/chat");

/** 依序回覆：前 N 次逾時，之後成功。只計算 /api/chat 的呼叫次數（AI 紀錄落盤也走 fetch）。 */
function installTimeoutThenOkFetch(okContent: string, timeouts = 1) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    if (!isChatRequest(input)) return Response.json({ ok: true });
    calls += 1;
    return calls <= timeouts ? timeoutResponse() : okResponse(okContent);
  };
  return {
    get calls() { return calls; },
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

test("關鍵決策（守衛）：第一次上游逾時會自動重試一次，重試成功仍照常守人", async () => {
  const restoreEnv = await setupBrowserEnv();
  // 模型回報的是畫面座位（3號），內部 raw seat 為 2。
  const mock = installTimeoutThenOkFetch(JSON.stringify({ seat: 3, reason: "首夜自守" }), 1);
  const { aiLogger } = await import("./ai-logger");
  const entries: Array<Record<string, unknown>> = [];
  const unsubscribe = aiLogger.subscribe((entry) => { entries.push(entry as unknown as Record<string, unknown>); });

  try {
    const { generateGuardAction } = await import("./game-master");
    const players = [makePlayer(0, "Guard"), makePlayer(1, "Villager"), makePlayer(2, "Villager")];
    const target = await generateGuardAction(makeState(players), players[0]);

    assert.equal(mock.calls, 2, "逾時後應該再發一次請求");
    assert.equal(target?.targetSeat, 2, "重試成功後仍要採用模型選的守人目標（畫面 3 號＝raw 2）");

    const log = entries.find((e) => e.type === "guard_action") as
      | { response?: { attempts?: number; failure?: string }; error?: string }
      | undefined;
    assert.ok(log, "應該留下一筆 guard_action 紀錄");
    assert.equal(log?.response?.attempts, 2, "log 要顯示實際發出兩次請求");
    assert.equal(log?.response?.failure, undefined, "重試成功不該標記失敗");
    assert.equal(log?.error, undefined);
  } finally {
    unsubscribe();
    mock.restore();
    await restoreEnv();
  }
});

test("關鍵決策（獵人開槍）：兩次都逾時才放棄，log 明確標成 upstream_timeout", async () => {
  const restoreEnv = await setupBrowserEnv();
  const mock = installTimeoutThenOkFetch("{}", 2); // 兩次都逾時
  const { aiLogger } = await import("./ai-logger");
  const entries: Array<Record<string, unknown>> = [];
  const unsubscribe = aiLogger.subscribe((entry) => { entries.push(entry as unknown as Record<string, unknown>); });

  try {
    const { generateHunterShoot } = await import("./game-master");
    const players = [makePlayer(0, "Villager"), makePlayer(1, "Villager"), makePlayer(2, "Hunter")];
    const shot = await generateHunterShoot(makeState(players), players[2]);

    assert.equal(mock.calls, 2, "逾時只重試一次，不無限重打");
    assert.equal(shot.targetSeat, null, "重試後仍逾時＝這槍沒了（呼叫端據此不動作）");
    assert.equal(shot.reason, "", "逾時沒有理由可記");

    const log = entries.find((e) => e.type === "hunter_shoot") as
      | { response?: { attempts?: number; failure?: string }; error?: string }
      | undefined;
    assert.ok(log, "應該留下一筆 hunter_shoot 紀錄");
    assert.equal(log?.response?.attempts, 2);
    assert.equal(log?.response?.failure, "upstream_timeout", "逾時失敗要和 AI 自己選擇不開槍區分開");
    assert.match(String(log?.error), /上游模型无响应/);
  } finally {
    unsubscribe();
    mock.restore();
    await restoreEnv();
  }
});

test("關鍵決策：AI 自己選擇不開槍時不會標記失敗（與逾時可區分）", async () => {
  const restoreEnv = await setupBrowserEnv();
  const mock = installTimeoutThenOkFetch(JSON.stringify({ action: "pass" }), 0);
  const { aiLogger } = await import("./ai-logger");
  const entries: Array<Record<string, unknown>> = [];
  const unsubscribe = aiLogger.subscribe((entry) => { entries.push(entry as unknown as Record<string, unknown>); });

  try {
    const { generateHunterShoot } = await import("./game-master");
    const players = [makePlayer(0, "Villager"), makePlayer(1, "Villager"), makePlayer(2, "Hunter")];
    const shot = await generateHunterShoot(makeState(players), players[2]);

    assert.equal(mock.calls, 1, "一次就拿到回應，不重試");
    assert.equal(shot.targetSeat, null);

    const log = entries.find((e) => e.type === "hunter_shoot") as
      | { response?: { attempts?: number; failure?: string } }
      | undefined;
    assert.equal(log?.response?.attempts, 1);
    assert.equal(log?.response?.failure, undefined, "AI 主動 pass 不是失敗");
  } finally {
    unsubscribe();
    mock.restore();
    await restoreEnv();
  }
});

test("關鍵決策：非逾時錯誤（例如 Key 無效）不重試，直接走原本備援", async () => {
  const restoreEnv = await setupBrowserEnv();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    if (!isChatRequest(input)) return Response.json({ ok: true });
    calls += 1;
    return new Response(JSON.stringify({ error: "API Key 无效或已过期" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const { generateGuardAction } = await import("./game-master");
    const players = [makePlayer(0, "Guard"), makePlayer(1, "Villager"), makePlayer(2, "Villager")];
    const target = await generateGuardAction(makeState(players), players[0]);

    assert.equal(calls, 1, "401 重試沒有意義，不該重打");
    assert.equal(target, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    await restoreEnv();
  }
});
