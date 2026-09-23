import { type GameState, type Player } from "@/types/game";
import { GamePhase } from "../core/GamePhase";
import type { GameAction, GameContext, PromptResult, SystemPromptPart } from "../core/types";
import {
  bindIdentityAndRoleSetting,
  buildGameContextParts,
  buildPlayerTodaySpeech,
  buildTodayTranscript,
  getRoleText,
  buildSharedSystemParts,
  buildSystemTextFromParts,
  buildPublicFactsForPlayer,
  buildDecisionGrounding,
} from "@/lib/prompt-utils";
import type { FlowToken } from "@/lib/game-flow-controller";
import {
  addSystemMessage,
  checkWinCondition,
  getNextAliveSeat,
  killPlayer,
  transitionPhase,
} from "@/lib/game-master";
import { getNextSpeechSeat, getSpeechPhaseOrder, getSpeechRoundStatus } from "@/lib/speech-order";
import { getMutedSeat } from "@/lib/rules/mute";
import { getSystemMessages, getUiText } from "@/lib/game-texts";
import { getI18n } from "@/i18n/translator";
import { DELAY_CONFIG } from "@/lib/game-constants";
import { delay } from "@/lib/game-flow-controller";
import { playNarrator } from "@/lib/narrator-audio-player";
import { getPlayerDiedKey } from "@/lib/narrator-voice";
import { getBoardRuleFlags } from "@/lib/rules/boards";
import { canSelfDestruct, hasAlreadyBoomed, isSelfDestructPhase } from "@/lib/rules/self-destruct";
import { canDuel } from "@/lib/rules/knight-duel";
import { canUseDeathShot } from "@/lib/rules/death-skills";
import { resolveSpeechSkillKind } from "@/lib/speech-skill";

type DaySpeechRuntime = {
  token: FlowToken;
  setGameState: (value: GameState | ((prev: GameState) => GameState)) => void;
  setDialogue: (speaker: string, text: string, isStreaming?: boolean) => void;
  waitForUnpause: () => Promise<void>;
  runAISpeech: (state: GameState, player: Player) => Promise<void>;
  onBadgeTransfer: (state: GameState, sheriff: Player, afterTransfer: (s: GameState) => Promise<void>) => Promise<void>;
  onHunterDeath: (state: GameState, hunter: Player, diedAtNight: boolean) => Promise<void>;
  onGameEnd: (state: GameState, winner: "village" | "wolf") => Promise<void>;
  onStartVote: (state: GameState, token: FlowToken) => Promise<void>;
  onBadgeSpeechEnd: (state: GameState) => Promise<void>;
  onPkSpeechEnd: (state: GameState) => Promise<void>;
  /** AI 自爆決策：返回 true 表示已自爆（由呼叫方處理後續），false 表示不自爆 */
  onSelfDestructCheck: (state: GameState, wolf: Player) => Promise<boolean>;
  /**
   * AI 騎士翻牌決鬥決策：
   * `night`＝決鬥成功、已進入黑夜；`continue`＝騎士以死謝罪、白天繼續；
   * `ended`＝這一步直接結束遊戲；`none`＝不發動。
   */
  onKnightDuelCheck: (state: GameState, knight: Player) => Promise<{
    action: "none" | "night" | "continue" | "ended";
    state?: GameState;
  }>;
  /** 第一夜死者的遺言佇列：死亡公告後依序發表，完成後呼叫 continuation 續跑白天流程 */
  onPendingLastWords?: (state: GameState, continuation: (s: GameState) => Promise<void>) => Promise<void>;
};

export class DaySpeechPhase extends GamePhase {
  private isMovingToNextSpeaker = false;

  async onEnter(): Promise<void> {
    return;
  }

