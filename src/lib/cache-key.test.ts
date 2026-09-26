import test from "node:test";
import assert from "node:assert/strict";
import { buildCacheKeyInfo, describeResponseFormat, type CacheKeyIngredients } from "./cache-key";

test("describeResponseFormat：只取型別與名稱，schema 內容不進指紋", () => {
  assert.equal(describeResponseFormat(undefined), "none");
  assert.equal(describeResponseFormat(null), "none");
  assert.equal(describeResponseFormat({}), "none");
  assert.equal(describeResponseFormat({ type: "json_object" }), "json_object");
  assert.equal(
    describeResponseFormat({ type: "json_schema", json_schema: { name: "day_vote" } }),
    "json_schema:day_vote",
  );
  assert.equal(describeResponseFormat({ type: "json_schema", json_schema: {} }), "json_schema:unnamed");
  const loose = { type: "json_schema", json_schema: { name: "day_vote", schema: { properties: { seat: { type: "integer" } } } } };
  const tight = { type: "json_schema", json_schema: { name: "day_vote", schema: { properties: { seat: { type: "string" } } } } };
  assert.equal(describeResponseFormat(loose), describeResponseFormat(tight));
});

test("buildCacheKeyInfo：同參數同指紋，且與組裝順序無關", () => {
  const base = {
    model: "deepseek-v4.1-flash:cloud",
    provider: "tokendance",
    promptScope: "gameplay",
    responseFormat: { type: "json_schema", json_schema: { name: "day_vote" } },
    temperature: 0.7,
    maxTokens: 3000,
    hasRequestId: true,
  };
  const reordered = buildCacheKeyInfo({
    hasRequestId: true,
    maxTokens: 3000,
    temperature: 0.7,
    responseFormat: base.responseFormat,
    promptScope: "gameplay",
    provider: "tokendance",
    model: base.model,
  });
  assert.equal(buildCacheKeyInfo(base).fingerprint, reordered.fingerprint);
  assert.equal(buildCacheKeyInfo(base).fingerprint.length, 16);
});

test("buildCacheKeyInfo：任一欄位不同就要換指紋", () => {
  const base: CacheKeyIngredients = {
    model: "m",
    provider: "p",
    promptScope: "gameplay",
    reasoningEffort: "low",
    responseFormat: { type: "json_object" },
    temperature: 0.7,
    maxTokens: 3000,
    hasRequestId: true,
  };
  const fingerprint = buildCacheKeyInfo(base).fingerprint;
  const variants: Array<[string, Partial<CacheKeyIngredients>]> = [
    ["model", { model: "m2" }],
    ["provider", { provider: "p2" }],
    ["promptScope", { promptScope: "utility" }],
    ["reasoningEffort", { reasoningEffort: "minimal" }],
    ["responseFormat 型別", { responseFormat: { type: "json_schema", json_schema: { name: "day_vote" } } }],
    ["temperature", { temperature: 1 }],
    ["maxTokens", { maxTokens: 16 }],
    ["hasRequestId", { hasRequestId: false }],
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
  const explicit = buildCacheKeyInfo({
    model: "m",
    provider: "",
    promptScope: "",
    reasoningEffort: "",
    temperature: undefined,
    maxTokens: undefined,
    hasRequestId: false,
  });
  assert.equal(sparse.fingerprint, explicit.fingerprint);
  assert.deepEqual(sparse.ingredients, {
    model: "m",
    provider: "",
    promptScope: "",
    reasoningEffort: "",
    responseFormat: "none",
    temperature: "",
    maxTokens: "",
    hasRequestId: false,
  });
});
