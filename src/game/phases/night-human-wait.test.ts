process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "night-human-wait-key";
import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import type { GameState, Phase } from "@/types/game";

setLocale("zh-CN");

/**
 * 夜間續跑鏈的「等真人」行為（不需要瀏覽器）。
 *
 * 續跑鏈裡有五處「真人還沒決定就停在該階段等前端寫入」的判定
 * （守衛／禁言／攝夢／女巫／預言家），過去各處自己寫
 * `x?.isHuman && 某欄位 === undefined`。改為向 `rules/night-progress` 查
 * `humanActorPending()` 之後，這支測試守住兩件原本沒有測試覆蓋的事：
 *
 *   1. 真人未決定時，夜晚**不會**走完（`onNightComplete` 不被呼叫），且停在該階段；
 *   2. 前端寫入決定並下 CONTINUE 之後，續跑鏈會把剩下的步驟跑完。
 *
 * 夾具（stub runtime + fetch）與 `night-dream-flow.test.ts` 同型；把五份宿主合併成
 * 一份是候選 8 的範圍，見 docs/night-sequencing-refactor-plan.md。
 */

type FetchBody = { messages: Array<{ role: string; content: unknown }> };

function promptTextOf(body: FetchBody): string {
  return body.messages
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
    .join("\n");
}

test("夜晚流程：真人攝夢人未決定時停在該階段等輸入，寫入決定後才續跑", async () => {
  // game-master 與 PhaseManager／NightPhase 之間有循環引用，必須先載入它
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
      isHuman: roles[index] === "Dreamweaver",
      alive: true,
    })),
    messages: [],
    nightHistory: {},
    dayHistory: {},
    nightActions: {},
  };
  assert.equal(startState.players.filter((p) => p.isHuman).length, 1, "這局只有攝夢人是真人");
  assert.equal(startState.players.find((p) => p.isHuman)!.role, "Dreamweaver");

  const askedPrompts: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (String(input) === "/api/demo-config") return Response.json({ active: false, enabled: false });
    const body = JSON.parse(String(init?.body)) as FetchBody;
    const text = promptTextOf(body);
    let content = "{}";
    if (text.includes("【今晚刀口】")) {
      askedPrompts.push("wolfTeamPlan");
      content = JSON.stringify({ captainSeat: 1, jumpSeat: 0, signupSeats: [], postures: {}, reason: "測試計畫", day: 1 });
    } else if (text.includes("【狼人技能】")) {
      askedPrompts.push("wolf");
      content = JSON.stringify({ seat: 2, reason: "測試：刀 2 號" });
    } else if (text.includes("【女巫技能】")) {
      askedPrompts.push("witch");
      content = JSON.stringify({ action: "pass", reason: "測試：不動作" });
    } else if (text.includes("【预言家技能】")) {
      askedPrompts.push("seer");
      content = JSON.stringify({ seat: 3, reason: "測試：查 3 號" });
    } else if (text.includes("【摄梦（夜间技能）】")) {
      askedPrompts.push("dream");
      content = JSON.stringify({ seat: 1, reason: "不該被問到" });
    }
    return Response.json({ id: "test", choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] });
  };

  let completed: GameState | null = null;
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
      completed = state;
    },
  };

  const phase = new NightPhase();
  try {
    // 1) 天黑後一路跑到真人攝夢人：必須停在這裡，不能走完
    await phase.handleAction(
      { state: startState, phase: "NIGHT_START", extras: runtime },
      { type: "START_NIGHT" },
    );
    assert.equal(completed, null, "真人未決定時不該走完夜晚");
    assert.equal(seenState.phase, "NIGHT_DREAM_ACTION", `應停在攝夢階段，實際：${phaseTrace.join(" → ")}`);
    assert.equal(seenState.nightActions.dreamTarget, undefined, "真人還沒選，不該有夢游者");
    assert.equal(askedPrompts.includes("dream"), false, "真人的決定不該由 LLM 代答");
    assert.equal(askedPrompts.includes("wolf"), false, "真人在等輸入時不該先跑狼人");

    // 2) 前端寫入決定後（handleDreamSubmit）下 CONTINUE，續跑鏈應把剩下的步驟跑完
    const decided: GameState = {
      ...seenState,
      nightActions: { ...seenState.nightActions, dreamTarget: 1 },
    };
    seenState = decided;
    await phase.handleAction(
      { state: decided, phase: "NIGHT_DREAM_ACTION", extras: runtime },
      { type: "CONTINUE_NIGHT_AFTER_DREAM" },
    );
    assert.ok(completed, "寫入決定後應該走完夜晚");
    const result = completed as GameState;
    assert.equal(result.nightActions.dreamTarget, 1, "真人選的夢游者必須保留");
    assert.ok(askedPrompts.includes("wolf"), "續跑後才會問狼人");
    assert.equal(result.nightActions.wolfTarget, 1, "刀口＝AI 指定的 2 號");
    assert.equal(result.nightActions.seerTarget, 2, "查驗＝AI 指定的 3 號");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
