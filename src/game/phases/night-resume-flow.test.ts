process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "night-resume-flow-key";
import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import { NIGHT_ACTION_ORDER, type NightActionPhase } from "@/lib/rules/phases";
import { replayCommandFor } from "./night-resume";
import type { GameState, Phase, Role } from "@/types/game";

setLocale("zh-CN");

/**
 * 重跑指令的**行為**驗證：下 `replayCommandFor(phase)` 之後，那一步的行動真的被執行了。
 *
 * 只比對指令表是不夠的——續跑鏈的「已在這一階段就不重跑」守衛會讓某些看起來合理的指令
 * **整步被跳過**（禁言就是：前一步的 `CONTINUE_NIGHT_AFTER_GUARD` 只是轉呼叫、不改 phase，
 * 於是禁言行動根本沒跑）。這種錯只有實際跑一夜才看得出來，所以這裡逐階段驗證。
 *
 * 板子刻意只有一個 AI 村民充數以外的角色全部在場；每個階段都用「前面步驟已決定、目標步驟
 * 未決定」的存檔形狀（＝真正會走恢復路徑的樣子）。
 */

// 稽核板子共 11 位玩家（座位 0-10）；前六席放六個夜間角色，其餘村民。
const ROLES: Role[] = [
  "Guard",
  "MuteElder",
  "Dreamweaver",
  "Werewolf",
  "WolfBeauty",
  "Witch",
  "Seer",
  "Villager",
  "Villager",
  "Villager",
  "Villager",
];

/** AI 答案的顯示座位：11 號＝索引 10（存活村民；不是任何夜間角色的自己）。 */
const ANSWER_DISPLAY_SEAT = 11;
const ANSWER_SEAT = ANSWER_DISPLAY_SEAT - 1;

/** 目標步驟之前「已經決定」的存檔形狀。 */
const BEFORE: Record<NightActionPhase, GameState["nightActions"]> = {
  NIGHT_GUARD_ACTION: {},
  NIGHT_MUTE_ACTION: { guardTarget: 5 },
  NIGHT_DREAM_ACTION: { guardTarget: 5, mutedTarget: 6 },
  NIGHT_WOLF_ACTION: { guardTarget: 5, mutedTarget: 6, dreamTarget: 7 },
  NIGHT_WOLF_BEAUTY_ACTION: { guardTarget: 5, mutedTarget: 6, dreamTarget: 7, wolfTarget: 0 },
  NIGHT_WITCH_ACTION: {
    guardTarget: 5,
    mutedTarget: 6,
    dreamTarget: 7,
    wolfTarget: 0,
    wolfBeautyTarget: 0,
  },
  NIGHT_SEER_ACTION: {
    guardTarget: 5,
    mutedTarget: 6,
    dreamTarget: 7,
    wolfTarget: 0,
    wolfBeautyTarget: 0,
  },
};

type FetchBody = { messages: Array<{ role: string; content: unknown }> };

type NightRunResult = {
  completed: GameState | null;
  askedCount: number;
};

