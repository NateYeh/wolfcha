"use client";

/**
 * useGameLogic - 游戏逻辑协调层（重构版）
 * 
 * 职责：
 * 1. 协调各阶段 Hook 的调用
 * 2. 管理全局游戏状态
 * 3. 处理 Dev Mode 跳转
 * 4. 暴露统一的 API 给 UI 组件
 * 
 * 遵循原则：
 * - SRP: 仅负责协调，不包含具体业务逻辑
 * - DRY: 复用子模块，避免重复代码
 */

import { isValidSwap, redirectSeat } from "@/lib/rules/magician";
import { useState, useCallback, useRef, useEffect } from "react";
import { useAtom, useStore } from "jotai";
import { useLocalStorageState } from "ahooks";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { getGatewayModels } from "@/lib/api-keys";
import { PLAYER_MODELS, isWolfRole, type GameState, type Player, type Phase, type Role, type DevPreset, type ModelRef, type StartGameOptions, type WolfTeamPlan } from "@/types/game";
import { gameStateAtom, isValidTransition, clearPersistedGameState, isRestorableGameState } from "@/store/game-machine";
import { getGeneratorModel, getModelSource } from "@/lib/api-keys";
import { isAbstainSeat } from "@/lib/rules/actions";
import { takeNextLastWordsSeat } from "@/lib/rules/last-words";
import { getRoleCapabilities } from "@/lib/rules/roles";
import { canSelfDestruct, hasAlreadyBoomed, shouldResumeBadgeElection } from "@/lib/rules/self-destruct";
import { applySelfDestructToState } from "@/lib/rules/self-destruct-apply";
import { getBoardRuleFlags } from "@/lib/rules/boards";
import { canDuel, hasAlreadyDueled } from "@/lib/rules/knight-duel";
import { canUseDeathShot, getChainedShooter, getDeathShotKind } from "@/lib/rules/death-skills";
import { isValidMuteTarget } from "@/lib/rules/mute";
import { isValidDreamTarget } from "@/lib/rules/dream";
import { applyCharmRevenge, isValidWolfBeautyTarget } from "@/lib/rules/charm";
import { appendDayHunterShot, appendNightHunterShot } from "@/lib/rules/hunter-shots";
import { getPendingDeathSeats } from "@/lib/rules/night-deaths";
import {
  humanActorPending,
  isNightActionPhase,
} from "@/lib/rules/night-progress";
import { nightResumePlan, replayCommandFor, type NightResumeCommand } from "@/game/phases/night-resume";
import { applyKnightDuelToState } from "@/lib/rules/knight-duel-apply";
import {
  buildGameStartState,
  createInitialGameState,
  setupPlayers,
  addSystemMessage,
  addPlayerMessage,
  transitionPhase as rawTransitionPhase,
  checkWinCondition,
  killPlayer,
  generateDailySummary,
  getRandomHumanSeat,
  generateSelfDestructDecision,
  generateKnightDuelDecision,
  generateWolfTeamPlan,
  buildHumanWolfTeamPlan,
  type HumanWolfTeamPlanChoice,
  carryDailySummary,
} from "@/lib/game-master";
import { buildGenshinModelRefs, generateGenshinModeCharacters, sampleModelRefs, type GeneratedCharacter } from "@/lib/character-generator";
import { sampleRosterCharacters } from "@/lib/character-roster";
import { fetchCharacterStats } from "@/lib/character-stats";
import { getSystemMessages, getUiText } from "@/lib/game-texts";
import { getRandomScenario } from "@/lib/scenarios";
import { DELAY_CONFIG, getRoleName } from "@/lib/game-constants";
import { generateUUID } from "@/lib/utils";
import {
  AsyncFlowController,
  delay,
  randomDelay,
  computeUniqueTopSeat,
} from "@/lib/game-flow-controller";
import { playNarrator } from "@/lib/narrator-audio-player";
import { PhaseManager } from "@/game/core/PhaseManager";
import { supabase } from "@/lib/supabase";
import { gameStatsTracker } from "@/hooks/useGameStats";
import { gameSessionTracker } from "@/lib/game-session-tracker";
import { continueAfterHunterShotWithBadgeTransfer } from "@/lib/hunter-badge-flow";
import { isQuotaExhaustedMessage } from "@/lib/llm";
import { aiLogger } from "@/lib/ai-logger";

// 子模块
import { toModelRef } from "@/lib/model-pool";
import { useDialogueManager, type DialogueState } from "./useDialogueManager";
import { useDayPhase } from "./game-phases/useDayPhase";
import { useBadgePhase } from "./game-phases/useBadgePhase";
import { useSpecialEvents } from "./game-phases/useSpecialEvents";

function getModelRefForModel(model: string): ModelRef {
  return toModelRef(model, getGatewayModels());
}

function getRandomModelRef(): ModelRef {
  const fallback = sampleModelRefs(1)[0];
  if (fallback) return fallback;
  if (PLAYER_MODELS.length === 0) {
    // Fallback to GENERATOR_MODEL if no models available
    return getModelRefForModel(getGeneratorModel());
  }
  const randomIndex = Math.floor(Math.random() * PLAYER_MODELS.length);
  return PLAYER_MODELS[randomIndex];
}

// Re-export for backward compatibility
export type { DialogueState };