  getPrompt(context: GameContext, player: Player): PromptResult {
    const { t } = getI18n();
    const state = context.state;
    // 警长竞选发言(及警徽 PK)发生在夜间死亡正式公布之前，必须与 BadgePhase 的报名/竞选投票
    // 一样隐藏未公布的夜间结果（平安夜/今日死亡），否则会提前泄露"昨晚是否死人"。
    // 投票平票产生的 PK(pkSource==="vote")发生在死亡已公布之后，不需隐藏。
    const isPreAnnouncementCampaign =
      state.phase === "DAY_BADGE_SPEECH" ||
      (state.phase === "DAY_PK_SPEECH" && state.pkSource === "badge");
    const gameContextParts = buildGameContextParts(
      state,
      player,
      isPreAnnouncementCampaign ? { excludePendingDeaths: true } : undefined
    );
    // 場景說明（線上打字交流）原本黏在身份模板裡；現在身份只與角色設定綁定，
    // 場景改為獨立小節、排在「身份＋角色設定」之後。
    // coreRules 佔位符仍在模板裡（歷史遺留）：務必傳空字串，否則 ICU 會拋
    // FORMATTING_ERROR 並讓整段退回成 key（prompt 直接壞掉）。
    // 主持人發言品質評估：昨天被記為消極的座位，今天發言時要提醒他積極參與。
    // 只在「次日」提醒（評估只在當天摘要時產生，隔天沒再消極就不會再被記）。
    const assessment = state.speechAssessment;
    const participationNote =
      assessment && assessment.day + 1 === state.day && assessment.passiveSeats.includes(player.seat)
        ? t("promptUtils.gameContext.passiveSpeechNote")
        : "";
    const todayTranscript = buildTodayTranscript(state);
    const selfSpeech = buildPlayerTodaySpeech(state, player);
    const selfSpeechContext = selfSpeech
      ? t("promptUtils.gameContext.selfSpeechIncludedInTimeline", { seat: player.seat + 1 })
      : "";

    const isLastWords = state.phase === "DAY_LAST_WORDS";
    const isBadgeSpeech = state.phase === "DAY_BADGE_SPEECH";
    const isPkSpeech = state.phase === "DAY_PK_SPEECH";
    const isBadgePkSpeech = isPkSpeech && state.pkSource === "badge";
    const isVotePkSpeech = isPkSpeech && state.pkSource === "vote";
    const isCampaignSpeech = isBadgeSpeech || isBadgePkSpeech;

    const candidates = isBadgeSpeech || isBadgePkSpeech
      ? (Array.isArray(state.badge?.candidates) ? state.badge.candidates : [])
      : isVotePkSpeech && Array.isArray(state.pkTargets)
        ? state.pkTargets
        : [];

    const hasCandidateList = (isBadgeSpeech || isPkSpeech) && candidates.length > 0;

    const speechRound = getSpeechRoundStatus(state, player.seat);
    const formatSeatList = (seats: number[]) =>
      seats
        .map((seat) => t("ui.seatNumber", { seat: seat + 1 }))
        .join(t("common.listSeparator")) || t("common.none");
    const speakOrder = speechRound.currentPosition;
    const totalSpeakers = speechRound.totalSpeakers;
    const speakOrderHint = t("prompts.daySpeech.speakOrder.status", {
      orderList: formatSeatList(speechRound.orderedSeats),
      currentSeat: t("ui.seatNumber", { seat: player.seat + 1 }),
      speakOrder,
      totalSpeakers,
      spokenList: formatSeatList(
        speechRound.spokenSeats.filter((seat) => seat !== player.seat)
      ),
      passedList: formatSeatList(speechRound.passedWithoutSpeechSeats),
      unspokenList: formatSeatList(speechRound.yetToSpeakSeats),
    });

    const nonCandidateList = state.players
      .filter((p) => p.alive && !candidates.includes(p.seat))
      .map((p) => t("ui.seatNumber", { seat: p.seat + 1 }))
      .join(t("common.listSeparator"));
    const phaseRequirements = isBadgeSpeech
      ? t("prompts.daySpeech.campaign.badge") + "\n" + (hasCandidateList
        ? t("prompts.daySpeech.campaign.candidateNote", { list: nonCandidateList })
        : t("prompts.daySpeech.campaign.emptyCandidateNote"))
      : isBadgePkSpeech
        ? t("prompts.daySpeech.campaign.badgePk") + "\n" + t("prompts.daySpeech.campaign.pkParticipantNote", { list: nonCandidateList })
        : isVotePkSpeech
          ? t("prompts.daySpeech.campaign.votePk") + "\n" + t("prompts.daySpeech.campaign.pkParticipantNote", { list: nonCandidateList })
        : "";

    const publicFactsForPlayer = buildPublicFactsForPlayer(state, player);

    // system 只放全桌通用的內容（說話/格式規則＋公共基本盤）；
    // 逐人內容（身份、人設、勝負條件、階段任務、個人公開事實）全進 user 個人區，
    // 否則 system 第一個 token 就逐人不同，後面的公共區塊全部無法共用快取。
    const identityContent = bindIdentityAndRoleSetting(t("prompts.daySpeech.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
      coreRules: "",
    }).trim(), player, !!state.isGenshinMode);
    const wasVotedOut = isLastWords && state.dayHistory?.[state.day]?.executed?.seat === player.seat;
    const taskLine = isLastWords
      ? t(
        player.role === "Hunter" && wasVotedOut
          ? "prompts.daySpeech.task.lastWordsVotedOutHunter"
          : wasVotedOut
            ? "prompts.daySpeech.task.lastWordsVotedOut"
            : "prompts.daySpeech.task.lastWords",
        { seat: player.seat + 1, name: player.displayName }
      )
      : isCampaignSpeech
        ? t("prompts.daySpeech.task.campaign")
        : isVotePkSpeech
          ? t("prompts.daySpeech.task.votePk")
          : isPkSpeech
            ? t("prompts.daySpeech.task.pk")
            : t("prompts.daySpeech.task.dayDiscussion");

