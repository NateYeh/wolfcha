import assert from "node:assert/strict";
import test from "node:test";
import { extractGatewayModelIds } from "@/lib/gateway-models";

test("解析 /models 回應：支援 OpenAI 格式、字串陣列、去重與去空白", () => {
  assert.deepEqual(
    extractGatewayModelIds({
      object: "list",
      data: [
        { id: "glm-5.3-flash:cloud", object: "model" },
        { id: " gemma4:31b-cloud " },
        { id: "glm-5.3-flash:cloud" },
      ],
    }),
    ["glm-5.3-flash:cloud", "gemma4:31b-cloud"],
  );
  assert.deepEqual(extractGatewayModelIds({ data: ["a", "b", ""] }), ["a", "b"]);
});

test("解析 /models 回應：格式不符時回空陣列（不亂猜）", () => {
  assert.deepEqual(extractGatewayModelIds(null), []);
  assert.deepEqual(extractGatewayModelIds({}), []);
  assert.deepEqual(extractGatewayModelIds({ data: "nope" }), []);
  assert.deepEqual(extractGatewayModelIds({ data: [{ nope: 1 }, 42] }), []);
});
