import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import {
  extractSpeechSkillDecision,
  resolveSpeechSkillKind,
  speechSkillTakesPlayer,
} from "@/lib/speech-skill";
import type { GameState, Player } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "speech-skill-key";

setLocale("zh-CN");

const stateWith = (role: Player["role"], overrides: Partial<GameState> = {}): { state: GameState; player: Player } => {
  const base = createSinglePlayerContextAuditState();
  const seat = 0;
  const player: Player = base.players[seat];
  const withRole: Player = { ...player, role, isHuman: false, alive: true };
  const state: GameState = {
    ...base,
    players: base.players.map((p) => (p.seat === seat ? withRole : p)),
    phase: "DAY_SPEECH",
    day: 2,
    currentSpeakerSeat: seat,
    ...overrides,
  };
  return { state, player: withRole };
};

test("技能決定解析：自爆（不帶人／帶人）、翻牌決鬥、不發動", () => {
  assert.deepEqual(
    extractSpeechSkillDecision('{"speech":["好。"],"skill":{"action":"none"}}', "self_destruct"),
    { kind: "self_destruct", action: "none", seat: null, reason: "" }
  );
  assert.deepEqual(
    extractSpeechSkillDecision(
      '{"speech":["好。"],"skill":{"action":"boom","reason":"票台要出去的是我队友"}}',
      "self_destruct"
    ),
    { kind: "self_destruct", action: "use", seat: null, reason: "票台要出去的是我队友" }
  );
  assert.deepEqual(
    extractSpeechSkillDecision('{"speech":["好。"],"skill":{"action":"boom","seat":5}}', "self_destruct"),
    { kind: "self_destruct", action: "use", seat: 4, reason: "" }
  );
  assert.deepEqual(
    extractSpeechSkillDecision(
      '{"speech":["好。"],"skill":{"action":"duel","seat":7,"reason":"他三票都是跟票"}}',
      "knight_duel"
    ),
    { kind: "knight_duel", action: "use", seat: 6, reason: "他三票都是跟票" }
  );
  // 模型改欄位名（skill_decision／ability）也要吃得下
  assert.equal(
    extractSpeechSkillDecision('{"speech":["好。"],"skill_decision":{"action":"pass"}}', "self_destruct")?.action,
    "none"
  );
  assert.equal(
    extractSpeechSkillDecision('{"speech":["好。"],"ability":{"action":"boom"}}', "self_destruct")?.action,
    "use"
  );
  // 座位 0＝不指定目標（顯示座位從 1 起算）
  assert.equal(
    extractSpeechSkillDecision('{"speech":["好。"],"skill":{"action":"boom","seat":0}}', "self_destruct")?.seat,
    null
  );
});

test("技能決定解析：模型漏寫或寫壞時回傳 null（呼叫端退回獨立請求）", () => {
  assert.equal(extractSpeechSkillDecision('["第一段。","第二段。"]', "self_destruct"), null);
  assert.equal(extractSpeechSkillDecision('{"speech":["好。"]}', "self_destruct"), null);
  assert.equal(extractSpeechSkillDecision("这不是 JSON", "self_destruct"), null);
  assert.equal(extractSpeechSkillDecision('{"speech":["好。"],"skill":"boom"}', "self_destruct"), null);
  assert.equal(
    extractSpeechSkillDecision('{"speech":["好。"],"skill":{"action":"也许吧"}}', "self_destruct"),
    null
  );
});

test("技能決定歸屬：只有技能角色在可發動階段才附帶決定", () => {
  const werewolf = stateWith("Werewolf");
  assert.equal(resolveSpeechSkillKind(werewolf.state, werewolf.player), "self_destruct");
  assert.equal(speechSkillTakesPlayer(werewolf.state, werewolf.player), false);

  const whiteWolfKing = stateWith("WhiteWolfKing");
  assert.equal(resolveSpeechSkillKind(whiteWolfKing.state, whiteWolfKing.player), "self_destruct");
  assert.equal(speechSkillTakesPlayer(whiteWolfKing.state, whiteWolfKing.player), true);

  const knight = stateWith("Knight");
  assert.equal(resolveSpeechSkillKind(knight.state, knight.player), "knight_duel");

  // 村民／預言家沒有發言階段技能
  assert.equal(resolveSpeechSkillKind(stateWith("Villager").state, stateWith("Villager").player), null);
  assert.equal(resolveSpeechSkillKind(stateWith("Seer").state, stateWith("Seer").player), null);

  // 用過技能就不再附帶決定：已自爆過的狼、已翻牌的騎士
  const boomed = stateWith("Werewolf", { roleAbilities: { ...stateWith("Werewolf").state.roleAbilities, boomedSeats: [0] } });
  assert.equal(resolveSpeechSkillKind(boomed.state, boomed.player), null);
  const dueled = stateWith("Knight", { roleAbilities: { ...stateWith("Knight").state.roleAbilities, duelUsedSeats: [0] } });
  assert.equal(resolveSpeechSkillKind(dueled.state, dueled.player), null);

  // 騎士在警長競選階段不能翻牌 → 不附帶決定
  const knightCampaign = stateWith("Knight", { phase: "DAY_BADGE_SPEECH" });
  assert.equal(resolveSpeechSkillKind(knightCampaign.state, knightCampaign.player), null);

  // 真人玩家不產生 AI 技能決定
  const humanKnight = stateWith("Knight");
  assert.equal(resolveSpeechSkillKind(humanKnight.state, { ...humanKnight.player, isHuman: true }), null);
});

