import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "llm-upstream-timeout-test-key";

// 注意：@/lib/llm 會連帶載入 supabase 客戶端，必須等上面的 env 設定完成後才動態載入。
const loadLlm = () => import("@/lib/llm");

const TEST_MODEL = "glm-5.3-flash:cloud";

const requestUrl = (input: string | URL | Request): string =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

const completionResponse = (content: string) => Response.json({
  id: "llm-upstream-timeout-test",
  choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
});

/** demo-config 是 auth header 的前置查詢，不算模型呼叫。 */
function stubFetch(handler: () => Response): { calls: () => number; restore: () => void } {
  const originalFetch = globalThis.fetch;
  let chatCalls = 0;
  globalThis.fetch = async (input) => {
    if (requestUrl(input) === "/api/demo-config") {
      return Response.json({ active: false, enabled: false });
    }
    chatCalls += 1;
    return handler();
  };
  return { calls: () => chatCalls, restore: () => { globalThis.fetch = originalFetch; } };
}

test("上游逾時（504 + 標頭）不重試，錯誤訊息可直接看懂", async () => {
  const [{ generateCompletion }, { UPSTREAM_TIMEOUT_CODE, UPSTREAM_TIMEOUT_HEADER }] = await Promise.all([
    loadLlm(),
    import("@/lib/upstream-timeout"),
  ]);
  const stub = stubFetch(() => Response.json(
    { error: "上游模型无响应（超时 60s）", code: UPSTREAM_TIMEOUT_CODE },
    { status: 504, headers: { [UPSTREAM_TIMEOUT_HEADER]: "60000" } },
  ));
  try {
    await assert.rejects(
      generateCompletion({ model: TEST_MODEL, messages: [{ role: "user", content: "今晚刀谁" }] }),
      /上游模型无响应（超时 60s）/,
    );
    // 逾時已經等滿 60s，再重試只是讓整桌多卡 3 輪（過去實測約 4 分鐘）。
    assert.equal(stub.calls(), 1);
  } finally {
    stub.restore();
  }
});

test("沒有逾時標頭的 500 仍照原設定重試", async () => {
  const { generateCompletion } = await loadLlm();
  const stub = stubFetch(() => Response.json({ error: "boom" }, { status: 500 }));
  try {
    await assert.rejects(
      generateCompletion({ model: TEST_MODEL, messages: [{ role: "user", content: "今晚刀谁" }] }),
    );
    assert.equal(stub.calls(), 4);
  } finally {
    stub.restore();
  }
});

test("generateJSON 把原始回覆交給 onRawContent，解析失敗時也拿得到", async () => {
  const { generateJSON } = await loadLlm();
  const stub = stubFetch(() => completionResponse("这里没有 JSON"));
  const seen: string[] = [];
  try {
    await assert.rejects(
      generateJSON({
        model: TEST_MODEL,
        messages: [{ role: "user", content: "复盘" }],
        onRawContent: (content) => { seen.push(content); },
      }),
    );
    assert.deepEqual(seen, ["这里没有 JSON"]);
  } finally {
    stub.restore();
  }
});
