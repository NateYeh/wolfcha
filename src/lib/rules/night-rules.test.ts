import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import { ABSTAIN_SEAT, canWitchSave, getGuardEligibleSeats, isAbstainKeyword, isAbstainSeat } from "@/lib/rules/actions";
import { DEFAULT_RULE_FLAGS, mergeRuleFlags } from "@/lib/rules/flags";
import type { GameState, Phase } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "night-rules-test-key";

setLocale("zh-CN");

function fresh(phase: Phase): GameState {
  const state = createSinglePlayerContextAuditState();
  return {
    ...state,
    phase,
    day: 2,
    messages: [],
    nightHistory: {},
    dayHistory: {},
    nightActions: {},
    dailySummaries: {},
    dailySummaryFacts: {},
    roleAbilities: { ...state.roleAbilities, witchHealUsed: false, witchPoisonUsed: false },
  };
}

// ─────────────────────────────────────────────────────────────
// 守衛：空守與連守限制（純函式）
// ─────────────────────────────────────────────────────────────

// 身分與本輪任務已移到 user：斷言 prompt 內容時一律看 system＋user 全文。
const promptText = (p: { system: string; user: string }): string => `${p.system}\n\n${p.user}`;

test("守衛可守座位：排除上一晚目標，空守（undefined）時全部可選", () => {
  const flags = mergeRuleFlags();
  assert.deepEqual(
    getGuardEligibleSeats({ aliveSeats: [0, 1, 2, 3], lastGuardTarget: 2, flags }),
    [0, 1, 3],
  );
  // 空守＝沒有上一晚目標，因此不會被限制（也可以連續多晚空守）
  assert.deepEqual(
    getGuardEligibleSeats({ aliveSeats: [0, 1, 2, 3], lastGuardTarget: undefined, flags }),
    [0, 1, 2, 3],
  );
  // 規則可關閉（版型覆寫）
  assert.deepEqual(
    getGuardEligibleSeats({
      aliveSeats: [0, 1, 2, 3],
      lastGuardTarget: 2,
      flags: mergeRuleFlags({ guardCannotRepeat: false }),
    }),
    [0, 1, 2, 3],
  );
});

test("不動作座位值：-1 為空守／棄槍，與女巫 pass 的 0 區隔", () => {
  assert.equal(isAbstainSeat(ABSTAIN_SEAT), true);
  assert.equal(isAbstainSeat(0), false);
  assert.equal(isAbstainSeat(undefined), false);
  assert.equal(isAbstainKeyword("abstain"), true);
  assert.equal(isAbstainKeyword("SKIP"), true);
  assert.equal(isAbstainKeyword("protect"), false);
  assert.equal(isAbstainKeyword(null), false);
});

// ─────────────────────────────────────────────────────────────
// 女巫：不可自救（純函式）
// ─────────────────────────────────────────────────────────────

test("女巫解藥：預設不可自救，刀口是自己時不能救", () => {
  const flags = mergeRuleFlags();
  assert.equal(flags.witchCanSelfSave, false);
  assert.equal(canWitchSave({ healUsed: false, witchSeat: 3, wolfTarget: 5, flags }), true);
  assert.equal(canWitchSave({ healUsed: false, witchSeat: 3, wolfTarget: 3, flags }), false);
  assert.equal(canWitchSave({ healUsed: true, witchSeat: 3, wolfTarget: 5, flags }), false);
  assert.equal(canWitchSave({ healUsed: false, witchSeat: 3, wolfTarget: undefined, flags }), false);
});

test("女巫解藥：版型若開放自救仍可救自己", () => {
  const flags = mergeRuleFlags({ witchCanSelfSave: true });
  assert.equal(canWitchSave({ healUsed: false, witchSeat: 3, wolfTarget: 3, flags }), true);
  assert.equal(DEFAULT_RULE_FLAGS.witchCanSelfSave, false, "預設值不得被覆寫物件污染");
});

// ─────────────────────────────────────────────────────────────
// Prompt：規則要真的進到 AI 的眼裡
// ─────────────────────────────────────────────────────────────

test("守衛 prompt：說明可以空守並給出 seat 0 的寫法", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("@/game/core/PhaseManager");
  const state = fresh("NIGHT_GUARD_ACTION");
  const guard = state.players.find((p) => p.role === "Guard")!;
  state.currentSpeakerSeat = guard.seat;
  const prompt = new PhaseManager().getPrompt("NIGHT_GUARD_ACTION", { state }, guard)!;

  assert.match(promptText(prompt), /可以空守/);
  assert.match(promptText(prompt), /连续多晚空守/);
  assert.match(promptText(prompt), /seat 填 0/);
});