    const taskSection = t("prompts.daySpeech.task.section", { taskLine, campaignRequirements: phaseRequirements ? "\n" + phaseRequirements : "" });
    const guidelinesSection = state.isGenshinMode
      ? t("prompts.daySpeech.guidelines.genshin")
      : t("prompts.daySpeech.guidelines.default");
    // system 只放全桌逐字相同的共用開場（陣容／規則／攻略）；說話要求是本輪任務，放 user。
    const systemParts: SystemPromptPart[] = [...buildSharedSystemParts(state)];
    const system = buildSystemTextFromParts(systemParts);

    const phaseHint = isBadgeSpeech
      ? t("prompts.daySpeech.phaseHint.badge")
      : isBadgePkSpeech
        ? t("prompts.daySpeech.phaseHint.badgePk")
        : isVotePkSpeech
          ? t("prompts.daySpeech.phaseHint.votePk")
          : isPkSpeech
            ? t("prompts.daySpeech.phaseHint.pk")
        : "";
    const phaseHintSection = phaseHint ? t("prompts.daySpeech.phaseSection", { phaseHint }) : "";

    // 發言階段技能（自爆／翻牌決鬥）：併進同一次發言請求，省掉一輪完整 context
    // 第二次請求。模型漏寫 skill 時，呼叫端會退回獨立決策請求（見 lib/speech-skill.ts）。
    const skillKind = resolveSpeechSkillKind(state, player);
    const skillContract = skillKind === "self_destruct"
      ? t("prompts.daySpeech.skillContract.selfDestruct")
      : skillKind === "knight_duel"
        ? t("prompts.daySpeech.skillContract.knightDuel")
        : "";
    const formatReminder = skillKind
      ? t("prompts.daySpeech.formatReminderWithSkill")
      : t("prompts.daySpeech.formatReminder");

    const user = t("prompts.daySpeech.user", {
      sharedContext: gameContextParts.shared,
      privateContext: [
        gameContextParts.private,
        identityContent,
        participationNote,
        taskSection,
        guidelinesSection,
        publicFactsForPlayer,
        skillContract,
      ].filter(Boolean).join("\n\n"),
      todayTranscript: todayTranscript || t("prompts.daySpeech.userNoTranscript", { speakOrder }),
      selfSpeech: selfSpeechContext || t("prompts.daySpeech.userNoSelfSpeech"),
      phaseHintSection,
      speakOrderHint,
    }) + `\n\n${buildDecisionGrounding(state, player)}\n${
      t("promptUtils.gameContext.speechOrderCheck", { seats: formatSeatList(speechRound.yetToSpeakSeats) })
    }${speechRound.yetToSpeakSeats.length === 0
      ? t("promptUtils.gameContext.speechOrderLast")
      : t("promptUtils.gameContext.speechOrderOthersNoNew")}

${formatReminder}`;