test("發言 prompt：技能角色附帶技能契約與物件格式，非技能角色維持原格式", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("@/game/core/PhaseManager");
  const manager = new PhaseManager();

  const werewolf = stateWith("Werewolf");
  const wolfPrompt = manager.getPrompt("DAY_SPEECH", { state: werewolf.state }, werewolf.player)!;
  assert.match(wolfPrompt.user, /本回合含自爆决定/);
  assert.match(wolfPrompt.user, /"speech": \["第一段。", "第二段。"\]/);
  assert.match(wolfPrompt.user, /"action": "boom"/);
  assert.match(wolfPrompt.user, /skill/);
  // 格式提醒改成物件版
  assert.match(wolfPrompt.user, /本回合你同时要决定技能/);

  const knight = stateWith("Knight");
  const knightPrompt = manager.getPrompt("DAY_SPEECH", { state: knight.state }, knight.player)!;
  assert.match(knightPrompt.user, /本回合含翻牌决斗决定/);
  assert.match(knightPrompt.user, /"action": "duel"/);

  const villager = stateWith("Villager");
  const villagerPrompt = manager.getPrompt("DAY_SPEECH", { state: villager.state }, villager.player)!;
  assert.doesNotMatch(villagerPrompt.user, /本回合含/);
  assert.doesNotMatch(villagerPrompt.user, /"skill"/);
  assert.match(villagerPrompt.user, /只输出 JSON 字符串数组/);
});

test("沿用發言附帶的決定時不再送第二次請求（自爆與翻牌）", async () => {
  const { aiLogger } = await import("@/lib/ai-logger");
  const { generateSelfDestructDecision, generateKnightDuelDecision } = await import("@/lib/game-master");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error("不該發出請求"); }) as typeof globalThis.fetch;
  const logs: Array<{ type: string; response?: { parsed?: unknown } }> = [];
  const unsubscribe = aiLogger.subscribe((entry) => {
    logs.push(entry as unknown as { type: string });
  });

  try {
    const werewolf = stateWith("Werewolf");
    const boom = await generateSelfDestructDecision(werewolf.state, werewolf.player, {
      fromSpeech: { kind: "self_destruct", action: "use", seat: null, reason: "票台要出去的是我队友" },
    });
    assert.deepEqual(boom, { boom: true, targetSeat: null, reason: "票台要出去的是我队友" });

    const whiteWolfKing = stateWith("WhiteWolfKing");
    const boomWithTarget = await generateSelfDestructDecision(whiteWolfKing.state, whiteWolfKing.player, {
      fromSpeech: { kind: "self_destruct", action: "use", seat: 4, reason: "带走预言家" },
    });
    assert.deepEqual(boomWithTarget, { boom: true, targetSeat: 4, reason: "带走预言家" });

    // 普通狼即使模型給了座位也不帶人
    const wolfWithSeat = await generateSelfDestructDecision(werewolf.state, werewolf.player, {
      fromSpeech: { kind: "self_destruct", action: "use", seat: 4, reason: "" },
    });
    assert.equal(wolfWithSeat.targetSeat, null);

    const knight = stateWith("Knight");
    const duel = await generateKnightDuelDecision(knight.state, knight.player, {
      fromSpeech: { kind: "knight_duel", action: "use", seat: 6, reason: "他三票都是跟票" },
    });
    assert.deepEqual(duel, { duel: true, targetSeat: 6, reason: "他三票都是跟票" });

    assert.equal(calls, 0, "沿用發言決定時不應再呼叫上游");
    const parsed = logs.map((entry) => entry.response?.parsed as { source?: string } | undefined);
    assert.equal(parsed.filter((item) => item?.source === "speech").length, 4);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
  }
});
