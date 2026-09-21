/**
 * 游戏分析生成 Hook
 * 在 GAME_END 时自动触发分析数据生成
 */

import { useEffect, useCallback } from "react";
import { useAtom, useAtomValue } from "jotai";
import {
  gameStateAtom,
  gameAnalysisAtom,
  analysisLoadingAtom,
  analysisErrorAtom,
} from "@/store/game-machine";
import {
  GAME_ANALYSIS_VERSION,
  generateGameAnalysis,
  getGameAnalysisSourceFingerprint,
} from "@/lib/game-analysis";
import { isCurrentAnalysis } from "@/lib/analysis-cache";
import { gameStatsTracker } from "@/hooks/useGameStats";
import { getReviewModel } from "@/lib/api-keys";
import { recordCharacterStats, type CharacterStatRecord } from "@/lib/character-stats";

export function useGameAnalysis() {
  const gameState = useAtomValue(gameStateAtom);
  const [analysisData, setAnalysisData] = useAtom(gameAnalysisAtom);
  const [isLoading, setIsLoading] = useAtom(analysisLoadingAtom);
  const [error, setError] = useAtom(analysisErrorAtom);

  const triggerAnalysis = useCallback(async () => {
    if (gameState.phase !== "GAME_END" || !gameState.winner) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const winner = gameState.winner === "wolf" ? "wolf" : "villager";
      
      // 优先使用 GameState.startTime 计算时长，避免刷新后丢失
      let durationSeconds = 0;
      if (gameState.startTime) {
        durationSeconds = Math.round((Date.now() - gameState.startTime) / 1000);
      } else {
        // 降级方案：尝试从 gameStatsTracker 获取
        const statsSummary = gameStatsTracker.getSummary(winner, true);
        durationSeconds = statsSummary?.durationSeconds ?? 0;
      }
      
      const reviewModel = getReviewModel();
      const data = await generateGameAnalysis(gameState, reviewModel, durationSeconds);
      setAnalysisData(data);

      // 熟人局素材：把本局逐人结果（含 MVP）上报到角色交手统计。fire-and-forget，
      // 失败只 warn；服务端按 gameId 去重，分析重触发不会重复计场。
      const statRecords: CharacterStatRecord[] = gameState.players.map((p) => ({
        gameId: gameState.gameId,
        name: p.displayName,
        alignment: p.alignment === "wolf" ? "wolf" : "village",
        won: (p.alignment === "wolf") === (winner === "wolf"),
        mvp: data.awards.mvp.some((award) => award.playerId === p.playerId),
        svp: data.awards.svp.some((award) => award.playerId === p.playerId),
      }));
      void recordCharacterStats(gameState.gameId, statRecords);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "分析生成失败";
      setError(errorMessage);
      console.error("Game analysis generation failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [gameState, setAnalysisData, setIsLoading, setError]);

  useEffect(() => {
    const sourceFingerprint = gameState.phase === "GAME_END"
      ? getGameAnalysisSourceFingerprint(gameState)
      : null;

    // 賽後感言投票尚未跑完（endGameVotes 存在但旗標未設）時先不分析，
    // 否則 MVP／SVP 會少算票。舊存檔沒有 endGameVotes，不受此限。
    const votingPending =
      Array.isArray(gameState.endGameVotes) && gameState.endGameVotingDone !== true;

    // 触发条件：游戏结束、有胜利方、未加载中
    // 如果缓存来自旧版本或旧状态，也需要重新生成
    const needsAnalysis = gameState.phase === "GAME_END" && 
      gameState.winner && 
      !isLoading &&
      !votingPending &&
      (
        !analysisData ||
        analysisData.gameId !== gameState.gameId ||
        analysisData.analysisVersion !== GAME_ANALYSIS_VERSION ||
        analysisData.sourceFingerprint !== sourceFingerprint
      );
    
    if (needsAnalysis) {
      triggerAnalysis();
    }
  }, [gameState, analysisData, isLoading, triggerAnalysis]);

  const clearAnalysis = useCallback(() => {
    setAnalysisData(null);
    setError(null);
  }, [setAnalysisData, setError]);

  // 分析快取存在 localStorage、跨局共用：gameId（或版本）對不上時它就是上一局的資料。
  // 對外一律回 null，否則新局結算的瞬間會先閃出上一局的 MVP／SVP 卡片。
  const currentAnalysis = isCurrentAnalysis(analysisData, gameState.gameId, GAME_ANALYSIS_VERSION) ? analysisData : null;

  return {
    analysisData: currentAnalysis,
    isLoading,
    error,
    triggerAnalysis,
    clearAnalysis,
  };
}

export function useAnalysisData() {
  const analysisData = useAtomValue(gameAnalysisAtom);
  const gameState = useAtomValue(gameStateAtom);
  // 同 useGameAnalysis：跨局共用的快取要按 gameId／版本過濾，避免顯示上一局的分析。
  return isCurrentAnalysis(analysisData, gameState.gameId, GAME_ANALYSIS_VERSION) ? analysisData : null;
}

export function useAnalysisLoading() {
  return useAtomValue(analysisLoadingAtom);
}

export function useAnalysisError() {
  return useAtomValue(analysisErrorAtom);
}
