process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "analysis-cache-key";
import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentAnalysis } from "./analysis-cache";
import type { GameAnalysisData } from "@/types/analysis";

const VERSION = 3;
const stub = (gameId: string, analysisVersion: number): GameAnalysisData =>
  ({ gameId, analysisVersion } as GameAnalysisData);

test("分析快取：跨局共用必须按 gameId／版本过滤，否则会先显示上一局的 MVP／SVP", () => {
  // 当前局：可用
  assert.equal(isCurrentAnalysis(stub("g2", VERSION), "g2", VERSION), true);
  // 上一局的快取（新局结算瞬间最常见）：不可用
  assert.equal(isCurrentAnalysis(stub("g1", VERSION), "g2", VERSION), false);
  // 舊版分析（例如评奖规则已改）：不可用，等重跑
  assert.equal(isCurrentAnalysis(stub("g2", VERSION - 1), "g2", VERSION), false);
  // 無快取：不可用（呼叫方據此顯示生成中）
  assert.equal(isCurrentAnalysis(null, "g2", VERSION), false);
});

test("復盤提示詞：記錄員與分析師的 system 只放共用公開知識（任務指令移出 system）", async () => {
  const { setLocale } = await import("@/i18n/locale-store");
  setLocale("zh-CN");
  const { buildAnalysisSystemPrompt, buildSpeechSummarySystemPrompt } = await import("./game-analysis");
  const { createSinglePlayerContextAuditState } = await import("../../scripts/single-player-context-audit");
  const state = createSinglePlayerContextAuditState();

  for (const system of [buildAnalysisSystemPrompt(state), buildSpeechSummarySystemPrompt(state)]) {
    assert.match(system, /【这是一局什么游戏】/);
    assert.match(system, /【通用规则/);
    assert.match(system, /【角色与技能/);
    // 公開知識與玩家階段逐字相同（第一段），且不再混入任何任務指令
    assert.match(system, /【本局公开角色配置】/);
    assert.match(system, /【获胜条件】/);
    // 任務指令不得再留在 system（攻略是共用公開知識，裡面出現「你是」屬正常）
    assert.doesNotMatch(system, /你是专业的狼人杀游戏分析师/);
    assert.doesNotMatch(system, /你是狼人杀游戏记录员/);
  }
  // 分析師要評「這一手好不好」→ 吃攻略；記錄員是純抄錄 → 不吃攻略
  assert.match(buildAnalysisSystemPrompt(state), /【狼人杀攻略】/);
  assert.doesNotMatch(buildSpeechSummarySystemPrompt(state), /【狼人杀攻略】/);
});
