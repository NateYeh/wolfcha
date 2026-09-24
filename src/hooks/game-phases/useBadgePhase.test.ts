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
    "@/lib/rules/mute": await import("@/lib/rules/mute"),
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
    assert.ok(id in modules, `VM 夾具未註冊模組「${id}」：請把 await import("${id}") 加進本檔的 modules 表`); return modules[id];
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
    "@/lib/rules/mute": await import("@/lib/rules/mute"),
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
    assert.ok(id in modules, `VM 夾具未註冊模組「${id}」：請把 await import("${id}") 加進本檔的 modules 表`); return modules[id];
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

// 回歸：禁言長老禁掉的候選人不能在警徽競選發言拿麥克風（規則：禁言含競選發言）。
// 舊版 startBadgeSpeechPhase／resumeBadgeSpeechPhase 直接從 badge.candidates 挑發言者，
// 繞過了 getSpeechPhaseOrder 的禁言過濾 → 被禁言的候選人照樣發言。
test("被禁言的候选人不在警徽竞选发言拿到发言轮（仍保留竞选资格与投票权）", async () => {
  const modules: Record<string, unknown> = {
    "@/lib/game-master": await import("@/lib/game-master"),
    "@/lib/vote-rounds": await import("@/lib/vote-rounds"),
    "@/i18n/translator": await import("@/i18n/translator"),
    "@/lib/game-texts": await import("@/lib/game-texts"),
    "@/lib/game-constants": await import("@/lib/game-constants"),
    "@/lib/game-flow-controller": { delay: async () => {} },
    "@/lib/reveal-pacer": { createRevealPacer: () => async (reveal: () => void) => { reveal(); } },
    "@/lib/rules/mute": await import("@/lib/rules/mute"),
    "@/lib/narrator-audio-player": { playNarrator: async () => {} },
    "@/store/game-machine": { gameStateAtom: {} },
  };
  let state = createSinglePlayerContextAuditState();
  state.phase = "DAY_BADGE_SIGNUP";
  state.day = 1;
  state.messages = [];
  // 1 號（座位 0）昨晚被禁言長老禁言，且他是候選人；另一位候選人是座位 2
  state.nightActions = { ...state.nightActions, mutedTarget: 0 };
  state.badge = { ...state.badge, holderSeat: null, candidates: [0, 2], signup: {}, votes: {}, allVotes: {}, history: {}, electionWinners: {}, revoteCount: 0 };

  const spokenSeats: number[] = [];
  modules.react = { useCallback: (fn: unknown) => fn, useRef: (current: unknown) => ({ current }) };
  modules.jotai = { useAtom: () => [state, (next: GameState) => { state = next; }] };
  const source = readFileSync("src/hooks/game-phases/useBadgePhase.ts", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} as { useBadgePhase: (callbacks: unknown) => BadgePhaseActions } };
  runInNewContext(`(function(require,module,exports){${code}\n})`, { console })((id: string) => {
    assert.ok(id in modules, `VM 夾具未註冊模組「${id}」：請把 await import("${id}") 加進本檔的 modules 表`); return modules[id];
  }, loadedModule, loadedModule.exports);
  const hook = loadedModule.exports.useBadgePhase({
    setDialogue: () => {}, clearDialogue: () => {}, setIsWaitingForAI: () => {}, waitForUnpause: async () => {},
    isTokenValid: () => true, runAISpeech: async (_s: GameState, player: Player) => { spokenSeats.push(player.seat); },
    onBadgeElectionComplete: async () => {}, onBadgeTransferComplete: async () => {},
  });

  await hook.startBadgeSpeechPhase(state);
  assert.equal(state.currentSpeakerSeat, 2, "第一位發言者不能是被禁言的 1 號");
  assert.equal(state.daySpeechStartSeat, 2);
  assert.deepEqual(spokenSeats, [2]);
  assert.deepEqual(state.badge.candidates, [0, 2], "禁言不改競選資格：候選人名單仍然包含他");

  // 恢復路徑（例如中途 reload）：已發言者之後也不能把麥克風遞給被禁言者
  spokenSeats.length = 0;
  const resumed: GameState = {
    ...state,
    phase: "DAY_BADGE_SPEECH",
    badge: { ...state.badge, candidates: [0, 2, 4], electionSpokenSeats: [2] },
  };
  await hook.resumeBadgeSpeechPhase(resumed);
  assert.equal(state.currentSpeakerSeat, 4, "應跳過被禁言的 1 號，把麥克風交給下一位候選人");
  assert.deepEqual(spokenSeats, [4]);
});
