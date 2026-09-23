"use client";

import { useCallback } from "react";
import { getRoleName } from "@/lib/game-constants";
import { useAtom } from "jotai";
import type { GameState, Player, Alignment } from "@/types/game";
import { gameStateAtom } from "@/store/game-machine";
import {
  transitionPhase,
  addSystemMessage,
  killPlayer,
  checkWinCondition,
  generateHunterShoot,
} from "@/lib/game-master";
import { getSystemMessages } from "@/lib/game-texts";
import { getDeathShotKind } from "@/lib/rules/death-skills";
import { getI18n } from "@/i18n/translator";
import { DELAY_CONFIG } from "@/lib/game-constants";
import { delay, type FlowToken } from "@/lib/game-flow-controller";
import { playNarrator } from "@/lib/narrator-audio-player";
import { gameSessionTracker } from "@/lib/game-session-tracker";
import { addPlayerMessage, generateGameEndRemark } from "@/lib/game-master";
import { getPendingLastWordsSeats } from "@/lib/rules/last-words";
import { resolveNightDeaths } from "@/lib/rules/night-resolution";

export interface SpecialEventsCallbacks {
  setDialogue: (speaker: string, text: string, isStreaming?: boolean) => void;
  setIsWaitingForAI: (waiting: boolean) => void;
  waitForUnpause: () => Promise<void>;
  isTokenValid: (token: FlowToken) => boolean;
  prepareFinalState?: (state: GameState) => Promise<GameState>;
}

export interface SpecialEventsActions {
  handleHunterDeath: (state: GameState, hunter: Player, diedAtNight: boolean, token: FlowToken, afterHunter: (state: GameState) => Promise<void>) => Promise<void>;
  endGame: (state: GameState, winner: Alignment) => Promise<void>;
  resolveNight: (state: GameState, token: FlowToken, afterResolve: (state: GameState) => Promise<void>) => Promise<void>;
}

/**
 * 特殊事件 Hook
 * 负责管理猎人开枪、游戏结束、夜晚结算等特殊流程
 */
