import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import type { GameState, Player } from "@/types/game";
import type { BadgePhaseActions } from "./useBadgePhase";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "badge-round-test-key";

test("真实警徽结算：首轮票型公开进入 PK，复投保留各轮候选与改票记录", async () => {
  const modules: Record<string, unknown> = {
    "@/lib/game-master": await import("@/lib/game-master"),
    "@/lib/vote-rounds": await import("@/lib/vote-rounds"),
    "@/i18n/translator": await import("@/i18n/translator"),
    "@/lib/game-texts": await import("@/lib/game-texts"),
    "@/lib/game-constants": await import("@/lib/game-constants"),
    "@/lib/game-flow-controller": { delay: async () => {} },
    "@/lib/reveal-pacer": { createRevealPacer: () => async (reveal: () => void) => { reveal(); } },
    "@/lib/narrator-audio-player": { playNarrator: async () => {} },
    "@/store/game-machine": { gameStateAtom: {} },
  };
  let state = createSinglePlayerContextAuditState();
  state.phase = "DAY_BADGE_ELECTION"; state.day = 1; state.messages = [];
  state.badge = { ...state.badge, holderSeat: null, candidates: [0, 1, 2], revoteCount: 0, history: {}, allVotes: {},
    votes: Object.fromEntries(state.players.slice(3).map((p, i) => [p.playerId, i < 4 ? 0 : 1])) };
  const originalVotes = { ...state.badge.votes };
  modules.react = { useCallback: (fn: unknown) => fn, useRef: (current: unknown) => ({ current }) };
  modules.jotai = { useAtom: () => [state, (next: GameState) => { state = next; }] };
  const source = readFileSync("src/hooks/game-phases/useBadgePhase.ts", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} as { useBadgePhase: (callbacks: unknown) => BadgePhaseActions } };
  runInNewContext(`(function(require,module,exports){${code}\n})`, { console })((id: string) => {
    assert.ok(id in modules, id); return modules[id];
  }, loadedModule, loadedModule.exports);
  const hook = loadedModule.exports.useBadgePhase({
    setDialogue: () => {}, clearDialogue: () => {}, setIsWaitingForAI: () => {}, waitForUnpause: async () => {},
    isTokenValid: () => true, runAISpeech: async () => {},
    onBadgeElectionComplete: async (next: GameState) => { state = next; }, onBadgeTransferComplete: async () => {},
  });
  await hook.maybeResolveBadgeElection(state);
  assert.equal(state.phase, "DAY_PK_SPEECH");
  assert.equal(state.voteRounds?.length, 1);
  assert.deepEqual(state.voteRounds![0].candidates, [0, 1, 2]);
  assert.ok(state.messages.some((m) => m.content.startsWith("[VOTE_RESULT]")));
  const firstRound = state.voteRounds![0];
  state = { ...state, phase: "DAY_BADGE_ELECTION", badge: { ...state.badge,
    votes: Object.fromEntries(state.players.slice(2).map((p, i) => [p.playerId, i < 5 ? 1 : 0])) } };
  await hook.maybeResolveBadgeElection(state);
  assert.equal(state.voteRounds?.length, 2);
  assert.deepEqual(firstRound.votes, originalVotes);
  assert.deepEqual(state.voteRounds![0].votes, originalVotes);
  assert.deepEqual(state.voteRounds![1].candidates, [0, 1]);
  assert.equal(state.voteRounds![1].winnerSeat, 1);
  assert.equal(state.badge.holderSeat, 1);
  assert.deepEqual({ ...state.badge.history[1] }, state.voteRounds![1].votes);
});

// 回歸：夜 1 被刀但死亡尚未公布（警長競選後才公布）的人類玩家，報名階段不能停在等他決定。
// 舊版 startBadgeSignupPhase 用 players.filter(alive) 找人類，而 handleBadgeSignup 用
// getPendingDeathSeats 擋掉他，兩邊互等 → 永遠卡在 DAY_BADGE_SIGNUP。
test("人类玩家夜 1 被刀且死亡未公布时，警徽报名会自行推进而不是等他决定", async () => {
  const gameMaster = await import("@/lib/game-master");
  const modules: Record<string, unknown> = {
    // 全部 AI 都不上警 → 報名結束直接結算，不必進入發言階段（不依賴 LLM）
    "@/lib/game-master": {
      ...gameMaster,
      generateAIBadgeSignupBatch: async (_state: GameState, pending: Player[]) =>
        Object.fromEntries(pending.map((p) => [p.playerId, false])),
    },
    "@/lib/vote-rounds": await import("@/lib/vote-rounds"),
    "@/i18n/translator": await import("@/i18n/translator"),
    "@/lib/game-texts": await import("@/lib/game-texts"),
    "@/lib/game-constants": await import("@/lib/game-constants"),
    "@/lib/game-flow-controller": { delay: async () => {} },
    "@/lib/reveal-pacer": { createRevealPacer: () => async (reveal: () => void) => { reveal(); } },
    "@/lib/narrator-audio-player": { playNarrator: async () => {} },
    "@/store/game-machine": { gameStateAtom: {} },
  };
  let state = createSinglePlayerContextAuditState();
  // audit state 預設全員都是 AI，這裡指定 1 號為人類玩家
  state.players = state.players.map((p, i) => (i === 0 ? { ...p, isHuman: true } : p));
  const human = state.players.find((p) => p.isHuman)!;
  state.phase = "NIGHT_RESOLVE";
  state.day = 1;
  state.messages = [];
  state.nightActions = { ...state.nightActions, pendingWolfVictim: human.seat };
  assert.ok(gameMaster.getPendingDeathSeats(state).includes(human.seat));

  modules.react = { useCallback: (fn: unknown) => fn, useRef: (current: unknown) => ({ current }) };
  modules.jotai = { useAtom: () => [state, (next: GameState) => { state = next; }] };
  const source = readFileSync("src/hooks/game-phases/useBadgePhase.ts", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} as { useBadgePhase: (callbacks: unknown) => BadgePhaseActions } };
  runInNewContext(`(function(require,module,exports){${code}\n})`, { console })((id: string) => {
    assert.ok(id in modules, id); return modules[id];
  }, loadedModule, loadedModule.exports);
  const flow: { completed: GameState | null } = { completed: null };
  const hook = loadedModule.exports.useBadgePhase({
    setDialogue: () => {}, clearDialogue: () => {}, setIsWaitingForAI: () => {}, waitForUnpause: async () => {},
    isTokenValid: () => true, runAISpeech: async () => {},
    onBadgeElectionComplete: async (next: GameState) => { flow.completed = next; },
    onBadgeTransferComplete: async () => {},
  });
  await hook.startBadgeSignupPhase(state);
  assert.ok(flow.completed, "報名結束後應由流程自行推進，不可等待已死未公布的人類玩家");
  // 死人不必留下報名值；其餘存活 AI 都已被問過（測試 stub 一律回 false）
  assert.equal(flow.completed!.badge.signup[human.playerId], undefined);
  const signupValues = Object.values(flow.completed!.badge.signup);
  assert.ok(signupValues.length > 0);
  assert.ok(signupValues.every((v) => v === false));
});
