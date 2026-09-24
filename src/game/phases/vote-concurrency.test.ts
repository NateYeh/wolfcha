import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import type { GameState, Player } from "@/types/game";
import type { VotePhase } from "./VotePhase";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "vote-concurrency-test";

/**
 * 投票必須併發發送。
 *
 * 逐席 `await generateAIVote` 會讓一輪投票的總時間＝各席位加總（實測 10 席 × 5~25 秒），
 * 使用者看到的就是「票一張一張慢慢出來」。這裡驗證：
 *   1. 第一席先算完（它的票會進公共資訊，後面的人看得到）
 *   2. 其餘席位**同時**在飛（彼此的請求時間重疊）
 */

interface Call {
  voterId: string;
  startedAt: number;
  endedAt: number;
}

async function runVotePhase(callDurationMs: number): Promise<{ calls: Call[]; state: GameState }> {
  const modules: Record<string, unknown> = {};
  for (const id of ["@/lib/vote-rounds", "@/lib/prompt-utils", "@/i18n/translator", "@/lib/game-texts", "@/lib/game-constants", "@/lib/narrator-voice", "@/lib/game-flow-controller", "@/lib/rules/death-skills", "@/lib/rules/vote-weight", "@/types/game", "@/lib/reveal-pacer"]) {
    modules[id] = await import(id);
  }
  modules["../core/GamePhase"] = await import("../core/GamePhase");
  modules["@/lib/narrator-audio-player"] = { playNarrator: async () => {} };

  const calls: Call[] = [];
  const real = await import("@/lib/game-master");
  modules["@/lib/game-master"] = {
    ...real,
    warmUpVotePrompt: async () => {},
    generateAIVote: async (_: GameState, player: Player) => {
      const startedAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, callDurationMs));
      calls.push({ voterId: player.playerId, startedAt, endedAt: Date.now() });
      return { seat: 2, reason: "併發測試" };
    },
  };

  const m = { exports: {} as { VotePhase: typeof VotePhase } };
  const code = ts.transpileModule(readFileSync("src/game/phases/VotePhase.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(`(function(require,module,exports){${code}\n})`, { console })((id: string) => {
    assert.ok(id in modules, `VM 夾具未註冊模組「${id}」：請把 await import("${id}") 加進本檔的 modules 表`);
    return modules[id];
  }, m, m.exports);

  let state = createSinglePlayerContextAuditState();
  state.players = state.players.map((p) => ({ ...p, isHuman: p.seat === 4 }));
  state.phase = "DAY_VOTE";
  state.pkSource = "vote";
  state.pkTargets = [];

  const runtime = {
    token: { isValid: () => true },
    isTokenValid: () => true,
    humanPlayer: state.players.find((p) => p.isHuman),
    setGameState: (v: GameState | ((p: GameState) => GameState)) => {
      state = typeof v === "function" ? v(state) : v;
    },
    getGameState: () => state,
    setDialogue: () => {},
    setIsWaitingForAI: () => {},
    waitForUnpause: async () => {},
    onVoteComplete: async () => {},
    onGameEnd: async () => {},
    runAISpeech: async () => {},
  };

  const phase = new m.exports.VotePhase();
  await phase.handleAction({ state, extras: runtime }, { type: "RESUME_VOTES" });
  return { calls, state };
}

test("放逐投票：第一席先算完，其餘席位併發（請求時間重疊）", async () => {
  const duration = 80;
  const { calls, state } = await runVotePhase(duration);

  const aiVoters = state.players.filter((p) => p.alive && !p.isHuman);
  assert.equal(calls.length, aiVoters.length, "每一席 AI 都應該投到票");

  // 第一席必須是獨立先算完的那一席
  assert.equal(calls[0].voterId, aiVoters[0].playerId, "第一席要先算（它的票進公共資訊）");

  // 其餘席位必須重疊：取第二席開始到最後一席結束的區間，
  // 若為逐席 await，這個區間會是 (n-1) × duration；併發則約等於 duration。
  const later = calls.slice(1);
  if (later.length >= 2) {
    const windowMs = Math.max(...later.map((c) => c.endedAt)) - Math.min(...later.map((c) => c.startedAt));
    const sequentialMs = later.length * duration;
    assert.ok(
      windowMs < sequentialMs * 0.6,
      `其餘 ${later.length} 席應併發送出（實際區間 ${windowMs}ms，逐席會是 ~${sequentialMs}ms）`
    );
    const maxConcurrent = Math.max(
      ...later.map((c) => later.filter((o) => o.startedAt < c.endedAt && o.endedAt > c.startedAt).length)
    );
    assert.ok(maxConcurrent >= 2, `同一時間應有多筆請求在飛（實際最多 ${maxConcurrent}）`);
  }

  // 票仍然要全部寫進 state
  for (const voter of aiVoters) {
    assert.equal(state.votes[voter.playerId], 2);
  }
});
