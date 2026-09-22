import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "llm-stream-usage-test-key";

// 注意：@/lib/llm 會連帶載入 supabase 客戶端，必須等上面的 env 設定完成後才動態載入。
const loadLlm = () => import("@/lib/llm");

const TEST_MODEL = "gemma4:31b-cloud";

const requestUrl = (input: string | URL | Request): string =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

const sseFrame = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;

/** 串流回應：兩個內容幀、一個 usage 幀、[DONE]。 */
const streamBody = (withUsage: boolean): string => [
  sseFrame({ choices: [{ delta: { content: "今天" } }] }),
  sseFrame({ choices: [{ delta: { content: "我站9号" } }] }),
  ...(withUsage
    ? [sseFrame({
      choices: [],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 20,
        total_tokens: 1220,
        prompt_tokens_details: { cached_tokens: 1100 },
      },
    })]
    : []),
  "data: [DONE]\n\n",
].join("");

type CapturedBody = { stream?: boolean; stream_options?: { include_usage?: boolean } };

function stubStreamFetch(body: string): {
  body: () => CapturedBody | undefined;
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  let captured: CapturedBody | undefined;
  globalThis.fetch = async (input, init) => {
    if (requestUrl(input) === "/api/demo-config") {
      return Response.json({ active: false, enabled: false });
    }
    captured = init?.body ? JSON.parse(String(init.body)) as CapturedBody : undefined;
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  return { body: () => captured, restore: () => { globalThis.fetch = originalFetch; } };
}

test("串流要求上游回報 usage，並經 onUsage 交回快取統計", async () => {
  const { generateCompletionStream } = await loadLlm();
  const stub = stubStreamFetch(streamBody(true));
  let usage: { prompt_tokens: number; prompt_tokens_details?: { cached_tokens?: number } | null } | undefined;
  try {
    const chunks: string[] = [];
    for await (const chunk of generateCompletionStream({
      model: TEST_MODEL,
      messages: [{ role: "user", content: "你要投谁" }],
      onUsage: (value) => { usage = value; },
    })) {
      chunks.push(chunk);
    }

    // usage 幀只帶統計，不能變成發言內容。
    assert.deepEqual(chunks, ["今天", "我站9号"]);
    // 沒有 stream_options 上游不會回 usage，串流的快取命中就永遠量不到。
    assert.equal(stub.body()?.stream, true);
    assert.equal(stub.body()?.stream_options?.include_usage, true);
    assert.equal(usage?.prompt_tokens, 1200);
    assert.equal(usage?.prompt_tokens_details?.cached_tokens, 1100);
  } finally {
    stub.restore();
  }
});

test("串流沒有 usage 幀時 onUsage 收到 undefined，內容照常輸出", async () => {
  const { generateCompletionStream } = await loadLlm();
  const stub = stubStreamFetch(streamBody(false));
  let onUsageCalled = false;
  let usage: unknown = "未呼叫";
  try {
    const chunks: string[] = [];
    for await (const chunk of generateCompletionStream({
      model: TEST_MODEL,
      messages: [{ role: "user", content: "你要投谁" }],
      onUsage: (value) => { onUsageCalled = true; usage = value; },
    })) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, ["今天", "我站9号"]);
    assert.equal(onUsageCalled, true);
    assert.equal(usage, undefined);
  } finally {
    stub.restore();
  }
});
