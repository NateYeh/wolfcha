import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import { mergeRuleFlags } from "@/lib/rules/flags";
import {
  canSelfDestruct,
  hasAlreadyBoomed,
  isSelfDestructPhase,
  resolveSelfDestructOutcome,
  shouldResumeBadgeElection,
} from "@/lib/rules/self-destruct";
import type { GameState } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "self-destruct-test-key";

setLocale("zh-CN");

const flags = mergeRuleFlags();

// ─────────────────────────────────────────────────────────────
// 時機與角色
// ─────────────────────────────────────────────────────────────

test("自爆時機：只有競選發言／白天發言／PK 發言可以自爆", () => {
  assert.equal(isSelfDestructPhase("DAY_BADGE_SPEECH"), true);
  assert.equal(isSelfDestructPhase("DAY_SPEECH"), true);
  assert.equal(isSelfDestructPhase("DAY_PK_SPEECH"), true);
  assert.equal(isSelfDestructPhase("DAY_VOTE"), false);
  assert.equal(isSelfDestructPhase("DAY_LAST_WORDS"), false);
  assert.equal(isSelfDestructPhase("NIGHT_WOLF_ACTION"), false);
});

test("自爆角色：所有狼陣營可自爆，好人不行", () => {
  for (const role of ["Werewolf", "WhiteWolfKing"] as const) {
    assert.equal(canSelfDestruct({ phase: "DAY_SPEECH", role, flags }), true, role);
  }
  for (const role of ["Seer", "Witch", "Hunter", "Guard", "Idiot", "Villager"] as const) {
    assert.equal(canSelfDestruct({ phase: "DAY_SPEECH", role, flags }), false, role);
  }
  // 投票階段不能爆
  assert.equal(canSelfDestruct({ phase: "DAY_VOTE", role: "Werewolf", flags }), false);
  // 版型可關掉「全狼自爆」，只留白狼王
  const wwkOnly = mergeRuleFlags({ boom: { anyWolf: false } });
  assert.equal(canSelfDestruct({ phase: "DAY_SPEECH", role: "Werewolf", flags: wwkOnly }), false);
  assert.equal(canSelfDestruct({ phase: "DAY_SPEECH", role: "WhiteWolfKing", flags: wwkOnly }), true);
});

// ─────────────────────────────────────────────────────────────
// 效果矩陣
// ─────────────────────────────────────────────────────────────

test("自爆效果：競選階段白狼王自爆＝帶人＋吞警徽", () => {
  const outcome = resolveSelfDestructOutcome({
    phase: "DAY_BADGE_SPEECH",
    role: "WhiteWolfKing",
    flags,
    electionBooms: 0,
  });
  assert.deepEqual(outcome, { takesPlayer: true, swallowBadge: true, suspendElection: false });
});

test("自爆效果：普通狼競選自爆第一次順延競選、第二次（雙爆）吞警徽", () => {
  const first = resolveSelfDestructOutcome({
    phase: "DAY_BADGE_SPEECH",
    role: "Werewolf",
    flags,
    electionBooms: 0,
  });
  assert.deepEqual(first, { takesPlayer: false, swallowBadge: false, suspendElection: true });

  const second = resolveSelfDestructOutcome({
    phase: "DAY_BADGE_SPEECH",
    role: "Werewolf",
    flags,
    electionBooms: 1,
  });
  assert.deepEqual(second, { takesPlayer: false, swallowBadge: true, suspendElection: false });
});

test("自爆效果：非競選階段自爆不動警徽（警長死亡才撕徽）", () => {
  for (const phase of ["DAY_SPEECH", "DAY_PK_SPEECH"] as const) {
    const wolf = resolveSelfDestructOutcome({ phase, role: "Werewolf", flags, electionBooms: 0 });
    assert.deepEqual(wolf, { takesPlayer: false, swallowBadge: false, suspendElection: false }, phase);
    const wwk = resolveSelfDestructOutcome({ phase, role: "WhiteWolfKing", flags, electionBooms: 0 });
    assert.deepEqual(wwk, { takesPlayer: true, swallowBadge: false, suspendElection: false }, phase);
  }
});

test("自爆防重複：boomedSeats 記錄過的座位不能再爆", () => {
  assert.equal(hasAlreadyBoomed([3, 5], 3), true);
  assert.equal(hasAlreadyBoomed([3, 5], 4), false);
  assert.equal(hasAlreadyBoomed(undefined, 0), false);
});

