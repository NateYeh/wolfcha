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

test("復盤提示詞：記錄員與分析師都必須帶上遊戲基本盤", async () => {
  const { setLocale } = await import("@/i18n/locale-store");
  setLocale("zh-CN");
  const { buildAnalysisSystemPrompt, buildSpeechSummarySystemPrompt } = await import("./game-analysis");

  for (const system of [buildAnalysisSystemPrompt(), buildSpeechSummarySystemPrompt()]) {
    assert.match(system, /【这是一局什么游戏】/);
    assert.match(system, /【通用规则/);
    assert.match(system, /【角色与技能/);
    // 基本盤在前、角色任務在後
    assert.ok(
      system.indexOf("【这是一局什么游戏】") < system.indexOf("你是"),
      "遊戲基本盤要排在角色任務之前"
    );
  }
  assert.match(buildAnalysisSystemPrompt(), /你是专业的狼人杀游戏分析师/);
  assert.match(buildSpeechSummarySystemPrompt(), /你是狼人杀游戏记录员/);
});
