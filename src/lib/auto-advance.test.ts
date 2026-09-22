import assert from "node:assert/strict";
import test from "node:test";
import { getAutoAdvanceRoundSignature, getAutoAdvanceSignature } from "@/lib/auto-advance";

/** 自動播放對話（自動推進）的簽章：避免重複排 timer，但不得讓同一句話跨日失效 */

const say = (speaker: string, text: string, isStreaming = false) => ({ speaker, text, isStreaming });

test("同一日、同一階段、同一段台詞只排一次 timer", () => {
  const dialogue = say("主持人", "天亮了", false);
  assert.equal(
    getAutoAdvanceSignature(dialogue, null, 2, "DAY_SPEECH"),
    getAutoAdvanceSignature(dialogue, null, 2, "DAY_SPEECH")
  );
});

test("換日或換階段時，即使台詞一字不差也要重新自動推進", () => {
  const dialogue = say("主持人", "天亮了", false);
  assert.notEqual(
    getAutoAdvanceSignature(dialogue, null, 1, "DAY_SPEECH"),
    getAutoAdvanceSignature(dialogue, null, 2, "DAY_SPEECH"),
    "隔天同一句系統台詞必須重新排自動推進（否則會停在原地等按鍵）"
  );
  assert.notEqual(
    getAutoAdvanceSignature(dialogue, null, 2, "DAY_SPEECH"),
    getAutoAdvanceSignature(dialogue, null, 2, "DAY_VOTE")
  );
});

test("不同講者／不同台詞不會共用簽章；串流段落用打字完成後的全文", () => {
  assert.notEqual(
    getAutoAdvanceSignature(say("1號", "我信2號"), null, 1, "DAY_SPEECH"),
    getAutoAdvanceSignature(say("2號", "我信2號"), null, 1, "DAY_SPEECH")
  );
  const streamed = say("1號", "我信2號，先掛票", true);
  assert.equal(
    getAutoAdvanceSignature(streamed, "我信2號，先掛票", 1, "DAY_SPEECH"),
    getAutoAdvanceSignature(streamed, "我信2號，先掛票", 1, "DAY_SPEECH")
  );
  assert.notEqual(
    getAutoAdvanceSignature(streamed, "我信2號，先掛票", 1, "DAY_SPEECH"),
    getAutoAdvanceSignature(streamed, "我信2號", 1, "DAY_SPEECH"),
    "打字進度不同＝不同簽章（尚未打完時不該排下一次）"
  );
});

test("等待下一輪的簽章同樣帶日與階段", () => {
  assert.equal(getAutoAdvanceRoundSignature("DAY_SPEECH", 1, 3), getAutoAdvanceRoundSignature("DAY_SPEECH", 1, 3));
  assert.notEqual(getAutoAdvanceRoundSignature("DAY_SPEECH", 1, 3), getAutoAdvanceRoundSignature("DAY_SPEECH", 2, 3));
  assert.notEqual(getAutoAdvanceRoundSignature("DAY_SPEECH", 1, 3), getAutoAdvanceRoundSignature("DAY_VOTE", 1, 3));
  assert.notEqual(getAutoAdvanceRoundSignature("DAY_SPEECH", 1, null), getAutoAdvanceRoundSignature("DAY_SPEECH", 1, 0));
});