    return { system, user, systemParts };
  }

  async handleAction(_context: GameContext, _action: GameAction): Promise<void> {
    const runtime = this.getRuntime(_context);
    if (!runtime) return;

    if (_action.type === "START_DAY_SPEECH_AFTER_BADGE") {
      await this.startDaySpeechAfterBadge(_context.state, runtime, _action.options);
      return;
    }
    if (_action.type === "ANNOUNCE_NIGHT_RESULTS") {
      // 只補公布死訊與第一夜遺言（自爆跳過白天流程時使用），不進入白天討論
      const announced = await this.announceNightResults(_context.state, runtime, _action.options);
      await this.runPendingLastWords(runtime, announced.state, async () => {});
      return;
    }
    if (_action.type === "ADVANCE_SPEAKER") {
      await this.advanceSpeaker(_context.state, runtime);
    }
  }

  async onExit(): Promise<void> {
    return;
  }

  private getRuntime(context: GameContext): DaySpeechRuntime | null {
    const raw = context.extras as DaySpeechRuntime | undefined;
    if (!raw) return null;
    if (!raw.setGameState || !raw.setDialogue || !raw.waitForUnpause) return null;
    if (!raw.runAISpeech || !raw.onBadgeTransfer || !raw.onHunterDeath || !raw.onGameEnd) return null;
    if (!raw.onStartVote || !raw.onBadgeSpeechEnd || !raw.onPkSpeechEnd) return null;
    // 提供默认的空实现以保持向后兼容
    if (!raw.onSelfDestructCheck) {
      raw.onSelfDestructCheck = async () => false;
    }
    if (!raw.onKnightDuelCheck) {
      raw.onKnightDuelCheck = async () => ({ action: "none" as const });
    }
    if (!raw.onPendingLastWords) {
      raw.onPendingLastWords = async (state, continuation) => {
        await continuation(state);
      };
    }
    return raw;
  }

  /**
   * 死訊公告：把「已結算但還沒公布」的夜晚死亡套用到玩家並公告。
   *
   * 自爆會跳過當天剩餘流程直接天黑，因此這個方法也會被自爆流程單獨呼叫
   * （action `ANNOUNCE_NIGHT_RESULTS`），確保第一夜死訊與其遺言不會被吃掉。
   */
  private async announceNightResults(
    state: GameState,
    runtime: DaySpeechRuntime,
    options?: { skipAnnouncements?: boolean }
  ): Promise<{ state: GameState; wolfVictim?: Player; poisonVictim?: Player; hasDeaths: boolean }> {
    const { t } = getI18n();
    const systemMessages = getSystemMessages();
    const speakerHost = t("speakers.host");
    let currentState = state;
    const skipAnnouncements = options?.skipAnnouncements === true;

    // 這一夜已經公告過（例如自爆中斷競選時先用 ANNOUNCE_NIGHT_RESULTS 補公布過）就不再重複：
    // 否則第二次呼叫會因為沒有 pending 死因而誤報「平安夜」。
    if (currentState.nightHistory?.[currentState.day]?.resultsAnnounced === true) {
      return { state: currentState, hasDeaths: false };
    }

    const { pendingWolfVictim, pendingPoisonVictim } = currentState.nightActions;
    let hasDeaths = false;
    let wolfVictim: Player | undefined;
    let poisonVictim: Player | undefined;

    if (!skipAnnouncements) {
      if (pendingWolfVictim !== undefined) {
        hasDeaths = true;
        currentState = killPlayer(currentState, pendingWolfVictim);
        wolfVictim = currentState.players.find((p) => p.seat === pendingWolfVictim);
        if (wolfVictim) {
          currentState = addSystemMessage(
            currentState,
            systemMessages.playerKilled(wolfVictim.seat + 1, wolfVictim.displayName)
          );
          runtime.setDialogue(
            speakerHost,
            systemMessages.playerKilled(wolfVictim.seat + 1, wolfVictim.displayName),
            false
          );
          runtime.setGameState(currentState);

          const diedKey = getPlayerDiedKey(wolfVictim.seat);
          if (diedKey) await playNarrator(diedKey);

          await delay(DELAY_CONFIG.LONG);
          await runtime.waitForUnpause();
        }
      }

      if (pendingPoisonVictim !== undefined) {
        const sameTargetAsWolf =
          pendingWolfVictim !== undefined && pendingPoisonVictim === pendingWolfVictim;

        if (sameTargetAsWolf) {
          // 同刀同毒（毒奶）：人已隨刀口出局，nightHistory 死因會記為 poison，
          // canUseDeathShot 查夜史即封槍，不再全域關 hunterCanShoot（否則會誤傷日後狼王被票出開槍）。
        } else {
          hasDeaths = true;
          currentState = killPlayer(currentState, pendingPoisonVictim);
          poisonVictim = currentState.players.find((p) => p.seat === pendingPoisonVictim);
          if (poisonVictim) {
            // 被毒死者封槍改由 canUseDeathShot 查夜史（reason=poison），不再全域關 hunterCanShoot。
            currentState = addSystemMessage(
              currentState,
              systemMessages.playerKilled(poisonVictim.seat + 1, poisonVictim.displayName)
            );
            runtime.setDialogue(
              speakerHost,
              systemMessages.playerKilled(poisonVictim.seat + 1, poisonVictim.displayName),
              false
            );
            runtime.setGameState(currentState);

            const poisonDiedKey = getPlayerDiedKey(poisonVictim.seat);
            if (poisonDiedKey) await playNarrator(poisonDiedKey);

            await delay(DELAY_CONFIG.LONG);
            await runtime.waitForUnpause();
          }
        }
      }

      if (!hasDeaths) {
        currentState = addSystemMessage(currentState, systemMessages.peacefulNight);
        runtime.setDialogue(speakerHost, systemMessages.peacefulNight, false);
        runtime.setGameState(currentState);

        await playNarrator("peacefulNight");

        await delay(DELAY_CONFIG.NIGHT_RESOLVE);
        await runtime.waitForUnpause();
      }
    }

    // 禁言公告（公開資訊）：天亮時宣布今天誰不能發言，並寫進當日紀錄
    const mutedSeat = getMutedSeat(currentState);
    if (mutedSeat !== null) {
      const mutedPlayer = currentState.players.find((p) => p.seat === mutedSeat);
      if (mutedPlayer) {
        const mutedMsg = systemMessages.playerMuted(mutedPlayer.seat + 1, mutedPlayer.displayName);
        currentState = addSystemMessage(currentState, mutedMsg);
        runtime.setDialogue(speakerHost, mutedMsg, false);
        currentState = {
          ...currentState,
          dayHistory: {
            ...(currentState.dayHistory || {}),
            [currentState.day]: {
              ...(currentState.dayHistory?.[currentState.day] || {}),
              muted: { seat: mutedPlayer.seat },
            },
          },
        };
      }
    }

    currentState = {
      ...currentState,
      nightHistory: {
        ...currentState.nightHistory,
        [currentState.day]: { ...currentState.nightHistory?.[currentState.day], resultsAnnounced: true },
      },
      nightActions: {
        ...currentState.nightActions,
        pendingWolfVictim: undefined,
        pendingPoisonVictim: undefined,
        // 禁言只作用於「次日白天」，公告後即消耗；下一晚由禁言長老重新指定
        mutedTarget: undefined,
      },
    };
    runtime.setGameState(currentState);

    return { state: currentState, wolfVictim, poisonVictim, hasDeaths };
  }

  /**
   * 死亡公告之後、白天討論之前：先讓待發表遺言的死者（第一夜死者）依序發言。
   *
   * 若白天流程被自爆／警徽事件中斷，佇列會留在狀態裡，於下一次天亮補發表，
   * 不會因為「直接天黑」而遺失（見 GameState.pendingLastWordsSeats）。
   */
  private async runPendingLastWords(
    runtime: DaySpeechRuntime,
    baseState: GameState,
    startDiscussion: (s: GameState) => Promise<void>
  ): Promise<void> {
    if ((baseState.pendingLastWordsSeats ?? []).length > 0 && runtime.onPendingLastWords) {
      await runtime.onPendingLastWords(baseState, startDiscussion);
      return;
    }
    await startDiscussion(baseState);
  }

  private async startDaySpeechAfterBadge(
    state: GameState,
    runtime: DaySpeechRuntime,
    options?: { skipAnnouncements?: boolean }
  ): Promise<void> {
    const announced = await this.announceNightResults(state, runtime, options);
    const currentState = announced.state;
    const wolfVictim = announced.wolfVictim;

    const currentSheriffSeat = currentState.badge.holderSeat;
    const sheriffPlayer =
      currentSheriffSeat !== null ? currentState.players.find((p) => p.seat === currentSheriffSeat) : null;
    const deadSheriff = sheriffPlayer && !sheriffPlayer.alive ? sheriffPlayer : null;

    if (deadSheriff) {
      await runtime.onBadgeTransfer(currentState, deadSheriff, async (afterTransferState) => {
        const winnerAfterTransfer = checkWinCondition(afterTransferState);
        if (winnerAfterTransfer) {
          await runtime.onGameEnd(afterTransferState, winnerAfterTransfer);
          return;
        }

        const newSheriffSeat = afterTransferState.badge.holderSeat;
        await this.runPendingLastWords(runtime, afterTransferState, async (discussionState) => {
          if (
            wolfVictim &&
            discussionState.roleAbilities.hunterCanShoot &&
            canUseDeathShot({ state: discussionState, role: wolfVictim.role, seat: wolfVictim.seat, cause: "night_kill" })
          ) {
            await runtime.onHunterDeath(discussionState, wolfVictim, true);
            return;
          }
          await this.startDayDiscussion(discussionState, runtime, {
            // 警徽移交成功：從新警長下一位開始（新警長最後發言）；撕毀：從死者下一位開始
            sheriffSeat: newSheriffSeat,
            fallbackSeat: deadSheriff.seat,
          });
        });
      });
      return;
    }

    const winner = checkWinCondition(currentState);
    if (winner) {
      await runtime.onGameEnd(currentState, winner);
      return;
    }

    await this.runPendingLastWords(runtime, currentState, async (discussionState) => {
      if (
        wolfVictim &&
        discussionState.roleAbilities.hunterCanShoot &&
        canUseDeathShot({ state: discussionState, role: wolfVictim.role, seat: wolfVictim.seat, cause: "night_kill" })
      ) {
        await runtime.onHunterDeath(discussionState, wolfVictim, true);
        return;
      }
      await this.startDayDiscussion(discussionState, runtime, {
        sheriffSeat: discussionState.badge.holderSeat,
        fallbackSeat: wolfVictim?.seat ?? null,
      });
    });
  }

  /**
   * 進入白天討論（死亡公告與遺言都已完成）。
   *
   * @param anchor 發言起點：`sheriffSeat` 存活時從警長下一位開始（警長最後發言）；
   *               否則從 `fallbackSeat`（通常為刀口死者）下一位開始；兩者皆無時從最小存活座位開始。
   */
  private async startDayDiscussion(
    state: GameState,
    runtime: DaySpeechRuntime,
    anchor: { sheriffSeat: number | null; fallbackSeat: number | null }
  ): Promise<void> {
    const { t } = getI18n();
    const systemMessages = getSystemMessages();
    const uiText = getUiText();
    const speakerHost = t("speakers.host");
    const speakerHint = t("speakers.hint");

    let speechState = transitionPhase(state, "DAY_SPEECH");
    speechState = addSystemMessage(speechState, systemMessages.dayDiscussion);

    await playNarrator("discussionStart");

    const alivePlayers = speechState.players.filter((p) => p.alive);
    const speechDirection = "clockwise" as const;
    const isSheriffAlive =
      typeof anchor.sheriffSeat === "number" && alivePlayers.some((p) => p.seat === anchor.sheriffSeat);

    let startSeat: number | null;
    if (isSheriffAlive) {
      startSeat = getNextAliveSeat(speechState, anchor.sheriffSeat as number, true, speechDirection);
    } else if (anchor.fallbackSeat !== null) {
      startSeat = getNextAliveSeat(speechState, anchor.fallbackSeat, false, speechDirection);
    } else {
      const aliveSeats = alivePlayers.map((p) => p.seat).sort((a, b) => a - b);
      startSeat = aliveSeats[0] ?? null;
    }

    // 首位發言者要從「已過濾禁言」的權威順序取，否則被禁言者會拿到發言輪
    speechState = {
      ...speechState,
      daySpeechStartSeat: startSeat,
      currentSpeakerSeat: null,
      speechDirection,
    };
    const orderedSeats = getSpeechPhaseOrder(speechState);
    const firstSeat = orderedSeats[0] ?? null;
    const firstSpeaker = firstSeat !== null ? alivePlayers.find((p) => p.seat === firstSeat) || null : null;
    speechState = { ...speechState, currentSpeakerSeat: firstSpeaker?.seat ?? null };

    runtime.setDialogue(speakerHost, uiText.speechOrder, false);
    runtime.setGameState(speechState);

    await delay(1500);
    await runtime.waitForUnpause();

    if (firstSpeaker && !firstSpeaker.isHuman) {
      await runtime.runAISpeech(speechState, firstSpeaker);
    } else if (firstSpeaker?.isHuman) {
      runtime.setDialogue(speakerHint, uiText.yourTurn, false);
    }
  }

  private async advanceSpeaker(state: GameState, runtime: DaySpeechRuntime): Promise<void> {
    const { t } = getI18n();
    const uiText = getUiText();
    const speakerHint = t("speakers.hint");
    if (this.isMovingToNextSpeaker) return;
    this.isMovingToNextSpeaker = true;

    try {
      // 發言結束後的技能檢查都在「當前發言者」身上跑，共用同一份旗標。
      const flags = getBoardRuleFlags(state.players.length);
      const currentSpeaker = state.players.find((p) => p.seat === state.currentSpeakerSeat);

      // AI 自爆決策：發言結束後檢查是否自爆（所有狼陣營角色皆可，見 lib/rules/self-destruct.ts）
      if (isSelfDestructPhase(state.phase)) {
        if (
          currentSpeaker &&
          !currentSpeaker.isHuman &&
          currentSpeaker.alive &&
          canSelfDestruct({ phase: state.phase, role: currentSpeaker.role, flags }) &&
          !hasAlreadyBoomed(state.roleAbilities.boomedSeats, currentSpeaker.seat)
        ) {
          const boomed = await runtime.onSelfDestructCheck(state, currentSpeaker);
          if (boomed) return; // 自爆已处理，不再继续发言流程
        }
      }

      // AI 騎士翻牌決鬥：白天發言階段（警上 PK 發言與遺言階段不可發動）
      let effectiveState = state;
      if (
        currentSpeaker &&
        !currentSpeaker.isHuman &&
        currentSpeaker.alive &&
        canDuel({
          phase: state.phase,
          role: currentSpeaker.role,
          flags,
          duelUsedSeats: state.roleAbilities.duelUsedSeats,
          seat: currentSpeaker.seat,
        })
      ) {
        const duel = await runtime.onKnightDuelCheck(state, currentSpeaker);
        if (duel.action === "night" || duel.action === "ended") return;
        if (duel.action === "continue") {
          // 決鬥失敗：騎士出局、白天繼續 → 用結算後的最新狀態推進到下一位發言者
          effectiveState = duel.state ?? state;
        }
      }

      // 实际推进与 Prompt 共用同一个本轮顺序和发言记录来源。
      const nextSeat = getNextSpeechSeat(effectiveState);

      if (nextSeat === null) {
        if (effectiveState.phase === "DAY_PK_SPEECH") {
          await runtime.onPkSpeechEnd(effectiveState);
          return;
        }
        if (effectiveState.phase === "DAY_BADGE_SPEECH") {
          await runtime.onBadgeSpeechEnd(effectiveState);
          return;
        }
        await runtime.onStartVote(effectiveState, runtime.token);
        return;
      }

      const currentState = { ...effectiveState, currentSpeakerSeat: nextSeat };
      runtime.setGameState(currentState);

      const nextPlayer = currentState.players.find((p) => p.seat === nextSeat);
      if (nextPlayer && !nextPlayer.isHuman) {
        await runtime.runAISpeech(currentState, nextPlayer);
      } else if (nextPlayer?.isHuman) {
        runtime.setDialogue(speakerHint, uiText.yourTurn, false);
      }
    } finally {
      this.isMovingToNextSpeaker = false;
    }
  }
}
