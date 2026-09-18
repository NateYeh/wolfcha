import assert from "node:assert/strict";
import test from "node:test";
import { hasBuiltInParams, resolveAvailableModelRefs, toModelRef, withGatewayModels } from "@/lib/model-pool";
import { PLAYER_MODELS } from "@/types/game";

test("模型池來源：沒抓過閘道器清單時用內建池", () => {
  assert.deepEqual(resolveAvailableModelRefs([], PLAYER_MODELS), PLAYER_MODELS);
});

test("模型池來源：有閘道器清單就以它為準，未內建的走自帶閘道器通道", () => {
  const pool = resolveAvailableModelRefs(["glm-5.3-flash:cloud", "brand-new-model:v3"], PLAYER_MODELS);
  assert.deepEqual(
    pool.map((ref) => `${ref.provider}:${ref.model}`),
    ["tokendance:glm-5.3-flash:cloud", "tokendance:brand-new-model:v3"],
  );
  // 內建模型保留內建參數（reasoning off），未內建的用預設值（不塞參數）
  assert.equal(pool[0].reasoning?.enabled, false);
  assert.equal(pool[1].reasoning, undefined);
  // 內建池沒有的模型不該再出現（閘道器沒提供就抽不到）
  assert.ok(!pool.some((ref) => ref.model === "gemma4:31b-cloud"));
});

test("模型池來源：內建與閘道器模型合併時不重複", () => {
  const merged = withGatewayModels(PLAYER_MODELS, ["gemma4:31b-cloud", "new-model:x"]);
  const keys = merged.map((ref) => `${ref.provider}:${ref.model}`);
  assert.deepEqual(keys, [
    "tokendance:glm-5.3-flash:cloud",
    "tokendance:gemma4:31b-cloud",
    "tokendance:new-model:x",
  ]);
  assert.equal(new Set(keys).size, keys.length);
});

test("toModelRef：內建模型帶參數、閘道器模型走 tokendance、都不認識時維持舊行為", () => {
  assert.equal(toModelRef("glm-5.3-flash:cloud").provider, "tokendance");
  assert.equal(toModelRef("glm-5.3-flash:cloud").reasoning?.enabled, false);
  assert.deepEqual(toModelRef("brand-new:v1", ["brand-new:v1"]), { provider: "tokendance", model: "brand-new:v1" });
  assert.deepEqual(toModelRef("unknown:v1"), { provider: "zenmux", model: "unknown:v1" });
});

test("hasBuiltInParams：分辨有沒有內建參數", () => {
  assert.equal(hasBuiltInParams("glm-5.3-flash:cloud"), true);
  assert.equal(hasBuiltInParams("brand-new:v1"), false);
});
