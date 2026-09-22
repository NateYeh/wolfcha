"use client";

import { recordVoteRound } from "@/lib/vote-rounds";
import { useCallback, useRef } from "react";
import { useAtom } from "jotai";
import { getI18n } from "@/i18n/translator";
import type { GameState, Player } from "@/types/game";
import { gameStateAtom } from "@/store/game-machine";
import {
  transitionPhase,
  addSystemMessage,
  generateAIBadgeVote,
  generateAIBadgeSignupBatch,
  generateBadgeTransfer,
  BADGE_VOTE_ABSTAIN,
  BADGE_TRANSFER_TORN,
  excludePendingDeathPlayers,
  getPendingDeathSeats,
} from "@/lib/game-master";
import { getSystemMessages, getUiText } from "@/lib/game-texts";
import { DELAY_CONFIG, GAME_CONFIG } from "@/lib/game-constants";
import { delay, type FlowToken } from "@/lib/game-flow-controller";
import { playNarrator } from "@/lib/narrator-audio-player";

export interface BadgePhaseCallbacks {
  setDialogue: (speaker: string, text: string, isStreaming?: boolean) => void;
  clearDialogue: () => void;
  setIsWaitingForAI: (waiting: boolean) => void;
  waitForUnpause: () => Promise<void>;
  isTokenValid: (token: FlowToken) => boolean;
  onBadgeElectionComplete: (state: GameState) => Promise<void>;
  onBadgeTransferComplete: (state: GameState) => Promise<void>;
  runAISpeech: (state: GameState, player: Player) => Promise<void>;
}

export interface BadgePhaseActions {
  startBadgeSignupPhase: (state: GameState) => Promise<void>;
  startBadgeSpeechPhase: (state: GameState) => Promise<void>;
  startBadgeElectionPhase: (state: GameState, options?: { isRevote?: boolean; isResume?: boolean }) => Promise<void>;
  resumeBadgeSpeechPhase: (state: GameState) => Promise<void>;
  resumeBadgeSignupPhase: (state: GameState) => Promise<void>;
  handleBadgeSignup: (wants: boolean) => Promise<void>;
  handleBadgeTransfer: (state: GameState, sheriff: Player, afterTransfer: (s: GameState) => Promise<void>) => Promise<void>;
  handleHumanBadgeTransfer: (targetSeat: number) => Promise<void>;
  maybeResolveBadgeElection: (state: GameState) => Promise<void>;
}

/**
 * 警长竞选阶段 Hook
 * 负责管理警长竞选报名、发言、投票、移交等流程
 */
/** 逐票落地的畫面節奏（網路已併發完成，這裡只錯開 UI 更新） */
const BADGE_VOTE_BEAT_MS = 120;

