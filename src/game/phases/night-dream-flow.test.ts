process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "night-dream-flow-key";
import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import type { GameState, Phase } from "@/types/game";

setLocale("zh-CN");

/**
 * 夜晚流程的整合測試（不需要瀏覽器）：把整條續跑鏈跑完一輪，
 * 確認攝夢人接在禁言長老之後、狼人之前，而且夢游者一定被指定。
 *
 * 這條鏈是「AI 與真人共用」的單一路徑（NightPhase.continueNightAfterMute →
 * continueNightAfterDream → continueNightAfterWolf → …），順序或掛點寫錯的話
 * 上一層的單元測試看不出來，只有整條跑一遍才會露出來。
 */

type FetchBody = { messages: Array<{ role: string; content: unknown }> };

function promptTextOf(body: FetchBody): string {
  return body.messages
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
    .join("\n");
}

test("夜晚流程：攝夢人在狼人之前被詢問，且夢游者必定被指定（AI 全自動跑完一夜）", async () => {
  // 先載入 game-master：它與 PhaseManager／NightPhase 之間有循環引用，
  // 反過來先載入 NightPhase 會踩到「Cannot access 'NightPhase' before initialization」。
  await import("@/lib/game-master");
  const [{ NightPhase }, { getSelectedBoardRoles }, { createSinglePlayerContextAuditState }] = await Promise.all([
    import("@/game/phases/NightPhase"),
    import("@/lib/rules/boards"),
    import("../../../scripts/single-player-context-audit"),
  ]);

  const base = createSinglePlayerContextAuditState() as unknown as GameState;
  const roles = getSelectedBoardRoles(12, "official-12-wolf-king-dreamweaver");
  const startState: GameState = {
    ...base,
    phase: "NIGHT_START" as Phase,
    day: 1,
    players: base.players.map((player, index) => ({
      ...player,
      role: roles[index]!,
      isHuman: false,
      alive: true,
    })),
    messages: [],
    nightHistory: {},
    dayHistory: {},
    nightActions: {},
  };

  const askedOrder: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (String(input) === "/api/demo-config") return Response.json({ active: false, enabled: false });
    const body = JSON.parse(String(init?.body)) as FetchBody;
    const text = promptTextOf(body);
    // 依 prompt 內容判斷是哪個角色的請求，回一份最小合法答案。
    let content = "{}";
    if (text.includes("【摄梦（夜间技能）】")) {
      askedOrder.push("dream");
      content = JSON.stringify({ seat: 1, reason: "測試：攝 1 號" });
    } else if (text.includes("【今晚刀口】")) {
      askedOrder.push("wolfTeamPlan");
      content = JSON.stringify({
        captainSeat: 1,
        jumpSeat: 0,
        signupSeats: [],
        postures: {},
        reason: "測試計畫",
        day: 1,
      });
    } else if (text.includes("【狼人技能】")) {
      askedOrder.push("wolf");
      content = JSON.stringify({ seat: 2, reason: "測試：刀 2 號" });
    } else if (text.includes("【女巫技能】")) {
      askedOrder.push("witch");
      content = JSON.stringify({ action: "pass", reason: "測試：不動作" });
    } else if (text.includes("【预言家技能】")) {
      askedOrder.push("seer");
      content = JSON.stringify({ seat: 3, reason: "測試：查 3 號" });
    }
    return Response.json({
      id: "test",
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    });
  };

  let finalState: GameState | null = null;
  let seenState: GameState = startState;
  const phaseTrace: Phase[] = [];
  const runtime = {
    token: { isValid: () => true },
    setGameState: (value: GameState | ((prev: GameState) => GameState)) => {
      seenState = typeof value === "function" ? value(seenState) : value;
      if (phaseTrace[phaseTrace.length - 1] !== seenState.phase) phaseTrace.push(seenState.phase);
    },
    setDialogue: () => {},
    setIsWaitingForAI: () => {},
    waitForUnpause: async () => {},
    isTokenValid: () => true,
    onNightComplete: async (state: GameState) => {
      finalState = state;
    },
  };

  try {
    const phase = new NightPhase();
    await phase.handleAction(
      { state: startState, phase: "NIGHT_START", extras: runtime },
      { type: "START_NIGHT" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(finalState, "夜晚必須走完並呼叫 onNightComplete（流程卡住就不會到這裡）");
  const result = finalState as GameState;
  // 攝夢人被詢問、且排在狼人之前（禁言長老不在這個版型，所以狼人是第一個問到的夜晚行動）
  assert.ok(askedOrder.includes("dream"), `攝夢人必須被詢問，實際順序：${askedOrder.join(" → ")}`);
  assert.ok(
    askedOrder.indexOf("dream") < askedOrder.indexOf("wolf"),
    `攝夢人必須排在狼人之前，實際順序：${askedOrder.join(" → ")}`,
  );
  // 階段順序：攝夢人在狼人之前（夢游者免疫的判定要有 dreamTarget 才成立）
  assert.ok(
    phaseTrace.indexOf("NIGHT_DREAM_ACTION") >= 0 &&
      phaseTrace.indexOf("NIGHT_DREAM_ACTION") < phaseTrace.indexOf("NIGHT_WOLF_ACTION"),
    `階段順序必須是 攝夢 → 狼人，實際：${phaseTrace.join(" → ")}`,
  );
  // 夢游者一定有（不能空攝）：AI 給 1 號（顯示 1 號＝seat 0）
  assert.equal(result.nightActions.dreamTarget, 0, "夢游者＝AI 指定的 1 號");
  assert.equal(result.nightActions.dreamReason, "測試：攝 1 號");
  assert.equal(result.nightActions.wolfTarget, 1, "刀口＝AI 指定的 2 號");
  assert.equal(result.nightActions.seerTarget, 2, "查驗＝AI 指定的 3 號");
  // 夜史（dreamTarget／deaths）在 resolveNight 才寫入，由 useSpecialEvents 呼叫
  // rules/night-resolution 的單元測試（dream.test.ts）負責守住。
});