// ─────────────────────────────────────────────────────────────
// AI 契約
// ─────────────────────────────────────────────────────────────

type CapturedBody = {
  messages: Array<{ role: string; content: string | unknown[] }>;
};

function stubFetch(bodies: CapturedBody[], content: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (init?.body) {
      const body = JSON.parse(String(init.body)) as CapturedBody & { requests?: unknown };
      if (!body.requests) bodies.push(body);
    }
    return new Response(
      JSON.stringify({
        id: "self-destruct",
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

async function boomState(role: "Werewolf" | "WhiteWolfKing"): Promise<{ state: GameState; seat: number }> {
  await import("@/lib/game-master");
  const base = createSinglePlayerContextAuditState();
  const actor = base.players.find((p) => p.role === role)!;
  return {
    state: {
      ...base,
      phase: "DAY_SPEECH",
      day: 2,
      messages: [],
      nightHistory: {},
      dayHistory: {},
      nightActions: {},
      dailySummaries: {},
      dailySummaryFacts: {},
      badge: { ...base.badge, holderSeat: null },
    },
    seat: actor.seat,
  };
}

test("AI 契約：普通狼自爆不帶人（即使回報 seat 也忽略）", async () => {
  const { generateSelfDestructDecision } = await import("@/lib/game-master");
  const { state, seat } = await boomState("Werewolf");
  const actor = state.players.find((p) => p.seat === seat)!;

  const bodies: CapturedBody[] = [];
  const restore = stubFetch(bodies, JSON.stringify({ action: "boom", seat: 2, reason: "今天票台是我队友" }));
  try {
    const decision = await generateSelfDestructDecision(state, actor);
    assert.equal(decision.boom, true);
    assert.equal(decision.targetSeat, null, "普通狼自爆不帶人");
    const promptText = JSON.stringify(bodies[0]?.messages ?? []);
    assert.match(promptText, /不带走任何人/);
    assert.doesNotMatch(promptText, /farewell/);
  } finally {
    restore();
  }
});

test("AI 契約：白狼王自爆需選目標，且 prompt 說明競選自爆吞警徽", async () => {
  const { generateSelfDestructDecision } = await import("@/lib/game-master");
  const { state, seat } = await boomState("WhiteWolfKing");
  const actor = state.players.find((p) => p.seat === seat)!;

  const target = state.players.find((p) => p.alive && p.seat !== seat)!;
  const bodies: CapturedBody[] = [];
  const restore = stubFetch(
    bodies,
    JSON.stringify({ action: "boom", seat: target.seat + 1, reason: "带走预言家" })
  );
  try {
    const decision = await generateSelfDestructDecision(state, actor);
    assert.equal(decision.boom, true);
    assert.equal(decision.targetSeat, target.seat, "顯示座位 → 內部座位換算正確");
    const promptText = JSON.stringify(bodies[0]?.messages ?? []);
    assert.match(promptText, /带走一名存活玩家/);
  } finally {
    restore();
  }
});

test("AI 契約：pass 表示不自爆", async () => {
  const { generateSelfDestructDecision } = await import("@/lib/game-master");
  const { state, seat } = await boomState("Werewolf");
  const actor = state.players.find((p) => p.seat === seat)!;

  const restore = stubFetch([], JSON.stringify({ action: "pass" }));
  try {
    const decision = await generateSelfDestructDecision(state, actor);
    assert.equal(decision.boom, false);
    assert.equal(decision.targetSeat, null);
  } finally {
    restore();
  }
});

test("競選續辦判定：只有「被自爆中斷、還沒有警長、警徽沒流失」才續辦", () => {
  assert.equal(
    shouldResumeBadgeElection({ badge: { holderSeat: null, electionSuspended: true, lost: false } }),
    true
  );
  // 警徽已流失 → 不續辦
  assert.equal(
    shouldResumeBadgeElection({ badge: { holderSeat: null, electionSuspended: true, lost: true } }),
    false
  );
  // 已經有警長 → 不續辦
  assert.equal(
    shouldResumeBadgeElection({ badge: { holderSeat: 3, electionSuspended: true } }),
    false
  );
  // 沒被中斷 → 不續辦
  assert.equal(shouldResumeBadgeElection({ badge: { holderSeat: null } }), false);
});
