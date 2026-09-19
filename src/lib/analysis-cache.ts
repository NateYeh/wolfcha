/**
 * 分析快取的歸屬判斷（純函式，不引入任何會連帶載入服務端依賴的模組）。
 *
 * 分析快取（gameAnalysisAtom）存在 localStorage，是跨局共用的：gameId 或分析版本
 * 對不上時，它只是「上一局的資料」。呼叫方必須把它視為 null，否則新局結算的瞬間
 * 會先閃出上一局的 MVP／SVP 卡片（實際回報：新局結算先看到自己上一局的 SVP）。
 */

import type { GameAnalysisData } from "@/types/analysis";

export function isCurrentAnalysis(
  data: GameAnalysisData | null,
  gameId: string,
  analysisVersion: number
): boolean {
  return !!data && data.gameId === gameId && data.analysisVersion === analysisVersion;
}