export function useBadgePhase(
  callbacks: BadgePhaseCallbacks
): BadgePhaseActions {
  const getTexts = () => {
    const { t } = getI18n();
    return {
      t,
      systemMessages: getSystemMessages(),
      uiText: getUiText(),
      speakerHost: t("speakers.host"),
      speakerHint: t("speakers.hint"),
      speakerSystem: t("speakers.system"),
    };
  };
  const [gameState, setGameState] = useAtom(gameStateAtom);

  const {
    setDialogue,
    clearDialogue,
    setIsWaitingForAI,
    waitForUnpause,
    isTokenValid,
    onBadgeElectionComplete,
    onBadgeTransferComplete,
    runAISpeech,
  } = callbacks;

  // 使用 ref 打破循环依赖
  const startBadgeSpeechPhaseRef = useRef<(state: GameState) => Promise<void>>(async () => {});
  const maybeStartBadgeSpeechAfterSignupRef = useRef<(state: GameState) => Promise<void>>(async () => {});
  
  // 用于保存人类警长移交时的回调
  const humanBadgeTransferCallbackRef = useRef<((state: GameState) => Promise<void>) | null>(null);
  
  // 用于在 AI 投票循环中获取最新状态
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;
  // Prevent concurrent AI signup runs
  const aiSignupPromiseRef = useRef<Promise<GameState> | null>(null);

  /** 生成警长投票详情 */
  const generateBadgeVoteDetails = useCallback((
    votes: Record<string, number>,
    players: Player[],
    candidates: number[] = []
  ): string => {
    const { t } = getI18n();
    const aliveById = new Set(players.filter((p) => p.alive).map((p) => p.playerId));
    const aliveBySeat = new Set(players.filter((p) => p.alive).map((p) => p.seat));
    const candidateSet = new Set(candidates);
    const badgeVoteGroups: Record<number, number[]> = {};
    Object.entries(votes).forEach(([playerId, targetSeat]) => {
      if (!aliveById.has(playerId)) return;
      if (!aliveBySeat.has(targetSeat)) return;
      if (candidateSet.size > 0 && !candidateSet.has(targetSeat)) return;
      const voter = players.find(p => p.playerId === playerId);
      if (voter) {
        if (!badgeVoteGroups[targetSeat]) badgeVoteGroups[targetSeat] = [];
        badgeVoteGroups[targetSeat].push(voter.seat);
      }
    });

    const badgeVoteResults = Object.entries(badgeVoteGroups)
      .sort(([, votersA], [, votersB]) => votersB.length - votersA.length)
      .map(([targetSeat, voters]) => {
        const target = players.find(p => p.seat === Number(targetSeat));
        return {
          targetSeat: Number(targetSeat),
          targetName: target?.displayName || t("common.unknown"),
          voterSeats: voters,
          voteCount: voters.length
        };
      });

    return `[VOTE_RESULT]${JSON.stringify({ title: t("badgePhase.voteDetailTitle"), results: badgeVoteResults })}`;
  }, []);

  // 用于防止重复结算的标志
  const isResolvingBadgeElectionRef = useRef(false);

  /** 开始警徽PK发言 */
  const startBadgePkSpeech = useCallback(async (state: GameState, pkTargets: number[]) => {
    const texts = getTexts();
    let currentState = transitionPhase(state, "DAY_PK_SPEECH");
    const firstSeat = pkTargets[0] ?? null;
    currentState = {
      ...currentState,
      pkTargets,
      pkSource: "badge",
      currentSpeakerSeat: firstSeat,
      daySpeechStartSeat: firstSeat,
      badge: {
        ...currentState.badge,
        candidates: pkTargets,
        votes: {},
      },
    };
    currentState = addSystemMessage(currentState, texts.t("badgePhase.tiePk"));
    setGameState(currentState);
    setDialogue(texts.speakerHost, texts.t("badgePhase.tiePk"), false);

    await delay(DELAY_CONFIG.DIALOGUE);
    await waitForUnpause();

    const firstSpeaker = currentState.players.find((p) => p.seat === firstSeat);
    if (firstSpeaker && !firstSpeaker.isHuman) {
      await runAISpeech(currentState, firstSpeaker);
    } else if (firstSpeaker?.isHuman) {
      setDialogue(texts.speakerHint, texts.uiText.yourTurn, false);
    }
  }, [setGameState, setDialogue, waitForUnpause, runAISpeech]);

  /** 结算警长竞选投票 */
  const maybeResolveBadgeElection = useCallback(async (state: GameState) => {
    const texts = getTexts();
    if (state.phase !== "DAY_BADGE_ELECTION") return;
    
    // 防止重复结算
    if (isResolvingBadgeElectionRef.current) return;
    
    // 如果警长已经选出，不再结算
    if (state.badge.holderSeat !== null) return;

    const candidates = state.badge.candidates || [];
    // 已死未公布（夜 1 被刀）的玩家不投票；其死亡尚未公布，但仍不能參與警徽投票。
    const voters = excludePendingDeathPlayers(
      state,
      state.players.filter((p) => p.alive && !candidates.includes(p.seat))
    );
    const voterIds = voters.map((p) => p.playerId);
    const allVoted = voterIds.every((id) => typeof state.badge.votes[id] === "number");
    if (!allVoted) return;
    
    // 设置结算中标志
    isResolvingBadgeElectionRef.current = true;

    // 计票
    const aliveById = new Set(state.players.filter((p) => p.alive).map((p) => p.playerId));
    const aliveBySeat = new Set(state.players.filter((p) => p.alive).map((p) => p.seat));
    const candidateSet = new Set(candidates);
    const counts: Record<number, number> = {};
    for (const [voterId, seat] of Object.entries(state.badge.votes)) {
      if (!aliveById.has(voterId)) continue;
      if (!aliveBySeat.has(seat)) continue;
      if (candidateSet.size > 0 && !candidateSet.has(seat)) continue;
      counts[seat] = (counts[seat] || 0) + 1;
    }
    const entries = Object.entries(counts);
    let max = -1;
    for (const [, c] of entries) max = Math.max(max, c);
    const topSeats = entries.filter(([, c]) => c === max).map(([s]) => Number(s));

    state = recordVoteRound(state, {
      kind: "badge", round: (state.badge.revoteCount || 0) + 1, candidates,
      votes: state.badge.votes, sheriffSeat: null, winnerSeat: topSeats.length === 1 ? topSeats[0] : null,
      outcome: topSeats.length === 1 ? "elected" : topSeats.length ? "tie" : "no-votes",
    });

    // 平票处理
    if (topSeats.length !== 1) {
      const revoteCount = (state.badge.revoteCount || 0) + 1;

      // 第二轮仍平票：自动撕毁（本局无警长）
      if (revoteCount >= GAME_CONFIG.MAX_BADGE_REVOTE_COUNT) {
        // 添加投票详情
        const badgeVoteDetailMessage = generateBadgeVoteDetails(state.badge.votes, state.players, state.badge.candidates || []);

        const badgeTieTearMessage = texts.t("badgePhase.tieTear" as never);

        // 兼容字段只保存最后一轮；完整过程存于 voteRounds
        const finalVotes = { ...state.badge.votes };
        let nextState: GameState = {
          ...state,
          badge: {
            ...state.badge,
            holderSeat: null,
            votes: {},
            allVotes: {},
            candidates: [],
            revoteCount,
            history: { ...state.badge.history, [state.day]: finalVotes },
            electionWinners: { ...state.badge.electionWinners, [state.day]: null },
          },
        };

        nextState = addSystemMessage(nextState, badgeVoteDetailMessage);
        nextState = addSystemMessage(nextState, badgeTieTearMessage);

        setGameState(nextState);
        setDialogue(texts.speakerHost, badgeTieTearMessage, false);

        await delay(DELAY_CONFIG.DIALOGUE);
        isResolvingBadgeElectionRef.current = false;
        await onBadgeElectionComplete(nextState);
        return;
      }

      // 进入 PK 前公开本轮票型，再开始下一轮
      isResolvingBadgeElectionRef.current = false;
      const nextState: GameState = {
        ...state,
        badge: {
          ...state.badge,
          votes: {},
          allVotes: { ...state.badge.votes },
          revoteCount,
          candidates: topSeats,
        },
      };
      await startBadgePkSpeech(addSystemMessage(nextState,
        generateBadgeVoteDetails(state.badge.votes, state.players, candidates)), topSeats);
      return;
    }

    // 唯一最高票
    const winnerSeat = topSeats[0];
    const winner = state.players.find((p) => p.seat === winnerSeat);
    const votedCount = counts[winnerSeat] || 0;

    // 兼容字段只保存最后一轮；完整过程存于 voteRounds
    const finalVotes = { ...state.badge.votes };
    let nextState: GameState = {
      ...state,
      badge: {
        ...state.badge,
        holderSeat: winnerSeat,
        allVotes: {},
        history: { ...state.badge.history, [state.day]: finalVotes },
        electionWinners: { ...state.badge.electionWinners, [state.day]: winnerSeat },
        // 競選已結案：清掉「被自爆中斷」的續辦旗標
        electionSuspended: false,
        electionSpokenSeats: undefined,
      },
    };

    // 添加投票详情
    const badgeVoteDetailMessage = generateBadgeVoteDetails(state.badge.votes, state.players, state.badge.candidates || []);
    nextState = addSystemMessage(nextState, badgeVoteDetailMessage);
    nextState = addSystemMessage(nextState, texts.systemMessages.badgeElected(winnerSeat + 1, winner?.displayName || "", votedCount));

    setGameState(nextState);
    setDialogue(texts.speakerHost, texts.systemMessages.badgeElected(winnerSeat + 1, winner?.displayName || "", votedCount), false);

    await delay(DELAY_CONFIG.DIALOGUE);
    isResolvingBadgeElectionRef.current = false;
    await onBadgeElectionComplete(nextState);
  }, [setGameState, setDialogue, generateBadgeVoteDetails, onBadgeElectionComplete, startBadgePkSpeech]);

  /** AI 报名决策（在用户决定后同时进行） */
  const resolveAIBadgeSignup = useCallback(async (state: GameState): Promise<GameState> => {
    if (aiSignupPromiseRef.current) {
      const resolved = await aiSignupPromiseRef.current;
      const fallback = gameStateRef.current ?? state;
      const base = resolved ?? fallback;
      return {
        ...base,
        badge: {
          ...base.badge,
          signup: { ...base.badge.signup, ...state.badge.signup },
        },
      };
    }

    const task = (async (): Promise<GameState> => {
      const baseState = gameStateRef.current ?? state;
      // 已死未公布（夜 1 被刀）的玩家不被詢問報名：死人不報名、不上警。
      const alivePlayers = excludePendingDeathPlayers(baseState, baseState.players.filter((p) => p.alive));
      const aiPlayers = alivePlayers.filter((p) => !p.isHuman);
      const pendingAI = aiPlayers.filter(
        (p) => typeof baseState.badge.signup?.[p.playerId] !== "boolean"
      );
      // If all AI have signed up, merge baseState (with AI signups) and state (with human signup)
      if (pendingAI.length === 0) {
        return {
          ...baseState,
          badge: {
            ...baseState.badge,
            signup: { ...baseState.badge.signup, ...state.badge.signup },
          },
        };
      }

      setIsWaitingForAI(true);
      try {
        const results = await generateAIBadgeSignupBatch(baseState, pendingAI);
        const latestState = gameStateRef.current ?? baseState;
        const mergedSignup = {
          ...latestState.badge.signup,
          ...baseState.badge.signup,
          ...results,
        };
        const nextState: GameState = {
          ...latestState,
          badge: {
            ...latestState.badge,
            signup: mergedSignup,
          },
        };
        setGameState(nextState);
        return nextState;
      } finally {
        setIsWaitingForAI(false);
      }
    })();

    aiSignupPromiseRef.current = task;
    try {
      return await task;
    } finally {
      aiSignupPromiseRef.current = null;
    }
  }, [setGameState, setIsWaitingForAI]);

  /** 开始警长竞选报名 */
  const startBadgeSignupPhase = useCallback(async (state: GameState) => {
    const texts = getTexts();
    let currentState = transitionPhase(state, "DAY_BADGE_SIGNUP");
    currentState = {
      ...currentState,
      currentSpeakerSeat: null,
      daySpeechStartSeat: null,
      badge: {
        ...currentState.badge,
        signup: {},
        candidates: [],
      },
    };

    currentState = addSystemMessage(currentState, texts.t("badgePhase.signupStart"));
    setGameState(currentState);
    clearDialogue();

    // 已死未公布（夜 1 被刀）的人類玩家不參與報名，也不能讓流程停在等他按按鈕：
    // handleBadgeSignup 會用 getPendingDeathSeats 擋掉他，若這裡仍視他為「要等他決定」就會互等卡死。
    const alivePlayers = excludePendingDeathPlayers(currentState, currentState.players.filter((p) => p.alive));
    const human = alivePlayers.find((p) => p.isHuman);
    if (!human) {
      const nextState = await resolveAIBadgeSignup(currentState);
      await maybeStartBadgeSpeechAfterSignupRef.current(nextState);
      return;
    }

    void resolveAIBadgeSignup(currentState);
  }, [setGameState, clearDialogue, resolveAIBadgeSignup]);

  /** 报名结束后检查是否开始发言 */
  const maybeStartBadgeSpeechAfterSignup = useCallback(async (state: GameState) => {
    const texts = getTexts();
    // 已死未公布（夜 1 被刀）的玩家不參與報名，也不需要報名決定。
    const alivePlayers = excludePendingDeathPlayers(state, state.players.filter((p) => p.alive));
    const signup = state.badge.signup || {};
    const allDecided = alivePlayers.every((p) => typeof signup[p.playerId] === "boolean");
    if (!allDecided) return;

    // 候選人資格：存活且不是「已死未公布」的玩家（夜死者在警長選出前不能參選）。
    const candidates = excludePendingDeathPlayers(
      state,
      alivePlayers.filter((p) => signup[p.playerId] === true)
    ).map((p) => p.seat);

    if (candidates.length === 0) {
      const nextState = addSystemMessage(state, texts.t("badgePhase.noSignup"));
      setGameState(nextState);
      setDialogue(texts.speakerHost, texts.t("badgePhase.noSignup"), false);
      await delay(DELAY_CONFIG.DIALOGUE);
      await onBadgeElectionComplete(nextState);
      return;
    }

    await startBadgeSpeechPhaseRef.current({
      ...state,
      badge: { ...state.badge, candidates },
    });
  }, [setGameState, setDialogue, onBadgeElectionComplete]);

  /** 人类报名处理 */
  const handleBadgeSignup = useCallback(async (wants: boolean) => {
    if (gameState.phase !== "DAY_BADGE_SIGNUP") return;
    const human = gameState.players.find((p) => p.isHuman);
    if (!human?.alive) return;
    // 已死未公布（夜 1 被刀）的玩家不能报名，即使死亡尚未公布。
    if (getPendingDeathSeats(gameState).includes(human.seat)) return;
    if (typeof gameState.badge.signup?.[human.playerId] === "boolean") return;

    let nextState: GameState = {
      ...gameState,
      badge: {
        ...gameState.badge,
        signup: { ...gameState.badge.signup, [human.playerId]: wants },
      },
    };
    setGameState(nextState);
    nextState = await resolveAIBadgeSignup(nextState);
    await maybeStartBadgeSpeechAfterSignup(nextState);
  }, [gameState, setGameState, resolveAIBadgeSignup, maybeStartBadgeSpeechAfterSignup]);

  /**
   * 刷新恢复后的报名阶段恢复：
   * - 不重置 badge.signup / candidates（避免回到“报名刚开始”）
   * - 继续让 AI 参与报名（对未决定者补齐）
   * - 若报名已全部完成，直接衔接到发言阶段
   */
  const resumeBadgeSignupPhase = useCallback(async (state: GameState) => {
    if (state.phase !== "DAY_BADGE_SIGNUP") return;
    // 如果没有任何玩家（理论上不会出现），直接退出
    if (!state.players || state.players.length === 0) return;

    // 继续跑 AI 报名（仅补齐未决定者）
    const nextState = await resolveAIBadgeSignup(state);
    await maybeStartBadgeSpeechAfterSignup(nextState);
  }, [maybeStartBadgeSpeechAfterSignup, resolveAIBadgeSignup]);

  /** 开始警长竞选发言 */
  const startBadgeSpeechPhase = useCallback(async (state: GameState) => {
    const texts = getTexts();
    let currentState = transitionPhase(state, "DAY_BADGE_SPEECH");
    currentState = { ...currentState, currentSpeakerSeat: null, daySpeechStartSeat: null };

    currentState = addSystemMessage(currentState, texts.systemMessages.badgeSpeechStart);
    setDialogue(texts.speakerHost, texts.systemMessages.badgeSpeechStart, false);

    const candidates = currentState.badge.candidates || [];
    const candidatePlayers = excludePendingDeathPlayers(
      currentState,
      currentState.players.filter((p) => p.alive && candidates.includes(p.seat))
    );
    const startSeat = candidatePlayers.length > 0
      ? candidatePlayers[Math.floor(Math.random() * candidatePlayers.length)].seat
      : null;
    const firstSpeaker = startSeat !== null
      ? candidatePlayers.find((p) => p.seat === startSeat) || null
      : null;

    currentState = {
      ...currentState,
      daySpeechStartSeat: startSeat,
      currentSpeakerSeat: firstSpeaker?.seat ?? null,
    };

    setGameState(currentState);

    await delay(DELAY_CONFIG.DIALOGUE);
    await waitForUnpause();

    if (firstSpeaker && !firstSpeaker.isHuman) {
      await runAISpeech(currentState, firstSpeaker);
    } else if (firstSpeaker?.isHuman) {
      setDialogue(texts.speakerHint, texts.uiText.yourTurn, false);
    }
  }, [setGameState, setDialogue, waitForUnpause, runAISpeech]);

  /** 开始警长竞选投票 */
  const startBadgeElectionPhase = useCallback(async (state: GameState, options?: { isRevote?: boolean; isResume?: boolean }) => {
    const texts = getTexts();
    const isResume = options?.isResume === true;
    const isRevote = options?.isRevote === true || state.phase === "DAY_BADGE_ELECTION";
    const shouldTransition = state.phase !== "DAY_BADGE_ELECTION";
    let currentState = shouldTransition ? transitionPhase(state, "DAY_BADGE_ELECTION") : state;

    currentState = {
      ...currentState,
      currentSpeakerSeat: null,
      badge: {
        ...currentState.badge,
        votes: isRevote ? currentState.badge.votes : {},
        revoteCount: isRevote ? currentState.badge.revoteCount : 0,
      },
    };

    if (!isRevote) {
      currentState = addSystemMessage(currentState, texts.systemMessages.badgeElectionStart);
      
      // 播放警徽竞选投票语音
      await playNarrator("badgeElectionStart");
    }

    const candidates = currentState.badge.candidates || [];
    if (candidates.length === 1) {
      // 只有一人竞选，直接当选，不展示投票环节
      const winnerSeat = candidates[0];
      const winner = currentState.players.find((p) => p.seat === winnerSeat);
      let nextState: GameState = {
        ...currentState,
        badge: {
          ...currentState.badge,
          holderSeat: winnerSeat,
          allVotes: {},
          history: { ...currentState.badge.history, [currentState.day]: {} },
          electionWinners: { ...currentState.badge.electionWinners, [currentState.day]: winnerSeat },
        },
      };
      // 使用特殊消息，不显示票数
      const autoElectMsg = texts.t("badgePhase.autoElected", { seat: winnerSeat + 1, name: winner?.displayName || "" });
      nextState = addSystemMessage(nextState, autoElectMsg);
      setGameState(nextState);
      setDialogue(texts.speakerHost, autoElectMsg, false);
      await delay(DELAY_CONFIG.DIALOGUE);
      await onBadgeElectionComplete(nextState);
      return;
    }

    // AI 玩家投票（候选人不投票）
    const human = currentState.players.find((p) => p.isHuman);
    const humanIsCandidate = human && candidates.includes(human.seat);
    
    // 只对非候选人显示投票提示
    // 已死未公布（夜 1 被刀）的玩家不投票；候选人也不投票。
    if (human?.alive && !humanIsCandidate && !getPendingDeathSeats(currentState).includes(human.seat)) {
      setDialogue(texts.speakerHost, texts.uiText.badgeVotePrompt, false);
    } else {
      setDialogue(texts.speakerHost, texts.uiText.aiVoting, false);
    }
    gameStateRef.current = currentState;
    setGameState(currentState);
    const aiPlayers = excludePendingDeathPlayers(
      currentState,
      currentState.players.filter((p) => p.alive && !p.isHuman && !candidates.includes(p.seat) &&
        (!isResume || typeof currentState.badge.votes[p.playerId] !== "number"))
    );
    // 对局或投票轮次已经变化时，旧返回不能写入新一轮。
    const sameBadgeRound = () => {
      const latest = gameStateRef.current;
      return (
        latest.gameId === state.gameId &&
        latest.day === state.day &&
        latest.phase === "DAY_BADGE_ELECTION" &&
        latest.badge.revoteCount === currentState.badge.revoteCount
      );
    };
    // Abstain (-1) is recorded as-is; invalid non-abstain results also abstain.
    const normalizeBadgeVote = (seat: number) =>
      seat !== BADGE_VOTE_ABSTAIN && candidates.length > 0 && !candidates.includes(seat)
        ? BADGE_VOTE_ABSTAIN
        : seat;
    const fetchBadgeVote = async (aiPlayer: (typeof aiPlayers)[number]) => {
      try {
        return normalizeBadgeVote(await generateAIBadgeVote(currentState, aiPlayer));
      } catch (e) {
        console.warn("[wolfcha] AI badge vote threw, treating as abstain", e);
        return BADGE_VOTE_ABSTAIN;
      }
    };
    const writeBadgeVote = (aiPlayer: (typeof aiPlayers)[number], targetSeat: number) => {
      const latestState = gameStateRef.current;
      currentState = {
        ...currentState,
        badge: {
          ...currentState.badge,
          votes: { ...latestState.badge.votes, [aiPlayer.playerId]: targetSeat },
        },
      };
      gameStateRef.current = currentState;
      setGameState(currentState);
    };

    try {
      setIsWaitingForAI(true);
      // 警徽投票同放逐投票：第一席先算完，它的 prefill 把共用前綴寫進上游快取，
      // 其餘席位併發直接命中（第一席本身就是暖機，不再另送 max_tokens=1 暖機）。
      // 第一席先算完（它的票進公共資訊，後面的人看得到），其餘併發送。
      const [firstVoter, ...laterVoters] = aiPlayers;
      if (firstVoter) {
        const firstSeat = await fetchBadgeVote(firstVoter);
        if (!sameBadgeRound()) return;
        writeBadgeVote(firstVoter, firstSeat);
      }

      if (laterVoters.length > 0) {
        const settledVotes = await Promise.all(
          laterVoters.map(async (aiPlayer) => ({ aiPlayer, seat: await fetchBadgeVote(aiPlayer) }))
        );
        if (!sameBadgeRound()) return;
        for (const settled of settledVotes) {
          if (!sameBadgeRound()) return;
          writeBadgeVote(settled.aiPlayer, settled.seat);
          // 保留逐票落地的視覺節奏（網路已併發完成，這裡只錯開畫面更新）
          await delay(BADGE_VOTE_BEAT_MS);
        }
      }
    } finally {
      setIsWaitingForAI(false);
    }

    // AI投票结束后统一结算一次
    await maybeResolveBadgeElection(currentState);
  }, [setGameState, setDialogue, setIsWaitingForAI, maybeResolveBadgeElection, onBadgeElectionComplete]);

  // 更新 ref 以打破循环依赖
  startBadgeSpeechPhaseRef.current = startBadgeSpeechPhase;
  maybeStartBadgeSpeechAfterSignupRef.current = maybeStartBadgeSpeechAfterSignup;

  /** 警长移交警徽 */
  /**
   * 繼續警徽競選發言（競選被自爆中斷後，下一個天亮續辦）。
   *
   * 與 `startBadgeSpeechPhase` 的差別：跳過「中斷前已經發言過」的候選人
   * （`badge.electionSpokenSeats`，因為跨天後當日發言紀錄已不包含前一天的競選發言），
   * 並且把 `speechRoundStartMessageIndex` 重新對齊本輪，避免重複發言。
   */
  const resumeBadgeSpeechPhase = useCallback(async (state: GameState) => {
    const texts = getTexts();
    const candidates = state.badge.candidates || [];
    const alreadySpoken = new Set(state.badge.electionSpokenSeats ?? []);
    const remaining = excludePendingDeathPlayers(
      state,
      state.players.filter((p) => p.alive && candidates.includes(p.seat) && !alreadySpoken.has(p.seat))
    );

    let currentState = transitionPhase(state, "DAY_BADGE_SPEECH");
    currentState = {
      ...currentState,
      badge: { ...currentState.badge, electionSuspended: false, electionSpokenSeats: undefined },
      currentSpeakerSeat: null,
      daySpeechStartSeat: null,
    };

    if (remaining.length === 0) {
      // 沒有還沒發言的候選人：直接進競選投票
      setGameState(currentState);
      await startBadgeElectionPhase(currentState, { isResume: true });
      return;
    }

    const firstSpeaker = remaining[0];
    currentState = addSystemMessage(
      currentState,
      texts.systemMessages.badgeSpeechStart
    );
    currentState = {
      ...currentState,
      daySpeechStartSeat: firstSpeaker.seat,
      currentSpeakerSeat: firstSpeaker.seat,
    };
    setDialogue(texts.speakerHost, texts.systemMessages.badgeSpeechStart, false);
    setGameState(currentState);

    await delay(DELAY_CONFIG.DIALOGUE);
    await waitForUnpause();

    if (!firstSpeaker.isHuman) {
      await runAISpeech(currentState, firstSpeaker);
    } else {
      setDialogue(texts.speakerHint, texts.uiText.yourTurn, false);
    }
  }, [setGameState, setDialogue, waitForUnpause, runAISpeech, startBadgeElectionPhase]);

  const handleBadgeTransfer = useCallback(async (
    state: GameState,
    sheriff: Player,
    afterTransfer: (s: GameState) => Promise<void>
  ) => {
    const texts = getTexts();
    let currentState = transitionPhase(state, "BADGE_TRANSFER");
    currentState = addSystemMessage(currentState, texts.systemMessages.badgeTransferStart(sheriff.seat + 1, sheriff.displayName));
    setGameState(currentState);

    await waitForUnpause();

    if (sheriff.isHuman) {
      // 保存回调以便人类操作后继续流程
      humanBadgeTransferCallbackRef.current = afterTransfer;
      setDialogue(texts.speakerSystem, texts.t("badgePhase.transferPrompt"), false);
      return;
    }

    // AI 警长选择移交对象
    setIsWaitingForAI(true);
    const targetSeat = await generateBadgeTransfer(currentState, sheriff);
    setIsWaitingForAI(false);

    if (targetSeat === BADGE_TRANSFER_TORN) {
      // 撕毁警徽
      currentState = {
        ...currentState,
        badge: { ...currentState.badge, holderSeat: null },
      };
      currentState = addSystemMessage(currentState, texts.systemMessages.badgeTorn(sheriff.seat + 1, sheriff.displayName));
      setDialogue(texts.speakerHost, texts.systemMessages.badgeTorn(sheriff.seat + 1, sheriff.displayName), false);
    } else {
      // 正常移交
      const target = currentState.players.find((p) => p.seat === targetSeat);
      if (target) {
        currentState = {
          ...currentState,
          badge: { ...currentState.badge, holderSeat: targetSeat },
        };
        currentState = addSystemMessage(currentState, texts.systemMessages.badgeTransferred(sheriff.seat + 1, targetSeat + 1, target.displayName));
        setDialogue(texts.speakerHost, texts.systemMessages.badgeTransferred(sheriff.seat + 1, targetSeat + 1, target.displayName), false);
      }
    }
    setGameState(currentState);

    await delay(DELAY_CONFIG.LONG);
    await waitForUnpause();
    await afterTransfer(currentState);
  }, [setGameState, setDialogue, setIsWaitingForAI, waitForUnpause]);

  /** 人类警长移交警徽 */
  const handleHumanBadgeTransfer = useCallback(async (targetSeat: number) => {
    const texts = getTexts();
    if (gameState.phase !== "BADGE_TRANSFER") return;

    const sheriffSeat = gameState.badge.holderSeat;
    const human = gameState.players.find((p) => p.isHuman);
    if (!human || human.seat !== sheriffSeat) return;

    let currentState: GameState;

    if (targetSeat === BADGE_TRANSFER_TORN) {
      // 撕毁警徽
      currentState = {
        ...gameState,
        badge: { ...gameState.badge, holderSeat: null },
      };
      currentState = addSystemMessage(currentState, texts.systemMessages.badgeTorn(sheriffSeat! + 1, human.displayName));
      setDialogue(texts.speakerHost, texts.systemMessages.badgeTorn(sheriffSeat! + 1, human.displayName), false);
    } else {
      // 正常移交
      const target = gameState.players.find((p) => p.seat === targetSeat);
      if (!target || !target.alive) return;

      currentState = {
        ...gameState,
        badge: { ...gameState.badge, holderSeat: targetSeat },
      };
      currentState = addSystemMessage(currentState, texts.systemMessages.badgeTransferred(sheriffSeat! + 1, targetSeat + 1, target.displayName));
      setDialogue(texts.speakerHost, texts.systemMessages.badgeTransferred(sheriffSeat! + 1, targetSeat + 1, target.displayName), false);
    }

    setGameState(currentState);

    await delay(DELAY_CONFIG.LONG);
    await waitForUnpause();
    
    // 使用保存的回调继续流程
    const callback = humanBadgeTransferCallbackRef.current;
    humanBadgeTransferCallbackRef.current = null;
    if (callback) {
      await callback(currentState);
    } else {
      // 如果没有保存的回调，使用默认的onBadgeTransferComplete
      await onBadgeTransferComplete(currentState);
    }
  }, [gameState, setGameState, setDialogue, waitForUnpause, onBadgeTransferComplete]);

  return {
    startBadgeSignupPhase,
    startBadgeSpeechPhase,
    resumeBadgeSpeechPhase,
    startBadgeElectionPhase,
    resumeBadgeSignupPhase,
    handleBadgeSignup,
    handleBadgeTransfer,
    handleHumanBadgeTransfer,
    maybeResolveBadgeElection,
  };
}
