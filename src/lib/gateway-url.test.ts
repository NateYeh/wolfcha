import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_GATEWAY_BASE_URL, normalizeGatewayBaseUrl, toChatCompletionsUrl } from "@/lib/gateway-url";

test("gateway 位址：https 可用，尾斜線會被去掉、路徑保留", () => {
  const check = normalizeGatewayBaseUrl("https://gpt-load.nate.idv.tw:8443/v1/");
  assert.deepEqual(check, { ok: true, url: "https://gpt-load.nate.idv.tw:8443/v1" });
  assert.equal(toChatCompletionsUrl("https://host/v1/"), "https://host/v1/chat/completions");
});

test("gateway 位址：http 只放行 localhost 與內網", () => {
  for (const url of ["http://localhost:47300/v1", "http://127.0.0.1:11434/v1", "http://192.168.77.140:47300/v1", "http://10.0.0.5/v1"]) {
    assert.equal(normalizeGatewayBaseUrl(url).ok, true, url);
  }
  assert.deepEqual(normalizeGatewayBaseUrl("http://example.com/v1"), { ok: false, reason: "insecure" });
});

test("gateway 位址：非 http(s)、亂填、空字串都要被擋下", () => {
  assert.deepEqual(normalizeGatewayBaseUrl("ftp://host/v1"), { ok: false, reason: "protocol" });
  assert.deepEqual(normalizeGatewayBaseUrl("not a url"), { ok: false, reason: "invalid" });
  assert.deepEqual(normalizeGatewayBaseUrl("   "), { ok: false, reason: "empty" });
  assert.equal(toChatCompletionsUrl("http://example.com/v1"), "");
});

test("預設 gateway 位址是 Ollama Cloud（https://ollama.com/v1）且可直接組成 chat/completions", () => {
  assert.equal(DEFAULT_GATEWAY_BASE_URL, "https://ollama.com/v1");
  assert.equal(toChatCompletionsUrl(DEFAULT_GATEWAY_BASE_URL), "https://ollama.com/v1/chat/completions");
  assert.equal(normalizeGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL).ok, true);
});
