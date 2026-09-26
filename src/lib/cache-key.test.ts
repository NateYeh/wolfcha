import test from "node:test";
import assert from "node:assert/strict";
import { buildCacheKeyInfo, type CacheKeyIngredients } from "./cache-key";

test("buildCacheKeyInfo：同參數同指紋，且與組裝順序無關", () => {
  const base = { model: "deepseek-v4.1-flash:cloud", provider: "tokendance", reasoningEffort: "low" };
  const reordered = buildCacheKeyInfo({
    reasoningEffort: "low",
    provider: "tokendance",
    model: base.model,
  });
  assert.equal(buildCacheKeyInfo(base).fingerprint, reordered.fingerprint);
  assert.equal(buildCacheKeyInfo(base).fingerprint.length, 16);
});

test("buildCacheKeyInfo：只納入實測會影響快取鍵的欄位", () => {
  const base = buildCacheKeyInfo({ model: "m", provider: "p", reasoningEffort: "low" });
  assert.deepEqual(base.ingredients, { model: "m", provider: "p", reasoningEffort: "low" });

  // 實測不影響上游快取鍵的欄位即使被傳進來，也不得改變指紋（否則會製造假警報）
  const ignored = {
    responseFormat: { type: "json_schema", json_schema: { name: "day_vote" } },
    promptScope: "gameplay",
    temperature: 0.7,
    maxTokens: 3000,
    hasRequestId: true,
  } as unknown as CacheKeyIngredients;
  const withIgnored = buildCacheKeyInfo({ model: "m", provider: "p", reasoningEffort: "low", ...ignored });
  assert.equal(withIgnored.fingerprint, base.fingerprint);
  assert.deepEqual(withIgnored.ingredients, base.ingredients);
});

test("buildCacheKeyInfo：任一納入欄位不同就要換指紋", () => {
  const base: CacheKeyIngredients = { model: "m", provider: "p", reasoningEffort: "low" };
  const fingerprint = buildCacheKeyInfo(base).fingerprint;
  const variants: Array<[string, Partial<CacheKeyIngredients>]> = [
    ["model", { model: "m2" }],
    ["provider", { provider: "p2" }],
    ["reasoningEffort", { reasoningEffort: "minimal" }],
  ];
  for (const [label, patch] of variants) {
    assert.notEqual(
      buildCacheKeyInfo({ ...base, ...patch }).fingerprint,
      fingerprint,
      `${label} 改變時指紋必須不同`,
    );
  }
});

test("buildCacheKeyInfo：缺欄位以空值正規化，不因 undefined 漂移", () => {
  const sparse = buildCacheKeyInfo({ model: "m" });
  const explicit = buildCacheKeyInfo({ model: "m", provider: "", reasoningEffort: "" });
  assert.equal(sparse.fingerprint, explicit.fingerprint);
  assert.deepEqual(sparse.ingredients, { model: "m", provider: "", reasoningEffort: "" });
});
