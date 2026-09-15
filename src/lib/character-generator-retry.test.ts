import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "test-publishable-key";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const validProfile = {
  displayName: "林川",
  gender: "male",
  age: 28,
  mbti: "ISTJ",
  basicInfo: "审计用角色",
};

const validCharacter = {
  displayName: "林川",
  persona: {
    voiceRules: ["语速平稳"],
    werewolfExperience: "偶尔参加朋友局",
    vocabularyStyle: "普通口语",
    reasoningStyle: "先听前后矛盾",
    speechLengthHabit: "通常简短",
    pressureStyle: "先解释",
    uncertaintyStyle: "明确保留意见",
    mistakePattern: "偶尔过度相信票型",
    wolfDeceptionStyle: "保持低调",
  },
  playerMind: {
    courage: "谨慎承担风险",
    memoryBias: "更记票型",
    suspicionThreshold: "两条矛盾后改站边",
    selfProtection: "先解释再反问",
    logicDepth: "能串联相邻发言",
    tablePresence: "关键时刻发言",
  },
};

// 模型被句尾中文引号误导，漏掉字符串结尾的 ASCII 双引号，整批因此作废。
const brokenCharacterJson = [
  "{",
  '  "characters": [',
  "    {",
  '      "displayName": "林川",',
  '      "persona": {',
  '        "voiceRules": ["语速平稳", "被质疑时会说“我真的不是”',
  "        ],",
  '        "werewolfExperience": "偶尔参加朋友局",',
  '        "vocabularyStyle": "普通口语",',
  '        "reasoningStyle": "先听前后矛盾",',
  '        "speechLengthHabit": "通常简短",',
  '        "pressureStyle": "先解释",',
  '        "uncertaintyStyle": "明确保留意见",',
  '        "mistakePattern": "偶尔过度相信票型",',
  '        "wolfDeceptionStyle": "保持低调"',
  "      },",
  '      "playerMind": {',
  '        "courage": "谨慎承担风险",',
  '        "memoryBias": "更记票型",',
  '        "suspicionThreshold": "两条矛盾后改站边",',
  '        "selfProtection": "先解释再反问",',
  '        "logicDepth": "能串联相邻发言",',
  '        "tablePresence": "关键时刻发言"',
  "      }",
  "    }",
  "  ]",
  "}",
].join("\n");

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

function personaStream(payload: string, complete: boolean): Response {
  const frame = JSON.stringify({ choices: [{ delta: { content: payload } }] });
  const tail = complete ? "data: [DONE]\n\n" : "";
  return new Response(`data: ${frame}\n\n${tail}`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

interface StreamReply {
  content: string;
  complete: boolean;
}

async function installMockFetch(replies: StreamReply[]) {
  const originalFetch = globalThis.fetch;
  let personaCalls = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
    if (!body.stream) {
      return Response.json({
        choices: [{
          message: { role: "assistant", content: JSON.stringify({ profiles: [validProfile] }) },
          finish_reason: "stop",
        }],
      });
    }
    const reply = replies[Math.min(personaCalls, replies.length - 1)];
    personaCalls += 1;
    return personaStream(reply.content, reply.complete);
  };
  return {
    get personaCalls() { return personaCalls; },
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

test("非 TokenPay 路径下批次失败会自动重试并成功", async () => {
  const restoreEnv = await setupBrowserEnv();
  const mock = await installMockFetch([
    { content: brokenCharacterJson, complete: false },
    { content: JSON.stringify({ characters: [validCharacter] }), complete: true },
  ]);

  try {
    const { setModelSource, setTokenPayConnected } = await import("@/lib/api-keys");
    setTokenPayConnected(false);
    setModelSource("custom");

    const { generateCharacters } = await import("@/lib/character-generator");
    const result = await generateCharacters(1);

    assert.equal(mock.personaCalls, 2, "应该重试一次");
    assert.equal(result.length, 1);
    assert.equal(result[0].displayName, "林川");
  } finally {
    mock.restore();
    await restoreEnv();
  }
});

test("TokenPay 付费路径不重试，避免重复计费", async () => {
  const restoreEnv = await setupBrowserEnv();
  const mock = await installMockFetch([
    { content: brokenCharacterJson, complete: false },
    { content: JSON.stringify({ characters: [validCharacter] }), complete: true },
  ]);

  try {
    const { setModelSource, setTokenPayConnected } = await import("@/lib/api-keys");
    setTokenPayConnected(true);
    setModelSource("tokenpay");

    const { generateCharacters } = await import("@/lib/character-generator");
    await assert.rejects(generateCharacters(1), /\[DONE\] 前意外结束/);

    assert.equal(mock.personaCalls, 1, "付费路径不该重打");
  } finally {
    mock.restore();
    await restoreEnv();
  }
});

test("字符串漏结尾引号的坏 JSON 由解析器修复，不需要重试", async () => {
  const restoreEnv = await setupBrowserEnv();
  const mock = await installMockFetch([
    { content: brokenCharacterJson, complete: true },
    { content: JSON.stringify({ characters: [validCharacter] }), complete: true },
  ]);

  try {
    const { setModelSource, setTokenPayConnected } = await import("@/lib/api-keys");
    setTokenPayConnected(false);
    setModelSource("custom");

    const { generateCharacters } = await import("@/lib/character-generator");
    const result = await generateCharacters(1);

    assert.equal(mock.personaCalls, 1, "解析器修得好就不该重试");
    assert.equal(result.length, 1);
    assert.equal(result[0].displayName, "林川");
  } finally {
    mock.restore();
    await restoreEnv();
  }
});
