import assert from "node:assert/strict";
import test from "node:test";

// character-generator 依賴鏈會載入 supabase，模組層級檢查環境變數；測試環境先補假值。
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "test-publishable-key";

import type { GameScenario } from "@/types/game";
import type { GeneratedCharacter } from "./character-generator";
import { CHARACTER_POOL_ROUNDS, type CharacterPool } from "./character-pool";

// character-generator（間接）會載入 supabase，必須等環境變數設好再動態載入。
const loadRefill = (): Promise<typeof import("./character-pool-refill")> => import("./character-pool-refill");

const scenario = (id: string): GameScenario => ({
  id,
  title: `場景-${id}`,
  description: `描述-${id}`,
  rolesHint: `角色建議-${id}`,
});

const character = (name: string): GeneratedCharacter => ({
  displayName: name,
  persona: {
    voiceRules: ["说话直接"],
    mbti: "INTJ",
    gender: "male",
    age: 30,
    basicInfo: `${name}的職業`,
  },
  playerMind: {
    courage: "敢冲票",
    memoryBias: "记票型",
    suspicionThreshold: "偏高",
    selfProtection: "会自保",
    logicDepth: "愿意展开",
    tablePresence: "中等",
  },
});

const batch = (prefix: string, count: number): GeneratedCharacter[] =>
  Array.from({ length: count }, (_, index) => character(`${prefix}${index + 1}`));

const makePool = (
  scenarioId: string,
  characters: GeneratedCharacter[],
  usedIndexes: number[] = [],
  locked = false,
): CharacterPool => ({
  version: 1,
  scenario: scenario(scenarioId),
  characters,
  usedIndexes,
  locked,
  updatedAt: Date.now(),
});

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

/** 安裝 fetch 假實作，模擬伺服器 API；回傳請求紀錄與還原函式。 */
const installFetchMock = (handlers: {
  getPool?: () => CharacterPool | null;
  postAppend?: (scenario: GameScenario, characters: GeneratedCharacter[]) => { ok: boolean };
}) => {
  const requests: RecordedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ url, method, body });
    if (method === "GET" && url.includes("/api/character-pool")) {
      return Response.json({ pool: handlers.getPool?.() ?? null });
    }
    if (method === "POST" && url.includes("/api/character-pool")) {
      const payload = body as { action?: string; scenario?: GameScenario; characters?: GeneratedCharacter[] };
      if (payload.action === "append" && payload.scenario && payload.characters) {
        const result = handlers.postAppend?.(payload.scenario, payload.characters) ?? { ok: true };
        if (result.ok) return Response.json({ pool: null });
        return Response.json({ error: "write_failed" }, { status: 500 });
      }
    }
    return Response.json({ error: "unexpected_request" }, { status: 500 });
  }) as typeof fetch;
  return {
    requests,
    restore: (): void => {
      globalThis.fetch = original;
    },
  };
};

test("補池協調：狀態由池物件計算（unused/total/target/情境）", async () => {
  const { getCharacterPoolStatus } = await loadRefill();
  const perGame = 9;
  const status = getCharacterPoolStatus(perGame, makePool("s1", batch("甲", 12), [0, 1]));
  assert.equal(status.unused, 10);
  assert.equal(status.total, 12);
  assert.equal(status.target, perGame * CHARACTER_POOL_ROUNDS);
  assert.equal(status.scenarioId, "s1");
  assert.equal(status.scenarioTitle, "場景-s1");
  assert.equal(status.locked, false);
  assert.equal(getCharacterPoolStatus(perGame, makePool("s1", [], [], true)).locked, true);
  assert.equal(getCharacterPoolStatus(perGame, null).total, 0);
  assert.equal(getCharacterPoolStatus(perGame, null).scenarioId, null);
  assert.equal(getCharacterPoolStatus(perGame, null).locked, false);
});

test("補池協調：固定班底時 skipped，不生成也不送出", async () => {
  const { refillCharacterPoolOnce } = await loadRefill();
  const perGame = 9;
  // 池只有一局份但已鎖定：未達標也不該生成。
  const mock = installFetchMock({ getPool: () => makePool("jinyong", batch("甲", perGame), [], true) });
  try {
    let generated = 0;
    const result = await refillCharacterPoolOnce(perGame, async () => {
      generated += 1;
      return batch("乙", perGame);
    });
    assert.equal(result, "skipped");
    assert.equal(generated, 0);
    assert.equal(mock.requests.filter((request) => request.method === "POST").length, 0);
  } finally {
    mock.restore();
  }
});

test("補池協調：池已達標時 skipped，不生成也不送出", async () => {
  const { refillCharacterPoolOnce } = await loadRefill();
  const perGame = 9;
  const mock = installFetchMock({ getPool: () => makePool("s1", batch("甲", perGame * CHARACTER_POOL_ROUNDS)) });
  try {
    let generated = 0;
    const result = await refillCharacterPoolOnce(perGame, async () => {
      generated += 1;
      return [];
    });
    assert.equal(result, "skipped");
    assert.equal(generated, 0);
    assert.equal(mock.requests.filter((request) => request.method === "POST").length, 0);
  } finally {
    mock.restore();
  }
});

test("補池協調：沿用池既有情境，生成後送出 append", async () => {
  const { refillCharacterPoolOnce } = await loadRefill();
  const perGame = 9;
  const mock = installFetchMock({
    getPool: () => makePool("jinyong", batch("舊", perGame * 2)),
  });
  try {
    const seenScenarios: string[] = [];
    const result = await refillCharacterPoolOnce(perGame, async (count, scenario) => {
      seenScenarios.push(scenario.id);
      assert.equal(count, perGame);
      return batch("新", count);
    });
    assert.equal(result, "refilled");
    assert.deepEqual(seenScenarios, ["jinyong"]);
    const appendRequest = mock.requests.find((request) => request.method === "POST");
    assert.ok(appendRequest);
    assert.equal((appendRequest.body as { action: string }).action, "append");
    assert.equal((appendRequest.body as { scenario: GameScenario }).scenario.id, "jinyong");
    assert.equal((appendRequest.body as { characters: GeneratedCharacter[] }).characters.length, perGame);
  } finally {
    mock.restore();
  }
});

test("補池協調：伺服器沒有池時，生成會附帶新抽的情境", async () => {
  const { refillCharacterPoolOnce } = await loadRefill();
  const perGame = 9;
  const mock = installFetchMock({ getPool: () => null });
  try {
    const seenScenarios: string[] = [];
    const result = await refillCharacterPoolOnce(perGame, async (count, scenario) => {
      seenScenarios.push(scenario.id);
      return batch("新", count);
    });
    assert.equal(result, "refilled");
    assert.equal(seenScenarios.length, 1);
    assert.ok(seenScenarios[0]);
  } finally {
    mock.restore();
  }
});

test("補池協調：生成為空回 failed，不送出", async () => {
  const { refillCharacterPoolOnce } = await loadRefill();
  const mock = installFetchMock({ getPool: () => null });
  try {
    const result = await refillCharacterPoolOnce(9, async () => []);
    assert.equal(result, "failed");
    assert.equal(mock.requests.filter((request) => request.method === "POST").length, 0);
  } finally {
    mock.restore();
  }
});

test("補池協調：伺服器寫入失敗回 failed", async () => {
  const { refillCharacterPoolOnce } = await loadRefill();
  const mock = installFetchMock({
    getPool: () => null,
    postAppend: () => ({ ok: false }),
  });
  try {
    const result = await refillCharacterPoolOnce(9, async (count) => batch("新", count));
    assert.equal(result, "failed");
  } finally {
    mock.restore();
  }
});