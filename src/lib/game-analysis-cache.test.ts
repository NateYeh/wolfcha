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
