import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 這兩個 timeout 必須成對調整：
//   - 伺服器端 API_TIMEOUT_MS：等上游模型回應的上限
//   - 前端 SPEECH_WAIT_TIMEOUT_MS：等一句發言的上限
// 前端若早於伺服器，思考較久的推理模型（reasoning_effort=low）還在跑就會被前端提前放棄，
// 玩家看到的是「卡住後放棄」，而不是伺服器端的逾時訊息。詳見 useDayPhase.ts 檔頭註解。
const chatRouteSource = readFileSync("src/app/api/chat/route.ts", "utf8");
const dayPhaseSource = readFileSync("src/hooks/game-phases/useDayPhase.ts", "utf8");

/** 從原始碼取出常數數值（用讀原始碼而非 export，維持常數留在原檔的可讀性）。 */
function constantValue(source: string, name: string): number {
  const match = source.match(new RegExp(`${name}\\s*=\\s*([0-9_]+)`));
  assert.ok(match, `在原始碼中找不到 ${name}`);
  return Number(match[1].replace(/_/g, ""));
}

test("前端發言等待上限不得早於伺服器 API timeout", () => {
  const apiTimeout = constantValue(chatRouteSource, "API_TIMEOUT_MS");
  const speechWait = constantValue(dayPhaseSource, "SPEECH_WAIT_TIMEOUT_MS");

  assert.equal(apiTimeout, 180_000, "伺服器 API timeout 應為 3 分鐘");
  assert.equal(speechWait, 180_000, "前端發言等待上限應為 3 分鐘");
  assert.ok(
    speechWait >= apiTimeout,
    `前端等待（${speechWait}ms）不得早於伺服器 timeout（${apiTimeout}ms）`,
  );
});