/** 跑一條重跑指令，回傳夜晚是否走完（onNightComplete 被呼叫）與被問過的次數。 */
async function runReplayCommand(
  phase: NightActionPhase,
  witchAnswer: Record<string, unknown> = { action: "poison", seat: 11, reason: "測試" },
): Promise<NightRunResult> {
  await import("@/lib/game-master");
  const [{ NightPhase }, { createSinglePlayerContextAuditState }] = await Promise.all([
    import("@/game/phases/NightPhase"),
    import("../../../scripts/single-player-context-audit"),
  ]);

  const base = createSinglePlayerContextAuditState() as unknown as GameState;
  const startState: GameState = {
    ...base,
    phase,
    day: 2, // 第二晚：不必處理第一夜狼隊分工
    players: base.players.map((player, index) => ({
      ...player,
      role: ROLES[index] ?? "Villager",
      isHuman: false,
      alive: true,
    })),
    messages: [],
    nightHistory: {},
    dayHistory: {},
    nightActions: { ...BEFORE[phase] },
    roleAbilities: { ...base.roleAbilities, witchHealUsed: false, witchPoisonUsed: false },
  };

  let askedCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    askedCount += 1;
    const body = JSON.parse(String(init?.body)) as FetchBody;
    const text = body.messages
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");
    // 女巫要的是 action 形狀（而且「不動作」不會落盤，所以這裡要給真的會寫入的毒殺）；
    // 其他角色給 11 號（索引 10，存活村民）：避開「座位 0＝空守」與「不能選自己」。
    const content = text.includes("【女巫技能】")
      ? witchAnswer
      : { seat: ANSWER_DISPLAY_SEAT, reason: "測試" };
    return Response.json({
      id: "test",
      choices: [{ message: { role: "assistant", content: JSON.stringify(content), finish_reason: "stop" } }],
    });
  };

  let completed: GameState | null = null;
  let seenState: GameState = startState;
  const runtime = {
    token: { isValid: () => true },
    setGameState: (value: GameState | ((prev: GameState) => GameState)) => {
      seenState = typeof value === "function" ? value(seenState) : value;
    },
    setDialogue: () => {},
    setIsWaitingForAI: () => {},
    waitForUnpause: async () => {},
    isTokenValid: () => true,
    onNightComplete: async (state: GameState) => {
      completed = state;
    },
  };

  try {
    const nightPhase = new NightPhase();
    await nightPhase.handleAction(
      { state: startState, phase, extras: runtime },
      { type: replayCommandFor(phase) },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  void seenState;
  return { completed, askedCount };
}

/** 這一步的「已決定」寫在哪個欄位。 */
const DECISION: Record<NightActionPhase, (state: GameState) => unknown> = {
  NIGHT_GUARD_ACTION: (s) => s.nightActions.guardTarget,
  NIGHT_MUTE_ACTION: (s) => s.nightActions.mutedTarget,
  NIGHT_DREAM_ACTION: (s) => s.nightActions.dreamTarget,
  NIGHT_WOLF_ACTION: (s) => s.nightActions.wolfTarget,
  NIGHT_WOLF_BEAUTY_ACTION: (s) => s.nightActions.wolfBeautyTarget,
  // 女巫的答案刻意選「毒殺」（真的會落盤的決定）；「不動作」不會寫任何欄位
  NIGHT_WITCH_ACTION: (s) => s.nightActions.witchPoison,
  NIGHT_SEER_ACTION: (s) => s.nightActions.seerTarget,
};

test("重跑指令會真的執行那一步的行動，並把夜晚走完", async () => {
  for (const phase of NIGHT_ACTION_ORDER) {
    const { completed, askedCount } = await runReplayCommand(phase);
    assert.ok(completed, `${phase}：下了重跑指令之後夜晚必須走完（卡住就不會到這裡）`);
    assert.ok(askedCount > 0, `${phase}：應該有問過 AI`);
    const decision = DECISION[phase](completed as GameState);
    assert.notEqual(decision, undefined, `${phase}：那一步的決定必須被寫入（否則就是整步被跳過）`);
    assert.equal(decision, ANSWER_SEAT, `${phase}：應該使用 AI 給的 ${ANSWER_DISPLAY_SEAT} 號座位`);
  }
});

test("女巫說「不救」也是決定：要落盤（否則恢復存檔會再問一次）", async () => {
  const { completed } = await runReplayCommand("NIGHT_WITCH_ACTION", { action: "pass", reason: "測試：不救" });
  const state = completed as GameState;
  assert.equal(state.nightActions.witchSave, false, "明確不救必須寫入 witchSave: false");
  assert.equal(state.nightActions.witchPoison, undefined, "沒有毒殺");
});

test("重跑指令不會把「目標步驟之後」的決定一起做掉（鏈只往前走）", async () => {
  // 從狼人階段重跑：女巫與預言家的決定應該照樣在之後的鏈上產生，而不是這一步就全部做完
  const { completed } = await runReplayCommand("NIGHT_WOLF_ACTION");
  const state = completed as GameState;
  assert.equal(state.nightActions.wolfTarget, ANSWER_SEAT, "狼刀已寫入");
  assert.equal(state.nightActions.witchPoison, ANSWER_SEAT, "女巫在鏈上接著被問到（毒殺目標落盤）");
  assert.notEqual(state.nightActions.seerTarget, undefined, "預言家在鏈上接著被問到");
});

test("重跑指令的字串本身必須是 NightPhase 認得的指令", async () => {
  // 打錯字會靜默變成 no-op（handleAction 的 if 鏈不匹配就什麼都不做），所以釘住
  const phaseModule = await import("@/game/phases/NightPhase");
  assert.ok(typeof phaseModule.NightPhase === "function");
  for (const phase of NIGHT_ACTION_ORDER) {
    const command = replayCommandFor(phase as Phase as NightActionPhase);
    assert.ok(command.length > 0, `${phase}：重跑指令不得為空`);
  }
});