test("守衛 prompt：上一晚守過的人不能被選，且明說今晚不能選", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("@/game/core/PhaseManager");
  const state = fresh("NIGHT_GUARD_ACTION");
  const guard = state.players.find((p) => p.role === "Guard")!;
  state.currentSpeakerSeat = guard.seat;
  state.nightActions = { ...state.nightActions, lastGuardTarget: 4 };

  const prompt = new PhaseManager().getPrompt("NIGHT_GUARD_ACTION", { state }, guard)!;
  const lines = promptText(prompt).split("\n");
  const optionLine = lines.find((line) => line.startsWith("可选: ")) ?? "";
  assert.ok(optionLine.length > 0, "應列出可選玩家");
  assert.doesNotMatch(optionLine, /5号/, "上一晚守過的 5 号不得出現在可選名單");
  assert.match(promptText(prompt), /上晚保护了5号，今晚不能选/);
});

test("女巫 prompt：預設規則下明說不可自救，且刀口是自己時不提供解藥選項", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("@/game/core/PhaseManager");
  const state = fresh("NIGHT_WITCH_ACTION");
  const witch = state.players.find((p) => p.role === "Witch")!;

  // 刀口是別人：正常提供解藥，規則行說明不可自救
  const other = state.players.find((p) => p.seat !== witch.seat)!;
  const normal = new PhaseManager().getPrompt(
    "NIGHT_WITCH_ACTION",
    { state, extras: { wolfTarget: other.seat } },
    witch,
  )!;
  assert.match(promptText(normal), /女巫全程不可自救/);
  assert.doesNotMatch(promptText(normal), /包括自救/);
  assert.match(promptText(normal), /可以使用解药救/);

  // 刀口是自己：不能救，並說明原因
  const selfVictim = new PhaseManager().getPrompt(
    "NIGHT_WITCH_ACTION",
    { state, extras: { wolfTarget: witch.seat } },
    witch,
  )!;
  assert.match(promptText(selfVictim), /袭击了你自己/);
  assert.match(promptText(selfVictim), /解药不能救自己/);
  assert.doesNotMatch(promptText(selfVictim), /可以使用解药救/);
});

test("女巫 prompt：版型開放自救時恢復「包括自救」說明", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("@/game/core/PhaseManager");
  // 目前官方版型沒有覆寫，這裡直接驗證 i18n 兩條文案都存在且語意相反（旗標接線已於純函式測試覆蓋）
  const { getI18n } = await import("@/i18n/translator");
  setLocale("zh-CN");
  const { t } = getI18n();
  assert.match(t("prompts.night.witch.selfSaveForbidden"), /不能救自己/);
  assert.match(t("prompts.night.witch.selfSaveAllowed"), /包括自救/);
});

// ─────────────────────────────────────────────────────────────
// AI 契約：空守要用 seat 0 表示，且必須留在 strict json_schema 的 enum 內
// ─────────────────────────────────────────────────────────────

type CapturedBody = {
  messages: Array<{ role: string; content: string | unknown[] }>;
  response_format?: unknown;
};

/** 攔截 /api/chat 請求（單發），回傳指定的模型輸出。 */
function stubFetch(bodies: CapturedBody[], content: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (init?.body) {
      const body = JSON.parse(String(init.body)) as CapturedBody & { requests?: unknown };
      if (!body.requests) bodies.push(body);
    }
    return new Response(
      JSON.stringify({
        id: "night-rules",
        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return () => {
    globalThis.fetch = original;
  };
}

test("守衛 AI 契約：schema 允許 seat 0，回傳 0 時視為空守（不設守護目標）", async () => {
  const { generateGuardAction } = await import("@/lib/game-master");
  const state = fresh("NIGHT_GUARD_ACTION");
  const guard = state.players.find((p) => p.role === "Guard")!;
  state.currentSpeakerSeat = guard.seat;

  const bodies: CapturedBody[] = [];
  const restore = stubFetch(bodies, JSON.stringify({ seat: 0, reason: "今晚想空守" }));
  try {
    const outcome = await generateGuardAction(state, guard);
    assert.equal(outcome, undefined, "空守不應產生守護目標");
    const format = JSON.stringify(bodies[0]?.response_format ?? {});
    assert.match(format, /"enum":\[0,/, "strict schema 的 enum 必須含 0，否則模型無法合法回報空守");
  } finally {
    restore();
  }
});

test("守衛 AI 契約：正常選人時座位由顯示值換算回 0 基（4 → 3）", async () => {
  const { generateGuardAction } = await import("@/lib/game-master");
  const state = fresh("NIGHT_GUARD_ACTION");
  const guard = state.players.find((p) => p.role === "Guard")!;
  state.currentSpeakerSeat = guard.seat;

  const bodies: CapturedBody[] = [];
  const restore = stubFetch(bodies, JSON.stringify({ seat: 4, reason: "守他" }));
  try {
    const outcome = await generateGuardAction(state, guard);
    assert.equal(outcome?.targetSeat, 3);
    assert.equal(outcome?.reason, "守他");
  } finally {
    restore();
  }
});