export function useGameLogic() {
  const t = useTranslations();
  const speakerHost = t("speakers.host");

  // ============================================
  // 基础状态
  // ============================================
  const [humanName, setHumanName] = useLocalStorageState<string>("wolfcha_human_name", {
    defaultValue: "",
  });
  const [gameStarted, setGameStarted] = useState(false);
  const [gameState, setGameState] = useAtom(gameStateAtom);
  const [isLoading, setIsLoading] = useState(false);
  const [inputText, setInputText] = useState("");
  const [showTable, setShowTable] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  
  // Track if we've already restored the game state on mount
  const hasRestoredRef = useRef(false);
  // If the FIRST render is already "in progress", it's almost certainly restored from localStorage
  const restoredInProgressOnMountRef = useRef(
    isRestorableGameState(gameState) && gameState.players.length > 0
  );
  const hasResumedFromCheckpointRef = useRef(false);

  // Restore game state from localStorage on mount
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    
    // Check if the current gameState is from a restored game in progress
    if (isRestorableGameState(gameState) && gameState.players.length > 0 && gameState.gameSessionId) {
      console.info("[wolfcha] Restoring game session from previous state");
      gameSessionTracker.rehydrate(gameState.gameSessionId, gameState.startTime ?? Date.now());
      // [LOCAL DEV PATCH] 重整恢復時接續寫入同一局的紀錄檔
      aiLogger.startGameLog(gameState.gameSessionId, gameState.startTime);
      void gameSessionTracker.syncProgressImmediate().catch((error) => {
        console.error("[game-session] Failed to sync restored session:", error);
      });
      setGameStarted(true);
      setShowTable(true);
    }
  }, [gameState]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    void aiLogger.clearLogsOncePerPageLoad();
  }, []);

  // ============================================
  // 流程控制
  // ============================================
  const flowController = useRef(new AsyncFlowController());
  const phaseManagerRef = useRef(new PhaseManager());
  const phaseExtrasRef = useRef<{ phase: Phase; extras: Record<string, unknown> } | null>(null);
  const gameStateRef = useRef<GameState>(gameState);
  const prevPhaseRef = useRef<Phase>(gameState.phase);
  const phaseLifecycleRef = useRef<Phase>(gameState.phase);
  const prevDayRef = useRef<number>(gameState.day);
  const prevDevMutationIdRef = useRef<number | undefined>(gameState.devMutationId);
  const prevDevPhaseJumpTsRef = useRef<number | undefined>(undefined);
  const runAISpeechRef = useRef<((state: GameState, player: Player) => Promise<void>) | null>(null);
  const handleVoteCompleteRef = useRef<((state: GameState, result: { seat: number; count: number } | null, token: ReturnType<typeof getToken>) => Promise<void>) | null>(null);
  const endGameRef = useRef<((state: GameState, winner: "village" | "wolf") => Promise<void>) | null>(null);
  const resolveNightRef = useRef<((state: GameState, token: ReturnType<typeof getToken>, onComplete: (resolvedState: GameState) => Promise<void>) => Promise<void>) | null>(null);
  const startDayPhaseInternalRef = useRef<((state: GameState, token: ReturnType<typeof getToken>, options?: { skipAnnouncements?: boolean }) => Promise<void>) | null>(null);
  const badgeTransferRef = useRef<((state: GameState, sheriff: Player, afterTransfer: (s: GameState) => Promise<void>) => Promise<void>) | null>(null);
  const hunterDeathRef = useRef<((state: GameState, hunter: Player, diedAtNight: boolean) => Promise<void>) | null>(null);
  const proceedToNightRef = useRef<((state: GameState, token: ReturnType<typeof getToken>) => Promise<void>) | null>(null);
  const onStartVoteRef = useRef<((state: GameState, token: ReturnType<typeof getToken>) => Promise<void>) | null>(null);
  const onBadgeSpeechEndRef = useRef<((state: GameState) => Promise<void>) | null>(null);
  const onPkSpeechEndRef = useRef<((state: GameState) => Promise<void>) | null>(null);
  const selfDestructCheckRef = useRef<((state: GameState, wolf: Player) => Promise<boolean>) | null>(null);
  /** 騎士翻牌決鬥（AI）：回傳 "night"＝已進黑夜、"continue"＝騎士出局白天繼續、"none"＝不發動 */
  const knightDuelCheckRef = useRef<
    ((state: GameState, knight: Player) => Promise<{ action: "none" | "night" | "continue" | "ended"; state?: GameState }>) | null
  >(null);
  /** 真人騎士翻牌時記住來源階段（會先切到 KNIGHT_DUEL 選目標） */
  const knightDuelOriginRef = useRef<Phase | null>(null);
  /** 真人自爆時用來記住「從哪個階段自爆」（白狼王需要先選目標，會先切到 SELF_DESTRUCT 階段） */
  const selfDestructOriginRef = useRef<Phase | null>(null);
  /** 第一夜死者遺言佇列的處理器（由 DaySpeechPhase 在死亡公告後呼叫） */
  const pendingLastWordsRef = useRef<
    ((state: GameState, continuation: (s: GameState) => Promise<void>) => Promise<void>) | null
  >(null);
  const drainPendingLastWordsRef = useRef<
    ((
      state: GameState,
      token: ReturnType<typeof getToken>,
      continuation: (s: GameState) => Promise<void>
    ) => Promise<void>) | null
  >(null);

  // 游戏启动相关 refs
  const pendingStartStateRef = useRef<GameState | null>(null);
  const hasContinuedAfterRevealRef = useRef(false);
  const isAwaitingRoleRevealRef = useRef(false);
  const showTableTimeoutRef = useRef<number | null>(null);
  const cancellableTimeoutsRef = useRef<number[]>([]);
  const cancellableTimeoutGenerationRef = useRef(0);

  const clearCancellableTimeouts = useCallback(() => {
    cancellableTimeoutGenerationRef.current += 1;
    cancellableTimeoutsRef.current.forEach((timer) => window.clearTimeout(timer));
    cancellableTimeoutsRef.current = [];
  }, []);

  const scheduleCancellableTimeout = useCallback(
    (generation: number, callback: () => void, delayMs: number) => {
      if (generation !== cancellableTimeoutGenerationRef.current) return;
      let timer = 0;
      timer = window.setTimeout(() => {
        cancellableTimeoutsRef.current = cancellableTimeoutsRef.current.filter(
          (activeTimer) => activeTimer !== timer,
        );
        if (generation === cancellableTimeoutGenerationRef.current) callback();
      }, delayMs);
      cancellableTimeoutsRef.current.push(timer);
    },
    [],
  );

  useEffect(() => () => clearCancellableTimeouts(), [clearCancellableTimeouts]);

  // 回调 refs（用于人类操作后继续流程）
  const afterLastWordsRef = useRef<((state: GameState) => Promise<void>) | null>(null);
  const nightContinueRef = useRef<((state: GameState) => Promise<void>) | null>(null);
  const afterBadgeTransferRef = useRef<((state: GameState) => Promise<void>) | null>(null);
  const badgeSpeechEndRef = useRef<((state: GameState) => Promise<void>) | null>(null);

  // ============================================
  // 对话管理
  // ============================================
  const dialogue = useDialogueManager();
  const {
    currentDialogue,
    isWaitingForAI,
    waitingForNextRound,
    setIsWaitingForAI,
    setWaitingForNextRound,
    setDialogue,
    clearDialogue,
    initSpeechQueue,
    initStreamingSpeechQueue,
    appendToSpeechQueue,
    finalizeSpeechQueue,
    getSpeechQueue,
    advanceSpeechQueue,
    clearSpeechQueue,
    resetDialogueState,
    setPrefetchedSpeech,
    consumePrefetchedSpeech,
    markCurrentSegmentCommitted,
    isCurrentSegmentCommitted,
    markCurrentSegmentCompleted,
    isCurrentSegmentCompleted,
    shouldAutoAdvanceToNextAI,
  } = dialogue;

  // ============================================
  // 派生状态
  // ============================================
  const humanPlayer = gameState.players.find((p) => p.isHuman) || null;
  const isNight = gameState.phase.includes("NIGHT");

  // ============================================
  // 工具函数
  // ============================================
  const transitionPhase = useCallback((state: GameState, newPhase: Phase): GameState => {
    if (!isValidTransition(state.phase, newPhase)) {
      console.warn(`[wolfcha] Invalid phase transition: ${state.phase} -> ${newPhase}`);
    }
    return rawTransitionPhase(state, newPhase);
  }, []);

  const waitForUnpause = useCallback(async () => {
    while (gameStateRef.current.isPaused) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, []);

  const getToken = useCallback(() => flowController.current.getToken(), []);
  const isTokenValid = useCallback((token: { isValid: () => boolean }) => token.isValid(), []);

  // 细粒度恢复逻辑在后面定义（等 runNightPhaseAction 等函数定义后）

  const scrollToBottom = useCallback(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, []);

  const queuePhaseExtras = useCallback((phase: Phase, extras: Record<string, unknown>) => {
    phaseExtrasRef.current = { phase, extras };
  }, []);

  const gameStore = useStore();
  const buildVotePhaseExtras = useCallback((token: ReturnType<typeof getToken>, options?: { isRevote?: boolean }) => {
    return {
      token,
      getGameState: () => gameStore.get(gameStateAtom),
      isRevote: options?.isRevote === true,
      humanPlayer,
      setGameState,
      setDialogue,
      setIsWaitingForAI,
      waitForUnpause,
      isTokenValid,
      onVoteComplete: async (state: GameState, result: { seat: number; count: number } | null) => {
        const nextToken = getToken();
        const fn = handleVoteCompleteRef.current;
        if (fn) {
          await fn(state, result, nextToken);
        }
      },
      onGameEnd: async (state: GameState, winner: "village" | "wolf") => {
        const fn = endGameRef.current;
        if (fn) {
          await fn(state, winner);
        }
      },
      runAISpeech: async (state: GameState, player: Player) => {
        const fn = runAISpeechRef.current;
        if (fn) {
          await fn(state, player);
        }
      },
    };
  }, [gameStore, getToken, humanPlayer, isTokenValid, setDialogue, setGameState, setIsWaitingForAI, waitForUnpause]);

  const buildNightPhaseExtras = useCallback((token: ReturnType<typeof getToken>) => {
    return {
      token,
      setGameState,
      setDialogue,
      setIsWaitingForAI,
      waitForUnpause,
      isTokenValid,
      onNightComplete: async (state: GameState) => {
        const nextToken = getToken();
        const resolveFn = resolveNightRef.current;
        const startDayFn = startDayPhaseInternalRef.current;
        if (!resolveFn || !startDayFn) return;
        await resolveFn(state, nextToken, async (resolvedState) => {
          await startDayFn(resolvedState, nextToken);
        });
      },
    };
  }, [getToken, isTokenValid, setDialogue, setGameState, setIsWaitingForAI, waitForUnpause]);

  const buildDaySpeechExtras = useCallback((token: ReturnType<typeof getToken>) => {
    return {
      token,
      setGameState,
      setDialogue,
      waitForUnpause,
      runAISpeech: async (state: GameState, player: Player) => {
        const fn = runAISpeechRef.current;
        if (fn) {
          await fn(state, player);
        }
      },
      onStartVote: async (state: GameState, nextToken: ReturnType<typeof getToken>) => {
        const fn = onStartVoteRef.current;
        if (fn) {
          await fn(state, nextToken);
        }
      },
      onBadgeSpeechEnd: async (state: GameState) => {
        const fn = onBadgeSpeechEndRef.current;
        if (fn) {
          await fn(state);
        }
      },
      onPkSpeechEnd: async (state: GameState) => {
        const fn = onPkSpeechEndRef.current;
        if (fn) {
          await fn(state);
        }
      },
      // 名稱必須與 DaySpeechPhase 的 runtime 介面一致：先前誤用 onWhiteWolfKingBoomCheck，
      // 導致 AI 狼的自爆檢查永遠走 fallback（等同 AI 不會自爆）。
      onSelfDestructCheck: async (state: GameState, wolf: Player): Promise<boolean> => {
        const fn = selfDestructCheckRef.current;
        if (fn) {
          return fn(state, wolf);
        }
        return false;
      },
      onKnightDuelCheck: async (state: GameState, knight: Player) => {
        const fn = knightDuelCheckRef.current;
        if (fn) {
          return fn(state, knight);
        }
        return { action: "none" as const };
      },
      onBadgeTransfer: async (state: GameState, sheriff: Player, afterTransfer: (s: GameState) => Promise<void>) => {
        const fn = badgeTransferRef.current;
        if (fn) {
          await fn(state, sheriff, afterTransfer);
        }
      },
      onHunterDeath: async (state: GameState, hunter: Player, diedAtNight: boolean) => {
        const fn = hunterDeathRef.current;
        if (fn) {
          await fn(state, hunter, diedAtNight);
        }
      },
      onPendingLastWords: async (state: GameState, continuation: (s: GameState) => Promise<void>) => {
        const fn = pendingLastWordsRef.current;
        if (fn) {
          await fn(state, continuation);
          return;
        }
        console.warn("[wolfcha] 遺言佇列處理器尚未就緒，直接續跑白天流程");
        await continuation(state);
      },
      onGameEnd: async (state: GameState, winner: "village" | "wolf") => {
        const fn = endGameRef.current;
        if (fn) {
          await fn(state, winner);
        }
      },
    };
  }, [setDialogue, setGameState, waitForUnpause]);

  const runDaySpeechAction = useCallback(
    async (
      state: GameState,
      token: ReturnType<typeof getToken>,
      action: "START_DAY_SPEECH_AFTER_BADGE" | "ADVANCE_SPEAKER",
      options?: { skipAnnouncements?: boolean }
    ) => {
      const phaseImpl = phaseManagerRef.current.getPhase("DAY_SPEECH");
      if (!phaseImpl) return;
      await phaseImpl.handleAction(
        { state, phase: state.phase, extras: buildDaySpeechExtras(token) },
        action === "START_DAY_SPEECH_AFTER_BADGE"
          ? { type: action, options }
          : { type: action }
      );
    },
    [buildDaySpeechExtras]
  );

  const runNightPhaseAction = useCallback(
    async (state: GameState, token: ReturnType<typeof getToken>, action: NightResumeCommand) => {
      const phaseImpl = phaseManagerRef.current.getPhase("NIGHT_START");
      if (!phaseImpl) return;
      await phaseImpl.handleAction(
        { state, phase: state.phase, extras: buildNightPhaseExtras(token) },
        { type: action }
      );
    },
    [buildNightPhaseExtras]
  );

  // ============================================
  // Phase lifecycle hook
  // ============================================
  useEffect(() => {
    const prevPhase = phaseLifecycleRef.current;
    const nextPhase = gameState.phase;
    if (prevPhase === nextPhase) return;

    const manager = phaseManagerRef.current;
    const prevImpl = manager.getPhase(prevPhase);
    const nextImpl = manager.getPhase(nextPhase);
    let cancelled = false;
    const queued = phaseExtrasRef.current;
    let extras = queued?.phase === nextPhase ? queued.extras : undefined;
    if (queued?.phase === nextPhase) {
      phaseExtrasRef.current = null;
    }
    if (!extras && nextPhase === "DAY_VOTE") {
      extras = buildVotePhaseExtras(getToken());
    }

    (async () => {
      if (prevImpl) {
        await prevImpl.onExit({ state: gameState, phase: prevPhase });
      }
      if (cancelled) return;
      if (nextImpl) {
        await nextImpl.onEnter({ state: gameState, phase: nextPhase, extras });
      }
    })();

    phaseLifecycleRef.current = nextPhase;
    return () => {
      cancelled = true;
    };
  }, [buildVotePhaseExtras, gameState, gameState.phase, getToken]);

  // ============================================
  // 每日总结生成
  // ============================================
  const maybeGenerateDailySummary = useCallback(
    async (state: GameState, options?: { force?: boolean }): Promise<GameState> => {
      if (state.day <= 0) return state;
      if (!options?.force && state.dailySummaries?.[state.day]?.length) return state;
      if (!state.messages || state.messages.length === 0) return state;
      try {
        const summary = await generateDailySummary(state);
        if (!summary || summary.bullets.length === 0) return state;
        return {
          ...state,
          dailySummaries: { ...state.dailySummaries, [state.day]: summary.bullets },
          dailySummaryVoteData: {
            ...(state.dailySummaryVoteData ?? {}),
            ...(summary.voteData ? { [state.day]: summary.voteData } : {}),
          },
          // 發言品質評估：次日發言時會提醒被記為消極的座位（見 DaySpeechPhase）
          speechAssessment: { day: state.day, passiveSeats: summary.passiveSeats ?? [] },
        };
      } catch {
        return state;
      }
    },
    []
  );

  const buildRawDayTranscript = useCallback((state: GameState): string => {
    const aliveIds = new Set(state.players.filter((p) => p.alive).map((p) => p.playerId));
    const dayStartIndex = (() => {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const m = state.messages[i];
        if (m.isSystem && m.content === t("system.dayBreak")) return i;
      }
      return 0;
    })();

    const voteStartIndex = (() => {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const m = state.messages[i];
        if (m.isSystem && m.content === t("system.voteStart")) return i;
      }
      return state.messages.length;
    })();

    const slice = state.messages.slice(
      dayStartIndex,
      voteStartIndex > dayStartIndex ? voteStartIndex : state.messages.length
    );

    return slice
      .filter((m) => !m.isSystem && aliveIds.has(m.playerId))
      .map((m) => `${m.playerName}: ${m.content}`)
      .join("\n");
  }, []);

  // ============================================
  // 特殊事件处理
  // ============================================
  // 缓存 access token 用于游戏会话保存
  // 注意：beforeunload 的 sendBeacon 不能 await，所以必须事先同步快取 token。
  const accessTokenRef = useRef<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      accessTokenRef.current = session?.access_token ?? null;
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      accessTokenRef.current = session?.access_token ?? null;
    });
    return () => subscription.unsubscribe();
  }, []);

  // 监听页面卸载，记录中断的游戏会话
  useEffect(() => {
    const handleBeforeUnload = () => {
      const summary = gameSessionTracker.getSummary();
      const accessToken = accessTokenRef.current;
      if (!summary || !accessToken) return;

      // 使用 sendBeacon 确保页面关闭时请求能发出
      // 由于 sendBeacon 无法等待异步操作，仍使用 API 路由
      const payload = JSON.stringify({
        action: "update",
        sessionId: summary.sessionId,
        accessToken,
        winner: null,
        completed: false,
        lifecycleStatus: "running",
        roundsPlayed: summary.roundsPlayed,
        durationSeconds: summary.durationSeconds,
      });
      navigator.sendBeacon?.(
        "/api/game-sessions",
        new Blob([payload], { type: "application/json" })
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const specialEvents = useSpecialEvents({
    setDialogue,
    setIsWaitingForAI,
    waitForUnpause,
    isTokenValid,
    prepareFinalState: (state) => maybeGenerateDailySummary(state, { force: true }),
  });

  const { endGame, resolveNight } = specialEvents;

  const endGameSafely = useCallback(
    async (state: GameState, winner: "village" | "wolf") => {
      clearSpeechQueue();
      clearDialogue();
      setIsWaitingForAI(false);
      setWaitingForNextRound(false);
      await endGame(state, winner);
    },
    [clearDialogue, clearSpeechQueue, endGame, setIsWaitingForAI, setWaitingForNextRound]
  );

  endGameRef.current = endGameSafely;
  resolveNightRef.current = resolveNight;

  // ============================================
  // 投票阶段（Phase 驱动）
  // ============================================
  const enterVotePhase = useCallback(
    async (state: GameState, token: ReturnType<typeof getToken>, options?: { isRevote?: boolean }) => {
      // 投票阶段不再触发总结 - 避免重复调用
      // 总结将在进入夜晚时统一生成，此时信息最完整（包含投票结果和遗言）
      
      queuePhaseExtras("DAY_VOTE", buildVotePhaseExtras(token, options));
      const clearedState: GameState = {
        ...state,
        votes: {},
        lastVoteReasons: state.voteReasons ? { ...state.voteReasons } : {},
        voteReasons: {},
      };
      const nextState = transitionPhase(clearedState, "DAY_VOTE");
      setGameState(nextState);
    },
    [buildVotePhaseExtras, queuePhaseExtras, setGameState, transitionPhase]
  );

  const resolveVotePhase = useCallback(
    async (state: GameState, token: ReturnType<typeof getToken>) => {
      const phaseImpl = phaseManagerRef.current.getPhase("DAY_VOTE");
      if (!phaseImpl) return;
      await phaseImpl.handleAction(
        { state, phase: "DAY_VOTE", extras: buildVotePhaseExtras(token) },
        { type: "RESOLVE_VOTES" }
      );
    },
    [buildVotePhaseExtras]
  );

  const resolveVotesSafely = useCallback(async (
    state: GameState,
    token: ReturnType<typeof getToken>
  ) => {
    if (isResolvingVotesRef.current) return;
    isResolvingVotesRef.current = true;
    try {
      await resolveVotePhase(state, token);
    } finally {
      isResolvingVotesRef.current = false;
    }
  }, [resolveVotePhase]);

  // ============================================
  // 白天阶段
  // ============================================
  const dayPhase = useDayPhase(humanPlayer, {
    setDialogue,
    setIsWaitingForAI,
    setWaitingForNextRound,
    isTokenValid,
    getToken,
    initSpeechQueue,
    initStreamingSpeechQueue,
    appendToSpeechQueue,
    finalizeSpeechQueue,
    setPrefetchedSpeech,
    consumePrefetchedSpeech,
    setAfterLastWords: (cb) => { afterLastWordsRef.current = cb; },
  });

  const { startLastWordsPhase, runAISpeech, isSpeechBlocked, takeSkillDecision } = dayPhase;
  runAISpeechRef.current = runAISpeech;

  // ============================================
  // 警长竞选阶段
  // ============================================
  const badgePhase = useBadgePhase({
    setDialogue,
    clearDialogue,
    setIsWaitingForAI,
    waitForUnpause,
    isTokenValid,
    onBadgeElectionComplete: async (state) => {
      const token = getToken();
      await runDaySpeechAction(state, token, "START_DAY_SPEECH_AFTER_BADGE");
    },
    onBadgeTransferComplete: async (state) => {
      const afterTransfer = afterBadgeTransferRef.current;
      afterBadgeTransferRef.current = null;
      if (afterTransfer) {
        await afterTransfer(state);
      }
    },
    runAISpeech: async (state, player) => {
      await runAISpeech(state, player);
    },
  });
  badgeTransferRef.current = badgePhase.handleBadgeTransfer;
  onStartVoteRef.current = enterVotePhase;
  onBadgeSpeechEndRef.current = async (state: GameState) => {
    await badgePhase.startBadgeElectionPhase(state);
  };
  onPkSpeechEndRef.current = async (state: GameState) => {
    const token = getToken();
    const nextState = {
      ...state,
      pkTargets: undefined,
      pkSource: undefined,
    };

    if (state.pkSource === "badge") {
      await badgePhase.startBadgeElectionPhase(nextState, { isRevote: true });
      return;
    }

    if (state.pkSource === "vote") {
      await enterVotePhase(state, token, { isRevote: true });
      return;
    }
  };

  /**
   * 執行自爆（AI 與真人共用）：狀態轉移交給純函式 `applySelfDestructToState`，
   * 這裡只負責公告、遺言、移交警徽與進入黑夜的流程。
   *
   * 標準流程（見 lib/rules/self-destruct-apply.ts 的說明）：
   * 第一隻狼在競選發言自爆 → 公布第一夜死訊 → 第一夜死者遺言 → 直接天黑（競選保留）；
   * 第二隻狼再自爆 → 警徽正式流失，且第二夜起的新死亡沒有遺言。
   */
  const applySelfDestruct = useCallback(async (
    state: GameState,
    boomer: Player,
    targetSeat: number | null,
    reason: string,
    originPhase: Phase,
    token: ReturnType<typeof getToken>
  ): Promise<void> => {
    const flags = getBoardRuleFlags(state.players.length);
    const applied = applySelfDestructToState({
      state,
      boomerSeat: boomer.seat,
      targetSeat,
      reason,
      originPhase,
      flags,
    });
    const systemMessages = getSystemMessages();
    let currentState = applied.state;

    // 公告：自爆（帶人／不帶人）
    if (applied.victimSeat !== undefined) {
      const victim = currentState.players.find((p) => p.seat === applied.victimSeat);
      const msg = t("system.selfDestructWithTarget", {
        seat: boomer.seat + 1,
        name: boomer.displayName,
        targetSeat: applied.victimSeat + 1,
        targetName: victim?.displayName ?? "",
      });
      currentState = addSystemMessage(currentState, msg);
      setDialogue(speakerHost, msg, false);
    } else {
      const msg = t("system.selfDestruct", { seat: boomer.seat + 1, name: boomer.displayName });
      currentState = addSystemMessage(currentState, msg);
      setDialogue(speakerHost, msg, false);
    }

    // 公告：警徽流失（競選階段吞徽）
    if (applied.outcome.swallowBadge) {
      const lostMsg = t("system.badgeLost");
      currentState = addSystemMessage(currentState, lostMsg);
      setDialogue(speakerHost, lostMsg, false);
    }

    if (applied.voidedTargetSeat !== undefined) {
      // 技能只能帶走場上存活的人：指定了已出局（含第一夜死者）的目標 → 技能無效
      console.warn(
        `[wolfcha] 自爆目標 ${applied.voidedTargetSeat + 1} 號已出局（或死訊未公布），自爆技能判定無效`
      );
    }

    // 公告：補公布尚未公布的夜間死訊（第一夜死者）；奶穿（同刀同毒）不重複發第二次
    for (const death of applied.newlyAnnouncedDeaths) {
      if (death.reason === "milk") continue;
      const victim = currentState.players.find((p) => p.seat === death.seat);
      currentState = addSystemMessage(
        currentState,
        systemMessages.playerKilled(death.seat + 1, victim?.displayName ?? "")
      );
    }
    setGameState(currentState);

    const continueAfterSettle = async (afterState: GameState): Promise<void> => {
      // 規則：自爆者自己沒有開槍窗口。這一條本來就由流程保證（自爆不接開槍判定），
      // 這裡明寫一次並在判定異常時出聲——以後若有人「順手」讓自爆者也開槍，至少不會靜默。
      if (
        canUseDeathShot({
          state: afterState,
          role: boomer.role,
          seat: boomer.seat,
          cause: "self_destruct",
        })
      ) {
        console.warn("[wolfcha] 自爆者依規則不得開槍（規則表異常）", boomer.role, boomer.seat + 1);
      }

      // 帶走獵人：獵人仍可開槍（與「槍打槍」共用同一條判定）
      const victim = applied.victimSeat !== undefined
        ? getChainedShooter(afterState, applied.victimSeat)
        : null;
      if (victim) {
        await delay(1200);
        const hunterFn = hunterDeathRef.current;
        if (hunterFn) await hunterFn(afterState, victim, false);
        return;
      }

      const winner = checkWinCondition(afterState);
      if (winner) {
        const endFn = endGameRef.current;
        if (endFn) await endFn(afterState, winner);
        return;
      }

      await delay(1200);
      const proceedFn = proceedToNightRef.current;
      if (proceedFn) await proceedFn(afterState, token);
    };

    const continueAfterBadge = async (afterBadgeState: GameState): Promise<void> => {
      // 第一夜死者的遺言不會被自爆吃掉：先發表完再進黑夜
      if ((afterBadgeState.pendingLastWordsSeats ?? []).length > 0) {
        const drain = drainPendingLastWordsRef.current;
        if (drain) {
          await drain(afterBadgeState, token, continueAfterSettle);
          return;
        }
        console.warn("[wolfcha] 遺言佇列處理器尚未就緒，自爆後直接續跑流程");
      }
      await continueAfterSettle(afterBadgeState);
    };

    // 警長（含自爆者本人）死亡時由他自己決定傳徽或撕徽，不自動撕毀
    if (applied.badgeTransferSeat !== null) {
      const sheriff = currentState.players.find((p) => p.seat === applied.badgeTransferSeat) ?? boomer;
      const transferFn = badgeTransferRef.current;
      if (transferFn) {
        await transferFn(currentState, sheriff, continueAfterBadge);
        return;
      }
      console.warn("[wolfcha] 警徽移交處理器尚未就緒，改為直接撕毀警徽");
      const fallbackMsg = t("system.badgeTorn", { seat: sheriff.seat + 1, name: sheriff.displayName });
      const fallbackState = addSystemMessage(
        { ...currentState, badge: { ...currentState.badge, holderSeat: null } },
        fallbackMsg
      );
      setDialogue(speakerHost, fallbackMsg, false);
      await continueAfterBadge(fallbackState);
      return;
    }

    await continueAfterBadge(currentState);
  }, [addSystemMessage, checkWinCondition, setDialogue, setGameState, speakerHost, t]);

  /**
   * 執行騎士翻牌決鬥（AI 與真人共用）：狀態轉移交給純函式 `applyKnightDuelToState`，
   * 這裡只負責公告、移交警徽與後續流程（成功＝直接天黑；失敗＝騎士出局、白天繼續）。
   */
  const applyKnightDuel = useCallback(async (
    state: GameState,
    duelist: Player,
    targetSeat: number,
    originPhase: Phase,
    token: ReturnType<typeof getToken>
  ): Promise<{ action: "none" | "night" | "continue" | "ended"; state: GameState }> => {
    const flags = getBoardRuleFlags(state.players.length);
    const applied = applyKnightDuelToState({
      state,
      duelistSeat: duelist.seat,
      targetSeat,
      originPhase,
      flags,
    });

    // 技能無效：目標已出局（含死訊未公布的第一夜死者）→ 不消耗技能、狀態原樣
    // （AI 路徑本來就在白天發言階段發動，階段不會被改動；真人路徑要切回來源階段，
    //  但同階段切換會重設 speechRoundStartMessageIndex，所以只有在階段不同時才切）
    if (applied.voidedTargetSeat !== undefined) {
      console.warn(`[wolfcha] 決鬥目標 ${applied.voidedTargetSeat + 1} 號已出局，翻牌決鬥判定無效`);
      const back = applied.state.phase === originPhase
        ? applied.state
        : transitionPhase(applied.state, originPhase);
      setGameState(back);
      return { action: "none", state: back };
    }

    const outcome = applied.outcome!;
    const target = state.players.find((p) => p.seat === targetSeat);
    const systemMessages = getSystemMessages();
    let currentState = applied.state;

    const revealMsg = t("system.knightDuelReveal", {
      seat: duelist.seat + 1,
      name: duelist.displayName,
      targetSeat: targetSeat + 1,
      targetName: target?.displayName ?? "",
    });
    currentState = addSystemMessage(currentState, revealMsg);
    setDialogue(speakerHost, revealMsg, false);

    const resultMsg = outcome.targetDies
      ? t("system.knightDuelHitWolf", { targetSeat: targetSeat + 1, targetName: target?.displayName ?? "" })
      : t("system.knightDuelMissed", {
        seat: duelist.seat + 1,
        name: duelist.displayName,
        targetSeat: targetSeat + 1,
        targetName: target?.displayName ?? "",
      });
    currentState = addSystemMessage(currentState, resultMsg);
    setDialogue(speakerHost, resultMsg, false);

    // 決鬥成功直接天黑時，補公布尚未公布的夜間死訊（第一夜死者）；奶穿不重複發第二次
    for (const death of applied.newlyAnnouncedDeaths) {
      if (death.reason === "milk") continue;
      const victim = currentState.players.find((p) => p.seat === death.seat);
      currentState = addSystemMessage(
        currentState,
        systemMessages.playerKilled(death.seat + 1, victim?.displayName ?? "")
      );
    }
    setGameState(currentState);

    const deadSeat = applied.deadSeat ?? duelist.seat;
    const deadPlayer = currentState.players.find((p) => p.seat === deadSeat) ?? duelist;

    /** 決鬥成功：遺言（若有）→ 勝負 → 進入黑夜 */
    const continueToNight = async (afterState: GameState): Promise<"night" | "ended"> => {
      const winner = checkWinCondition(afterState);
      if (winner) {
        await endGameRef.current?.(afterState, winner);
        return "ended";
      }
      await delay(1200);
      await proceedToNightRef.current?.(afterState, token);
      return "night";
    };

    /** 決鬥失敗（騎士以死謝罪）：白天流程照走，只檢查勝負 */
    const continueDay = async (afterState: GameState): Promise<"continue" | "ended"> => {
      const winner = checkWinCondition(afterState);
      if (winner) {
        await endGameRef.current?.(afterState, winner);
        return "ended";
      }
      setGameState(afterState);
      return "continue";
    };

    const finish = async (afterState: GameState): Promise<"none" | "night" | "continue" | "ended"> => {
      if (!outcome.goToNight) return await continueDay(afterState);
      // 第一夜死者的遺言不會被決鬥吃掉：先發表完再進黑夜
      if ((afterState.pendingLastWordsSeats ?? []).length > 0) {
        const drain = drainPendingLastWordsRef.current;
        if (drain) {
          let result: "night" | "ended" = "night";
          await drain(afterState, token, async (drainedState) => {
            result = await continueToNight(drainedState);
          });
          return result;
        }
        console.warn("[wolfcha] 遺言佇列處理器尚未就緒，決鬥後直接續跑流程");
      }
      return await continueToNight(afterState);
    };

    // 決鬥死者（可能是騎士自己）是警長時，由他自己選傳徽或撕徽
    if (applied.badgeTransferSeat !== null) {
      const transferFn = badgeTransferRef.current;
      if (transferFn) {
        let result: "none" | "night" | "continue" | "ended" = "none";
        await transferFn(currentState, deadPlayer, async (afterTransferState) => {
          result = await finish(afterTransferState);
        });
        return { action: result === "none" ? (outcome.goToNight ? "night" : "continue") : result, state: currentState };
      }
      console.warn("[wolfcha] 警徽移交處理器尚未就緒，改為直接撕毀警徽");
      const fallbackMsg = t("system.badgeTorn", { seat: deadPlayer.seat + 1, name: deadPlayer.displayName });
      currentState = addSystemMessage(
        { ...currentState, badge: { ...currentState.badge, holderSeat: null } },
        fallbackMsg
      );
      setDialogue(speakerHost, fallbackMsg, false);
    }

    const action = await finish(currentState);
    return { action, state: currentState };
  }, [addSystemMessage, checkWinCondition, setDialogue, setGameState, speakerHost, t, transitionPhase]);

  // AI 自爆決策（所有狼陣營角色，見 lib/rules/self-destruct.ts）
  selfDestructCheckRef.current = async (state: GameState, wolf: Player): Promise<boolean> => {
    if (!wolf.agentProfile?.modelRef) return false;
    if (hasAlreadyBoomed(state.roleAbilities.boomedSeats, wolf.seat)) return false;

    // 發言請求若已附帶技能決定就直接沿用（一次發送）；模型漏寫才退回獨立請求
    const fromSpeech = takeSkillDecision(state, wolf);
    const decision = await generateSelfDestructDecision(
      state,
      wolf,
      fromSpeech?.kind === "self_destruct" ? { fromSpeech } : undefined
    );
    if (!decision.boom) return false;

    const token = getToken();
    if (!isTokenValid(token)) return false;

    if (decision.targetSeat !== null) {
      const target = state.players.find((p) => p.seat === decision.targetSeat);
      if (!target?.alive) return false;
    }

    await applySelfDestruct(state, wolf, decision.targetSeat, decision.reason, state.phase, token);
    return true;
  };

  // AI 騎士翻牌決鬥（一場一次；白天發言階段）
  knightDuelCheckRef.current = async (
    state: GameState,
    knight: Player
  ): Promise<{ action: "none" | "night" | "continue" | "ended"; state?: GameState }> => {
    if (!knight.agentProfile?.modelRef) return { action: "none" };
    const flags = getBoardRuleFlags(state.players.length);
    if (!canDuel({
      phase: state.phase,
      role: knight.role,
      flags,
      duelUsedSeats: state.roleAbilities.duelUsedSeats,
      seat: knight.seat,
    })) {
      return { action: "none" };
    }

    // 發言請求若已附帶技能決定就直接沿用（一次發送）；模型漏寫才退回獨立請求
    const fromSpeech = takeSkillDecision(state, knight);
    const decision = await generateKnightDuelDecision(
      state,
      knight,
      fromSpeech?.kind === "knight_duel" ? { fromSpeech } : undefined
    );
    if (!decision.duel || decision.targetSeat === null) return { action: "none" };

    const token = getToken();
    if (!isTokenValid(token)) return { action: "none" };

    const pendingDeathSeats = getPendingDeathSeats(state);
    const target = state.players.find((p) => p.seat === decision.targetSeat);
    if (!target?.alive || pendingDeathSeats.includes(target.seat)) return { action: "none" };

    return await applyKnightDuel(state, knight, target.seat, state.phase, token);
  };

  // ============================================
  // 内部流程函数
  // ============================================
  /**
   * 派送 DaySpeech 階段的 action，並回傳「含 setGameState 之後」的最新狀態。
   *
   * 一般流程靠 setGameState 驅動即可，但自爆／續辦競選需要在同一個 async 流程裡
   * 立刻拿到公告後的狀態，因此這裡包一層捕捉。
   */
  const runDaySpeechActionCapturing = useCallback(async (
    state: GameState,
    token: ReturnType<typeof getToken>,
    action: "ANNOUNCE_NIGHT_RESULTS"
  ): Promise<GameState> => {
    const phaseImpl = phaseManagerRef.current.getPhase("DAY_SPEECH");
    if (!phaseImpl) return state;
    let latest = state;
    const extras = {
      ...buildDaySpeechExtras(token),
      setGameState: (value: GameState | ((prev: GameState) => GameState)) => {
        latest = typeof value === "function" ? value(latest) : value;
        setGameState(latest);
      },
    };
    await phaseImpl.handleAction({ state, phase: state.phase, extras }, { type: action });
    return latest;
  }, [buildDaySpeechExtras, setGameState]);

  const startDayPhaseInternal = useCallback(async (
    state: GameState,
    token: ReturnType<typeof getToken>,
    options?: { skipAnnouncements?: boolean }
  ) => {
    // 警徽競選被自爆中斷：天亮後先補公布死訊（含第一夜遺言），再繼續競選
    if (shouldResumeBadgeElection(state)) {
      const announced = await runDaySpeechActionCapturing(state, token, "ANNOUNCE_NIGHT_RESULTS");
      await badgePhase.resumeBadgeSpeechPhase(announced);
      return;
    }
    // 第一天：先进行警徽评选（警徽流失時直接跳過）
    if (state.day === 1 && state.badge.holderSeat === null && state.badge.lost !== true) {
      await badgePhase.startBadgeSignupPhase(state);
      return;
    }
    // 非第一天：直接进入讨论
    await runDaySpeechAction(state, token, "START_DAY_SPEECH_AFTER_BADGE", options);
  }, [badgePhase, runDaySpeechAction]);
  startDayPhaseInternalRef.current = startDayPhaseInternal;

  const proceedToNight = useCallback(async (state: GameState, token: ReturnType<typeof getToken>) => {
    if (!isTokenValid(token)) return;
    if (isAwaitingRoleRevealRef.current) return;

    // 天黑时同步游戏进度到数据库（incrementRound 内部会立即同步）
    gameSessionTracker.incrementRound().catch(() => {});

    const systemMessages = getSystemMessages();
    // 只帶入「剛結束那一晚」的守護目標；守衛空守時為 undefined，代表限制一併清除
    // （空守不算守護，因此之後仍可守任何人）。
    const lastGuardTarget = state.nightActions.guardTarget;
    // 同理：只帶入剛結束那一晚的夢游者（連攝判定用），其餘夜間行動一律清空。
    const lastDreamTarget = state.nightActions.dreamTarget;
    // 同理：只帶入剛結束那一晚的魅惑對象（殉情判定用）。
    const lastWolfBeautyTarget = state.nightActions.wolfBeautyTarget;
    // Preserve seerHistory across nights
    const seerHistory = state.nightActions.seerHistory;
    let nextState = {
      ...state,
      day: state.day + 1,
      nightActions: {
        ...(lastGuardTarget !== undefined ? { lastGuardTarget } : {}),
        ...(lastDreamTarget !== undefined ? { lastDreamTarget } : {}),
        ...(lastWolfBeautyTarget !== undefined ? { lastWolfBeautyTarget } : {}),
        ...(seerHistory ? { seerHistory } : {}),
      },
    };
    nextState = transitionPhase(nextState, "NIGHT_START");
    nextState = addSystemMessage(nextState, systemMessages.nightFall(nextState.day));
    setGameState(nextState);

    // Set dialogue before playing audio so message box appears immediately
    setDialogue(speakerHost, systemMessages.nightFall(nextState.day), false);

    // 播放旁白语音
    await playNarrator("nightFall");

    await delay(250);
    if (!isTokenValid(token)) return;

    setDialogue(speakerHost, systemMessages.summarizingDay, false);

    const summarized = await maybeGenerateDailySummary(state, { force: true });
    if (!isTokenValid(token)) return;

    const mergedState = carryDailySummary(nextState, summarized);

    await runNightPhaseAction(mergedState, token, "START_NIGHT");
  }, [isTokenValid, maybeGenerateDailySummary, runNightPhaseAction, setGameState, setDialogue, speakerHost, transitionPhase]);
  proceedToNightRef.current = proceedToNight;

  // ============================================
  // 从检查点恢复后的细粒度推进
  // 根据恢复的具体阶段决定如何继续流程
  // ============================================
  useEffect(() => {
    if (!restoredInProgressOnMountRef.current) return;
    if (hasResumedFromCheckpointRef.current) return;

    const s = gameStateRef.current;
    if (!isRestorableGameState(s) || !s.gameSessionId || s.players.length === 0) return;

    hasResumedFromCheckpointRef.current = true;
    const token = getToken();

    console.info(`[wolfcha] Resuming from checkpoint at phase ${s.phase}, day ${s.day}`);

    const uiText = getUiText();
    const speakerHint = t("speakers.hint");

    const didLastSpeechComeFrom = (state: GameState, playerId: string): boolean => {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const m = state.messages[i];
        if (m.isSystem) continue;
        if (m.day !== state.day) continue;
        if (m.phase !== state.phase) continue;
        return m.playerId === playerId;
      }
      return false;
    };

    // 根据恢复的阶段决定如何继续
    switch (s.phase) {
      case "NIGHT_START": {
        // 第一晚需要弹身份牌，后续夜晚直接开始夜晚流程
        if (s.day === 1) {
          // 第一晚：标记等待身份牌展示
          pendingStartStateRef.current = s;
          hasContinuedAfterRevealRef.current = false;
          isAwaitingRoleRevealRef.current = true;
        } else {
          // 后续夜晚：直接开始夜晚流程（不弹身份牌）
          hasContinuedAfterRevealRef.current = true;
          isAwaitingRoleRevealRef.current = false;
          void runNightPhaseAction(s, token, "START_NIGHT");
        }
        break;
      }

      case "NIGHT_GUARD_ACTION":
      case "NIGHT_MUTE_ACTION":
      case "NIGHT_DREAM_ACTION":
      case "NIGHT_WOLF_BEAUTY_ACTION":
      case "NIGHT_WOLF_ACTION":
      case "NIGHT_WITCH_ACTION": {
        // 夜間角色階段：該跳過、該等真人、該重跑，一律問 night-resume 的計畫表。
        // （過去這五個 case 各自寫死指令，wolf 那處還會沿鏈把已決定的禁言／攝夢再問一次 AI。）
        hasContinuedAfterRevealRef.current = true;
        isAwaitingRoleRevealRef.current = false;
        const plan = nightResumePlan(s, s.phase);
        if (plan.kind === "advance" || plan.kind === "replay") {
          void runNightPhaseAction(s, token, plan.command);
        }
        // plan.kind === "wait"：真人在等輸入
        break;
      }

      case "NIGHT_SEER_ACTION": {
        // 預言家階段：已完成（含沒有預言家）就顯示查驗結果並準備收尾；AI 未查驗則重跑
        hasContinuedAfterRevealRef.current = true;
        isAwaitingRoleRevealRef.current = false;
        const plan = nightResumePlan(s, s.phase);
        if (plan.kind === "advance" || plan.kind === "resolve") {
          const seerResult = s.nightActions.seerResult;
          if (seerResult) {
            const targetPlayer = s.players.find((p) => p.seat === seerResult.targetSeat);
            setDialogue(
              t("speakers.seerResult"),
              t("gameLogicMessages.seerResultText", {
                seat: seerResult.targetSeat + 1,
                name: targetPlayer?.displayName || "",
                result: seerResult.isWolf ? t("gameLogicMessages.werewolfResult") : t("gameLogicMessages.goodResult"),
              }),
              false
            );
          }
          nightContinueRef.current = async (state) => {
            await resolveNight(state, token, async (resolvedState) => {
              await startDayPhaseInternal(resolvedState, token);
            });
          };
        } else if (plan.kind === "replay") {
          void runNightPhaseAction(s, token, plan.command);
        }
        // plan.kind === "wait"：真人在等輸入
        break;
      }

      case "DAY_START": {
        // 白天开始：进入警徽/讨论流程
        hasContinuedAfterRevealRef.current = true;
        isAwaitingRoleRevealRef.current = false;
        void startDayPhaseInternal(s, token);
        break;
      }

      case "DAY_BADGE_SIGNUP": {
        // Day 1 警长竞选报名：恢复后继续让 AI 补齐报名，并在全员决定后衔接发言
        hasContinuedAfterRevealRef.current = true;
        isAwaitingRoleRevealRef.current = false;
        void badgePhase.resumeBadgeSignupPhase(s);
        break;
      }

      case "DAY_BADGE_SPEECH":
      case "DAY_PK_SPEECH":
      case "DAY_SPEECH": {
        // 发言阶段：恢复后尝试把 UI/AI 推进到一个可继续的状态
        hasContinuedAfterRevealRef.current = true;
        isAwaitingRoleRevealRef.current = false;

        // 若没有 speaker（异常/边界），尝试推进到下一个 speaker
        if (s.currentSpeakerSeat === null) {
          void runDaySpeechAction(s, token, "ADVANCE_SPEAKER");
          break;
        }

        const currentSpeaker = s.players.find((p) => p.seat === s.currentSpeakerSeat) || null;
        if (!currentSpeaker || !currentSpeaker.alive) {
          void runDaySpeechAction(s, token, "ADVANCE_SPEAKER");
          break;
        }

        if (currentSpeaker.isHuman) {
          setDialogue(speakerHint, uiText.yourTurn, false);
          break;
        }

        // AI speaker：如果刷新前它已经说完（最后一条本 phase 消息来自它），则恢复为"等待下一轮"状态
        // 否则说明它还没开始/没说完，重新触发一次发言生成
        const aiAlreadySpoke = didLastSpeechComeFrom(s, currentSpeaker.playerId);
        if (aiAlreadySpoke) {
          setWaitingForNextRound(true);
          break;
        }

        void runAISpeech(s, currentSpeaker);
        break;
      }

      case "DAY_LAST_WORDS": {
        // 遗言阶段：发言者应该是已死亡的玩家
        hasContinuedAfterRevealRef.current = true;
        isAwaitingRoleRevealRef.current = false;

        // 若没有 speaker，说明状态异常，跳过遗言直接进入下一阶段
        if (s.currentSpeakerSeat === null) {
          console.warn('[wolfcha] DAY_LAST_WORDS: currentSpeakerSeat is null, skipping last words');
          void proceedToNight(s, token);
          break;
        }

        const lastWordsSpeaker = s.players.find((p) => p.seat === s.currentSpeakerSeat) || null;
        
        // 遗言发言者必须存在（无论生死）
        if (!lastWordsSpeaker) {
          console.warn('[wolfcha] DAY_LAST_WORDS: speaker not found, skipping last words');
          void proceedToNight(s, token);
          break;
        }

        // 遗言阶段的发言者应该是已死亡的玩家，如果还活着说明状态异常
        if (lastWordsSpeaker.alive) {
          console.warn('[wolfcha] DAY_LAST_WORDS: speaker is still alive, this should not happen');
          void proceedToNight(s, token);
          break;
        }

        if (lastWordsSpeaker.isHuman) {
          // 人类玩家：始终恢复到可以继续发言的状态，让玩家决定是否继续或结束
          setDialogue(speakerHint, uiText.yourTurn, false);
          break;
        }

        // AI 遗言发言者：由于无法可靠判断是否已完整说完（可能只说了一部分就刷新了）
        // 因此不检查历史消息，直接重新触发 AI 发言
        // AI 会根据历史消息自行判断是否需要继续说，如果已经说过遗言，AI 会生成简短的补充或确认
        console.info('[wolfcha] DAY_LAST_WORDS: Restoring AI last words, re-triggering speech');
        void runAISpeech(s, lastWordsSpeaker);
        break;
      }

      case "DAY_BADGE_ELECTION": {
        // 如果已经全员投票，恢复后直接触发一次结算（否则维持现状）
        hasContinuedAfterRevealRef.current = true;
        isAwaitingRoleRevealRef.current = false;
        void badgePhase.startBadgeElectionPhase(s, { isResume: true });
        break;
      }

      case "DAY_VOTE": {
        hasContinuedAfterRevealRef.current = true;
        isAwaitingRoleRevealRef.current = false;
        void phaseManagerRef.current.getPhase("DAY_VOTE")?.handleAction(
          { state: s, phase: "DAY_VOTE", extras: buildVotePhaseExtras(token) },
          { type: "RESUME_VOTES" },
        );
        break;
      }

      default: {
        // 其他阶段暂不自动推进
        hasContinuedAfterRevealRef.current = true;
        isAwaitingRoleRevealRef.current = false;
        break;
      }
    }
  }, [badgePhase, buildVotePhaseExtras, getToken, proceedToNight, runAISpeech, runDaySpeechAction, runNightPhaseAction, resolveNight, resolveVotesSafely, setDialogue, setWaitingForNextRound, startDayPhaseInternal, t]);

  const transferBadgeAfterHunterShot = badgePhase.handleBadgeTransfer;
  const continueAfterHunterShot = useCallback(async (
    state: GameState,
    continuation: (nextState: GameState) => Promise<void>
  ) => {
    await continueAfterHunterShotWithBadgeTransfer(
      state,
      transferBadgeAfterHunterShot,
      continuation
    );
  }, [transferBadgeAfterHunterShot]);

  hunterDeathRef.current = async (state: GameState, hunter: Player, diedAtNight: boolean) => {
    const token = getToken();
    await specialEvents.handleHunterDeath(state, hunter, diedAtNight, token, async (afterState) => {
      await continueAfterHunterShot(afterState, async (nextState) => {
        const startDayFn = startDayPhaseInternalRef.current;
        const proceedFn = proceedToNightRef.current;
        if (!startDayFn || !proceedFn) return;
        if (diedAtNight) {
          await startDayFn(nextState, token, { skipAnnouncements: true });
        } else {
          await proceedFn(nextState, token);
        }
      });
    });
  };

  // 第一夜死者的遺言：死亡公告後依序發表（見 GameState.pendingLastWordsSeats）。
  // 人類遺言由 UI 完成後續跑（startLastWordsPhase 會保存 callback），因此這裡用 ref 遞迴串接。
  drainPendingLastWordsRef.current = async (state, token, continuation) => {
    const { seat, rest } = takeNextLastWordsSeat(state.pendingLastWordsSeats);
    if (seat === null) {
      await continuation(state);
      return;
    }
    const cleared: GameState = { ...state, pendingLastWordsSeats: rest };
    await startLastWordsPhase(
      cleared,
      seat,
      async (after) => {
        const drain = drainPendingLastWordsRef.current;
        if (!drain) {
          console.warn("[wolfcha] 遺言佇列處理器遺失，直接續跑白天流程");
          await continuation(after);
          return;
        }
        await drain(after, token, continuation);
      },
      token
    );
  };

  pendingLastWordsRef.current = async (state, continuation) => {
    const drain = drainPendingLastWordsRef.current;
    if (!drain) {
      console.warn("[wolfcha] 遺言佇列處理器尚未就緒，直接續跑白天流程");
      await continuation(state);
      return;
    }
    await drain(state, getToken(), continuation);
  };

  const handleVoteComplete = useCallback(async (
    state: GameState,
    result: { seat: number; count: number } | null,
    token: ReturnType<typeof getToken>
  ) => {
    if (result) {
      const executedPlayer = state.players.find((p) => p.seat === result.seat);
      const isSheriff = state.badge.holderSeat === result.seat;

      await delay(DELAY_CONFIG.MEDIUM);
      if (!isTokenValid(token)) return;

      // 被放逐的是狼美人時，被魅惑者一并殉情（騎士決鬥不在此路徑，見 rules/charm）。
      // 殉情者不進遺言佇列：官方對「連帶出局」的遺言沒有明文，本作比照一般連帶死亡只公告不發言。
      const exileRevenge = applyCharmRevenge(state, result.seat, "exile");
      if (exileRevenge.victimSeat !== null) {
        state = addSystemMessage(
          exileRevenge.state,
          getSystemMessages().charmRevenge(
            exileRevenge.victimSeat + 1,
            state.players.find((p) => p.seat === exileRevenge.victimSeat)?.displayName ?? ""
          )
        );
      }
      await startLastWordsPhase(state, result.seat, async (s) => {
        // 警长死亡，先移交警徽
        if (isSheriff && executedPlayer) {
          afterBadgeTransferRef.current = async (afterTransferState) => {
            if (
              executedPlayer &&
              afterTransferState.roleAbilities.hunterCanShoot &&
              canUseDeathShot({
                state: afterTransferState,
                role: executedPlayer.role,
                seat: executedPlayer.seat,
                cause: "exile",
              })
            ) {
              await specialEvents.handleHunterDeath(afterTransferState, executedPlayer, false, token, async (afterHunterState) => {
                await continueAfterHunterShot(afterHunterState, async (nextState) => {
                  await proceedToNight(nextState, token);
                });
              });
              return;
            }

            const winnerAfterTransfer = checkWinCondition(afterTransferState);
            if (winnerAfterTransfer) {
              await endGameSafely(afterTransferState, winnerAfterTransfer);
              return;
            }

            await proceedToNight(afterTransferState, token);
          };
          await badgePhase.handleBadgeTransfer(s, executedPlayer, async (afterTransferState) => {
            const cb = afterBadgeTransferRef.current;
            afterBadgeTransferRef.current = null;
            if (cb) await cb(afterTransferState);
          });
          return;
        }

        // 死亡技能（獵人槍／狼王槍）：以 canUseDeathShot 統一判定，避免寫死 role === "Hunter" 漏掉狼王
        if (
          executedPlayer &&
          s.roleAbilities.hunterCanShoot &&
          canUseDeathShot({ state: s, role: executedPlayer.role, seat: executedPlayer.seat, cause: "exile" })
        ) {
          await specialEvents.handleHunterDeath(s, executedPlayer, false, token, async (afterHunterState) => {
            await continueAfterHunterShot(afterHunterState, async (nextState) => {
              await proceedToNight(nextState, token);
            });
          });
          return;
        }

        // 检查胜负
        const winnerAfterLastWords = checkWinCondition(s);
        if (winnerAfterLastWords) {
          await endGameSafely(s, winnerAfterLastWords);
          return;
        }

        await proceedToNight(s, token);
      }, token);
      return;
    }

    // 平票，等待一段时间让用户看到结果，然后进入夜晚
    await delay(DELAY_CONFIG.MEDIUM);
    if (!isTokenValid(token)) return;
    await proceedToNight(state, token);
  }, [isTokenValid, startLastWordsPhase, badgePhase, specialEvents, endGameSafely, proceedToNight, continueAfterHunterShot]);
  handleVoteCompleteRef.current = handleVoteComplete;

  

  // ============================================
  // 投票完成监控（安全保障机制）
  // ============================================
  const isResolvingVotesRef = useRef(false);
  useEffect(() => {
    if (gameState.phase !== "DAY_VOTE") return;
    if (isResolvingVotesRef.current) return;
    if (isWaitingForAI) return;

    // Revealed Idiot cannot vote, exclude from allVoted check
    const revealedIdiotId = gameState.roleAbilities.idiotRevealed
      ? gameState.players.find((p) => p.role === "Idiot" && p.alive)?.playerId
      : undefined;
    // PK投票时，参与PK的人不投票，需要排除
    const pkTargets =
      gameState.pkSource === "vote" && Array.isArray(gameState.pkTargets) ? gameState.pkTargets : [];
    const voterIds = gameState.players
      .filter((p) => p.alive && p.playerId !== revealedIdiotId && !pkTargets.includes(p.seat))
      .map((p) => p.playerId);
    const allVoted = voterIds.every((id) => typeof gameState.votes[id] === "number");
    
    if (allVoted && voterIds.length > 0) {
      console.log("[wolfcha] useEffect: All votes detected, triggering resolveVotePhase as safety net");
      const token = getToken();
      void resolveVotesSafely(gameState, token);
    }
  }, [gameState.phase, gameState.votes, gameState.players, getToken, resolveVotesSafely, isWaitingForAI]);

  // ============================================
  // 同步 gameStateRef
  // ============================================
  useEffect(() => {
    gameStateRef.current = gameState;

    // Dev Mode 容错
    const prevDevMutationId = prevDevMutationIdRef.current;
    const devMutationId = gameState.devMutationId;
    const devMutated =
      typeof devMutationId === "number" &&
      (typeof prevDevMutationId !== "number" || devMutationId !== prevDevMutationId);

    const phaseChanged = prevPhaseRef.current !== gameState.phase;
    const dayChanged = prevDayRef.current !== gameState.day;
    const hardReset = phaseChanged || dayChanged || !!gameState.devPhaseJump;

    if (devMutated) {
      flowController.current.interrupt();
      pendingStartStateRef.current = null;
      hasContinuedAfterRevealRef.current = false;

      if (waitingForNextRound) setWaitingForNextRound(false);
      if (isWaitingForAI) setIsWaitingForAI(false);

      if (hardReset) {
        afterLastWordsRef.current = null;
        nightContinueRef.current = null;
        clearSpeechQueue();
        if (currentDialogue) clearDialogue();
        if (inputText) setInputText("");
      } else {
        // Dev 动作编辑：可能中断了 runNightPhase 的后台推进。若关键数据已被用户补齐，则自动继续夜晚流程。
        // 注意：只在"软编辑"时尝试恢复，避免和显式跳转冲突。
        const s = gameState;
        (async () => {
          const token = flowController.current.getToken();

          // Night phases: if the required action is already set (possibly via Dev actions tab), continue.
          // 「完成了嗎」與「該下哪個指令」都問 night-resume 的計畫表，不在這裡重寫。
          if (isNightActionPhase(s.phase)) {
            const plan = nightResumePlan(s, s.phase);
            if (plan.kind === "advance" || plan.kind === "replay") {
              await runNightPhaseAction(s, token, plan.command);
            } else if (plan.kind === "resolve") {
              // 預言家那一步：Dev 補上查驗結果後，收尾仍由使用者按確認觸發
              nightContinueRef.current = async (state) => {
                await resolveNight(state, token, async (resolvedState) => {
                  await startDayPhaseInternal(resolvedState, token);
                });
              };
            }
            return;
          }

          if (s.phase === "DAY_VOTE") {
            const revIdiotId = s.roleAbilities.idiotRevealed
              ? s.players.find((p) => p.role === "Idiot" && p.alive)?.playerId
              : undefined;
            const aliveIds = s.players.filter((p) => p.alive && p.playerId !== revIdiotId).map((p) => p.playerId);
            const allVoted = aliveIds.every((id) => typeof s.votes[id] === "number");
            if (allVoted) {
              await resolveVotePhase(s, token);
            }
          }
        })();
      }
    }

    prevPhaseRef.current = gameState.phase;
    prevDayRef.current = gameState.day;
    prevDevMutationIdRef.current = devMutationId;
  }, [gameState, currentDialogue, inputText, isWaitingForAI, waitingForNextRound, clearDialogue, clearSpeechQueue, setIsWaitingForAI, setWaitingForNextRound, runNightPhaseAction, resolveNight, startDayPhaseInternal, resolveVotePhase]);

  // ============================================
  // Dev Phase Jump 处理
  // ============================================
  useEffect(() => {
    const payload = gameState.devPhaseJump;
    if (!payload) return;
    if (prevDevPhaseJumpTsRef.current === payload.ts) return;
    prevDevPhaseJumpTsRef.current = payload.ts;

    flowController.current.interrupt();
    const token = getToken();
    const to = payload.to;
    const s = gameStateRef.current;

    const clearMark = () => {
      setGameState((prev) => {
        if (!prev.devPhaseJump || prev.devPhaseJump.ts !== payload.ts) return prev;
        return { ...prev, devPhaseJump: undefined };
      });
    };

    (async () => {
      try {
        if (to === "NIGHT_START" || isNightActionPhase(to)) {
          if (isAwaitingRoleRevealRef.current) return;
          // 跳到某個夜間階段：用「重跑這一步」的指令，讓續跑鏈正好停在該階段。
          // （舊寫法把這張表手寫在這裡，而且漏了禁言／攝夢兩個目標，跳到那兩個階段時夜晚會卡住。）
          await runNightPhaseAction(s, token, to === "NIGHT_START" ? "START_NIGHT" : replayCommandFor(to));
          return;
        }
        if (to === "NIGHT_RESOLVE") {
          await resolveNight(s, token, async (resolvedState) => {
            await startDayPhaseInternal(resolvedState, token);
          });
          return;
        }
        if (to === "DAY_START" || to === "DAY_SPEECH") {
          await startDayPhaseInternal(s, token);
          return;
        }
        if (to === "DAY_VOTE") {
          await enterVotePhase(s, token);
          return;
        }
        if (to === "DAY_LAST_WORDS") {
          const seat = s.currentSpeakerSeat ?? s.players.find((p) => !p.alive)?.seat ?? 0;
          await startLastWordsPhase(s, seat, async (after) => {
            await proceedToNight(after, token);
          }, token);
          return;
        }
        if (to === "DAY_RESOLVE") {
          await resolveVotePhase(s, token);
          return;
        }

        // 走到這裡代表這個目標階段還沒有跳轉實作（下拉選單列的是「所有階段」，不是「已支援的階段」）。
        // 大聲說出來，不要讓開發者以為按了沒反應是遊戲卡住。
        console.warn(`[wolfcha] Dev 跳轉尚未支援目標階段 ${to}，這次跳轉不會有任何動作`);
      } finally {
        clearMark();
      }
    })();
  }, [gameState.devPhaseJump, getToken, runNightPhaseAction, resolveNight, startDayPhaseInternal, enterVotePhase, startLastWordsPhase, resolveVotePhase, proceedToNight, setGameState]);

  /** 开始游戏 */
  const startGame = useCallback(async (options?: Partial<StartGameOptions>) => {
    const {
      fixedRoles,
      fixedRolesSeatOrdered = false,
      devPreset,
      difficulty = "normal",
      playerCount = 10,
      gameSessionId,
      isGenshinMode = false,
      isSpectatorMode = false,
      isAcquaintanceGame = false,
      rosterPoolId,
      preferredRole,
    } = options ?? {};

    const totalPlayers = playerCount;

    clearCancellableTimeouts();
    const characterAnimationGeneration = cancellableTimeoutGenerationRef.current;
    resetDialogueState();
    setInputText("");
    setShowTable(false);
    pendingStartStateRef.current = null;
    hasContinuedAfterRevealRef.current = false;
    isAwaitingRoleRevealRef.current = false;
    badgeSpeechEndRef.current = null;
    if (showTableTimeoutRef.current !== null) {
      window.clearTimeout(showTableTimeoutRef.current);
      showTableTimeoutRef.current = null;
    }

    setIsLoading(true);
    let sessionId: string | null = null;
    try {
      // 初始化游戏统计追踪器
      const statsConfig = {
        playerCount,
        difficulty,
        usedCustomKey: getModelSource() !== "project",
      };
      gameStatsTracker.start(statsConfig);

      sessionId = await gameSessionTracker.start({
        playerCount,
        difficulty,
        usedCustomKey: getModelSource() !== "project",
        modelUsed: getGeneratorModel(),
        sessionId: gameSessionId,
      }).catch((err) => {
        console.error("[game-session] Failed to create:", err);
        return null;
      });
      if (sessionId) {
        gameStatsTracker.setSessionId(sessionId);
      }
      // [LOCAL DEV PATCH] 這一局的 AI 紀錄寫進獨立檔案
      aiLogger.startGameLog(sessionId);

      const systemMessages = getSystemMessages();
      // 角色池會綁定情境，抽用成功時改寫成池的情境（見下方 pooledCharacters）。
      const scenario = isGenshinMode ? undefined : getRandomScenario();
      const makeId = () => generateUUID();

      // 普通模式每局只随机一次人类座位；之后 UI、阶段推进和 Prompt 都读取同一个 seat。
      // 观战模式没有人类玩家。
      const humanSeat = isSpectatorMode ? -1 : getRandomHumanSeat(totalPlayers);

      const aiSeats = Array.from({ length: totalPlayers }, (_, seat) => seat).filter(
        (seat) => seat !== humanSeat
      );
      const aiSeatOrder = (() => {
        const shuffled = [...aiSeats];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      })();

      const aiModelRefs = sampleModelRefs(isSpectatorMode ? totalPlayers : totalPlayers - 1);
      const initialPlayers: Player[] = Array.from({ length: totalPlayers }).map((_, seat) => {
        const isHuman = !isSpectatorMode && seat === humanSeat;
        const playerId = makeId();
        return {
          playerId,
          seat,
          displayName: isHuman ? (humanName || "你") : "",
          avatarSeed: playerId,
          alive: true,
          role: "Villager" as Role,
          alignment: "village",
          isHuman,
        };
      });

      const seedPlayerIds = initialPlayers.map((p) => p.playerId);

      // 熟人局才需要历史交手统计；取不到（首次游玩／接口失败）就静默降级为无记录。
      // 只取一次：LOBBY 与实际开局（NIGHT_START）必须帶同一份，否则熟人局资讯会掉。
      const characterStats = isAcquaintanceGame ? await fetchCharacterStats() : undefined;

      setGameState(
        buildGameStartState({
          gameSessionId: sessionId,
          scenario,
          players: initialPlayers,
          phase: "LOBBY",
          day: 0,
          difficulty,
          isGenshinMode,
          isSpectatorMode,
          isAcquaintanceGame,
          characterStats,
        })
      );

      setGameStarted(true);
      setShowTable(true);

      let characters: GeneratedCharacter[] = [];
      let genshinModelRefs: ModelRef[] | undefined = undefined;
      const numAiPlayers = isSpectatorMode ? totalPlayers : totalPlayers - 1;

      if (isGenshinMode) {
        genshinModelRefs = buildGenshinModelRefs(numAiPlayers);
        characters = await generateGenshinModeCharacters(numAiPlayers, genshinModelRefs);
        
        // 为 Genshin 模式添加逐个出现的动画效果
        characters.forEach((character, index) => {
          const seat = aiSeatOrder[index] ?? aiSeats[index] ?? index;
          scheduleCancellableTimeout(characterAnimationGeneration, () => {
            setGameState((prev) => {
              const nextPlayers = prev.players.map((pl) => {
                if (pl.seat !== seat) return pl;
                if (pl.isHuman) return pl;
                return {
                  ...pl,
                  displayName: character.displayName,
                  avatarSeed: pl.avatarSeed ?? pl.playerId,
                  agentProfile: {
                    modelRef: genshinModelRefs![index] ?? getRandomModelRef(),
                    persona: character.persona,
                    playerMind: character.playerMind,
                  },
                };
              });
              return { ...prev, players: nextPlayers };
            });
          }, 200 + index * 180); // 逐个出现，每个间隔 180ms
        });
      } else {
        // 一般模式：從金庸角色池隨機抽人，開局不 AI 生成角色。
        characters = sampleRosterCharacters(numAiPlayers, rosterPoolId);
      }

      if (sessionId) {
        await gameSessionTracker.markRunning().catch((error) => {
          console.error("[game-session] Failed to mark session running:", error);
        });
      }

      const players = setupPlayers(
        characters,
        humanSeat,
        humanName || "你",
        totalPlayers,
        fixedRoles,
        seedPlayerIds,
        isGenshinMode ? genshinModelRefs : aiModelRefs,
        aiSeatOrder,
        preferredRole,
        fixedRolesSeatOrdered
      );

      let newState: GameState = buildGameStartState({
        gameSessionId: sessionId,
        scenario,
        players,
        // 版型組成寫進狀態：公開角色配置（prompt）、賽後分析與 UI 都讀這份
        fixedRoles: fixedRoles && fixedRoles.length === totalPlayers ? [...fixedRoles] : undefined,
        phase: "NIGHT_START",
        day: 1,
        difficulty,
        isGenshinMode,
        isSpectatorMode,
        isAcquaintanceGame,
        characterStats,
      });

      newState = addSystemMessage(newState, systemMessages.gameStart);
      newState = addSystemMessage(newState, systemMessages.nightFall(1));

      // Dev 预设处理
      if (devPreset === "MILK_POISON_TEST") {
        const newPlayers = newState.players.map((p, i) => {
          if (i === 0) return { ...p, role: "Guard" as Role, alignment: "village" as const, alive: true };
          if (i === 1) return { ...p, role: "Witch" as Role, alignment: "village" as const, alive: true };
          if (i === 2) return { ...p, role: "Werewolf" as Role, alignment: "wolf" as const, alive: true };
          if (i === 3) return { ...p, role: "Villager" as Role, alignment: "village" as const, alive: true };
          return { ...p, alive: true };
        });
        newState = {
          ...newState,
          players: newPlayers,
          phase: "NIGHT_WITCH_ACTION",
          day: 1,
          devMutationId: (newState.devMutationId ?? 0) + 1,
          devPhaseJump: { to: "NIGHT_WITCH_ACTION", ts: Date.now() },
          nightActions: {
            ...newState.nightActions,
            guardTarget: 3,
            wolfTarget: 3,
          },
          roleAbilities: {
            ...newState.roleAbilities,
            witchHealUsed: false,
            witchPoisonUsed: false,
            hunterCanShoot: true,
          },
        };
      } else if (devPreset === "LAST_WORDS_TEST") {
        const alivePlayers = newState.players.filter((p) => p.alive);
        const votes: Record<string, number> = {};
        alivePlayers.forEach((p) => {
          votes[p.playerId] = 0;
        });
        newState = {
          ...newState,
          phase: "DAY_VOTE",
          day: 1,
          devMutationId: (newState.devMutationId ?? 0) + 1,
          devPhaseJump: { to: "DAY_VOTE", ts: Date.now() },
          votes,
        };
      }

      setGameState(newState);

      // In spectator mode, skip role reveal and start the game immediately
      if (isSpectatorMode) {
        pendingStartStateRef.current = null;
        hasContinuedAfterRevealRef.current = true;
        isAwaitingRoleRevealRef.current = false;
        
        // Start the night phase directly after state is set
        scheduleCancellableTimeout(characterAnimationGeneration, async () => {
          const token = getToken();
          if (isTokenValid(token)) {
            const systemMessages = getSystemMessages();
            setDialogue(speakerHost, systemMessages.nightFall(newState.day), false);
            await playNarrator("nightFall");
            await runNightPhaseAction(newState, token, "START_NIGHT");
          }
        }, 0);
      } else {
        pendingStartStateRef.current = devPreset ? null : newState;
        hasContinuedAfterRevealRef.current = false;
        isAwaitingRoleRevealRef.current = true;
      }
    } catch (error) {
      clearCancellableTimeouts();
      if (sessionId) {
        await gameSessionTracker.markFailed().catch((statusError) => {
          console.error("[game-session] Failed to mark session failed:", statusError);
        });
      }
      const msg = String(error);
      if (isQuotaExhaustedMessage(msg)) {
        toast.error(t("gameLogicMessages.quotaExhausted.title"), {
          description: t("gameLogicMessages.quotaExhausted.description"),
          duration: 10000,
        });
      } else if (msg.includes("ZenMux API error: 401") || msg.includes(" 401")) {
        toast.error(t("gameLogicMessages.zenmux401"));
      } else {
        toast.error(t("gameLogicMessages.requestFailed"), { description: msg });
      }
      setDialogue(t("speakers.system"), t("gameLogicMessages.errorOccurred", { error: String(error) }), false);
      setGameStarted(false);
      setShowTable(false);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [clearCancellableTimeouts, getToken, humanName, isTokenValid, resetDialogueState, runNightPhaseAction, scheduleCancellableTimeout, setDialogue, setGameStarted, setGameState, setInputText, setIsLoading, setShowTable, speakerHost, t]);

  /** 角色揭示后继续 */
  const continueAfterRoleReveal = useCallback(async () => {
    const token = getToken();
    const pending = pendingStartStateRef.current ?? gameStateRef.current;
    if (!pending) return;
    // Only meaningful at NIGHT_START (role reveal screen)
    if (pending.phase !== "NIGHT_START") return;
    if (hasContinuedAfterRevealRef.current) return;

    hasContinuedAfterRevealRef.current = true;
    pendingStartStateRef.current = null;
    isAwaitingRoleRevealRef.current = false;

    if (!isTokenValid(token)) return;

    const systemMessages = getSystemMessages();

    // Set dialogue before playing audio so message box appears immediately
    setDialogue(speakerHost, systemMessages.nightFall(pending.day), false);
    
    // 播放第一晚的"天黑请闭眼"旁白
    await playNarrator("nightFall");
    
    await runNightPhaseAction(pending, token, "START_NIGHT");
  }, [getToken, isTokenValid, runNightPhaseAction, setDialogue, speakerHost]);

  /** 重新开始 */
  const restartGame = useCallback(() => {
    flowController.current.interrupt();
    void gameSessionTracker.abandon().catch((error) => {
      console.error("[game-session] Failed to abandon session:", error);
    });
    gameSessionTracker.reset();
    clearCancellableTimeouts();

    // Clear persisted game state from localStorage
    clearPersistedGameState();
    
    setGameState(createInitialGameState());
    resetDialogueState();
    setInputText("");
    setShowTable(false);
    setGameStarted(false);

    pendingStartStateRef.current = null;
    hasContinuedAfterRevealRef.current = false;
    isAwaitingRoleRevealRef.current = false;
    badgeSpeechEndRef.current = null;
    if (showTableTimeoutRef.current !== null) {
      window.clearTimeout(showTableTimeoutRef.current);
      showTableTimeoutRef.current = null;
    }
  }, [clearCancellableTimeouts, resetDialogueState, setGameState]);

  /** 人类发言 */
  const handleHumanSpeech = useCallback(async () => {
    if (!inputText.trim() || !humanPlayer) return;

    const s = gameStateRef.current;
    const isMyTurn = (s.phase === "DAY_SPEECH" || s.phase === "DAY_LAST_WORDS" || s.phase === "DAY_BADGE_SPEECH" || s.phase === "DAY_PK_SPEECH") && s.currentSpeakerSeat === humanPlayer.seat;
    if (!isMyTurn) return;

    const speech = inputText.trim();
    setInputText("");

    const currentState = addPlayerMessage(gameStateRef.current, humanPlayer.playerId, speech);
    setGameState(currentState);
  }, [inputText, humanPlayer, setGameState]);

  /** 人类结束发言 */
  const handleFinishSpeaking = useCallback(async () => {
    if (!humanPlayer) return;

    if (gameStateRef.current.phase === "DAY_LAST_WORDS") {
      const next = afterLastWordsRef.current;
      afterLastWordsRef.current = null;
      if (next) {
        await delay(500);
        await next(gameStateRef.current);
      }
      return;
    }

    const startState = gameStateRef.current;
    const startGameId = startState.gameId;
    const startPhase = startState.phase;

    await delay(300);

    const liveState = gameStateRef.current;
    if (liveState.gameId !== startGameId) return;
    if (liveState.phase !== startPhase) return;

    const token = getToken();
    await runDaySpeechAction(liveState, token, "ADVANCE_SPEAKER");
  }, [humanPlayer, getToken, runDaySpeechAction]);

  /** 下一轮按钮 */
  const handleNextRound = useCallback(async () => {
    if (isSpeechBlocked()) return;
    const startState = gameStateRef.current;
    const startGameId = startState.gameId;
    const startPhase = startState.phase;

    if (startPhase !== "DAY_SPEECH" && startPhase !== "DAY_LAST_WORDS" && startPhase !== "DAY_BADGE_SPEECH" && startPhase !== "DAY_PK_SPEECH") {
      return;
    }

    setWaitingForNextRound(false);
    await delay(300);

    const liveState = gameStateRef.current;
    if (liveState.gameId !== startGameId) return;
    if (liveState.phase !== startPhase) return;

    const token = getToken();
    await runDaySpeechAction(liveState, token, "ADVANCE_SPEAKER");
  }, [isSpeechBlocked, getToken, runDaySpeechAction, setWaitingForNextRound]);

  /** 人类投票 */
  const handleHumanVote = useCallback(async (targetSeat: number) => {
    if (!humanPlayer) return;
    if (!humanPlayer.alive) return;

    // Revealed Idiot cannot vote
    const baseState0 = gameStateRef.current;
    if (humanPlayer.role === "Idiot" && baseState0.roleAbilities.idiotRevealed) return;

    const baseState = baseState0;
    if (baseState.phase !== "DAY_VOTE" && baseState.phase !== "DAY_BADGE_ELECTION") return;
    const targetPlayer = baseState.players.find((p) => p.seat === targetSeat);
    if (!targetPlayer || !targetPlayer.alive) return;

    if (baseState.phase === "DAY_BADGE_ELECTION") {
      if (typeof baseState.badge.votes?.[humanPlayer.playerId] === "number") return;
      const candidates = baseState.badge.candidates || [];
      if (candidates.includes(humanPlayer.seat)) {
        console.warn("[wolfcha] Candidate cannot vote in badge election");
        return;
      }

      const nextState: GameState = {
        ...baseState,
        badge: {
          ...baseState.badge,
          votes: { ...baseState.badge.votes, [humanPlayer.playerId]: targetSeat },
        },
      };
      setGameState(nextState);
      gameStateRef.current = nextState;

      await delay(200);
      await badgePhase.maybeResolveBadgeElection(nextState);
      return;
    }

    if (typeof baseState.votes[humanPlayer.playerId] === "number") return;
    if (baseState.pkSource === "vote" && Array.isArray(baseState.pkTargets) && baseState.pkTargets.length > 0) {
      if (!baseState.pkTargets.includes(targetSeat)) {
        console.warn("[wolfcha] Vote target not in PK list");
        return;
      }
    }

    // 使用函数式更新确保获取最新状态（解决AI投票后状态同步问题）
    let updatedState: GameState | null = null;
    setGameState((prevState) => {
      updatedState = {
        ...prevState,
        votes: { ...prevState.votes, [humanPlayer.playerId]: targetSeat },
      };
      return updatedState;
    });

    // 等待状态更新完成
    await delay(200);
    
    // 从 ref 获取最新状态（setGameState 的函数式更新会确保 prevState 是最新的）
    const latestState = updatedState || gameStateRef.current;
    gameStateRef.current = latestState;

    // 检查是否所有人都投票了（已翻牌白痴除外）
    const revealedIdiotId2 = latestState.roleAbilities.idiotRevealed
      ? latestState.players.find((p) => p.role === "Idiot" && p.alive)?.playerId
      : undefined;
    const aliveIds = latestState.players.filter((p) => p.alive && p.playerId !== revealedIdiotId2).map((p) => p.playerId);
    const allVoted = aliveIds.every((id) => typeof latestState.votes[id] === "number");
    
    console.log("[wolfcha] handleHumanVote: allVoted =", allVoted, "votes count =", Object.keys(latestState.votes).length, "alive count =", aliveIds.length);
    
    if (allVoted && !isWaitingForAI) {
      const token = getToken();
      await resolveVotesSafely(latestState, token);
    }
  }, [humanPlayer, setGameState, badgePhase, getToken, resolveVotesSafely, isWaitingForAI]);

  /** 夜晚收尾（預言家之後）：裝好「按下確認後結算」的續跑函式；顯示查驗結果由呼叫端負責。 */
  const armNightResolve = useCallback(
    (token: ReturnType<typeof getToken>) => {
      nightContinueRef.current = async (state: GameState) => {
        await resolveNight(state, token, async (resolvedState) => {
          await startDayPhaseInternal(resolvedState, token);
        });
      };
    },
    [resolveNight, startDayPhaseInternal]
  );

  /**
   * 真人剛把某個夜間決定寫進狀態之後，用它把夜晚推下去（真人夜間操作與狼隊分工共用）。
   *
   * 「該下哪個指令」不在這裡重寫：一律問 `night-resume` 的計畫表（與存檔恢復、Dev 跳轉同一份）。
   * 真人決定剛寫入 ⇒ 應該得到 `advance`（或預言家的 `resolve`）；若得到 `wait`，代表呼叫端
   * 以為寫入了、狀態其實沒寫進去——那是程式錯誤，要大聲記 log 而不是讓夜晚靜默卡住。
   */
  const continueNightAfterHumanAction = useCallback(
    async (state: GameState, phase: Phase, token: ReturnType<typeof getToken>) => {
      if (!isNightActionPhase(phase)) return;
      const plan = nightResumePlan(state, phase);
      if (plan.kind === "advance" || plan.kind === "replay") {
        await runNightPhaseAction(state, token, plan.command);
        return;
      }
      if (plan.kind === "resolve") {
        armNightResolve(token);
        return;
      }
      console.warn(
        `[wolfcha] 真人夜間決定沒有寫進狀態，夜晚不會往前（phase=${phase}）`,
        state.nightActions
      );
    },
    [armNightResolve, runNightPhaseAction]
  );

  /** 夜晚行动 */
  const handleNightAction = useCallback(async (targetSeat: number, witchAction?: "save" | "poison" | "pass") => {
    if (!humanPlayer) return;
    if (!humanPlayer.alive && gameState.phase !== "HUNTER_SHOOT") return;

    const token = getToken();
    const systemMessages = getSystemMessages();
    let currentState = gameState;

    // 守卫保护
    if (gameState.phase === "NIGHT_GUARD_ACTION" && humanPlayer.role === "Guard") {
      const guardFlags = getBoardRuleFlags(currentState.players.length);
      const abstain = isAbstainSeat(targetSeat);
      if (abstain && !guardFlags.guardCanAbstain) return;
      if (!abstain && guardFlags.guardCannotRepeat && currentState.nightActions.lastGuardTarget === targetSeat) {
        toast.error(t("gameLogicMessages.guardNoRepeat"));
        return;
      }
      const targetPlayer = abstain ? undefined : currentState.players.find((p) => p.seat === targetSeat);
      currentState = {
        ...currentState,
        nightActions: {
          ...currentState.nightActions,
          // 空守要有自己的表示（`guardAbstained`）：只寫 `guardTarget: undefined`
          // 會與「還沒決定」同形，存檔恢復時會被再問一次 AI。
          guardTarget: abstain ? undefined : targetSeat,
          guardAbstained: abstain || undefined,
        },
      };
      setDialogue(
        t("speakers.system"),
        abstain
          ? t("gameLogicMessages.youAbstainedGuard")
          : t("gameLogicMessages.youProtected", { seat: targetSeat + 1, name: targetPlayer?.displayName || "" }),
        false
      );
      setGameState(currentState);

      await delay(1000);
      await waitForUnpause();
      if (abstain) {
        // 空守：`guardAbstained` 讓「決定不守」與「還沒決定」分得開（night-progress
        // 的 guardDecided 讀得到），所以這條明確往下推。
        await runNightPhaseAction(currentState, token, "CONTINUE_NIGHT_AFTER_GUARD");
      } else {
        await continueNightAfterHumanAction(currentState, "NIGHT_GUARD_ACTION", token);
      }
    }
    // 禁言長老（真人）：指定明天不能發言的人
    else if (gameState.phase === "NIGHT_MUTE_ACTION" && humanPlayer.role === "MuteElder") {
      if (!isValidMuteTarget(currentState, humanPlayer.seat, targetSeat)) return;
      const targetPlayer = currentState.players.find((p) => p.seat === targetSeat);
      currentState = {
        ...currentState,
        nightActions: { ...currentState.nightActions, mutedTarget: targetSeat },
      };
      setDialogue(
        speakerHost,
        t("gameLogicMessages.youMuted", { seat: targetSeat + 1, name: targetPlayer?.displayName || "" }),
        false
      );
      setGameState(currentState);

      await delay(1000);
      await waitForUnpause();
      await continueNightAfterHumanAction(currentState, "NIGHT_MUTE_ACTION", token);
    }
    // 攝夢人（真人）：今晚的夢游者（必須指定，不能選自己）
    else if (gameState.phase === "NIGHT_DREAM_ACTION" && humanPlayer.role === "Dreamweaver") {
      if (!isValidDreamTarget(currentState, humanPlayer.seat, targetSeat)) return;
      const targetPlayer = currentState.players.find((p) => p.seat === targetSeat);
      currentState = {
        ...currentState,
        nightActions: { ...currentState.nightActions, dreamTarget: targetSeat },
      };
      setDialogue(
        speakerHost,
        t("gameLogicMessages.youDreamed", { seat: targetSeat + 1, name: targetPlayer?.displayName || "" }),
        false
      );
      setGameState(currentState);

      await delay(1000);
      await waitForUnpause();
      await continueNightAfterHumanAction(currentState, "NIGHT_DREAM_ACTION", token);
    }
    // 狼美人（真人）：今晚的魅惑對象（必須指定，不能選自己）
    else if (gameState.phase === "NIGHT_WOLF_BEAUTY_ACTION" && humanPlayer.role === "WolfBeauty") {
      if (!isValidWolfBeautyTarget(currentState, humanPlayer.seat, targetSeat)) return;
      const targetPlayer = currentState.players.find((p) => p.seat === targetSeat);
      currentState = {
        ...currentState,
        nightActions: { ...currentState.nightActions, wolfBeautyTarget: targetSeat },
      };
      setDialogue(
        speakerHost,
        t("gameLogicMessages.youCharmed", { seat: targetSeat + 1, name: targetPlayer?.displayName || "" }),
        false
      );
      setGameState(currentState);

      await delay(1000);
      await waitForUnpause();
      await continueNightAfterHumanAction(currentState, "NIGHT_WOLF_BEAUTY_ACTION", token);
    }
    // 狼人击杀
    else if (gameState.phase === "NIGHT_WOLF_ACTION" && isWolfRole(humanPlayer.role)) {
      const targetPlayer = currentState.players.find((p) => p.seat === targetSeat);
      const wolves = currentState.players.filter((p) => isWolfRole(p.role) && p.alive);
      
      // 简化逻辑：人类狼人决定目标，其他AI狼人自动达成共识
      const wolfVotes: Record<string, number> = {};
      for (const wolf of wolves) {
        wolfVotes[wolf.playerId] = targetSeat;
      }

      currentState = {
        ...currentState,
        nightActions: { ...currentState.nightActions, wolfVotes, wolfTarget: targetSeat },
      };
      
      // 显示狼队达成一致的确认消息
      setDialogue(t("speakers.system"), t("gameLogicMessages.wolfDecided", { seat: targetSeat + 1, name: targetPlayer?.displayName || "" }), false);
      setGameState(currentState);

      await delay(800);
      await waitForUnpause();
      await continueNightAfterHumanAction(currentState, "NIGHT_WOLF_ACTION", token);
    }
    // 女巫用药
    else if (gameState.phase === "NIGHT_WITCH_ACTION" && humanPlayer.role === "Witch") {
      const witchFlags = getBoardRuleFlags(currentState.players.length);
      const selfSaveForbidden =
        !witchFlags.witchCanSelfSave && currentState.nightActions.wolfTarget === humanPlayer.seat;
      if (witchAction === "save" && selfSaveForbidden) {
        toast.error(t("gameLogicMessages.witchNoSelfSave"));
        return;
      }
      if (witchAction === "save" && !currentState.roleAbilities.witchHealUsed) {
        currentState = {
          ...currentState,
          nightActions: { ...currentState.nightActions, witchSave: true },
          roleAbilities: { ...currentState.roleAbilities, witchHealUsed: true },
        };
        setDialogue(t("speakers.system"), t("gameLogicMessages.usedAntidote"), false);
      } else if (witchAction === "poison" && !currentState.roleAbilities.witchPoisonUsed) {
        const targetPlayer = currentState.players.find((p) => p.seat === targetSeat);
        currentState = {
          ...currentState,
          nightActions: { ...currentState.nightActions, witchPoison: targetSeat },
          roleAbilities: { ...currentState.roleAbilities, witchPoisonUsed: true },
        };
        setDialogue(t("speakers.system"), t("gameLogicMessages.usedPoison", { seat: targetSeat + 1, name: targetPlayer?.displayName || "" }), false);
      } else if (witchAction === "pass") {
        // 明確不救也是「已決定」：過去這裡什麼都不寫，於是刷新／恢復會再問一次女巫，
        // 存檔也把這一刻當成「未決定」而拒絕落盤。
        currentState = {
          ...currentState,
          nightActions: { ...currentState.nightActions, witchSave: false },
        };
        setDialogue(t("speakers.system"), t("gameLogicMessages.noPotion"), false);
      } else {
        // 按了已經用完的那一瓶（UI 已 disable，正常不可達）：不寫決定，但夜晚照舊往下走
        setDialogue(t("speakers.system"), t("gameLogicMessages.noPotion"), false);
        setGameState(currentState);
        await delay(800);
        await waitForUnpause();
        await runNightPhaseAction(currentState, token, "CONTINUE_NIGHT_AFTER_WITCH");
        return;
      }
      setGameState(currentState);

      await delay(800);
      await waitForUnpause();
      await continueNightAfterHumanAction(currentState, "NIGHT_WITCH_ACTION", token);
    }
    // 预言家查验
    else if (gameState.phase === "NIGHT_SEER_ACTION" && humanPlayer.role === "Seer") {
      // Check if seer has already checked this night
      if (currentState.nightActions.seerTarget !== undefined) {
        return;
      }
      // 魔術師換位：與 AI 預言家同一條改判（記錄的 targetSeat 仍是玩家選的人）
      const effectiveSeat = redirectSeat(targetSeat, currentState.nightActions.magicianSwap) ?? targetSeat;
      const targetPlayer = currentState.players.find((p) => p.seat === effectiveSeat);
      const isWolf = targetPlayer ? targetPlayer.alignment === "wolf" : false;
      const seerHistory = currentState.nightActions.seerHistory || [];

      currentState = {
        ...currentState,
        nightActions: {
          ...currentState.nightActions,
          seerTarget: targetSeat,
          seerResult: { targetSeat, isWolf: isWolf || false },
          seerHistory: [...seerHistory, { targetSeat, isWolf: isWolf || false, day: currentState.day }],
        },
      };
      setDialogue(t("speakers.seerResult"), t("gameLogicMessages.seerResultText", { seat: targetSeat + 1, name: targetPlayer?.displayName || "", result: isWolf ? t("gameLogicMessages.werewolfResult") : t("gameLogicMessages.goodResult") }), false);
      setGameState(currentState);

      // 預言家是最後一個夜間動作：計畫表會回 `resolve`，由它裝好「按下確認後結算」的續跑
      await continueNightAfterHumanAction(currentState, "NIGHT_SEER_ACTION", token);
      return;
    }
    // 猎人开枪
    else if (gameState.phase === "HUNTER_SHOOT" && getDeathShotKind(humanPlayer.role) !== "none") {
      const diedAtNight = (currentState as GameState & { _hunterDiedAtNight?: boolean })._hunterDiedAtNight ?? true;
      if (targetSeat >= 0) {
        currentState = killPlayer(currentState, targetSeat);
        // 自爆帶走狼美人時，被魅惑者一并殉情。
        {
          const carriedRevenge = applyCharmRevenge(currentState, targetSeat, "carried");
          if (carriedRevenge.victimSeat !== null) {
            currentState = addSystemMessage(
              carriedRevenge.state,
              systemMessages.charmRevenge(
                carriedRevenge.victimSeat + 1,
                currentState.players.find((p) => p.seat === carriedRevenge.victimSeat)?.displayName ?? ""
              )
            );
          }
        }
        const target = currentState.players.find((p) => p.seat === targetSeat);
        if (target) {
          currentState = addSystemMessage(
            currentState,
            systemMessages.hunterShoot(humanPlayer.seat + 1, humanPlayer.displayName, targetSeat + 1, target.displayName)
          );
          setDialogue(
            speakerHost,
            systemMessages.hunterShoot(humanPlayer.seat + 1, humanPlayer.displayName, targetSeat + 1, target.displayName),
            false
          );
        }

        const shot = { hunterSeat: humanPlayer.seat, targetSeat };
        // 追加而非覆蓋：同一晚槍打槍會有多筆（rules/hunter-shots 是單一真相）。
        currentState = diedAtNight
          ? appendNightHunterShot(currentState, shot)
          : appendDayHunterShot(currentState, shot);
        setGameState(currentState);

        // 槍打槍：被槍打死的人自己也有槍時，接著讓他開（真人這條也一樣）
        const chained = getChainedShooter(currentState, targetSeat);
        if (chained) {
          await delay(1200);
          const chainFn = hunterDeathRef.current;
          if (chainFn) {
            await chainFn(currentState, chained, diedAtNight);
            return;
          }
        }
      }

      const winner = checkWinCondition(currentState);
      if (winner) {
        await endGameSafely(currentState, winner);
        return;
      }

      await continueAfterHunterShot(currentState, async (nextState) => {
        await delay(1200);
        if (diedAtNight) {
          // 不重加 dayBreak：首次天亮的死訊公告、警徽移交、開槍公告都已在 messages 里。
          // 若再添一條「天亮了」，每日總結／原始日轉寫會從「最後一條天亮」切起，
          // 把夜死公告全部切掉——這是「獵人夜死開槍，賽後沒人提」的根因。
          const dayState = transitionPhase(nextState, "DAY_START");
          setGameState(dayState);
          await delay(800);
          await startDayPhaseInternal(dayState, token, { skipAnnouncements: true });
        } else {
          await proceedToNight(nextState, token);
        }
      });
    }
    // 自爆（所有狼陣營角色；白狼王另外帶走一名玩家）
    else if (gameState.phase === "SELF_DESTRUCT" && isWolfRole(humanPlayer.role)) {
      const boomFlags = getBoardRuleFlags(currentState.players.length);
      const boomTakesPlayer =
        getRoleCapabilities(humanPlayer.role).boomTakesPlayer &&
        boomFlags.boom.takesPlayerRoles.includes(humanPlayer.role);
      const originPhase = selfDestructOriginRef.current;
      selfDestructOriginRef.current = null;
      if (!originPhase) {
        console.warn("[wolfcha] 缺少自爆來源階段，依白天發言處理（此情況下不吞警徽）");
      }
      await applySelfDestruct(
        currentState,
        humanPlayer,
        boomTakesPlayer && targetSeat >= 0 ? targetSeat : null,
        "",
        originPhase ?? "DAY_SPEECH",
        token
      );
    }
    // 騎士翻牌決鬥（真人在白天發言階段選好目標後結算）
    else if (gameState.phase === "KNIGHT_DUEL" && getRoleCapabilities(humanPlayer.role).canDuel) {
      const originPhase = knightDuelOriginRef.current;
      knightDuelOriginRef.current = null;
      if (!originPhase) {
        console.warn("[wolfcha] 缺少決鬥來源階段，依白天發言處理");
      }
      const result = await applyKnightDuel(
        currentState,
        humanPlayer,
        targetSeat,
        originPhase ?? "DAY_SPEECH",
        token
      );
      // 決鬥失敗（目標是好人）：騎士出局、白天流程照走 → 推進到下一位發言者
      if (result.action === "continue") {
        await runDaySpeechAction(result.state ?? currentState, token, "ADVANCE_SPEAKER");
      }
    }
  }, [gameState, humanPlayer, setGameState, setDialogue, setIsWaitingForAI, waitForUnpause, getToken, runNightPhaseAction, resolveNight, startDayPhaseInternal, proceedToNight, endGameSafely, transitionPhase, speakerHost, t, continueAfterHunterShot, applyKnightDuel, runDaySpeechAction]);

  /**
   * 魔術師（真人）的夜間行動：選**兩名**玩家交換（`docs/board-variants-catalog.md` §6.1 步驟 6）。
   *
   * 與 AI 路徑共用同一份合法性判定（`isValidSwap`）——換位的規則只有 `rules/magician.ts` 一份。
   * 寫入後交給 `continueNightAfterHumanAction` 依計畫表往下走：這一步在續跑鏈上**不是**最後一步
   * （後面還有狼人、女巫、預言家），所以計畫表會回 `advance`，夜晚自然繼續。
   */
  const handleMagicianSwap = useCallback(
    async (firstSeat: number, secondSeat: number) => {
      if (!humanPlayer || humanPlayer.role !== "Magician" || !humanPlayer.alive) return;
      if (gameState.phase !== "NIGHT_MAGICIAN_ACTION") return;
      // 已經換過就不再換（面板條件也是同一條；這裡擋的是重複點擊）
      if (gameState.nightActions.magicianSwap !== undefined) return;

      const swap: [number, number] = [firstSeat, secondSeat];
      if (!isValidSwap(gameState, swap)) {
        // 不合法就明講，不要靜默吞掉——面板照理不會送出這種組合
        console.warn("[wolfcha] 真人魔術師的換位組合不合法，忽略", swap);
        return;
      }

      const token = getToken();
      const nameOf = (seat: number) =>
        gameState.players.find((player) => player.seat === seat)?.displayName ?? "";
      const currentState: GameState = {
        ...gameState,
        nightActions: { ...gameState.nightActions, magicianSwap: swap },
      };
      setGameState(currentState);
      setDialogue(
        speakerHost,
        t("gameLogicMessages.magicianSwapText", {
          firstSeat: firstSeat + 1,
          firstName: nameOf(firstSeat),
          secondSeat: secondSeat + 1,
          secondName: nameOf(secondSeat),
        }),
        false
      );

      await delay(800);
      await waitForUnpause();
      await continueNightAfterHumanAction(currentState, "NIGHT_MAGICIAN_ACTION", token);
    },
    [gameState, humanPlayer, setGameState, setDialogue, speakerHost, t, getToken, waitForUnpause, continueNightAfterHumanAction]
  );

  /** 真人騎士翻牌決鬥（切到 KNIGHT_DUEL 選目標） */
  const handleKnightDuel = useCallback(async () => {
    const currentState = gameStateRef.current;
    if (!humanPlayer || !humanPlayer.alive) return;

    const flags = getBoardRuleFlags(currentState.players.length);
    if (!canDuel({
      phase: currentState.phase,
      role: humanPlayer.role,
      flags,
      duelUsedSeats: currentState.roleAbilities.duelUsedSeats,
      seat: humanPlayer.seat,
    })) {
      return;
    }

    knightDuelOriginRef.current = currentState.phase;
    const nextState = transitionPhase(currentState, "KNIGHT_DUEL");
    setGameState(nextState);
    clearDialogue();
    setDialogue(speakerHost, t("ui.knightDuelPickTarget"), false);
  }, [clearDialogue, humanPlayer, setDialogue, setGameState, speakerHost, t, transitionPhase]);

  /** 人类白狼王自爆（进入 SELF_DESTRUCT 阶段） */
  /** 真人自爆（所有狼陣營角色；白狼王需要先選帶走的目標） */
  const handleSelfDestruct = useCallback(async () => {
    const currentState = gameStateRef.current;
    if (!humanPlayer || !humanPlayer.alive) return;

    const flags = getBoardRuleFlags(currentState.players.length);
    if (!canSelfDestruct({ phase: currentState.phase, role: humanPlayer.role, flags })) return;
    if (hasAlreadyBoomed(currentState.roleAbilities.boomedSeats, humanPlayer.seat)) return;

    const takesPlayer =
      getRoleCapabilities(humanPlayer.role).boomTakesPlayer &&
      flags.boom.takesPlayerRoles.includes(humanPlayer.role);

    if (takesPlayer) {
      // 需要選「帶走誰」：切到 SELF_DESTRUCT 階段讓玩家點卡片，來源階段記在 ref
      selfDestructOriginRef.current = currentState.phase;
      const nextState = transitionPhase(currentState, "SELF_DESTRUCT");
      setGameState(nextState);
      clearDialogue();
      setDialogue(speakerHost, t("ui.selfDestructPickTarget"), false);
      return;
    }

    await applySelfDestruct(currentState, humanPlayer, null, "", currentState.phase, getToken());
  }, [applySelfDestruct, clearDialogue, getToken, humanPlayer, setDialogue, setGameState, speakerHost, t, transitionPhase]);

  /** 人类警长移交 */
  const handleHumanBadgeTransfer = useCallback(async (targetSeat: number) => {
    await badgePhase.handleHumanBadgeTransfer(targetSeat);
  }, [badgePhase]);

  /** 推进发言 */
  const advanceSpeech = useCallback(async (): Promise<{ finished: boolean; shouldAdvanceToNextSpeaker: boolean; shouldAutoAdvanceToNextAI: boolean }> => {
    if (gameStateRef.current.phase === "GAME_END" || gameStateRef.current.winner) {
      clearSpeechQueue();
      clearDialogue();
      setIsWaitingForAI(false);
      setWaitingForNextRound(false);
      return { finished: true, shouldAdvanceToNextSpeaker: false, shouldAutoAdvanceToNextAI: false };
    }
    if (gameStateRef.current.phase.includes("NIGHT")) {
      const cont = nightContinueRef.current;
      if (cont) {
        nightContinueRef.current = null;
        clearDialogue();
        setIsWaitingForAI(false);
        setWaitingForNextRound(false);
        await cont(gameStateRef.current);
        return { finished: true, shouldAdvanceToNextSpeaker: false, shouldAutoAdvanceToNextAI: false };
      }
      return { finished: false, shouldAdvanceToNextSpeaker: false, shouldAutoAdvanceToNextAI: false };
    }

    const queue = getSpeechQueue();
    if (!queue || (queue.request && !queue.request.isValid())) {
      return { finished: false, shouldAdvanceToNextSpeaker: false, shouldAutoAdvanceToNextAI: false };
    }

    if (queue.isStreaming && !isCurrentSegmentCompleted()) {
      return { finished: false, shouldAdvanceToNextSpeaker: false, shouldAutoAdvanceToNextAI: false };
    }

    const { segments, currentIndex, player } = queue;

    let nextState = gameStateRef.current;

    // 将当前句子添加到消息列表（如果尚未提交）
    const currentSegment = segments[currentIndex];
    if (currentSegment && currentSegment.trim().length > 0 && !isCurrentSegmentCommitted()) {
      nextState = addPlayerMessage(nextState, player.playerId, currentSegment, {
        id: queue.request ? `${queue.request.id}:${currentIndex}` : undefined,
      });
      setGameState(nextState);
      markCurrentSegmentCommitted();

      const rawTranscript = buildRawDayTranscript(nextState);
      const shouldSummarizeEarly =
        nextState.phase === "DAY_SPEECH" &&
        nextState.day > 0 &&
        !nextState.dailySummaries?.[nextState.day]?.length &&
        rawTranscript.length > 10000;
      if (shouldSummarizeEarly) {
        void maybeGenerateDailySummary(nextState)
          .then((summarized) => {
            setGameState((prev) => {
              if (prev.gameId !== summarized.gameId || prev.day !== summarized.day) return prev;
              return carryDailySummary(prev, summarized);
            });
          })
          .catch(() => {});
      }
    }

    const result = advanceSpeechQueue();
    if (!result) return { finished: false, shouldAdvanceToNextSpeaker: false, shouldAutoAdvanceToNextAI: false };

    if (!result.finished) {
      return { finished: false, shouldAdvanceToNextSpeaker: false, shouldAutoAdvanceToNextAI: false };
    }

    setIsWaitingForAI(false);

    if (isSpeechBlocked()) {
      return { finished: true, shouldAdvanceToNextSpeaker: false, shouldAutoAdvanceToNextAI: false };
    }
    if (result.afterSpeech) {
      await result.afterSpeech(nextState);
      // 如果下一个发言者是AI，返回标志让调用方知道可以自动推进
      return { finished: true, shouldAdvanceToNextSpeaker: false, shouldAutoAdvanceToNextAI: result.shouldAutoAdvanceToNextAI ?? false };
    }

    // 不设置 waitingForNextRound，直接返回 shouldAdvanceToNextSpeaker: true
    // 让调用方立即调用 handleNextRound，避免单条消息时需要按两次回车的问题
    return { finished: true, shouldAdvanceToNextSpeaker: true, shouldAutoAdvanceToNextAI: false };
  }, [clearDialogue, clearSpeechQueue, isSpeechBlocked, buildRawDayTranscript, maybeGenerateDailySummary, setIsWaitingForAI, setWaitingForNextRound, getSpeechQueue, advanceSpeechQueue, setGameState, isCurrentSegmentCommitted, markCurrentSegmentCommitted, isCurrentSegmentCompleted]);

  /** 切换暂停 */
  const togglePause = useCallback(() => {
    setGameState((prev) => ({
      ...prev,
      isPaused: !prev.isPaused,
    }));
  }, [setGameState]);

  // ============================================
  // 返回 API
  // ============================================
  /**
   * 真人狼還欠第一夜分工嗎：真人狼在場、第一夜、尚未寫入計畫（也未交還 AI）時
   * 由前端對話框接手；NightPhase 的夜間流程同步擋在同一個條件上。
   */
  const awaitingWolfTeamPlan = Boolean(
    humanPlayer &&
      humanPlayer.alive &&
      isWolfRole(humanPlayer.role) &&
      gameState.day === 1 &&
      !gameState.wolfTeamPlan &&
      !gameState.wolfTeamPlanDelegated &&
      gameState.phase === "NIGHT_WOLF_ACTION"
  );

  /**
   * 寫入（或交還）第一夜分工後把夜間流程推下去：
   * 刀口若已經選好，流程正停在女巫階段前等這份分工；這一步就是把它放行。
   */
  const continueNightAfterWolfTeamPlan = useCallback(
    (next: GameState) => {
      if (next.phase !== "NIGHT_WOLF_ACTION") return;
      if (next.nightActions.wolfTarget === undefined) return;
      // 刀口＋（交還 AI 或寫入計畫）都齊了 ⇒ 問計畫表往下推
      void continueNightAfterHumanAction(next, "NIGHT_WOLF_ACTION", getToken());
    },
    [continueNightAfterHumanAction, getToken]
  );

  /** 真人狼指派第一夜分工：清洗失敗（座位不合法等）就整筆忽略，讓玩家重填。 */
  const handleWolfTeamPlanSubmit = useCallback(
    (choice: HumanWolfTeamPlanChoice) => {
      const plan = buildHumanWolfTeamPlan(gameState, choice);
      if (!plan) {
        console.warn("[wolfcha] 真人狼分工不成立，忽略本次指派", choice);
        return;
      }
      const nextState: GameState = { ...gameState, wolfTeamPlan: plan };
      setGameState(nextState);
      continueNightAfterWolfTeamPlan(nextState);
    },
    [continueNightAfterWolfTeamPlan, gameState, setGameState]
  );

  /** 真人狼把分工交還 AI 主導狼：生成失敗也照樣放行（旗標才是放行依據），不能卡住夜間流程。 */
  const handleWolfTeamPlanDelegate = useCallback(async () => {
    let plan: WolfTeamPlan | null = null;
    try {
      plan = await generateWolfTeamPlan(gameState);
    } catch (error) {
      console.warn("[wolfcha] 交還 AI 商議狼隊分工失敗，本局照舊無協調", error);
    }
    const nextState: GameState = {
      ...gameState,
      ...(plan ? { wolfTeamPlan: plan } : {}),
      wolfTeamPlanDelegated: true,
    };
    setGameState(nextState);
    continueNightAfterWolfTeamPlan(nextState);
  }, [continueNightAfterWolfTeamPlan, gameState, setGameState]);

  return {
    // State
    humanName: humanName || "",
    setHumanName,
    gameStarted,
    gameState,
    isLoading,
    isWaitingForAI,
    waitingForNextRound,
    currentDialogue,
    inputText,
    setInputText,
    showTable,
    logRef,
    humanPlayer,
    isNight,

    // Actions
    startGame,
    continueAfterRoleReveal,
    restartGame,
    handleHumanSpeech,
    handleFinishSpeaking,
    handleBadgeSignup: badgePhase.handleBadgeSignup,
    handleHumanVote,
    handleNightAction,
    handleMagicianSwap,
    handleHumanBadgeTransfer,
    handleSelfDestruct,
    handleKnightDuel,
    handleNextRound,
    scrollToBottom,
    advanceSpeech,
    togglePause,
    markCurrentSegmentCompleted,
    isCurrentSegmentCompleted,
    shouldAutoAdvanceToNextAI,
    awaitingWolfTeamPlan,
    handleWolfTeamPlanSubmit,
    handleWolfTeamPlanDelegate,
  };
}
