import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import type { GameState } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "fingerprint-test-key";
setLocale("zh-CN");

/** GAME_END 賽後感言不得改動分析 fingerprint；遊戲內訊息變動則必須改動。 */
test("分析 fingerprint：GAME_END 感言不觸發重跑，遊戲內訊息仍會", async () => {
  const [{ createInitialGameState, addPlayerMessage, addSystemMessage }, { getGameAnalysisSourceFingerprint }] =
    await Promise.all([import("./game-master"), import("./game-analysis")]);
  const base = createInitialGameState() as GameState;
  base.phase = "GAME_END";
  base.day = 3;
  base.winner = "village";
  base.players = [
    {
      playerId: "human-1",
      seat: 3,
      displayName: "葉小雷",
      role: "Villager",
      alive: false,
      isHuman: true,
    } as GameState["players"][number],
  ];
  base.messages = [
    {
      id: "msg-1",
      playerId: "human-1",
      playerName: "葉小雷",
      content: "白天我把票投给了2号",
      timestamp: 0,
      day: 3,
      phase: "DAY_SPEECH",
      isSystem: false,
    },
  ];

  const fpBefore = getGameAnalysisSourceFingerprint(base);

  let working = addSystemMessage(base, "賽後感言開始");
  working = addPlayerMessage(working, "human-1", "我只是話少，10號絕不是預言家");
  const fpAfterOne = getGameAnalysisSourceFingerprint(working);
  assert.equal(fpAfterOne, fpBefore, "加入 GAME_END 感言不應改變 fingerprint");

  working = addPlayerMessage(working, "human-1", "守衛的帳算得真乾淨");
  const fpAfterTwo = getGameAnalysisSourceFingerprint(working);
  assert.equal(fpAfterTwo, fpBefore, "再多一條感言也不應改變 fingerprint");

  // 對照組：遊戲內訊息變動仍要改變 fingerprint
  const withExtraSpeech: GameState = {
    ...base,
    messages: [
      ...base.messages,
      {
        id: "msg-2",
        playerId: "human-1",
        playerName: "葉小雷",
        content: "再補一句遊戲內發言",
        timestamp: 1,
        day: 3,
        phase: "DAY_SPEECH",
        isSystem: false,
      },
    ],
  };
  assert.notEqual(getGameAnalysisSourceFingerprint(withExtraSpeech), fpBefore, "遊戲內訊息變動必須改變 fingerprint");
});