export function useSpecialEvents(
  callbacks: SpecialEventsCallbacks
): SpecialEventsActions {
  const getTexts = () => {
    const { t } = getI18n();
    return {
      t,
      systemMessages: getSystemMessages(),
      speakerHost: t("speakers.host"),
      speakerSystem: t("speakers.system"),
    };
  };
  const [, setGameState] = useAtom(gameStateAtom);

  const { setDialogue, setIsWaitingForAI, waitForUnpause, isTokenValid, prepareFinalState } = callbacks;

  /** 游戏结束 */
  const endGame = useCallback(async (state: GameState, winner: Alignment) => {
    const texts = getTexts();
    const finalInputState = prepareFinalState ? await prepareFinalState(state) : state;
    let currentState = transitionPhase(finalInputState, "GAME_END");
    currentState = { ...currentState, winner, endGameVotes: [], endGameVotingDone: false };

    currentState = addSystemMessage(currentState, winner === "village" ? texts.systemMessages.villageWin : texts.systemMessages.wolfWin);
    const roleRevealPayload = {
      title: texts.t("specialEvents.roleRevealTitle"),
      players: currentState.players
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((p) => ({
          playerId: p.playerId,
          seat: p.seat,
          name: p.displayName,
          role: p.role,
          isHuman: p.isHuman,
          modelRef: p.agentProfile?.modelRef,
        })),
    };
    currentState = addSystemMessage(currentState, `[ROLE_REVEAL]${JSON.stringify(roleRevealPayload)}`);
    setDialogue(texts.speakerHost, winner === "village" ? texts.t("specialEvents.villageWinLine") : texts.t("specialEvents.wolfWinLine"), false);

    setGameState(currentState);

    // 先持久化会话终态，再继续清理本地流程。
    const winnerType = winner === "village" ? "villager" : "wolf";
    await gameSessionTracker.end(winnerType, true).catch((err) => {
      console.error("[game-session] Failed to end:", err);
    });

    // 赛后感言：身份全公开后，AI 角色并发生成本局复盘（赢家点评真神/调侃对方
    // 「卧底」，输家吐槽猪队友），全部算完再按座位序逐席播出。
    // generateGameEndRemark 内部已把失败吞成空感言，Promise.all 不会被打断。
    currentState = addSystemMessage(currentState, texts.t("specialEvents.remarkTitle"));
    setGameState(currentState);
    setIsWaitingForAI(true);
    try {
      const speakers = currentState.players
        .filter((p) => !p.isHuman)
        .sort((a, b) => a.seat - b.seat);
      const results = await Promise.all(
        speakers.map((speaker) => generateGameEndRemark(currentState, speaker, winner))
      );
      // 票先全部落地：即使感言为空，票仍有效（供系統分析計分）。
      currentState = {
        ...currentState,
        endGameVotes: [
          ...(currentState.endGameVotes ?? []),
          ...speakers.map((speaker, i) => ({
            voterId: speaker.playerId,
            voterName: speaker.displayName,
            voterRole: speaker.role,
            mvpPlayerId: results[i].mvpPlayerId,
            mvpReason: results[i].mvpReason,
            svpPlayerId: results[i].svpPlayerId,
            svpReason: results[i].svpReason,
          })),
        ],
      };
      for (const [i, speaker] of speakers.entries()) {
        const remark = results[i].remark;
        if (!remark.trim()) {
          console.warn("[game-end] 空感言，跳过:", speaker.displayName);
          continue;
        }
        currentState = addPlayerMessage(currentState, speaker.playerId, remark);
        setGameState(currentState);
        setDialogue(speaker.displayName, remark, false);
        await delay(DELAY_CONFIG.DIALOGUE);
      }
    } finally {
      setIsWaitingForAI(false);
    }
    // 投票流程结束（含失败跳过），让系统分析可以开始计票。
    currentState = { ...currentState, endGameVotingDone: true };
    setGameState(currentState);

    // 播放游戏结束语音
    await playNarrator(winner === "village" ? "villageWin" : "wolfWin");
  }, [setGameState, setDialogue, setIsWaitingForAI, prepareFinalState]);

  /** 处理猎人死亡开枪 */
  const handleHunterDeath = useCallback(async (
    state: GameState,
    hunter: Player,
    diedAtNight: boolean,
    token: FlowToken,
    afterHunter: (state: GameState) => Promise<void>
  ) => {
    const texts = getTexts();
    let currentState = transitionPhase(state, "HUNTER_SHOOT");
    setGameState(currentState);

    if (hunter.isHuman) {
      // 存储是否夜间死亡的信息，供后续 handleNightAction 使用
      (currentState as GameState & { _hunterDiedAtNight?: boolean })._hunterDiedAtNight = diedAtNight;
      setGameState(currentState);
      // 狼王用的是狼槍：提示文字要換成狼王版，不要說「你是猎人」
      setDialogue(
        texts.speakerSystem,
        texts.t(getDeathShotKind(hunter.role) === "wolf_gun" ? "specialEvents.wolfKingPrompt" : "specialEvents.hunterPrompt"),
        false
      );
      return;
    }

    // AI 猎人开枪
    setIsWaitingForAI(true);
    const shotDecision = await generateHunterShoot(currentState, hunter);
    const targetSeat = shotDecision.targetSeat;
    setIsWaitingForAI(false);

    if (!isTokenValid(token)) return;

    if (targetSeat !== null) {
      currentState = killPlayer(currentState, targetSeat);
      const target = currentState.players.find((p) => p.seat === targetSeat);
      if (target) {
        currentState = addSystemMessage(
          currentState,
          texts.systemMessages.hunterShoot(hunter.seat + 1, hunter.displayName, targetSeat + 1, target.displayName, getRoleName(hunter.role))
        );
        setDialogue(
          texts.speakerHost,
          texts.systemMessages.hunterShoot(hunter.seat + 1, hunter.displayName, targetSeat + 1, target.displayName, getRoleName(hunter.role)),
          false
        );
      }

      // 记录猎人开枪（reason 为猎人自己写下的开枪理由，仅进赛后感言 prompt）
      const shot = { hunterSeat: hunter.seat, targetSeat, reason: shotDecision.reason };
      if (diedAtNight) {
        const prevNightRecord = (currentState.nightHistory || {})[currentState.day] || {};
        currentState = {
          ...currentState,
          nightHistory: {
            ...(currentState.nightHistory || {}),
            [currentState.day]: { ...prevNightRecord, hunterShot: shot },
          },
        };
      } else {
        const prevDayRecord = (currentState.dayHistory || {})[currentState.day] || {};
        currentState = {
          ...currentState,
          dayHistory: {
            ...(currentState.dayHistory || {}),
            [currentState.day]: { ...prevDayRecord, hunterShot: shot },
          },
        };
      }
      setGameState(currentState);
    }

    const winner = checkWinCondition(currentState);
    if (winner) {
      await endGame(currentState, winner);
      return;
    }

    await delay(DELAY_CONFIG.LONG);
    await waitForUnpause();
    if (!isTokenValid(token)) return;

    await afterHunter(currentState);
  }, [setGameState, setDialogue, setIsWaitingForAI, waitForUnpause, isTokenValid, endGame]);

  /** 结算夜晚 */
  const resolveNight = useCallback(async (
    state: GameState,
    token: FlowToken,
    afterResolve: (state: GameState) => Promise<void>
  ) => {
    const texts = getTexts();
    let currentState = transitionPhase(state, "NIGHT_RESOLVE");
    setGameState(currentState);

    // 攝夢人座位：「攝夢人夜間出局 → 夢游者一并出局」的判定依據。
    const dreamerSeat = currentState.players.find((player) => player.role === "Dreamweaver" && player.alive)?.seat;

    // 夜間結算（狼刀／守護／解藥／毒藥／攝夢）走單一真相：rules/night-resolution。
    const { wolfTarget, guardTarget, witchSave, witchPoison, dreamTarget } = currentState.nightActions;
    // 「前一天晚上」的夢游者：同一座位連續兩晚被攝 → 隔夜出局。
    const previousDreamTarget = currentState.nightHistory?.[currentState.day - 1]?.dreamTarget;
    const { deaths: nightDeaths, wolfKillSuccessful, wolfVictimSeat, poisonVictimSeat, dreamVictimSeat } =
      resolveNightDeaths({
        wolfTarget,
        guardTarget,
        witchSave,
        witchPoison,
        dreamTarget,
        dreamerSeat,
        previousDreamTarget,
      });

    // 遺言規則：只有第一夜死者有遺言（無論幾個、無論死因）。先入列，
    // 實際發表排在死亡公告之後（DaySpeechPhase.startDaySpeechAfterBadge）。
    const pendingLastWordsSeats = getPendingLastWordsSeats({
      nightDay: currentState.day,
      deathSeats: nightDeaths.map((death) => death.seat),
      pending: currentState.pendingLastWordsSeats,
    });

    // 更新状态
    currentState = {
      ...currentState,
      pendingLastWordsSeats,
      nightActions: {
        ...currentState.nightActions,
        lastGuardTarget: guardTarget,
        lastDreamTarget: dreamTarget,
        pendingWolfVictim: wolfKillSuccessful ? wolfVictimSeat : undefined,
        pendingPoisonVictim: poisonVictimSeat,
        pendingDreamVictim: dreamVictimSeat,
      },
    };

    // 记录夜晚历史
    currentState = {
      ...currentState,
      nightHistory: {
        ...(currentState.nightHistory || {}),
        [currentState.day]: {
          guardTarget: currentState.nightActions.guardTarget,
          wolfTarget: currentState.nightActions.wolfTarget,
          witchSave: currentState.nightActions.witchSave,
          witchPoison: currentState.nightActions.witchPoison,
          seerTarget: currentState.nightActions.seerTarget,
          seerResult: currentState.nightActions.seerResult,
          dreamTarget: currentState.nightActions.dreamTarget,
          deaths: nightDeaths,
          resultsAnnounced: false,
          // 本人的私有決策理由：賽中不公開，只備賽後感言引用。
          guardReason: currentState.nightActions.guardReason,
          wolfReason: currentState.nightActions.wolfReason,
          witchSaveReason: currentState.nightActions.witchSaveReason,
          witchPoisonReason: currentState.nightActions.witchPoisonReason,
          seerReason: currentState.nightActions.seerReason,
          dreamReason: currentState.nightActions.dreamReason,
        },
      },
    };

    setGameState(currentState);

    await delay(DELAY_CONFIG.LONG);
    await waitForUnpause();
    if (!isTokenValid(token)) return;

    currentState = transitionPhase(currentState, "DAY_START");
    currentState = addSystemMessage(currentState, texts.systemMessages.dayBreak);
    setGameState(currentState);
    setDialogue(texts.speakerHost, texts.systemMessages.dayBreak, false);

    // 天亮时同步游戏进度到数据库
    gameSessionTracker.syncProgress().catch(() => {});

    // 播放旁白语音
    await playNarrator("dayBreak");

    await delay(DELAY_CONFIG.MEDIUM);
    await waitForUnpause();
    if (!isTokenValid(token)) return;

    await afterResolve(currentState);
  }, [setGameState, setDialogue, waitForUnpause, isTokenValid]);

  return {
    handleHunterDeath,
    endGame,
    resolveNight,
  };
}
