import assert from "node:assert/strict";
import test from "node:test";
import type { AILogEntry } from "./ai-logger";

/**
 * 落盤會對 /api/dev-ai-logs POST。測試環境沒有伺服器，若讓它走真 fetch，
 * 每筆都會失敗並進入 300/600ms 退避重試（靠 fileWriteChain 序列排隊），
 * 跑完測試後還留著數百個計時器讓行程不退出——先前「連續跑全套會停滯」
 * 就是這個原因。stub 成成功回應，落盤路徑立刻走完。
 */
globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "ai-logger-test-key";

const getLogger = async () => (await import("./ai-logger")).aiLogger;

const makeEntry = (model: string): Omit<AILogEntry, "id" | "timestamp"> => ({
  type: "speech",
  request: {
    model,
    messages: [{ role: "user", content: "测试提示词" }],
    apiKeySource: "project",
  },
  response: {
    content: "测试回复",
    duration: 1,
  },
});

test("每次 log 都通知订阅者，取消订阅后不再通知", async () => {
  const aiLogger = await getLogger();
  const received: AILogEntry[] = [];
  const unsubscribe = aiLogger.subscribe((entry) => {
    received.push(entry);
  });

  try {
    const first = await aiLogger.log(makeEntry("model-1"));
    const second = await aiLogger.log(makeEntry("model-2"));

    assert.deepEqual(received, [first, second]);

    unsubscribe();
    await aiLogger.log(makeEntry("model-3"));
    assert.deepEqual(received, [first, second]);
  } finally {
    unsubscribe();
  }
});

test("单个订阅者抛错不会影响其他订阅者或 log", async () => {
  const aiLogger = await getLogger();
  const received: AILogEntry[] = [];
  const unsubscribeThrowing = aiLogger.subscribe(() => {
    throw new Error("订阅者故意抛错");
  });
  const unsubscribeReceiving = aiLogger.subscribe((entry) => {
    received.push(entry);
  });

  try {
    await assert.doesNotReject(() => aiLogger.log(makeEntry("model-4")));
    assert.equal(received.length, 1);
    assert.equal(received[0].request.model, "model-4");
  } finally {
    unsubscribeThrowing();
    unsubscribeReceiving();
  }
});

test("localStorage 紀錄依位元組上限裁剪，不會撐爆配額", async () => {
  const aiLogger = await getLogger();
  const originalWindow = globalThis.window;
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => {
      const total = Array.from(values.entries()).reduce((sum, [k, v]) => sum + k.length + v.length, 0);
      if (total / 2 + value.length > 5_000_000) {
        throw new DOMException("Setting the value exceeded the quota.", "QuotaExceededError");
      }
      values.set(key, String(value));
    },
  };
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

  const bigEntry = (index: number): Omit<AILogEntry, "id" | "timestamp"> => ({
    type: "speech",
    request: { model: "model-1", messages: [{ role: "user", content: `${index}:` + "长".repeat(10_000) }] },
    response: { content: "回复", duration: 1 },
  });

  try {
    await aiLogger.clearLogs();
    for (let i = 0; i < 400; i++) {
      await aiLogger.log(bigEntry(i));
    }

    const stored = values.get("wolfcha_ai_logs");
    assert.ok(stored, "紀錄應該有寫入 localStorage");
    assert.ok(stored.length * 2 <= 5_000_000, "不得超過來源配額");
    assert.ok(stored.length * 2 <= 1_500_000 + 200_000, "應依位元組上限裁剪");

    const logs = JSON.parse(stored) as AILogEntry[];
    assert.ok(logs.length < 400, "舊紀錄應該被丟棄");
    const firstContent = (logs[0].request.messages[0].content as string);
    assert.match(firstContent, /^\d+:/, "保留下來的應該仍是完整且合法的紀錄");
    const lastContent = logs.at(-1)?.request.messages[0].content;
    assert.equal(typeof lastContent === "string" && lastContent.startsWith("399:"), true, "最新一筆必須保留");
  } finally {
    await aiLogger.clearLogs();
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
