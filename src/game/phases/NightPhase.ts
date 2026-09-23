import type { GameState, Player, Phase } from "@/types/game";
import { isWolfRole } from "@/types/game";
import { GamePhase } from "../core/GamePhase";
import type { GameAction, GameContext, PromptResult, SystemPromptPart } from "../core/types";
import { bindIdentityAndRoleSetting, buildDecisionContext, buildGameContext, buildTodayTranscript, buildPlayerTodaySpeech, getRoleText, buildSharedSystemParts, buildSystemTextFromParts } from "@/lib/prompt-utils";
import {
  addSystemMessage,
  generateGuardAction,
  generateMuteAction,
  generateSeerAction,
  generateWitchAction,
  generateWolfAction,
  generateWolfTeamPlan,
  humanWolfNeedsNightInput,
  transitionPhase as rawTransitionPhase,
} from "@/lib/game-master";
import { canWitchSave, getGuardEligibleSeats } from "@/lib/rules/actions";
import { getMuteEligibleSeats, isValidMuteTarget } from "@/lib/rules/mute";
import { getBoardRuleFlags } from "@/lib/rules/boards";
import { getSystemMessages, getUiText } from "@/lib/game-texts";
import { DELAY_CONFIG } from "@/lib/game-constants";
import {
  delay,
  type FlowToken,
} from "@/lib/game-flow-controller";
import { playNarrator } from "@/lib/narrator-audio-player";
import { getI18n } from "@/i18n/translator";

function randomFakeActionDelay(): number {
  const min = DELAY_CONFIG.NIGHT_ROLE_ANIMATION_MIN;
  const max = DELAY_CONFIG.NIGHT_ROLE_ANIMATION_MAX;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

type NightPhaseRuntime = {
  token: FlowToken;
  setGameState: (value: GameState | ((prev: GameState) => GameState)) => void;
  setDialogue: (speaker: string, text: string, isStreaming?: boolean) => void;
  setIsWaitingForAI: (waiting: boolean) => void;
  waitForUnpause: () => Promise<void>;
  isTokenValid: (token: FlowToken) => boolean;
  onNightComplete: (state: GameState) => Promise<void>;
};

export class NightPhase extends GamePhase {
  async onEnter(): Promise<void> {
    return;
  }

  getPrompt(context: GameContext, player: Player): PromptResult {
    const state = context.state;
    const extras = context.extras ?? {};
    // 用呼叫端要求的階段（resolvePhasePrompt 會覆寫 state.phase，但直接呼叫時不會）
    const phase = context.phase ?? state.phase;

    switch (phase) {
      case "NIGHT_GUARD_ACTION":
        return this.buildGuardPrompt(state, player);
      case "NIGHT_MUTE_ACTION":
        return this.buildMutePrompt(state, player);
      case "NIGHT_WOLF_ACTION":
        return this.buildWolfPrompt(
          state,
          player,
          (extras.existingVotes as Record<string, number> | undefined) ?? {}
        );
      case "NIGHT_WITCH_ACTION":
        return this.buildWitchPrompt(
          state,
          player,
          extras.wolfTarget as number | undefined
        );
      case "NIGHT_SEER_ACTION":
        return this.buildSeerPrompt(state, player);
      default:
        return this.buildWolfPrompt(state, player, {});
    }
  }

  async handleAction(_context: GameContext, _action: GameAction): Promise<void> {
    const runtime = this.getRuntime(_context);
    if (!runtime) return;

    if (_action.type === "START_NIGHT") {
      await this.runNightPhase(_context.state, runtime);
      return;
    }
    if (_action.type === "CONTINUE_NIGHT_AFTER_GUARD") {
      await this.continueNightAfterGuard(_context.state, runtime);
      return;
    }
    if (_action.type === "CONTINUE_NIGHT_AFTER_MUTE") {
      await this.continueNightAfterMute(_context.state, runtime);
      return;
    }
    if (_action.type === "CONTINUE_NIGHT_AFTER_WOLF") {
      await this.continueNightAfterWolf(_context.state, runtime);
      return;
    }
    if (_action.type === "CONTINUE_NIGHT_AFTER_WITCH") {
      await this.continueNightAfterWitch(_context.state, runtime);
      return;
    }
  }

  async onExit(): Promise<void> {
    return;
  }

  private getRuntime(context: GameContext): NightPhaseRuntime | null {
    const raw = context.extras as NightPhaseRuntime | undefined;
    if (!raw) return null;
    if (!raw.setGameState || !raw.setDialogue || !raw.waitForUnpause || !raw.isTokenValid) return null;
    return raw;
  }

  private transitionPhase(state: GameState, newPhase: Phase): GameState {
    return rawTransitionPhase(state, newPhase);
  }

  private async runGuardAction(state: GameState, runtime: NightPhaseRuntime): Promise<GameState> {
    const { t } = getI18n();
    const speakerSystem = t("speakers.system");
    const systemMessages = getSystemMessages();
    const uiText = getUiText();
    const guard = state.players.find((p) => p.role === "Guard" && p.alive);

    let currentState = this.transitionPhase(state, "NIGHT_GUARD_ACTION");
    currentState = addSystemMessage(currentState, systemMessages.guardActionStart);
    runtime.setGameState(currentState);

    runtime.setIsWaitingForAI(true);
    runtime.setDialogue(speakerSystem, uiText.guardActing, false);
    await playNarrator("guardWake");

    if (!guard) {
      await delay(randomFakeActionDelay());
      await runtime.waitForUnpause();
      if (!runtime.isTokenValid(runtime.token)) return currentState;
      runtime.setIsWaitingForAI(false);
      await playNarrator("guardClose");
      return currentState;
    }

    if (guard.isHuman) {
      runtime.setIsWaitingForAI(false);
      runtime.setDialogue(speakerSystem, uiText.waitingGuard, false);
      return currentState;
    }

    const guardOutcome = await generateGuardAction(currentState, guard);
    await runtime.waitForUnpause();

    if (!runtime.isTokenValid(runtime.token)) return currentState;

    if (guardOutcome !== undefined) {
      currentState = {
        ...currentState,
        nightActions: {
          ...currentState.nightActions,
          guardTarget: guardOutcome.targetSeat,
          ...(guardOutcome.reason ? { guardReason: guardOutcome.reason } : {}),
        },
      };
    }
    runtime.setGameState(currentState);
    runtime.setIsWaitingForAI(false);

    await playNarrator("guardClose");

    return currentState;
  }

  /**
   * 禁言長老的夜間行動：指定明天不能發言的人。
   *
   * 順序：天黑 →（守衛）→ **禁言長老** → 狼人 → 女巫 → 預言家。
   * 禁言只限制發言：警徽競選投票、放逐投票、遺言都不受限。
   */
  private async runMuteAction(state: GameState, runtime: NightPhaseRuntime): Promise<GameState> {
    const { t } = getI18n();
    const speakerSystem = t("speakers.system");
    const systemMessages = getSystemMessages();
    const uiText = getUiText();
    const elder = state.players.find((p) => p.role === "MuteElder" && p.alive);

    let currentState = this.transitionPhase(state, "NIGHT_MUTE_ACTION");
    currentState = addSystemMessage(currentState, systemMessages.muteActionStart);
    runtime.setGameState(currentState);

    runtime.setIsWaitingForAI(true);
    runtime.setDialogue(speakerSystem, uiText.muteActing, false);
    await playNarrator("muteWake");

    if (!elder) {
      await delay(randomFakeActionDelay());
      await runtime.waitForUnpause();
      if (!runtime.isTokenValid(runtime.token)) return currentState;
      runtime.setIsWaitingForAI(false);
      await playNarrator("muteClose");
      return currentState;
    }

    if (elder.isHuman) {
      runtime.setIsWaitingForAI(false);
      runtime.setDialogue(speakerSystem, uiText.waitingMute, false);
      return currentState;
    }

    const muteOutcome = await generateMuteAction(currentState, elder);
    await runtime.waitForUnpause();

    if (!runtime.isTokenValid(runtime.token)) return currentState;

    if (muteOutcome !== undefined && isValidMuteTarget(currentState, elder.seat, muteOutcome.targetSeat)) {
      currentState = {
        ...currentState,
        nightActions: {
          ...currentState.nightActions,
          mutedTarget: muteOutcome.targetSeat,
          ...(muteOutcome.reason ? { muteReason: muteOutcome.reason } : {}),
        },
      };
    } else if (muteOutcome !== undefined) {
      console.warn("[wolfcha] 禁言目標不合法，本晚不發動禁言");
    }
    runtime.setGameState(currentState);
    runtime.setIsWaitingForAI(false);

    await playNarrator("muteClose");

    return currentState;
  }

  /** 禁言長老 AI 提示：只能選存活玩家、不能選自己 */
  private buildMutePrompt(state: GameState, player: Player): PromptResult {
    const { t } = getI18n();
    const gameContext = buildDecisionContext(state, player);
    const eligible = getMuteEligibleSeats(state, player.seat);
    const options = eligible
      .map((seat) => {
        const target = state.players.find((p) => p.seat === seat);
        return t("prompts.night.option", { seat: seat + 1, name: target?.displayName ?? "" });
      })
      .join(t("promptUtils.gameContext.listSeparator"));
    const exampleSeat = (eligible[0] ?? 0) + 1;

    const cacheableContent = bindIdentityAndRoleSetting(t("prompts.mute.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
      coreRules: "",
    }), player, !!state.isGenshinMode);
    const dynamicContent = t("prompts.mute.task", {
      options,
      jsonFormat: JSON.stringify({ seat: exampleSeat, reason: t("promptUtils.gameContext.jsonReasonMute") }),
    });
    // system 只放全桌逐字相同的共用開場（陣容／規則／攻略）；身分與本輪任務逐人不同，一律進 user。
    const systemParts: SystemPromptPart[] = [...buildSharedSystemParts(state)];
    const system = buildSystemTextFromParts(systemParts);

    const user = t("prompts.mute.user", {
      context: [gameContext, cacheableContent, dynamicContent].filter(Boolean).join("\n\n"),
      jsonFormat: JSON.stringify({ seat: exampleSeat, reason: t("promptUtils.gameContext.jsonReasonMute") }),
    });

    return { system, user, systemParts };
  }

  private async runWolfAction(state: GameState, runtime: NightPhaseRuntime): Promise<GameState> {
    const { t } = getI18n();
    const speakerSystem = t("speakers.system");
    const systemMessages = getSystemMessages();
    const uiText = getUiText();
    let currentState = this.transitionPhase(state, "NIGHT_WOLF_ACTION");
    currentState = addSystemMessage(currentState, systemMessages.wolfActionStart);
    runtime.setGameState(currentState);

    const wolves = currentState.players.filter((p) => isWolfRole(p.role) && p.alive);

    if (wolves.length === 0) {
      runtime.setIsWaitingForAI(true);
      runtime.setDialogue(speakerSystem, uiText.wolfActing, false);
      await playNarrator("wolfWake");

      await delay(randomFakeActionDelay());
      await runtime.waitForUnpause();
      if (!runtime.isTokenValid(runtime.token)) return currentState;

      runtime.setIsWaitingForAI(false);
      await playNarrator("wolfClose");
      return currentState;
    }

    if (wolves.length > 0) {
      const humanWolf = wolves.find((w) => w.isHuman);
      if (humanWolf) {
        runtime.setDialogue(speakerSystem, uiText.waitingWolf, false);
      } else {
        runtime.setIsWaitingForAI(true);
        runtime.setDialogue(speakerSystem, uiText.wolfActing, false);
      }

      await playNarrator("wolfWake");

      if (humanWolf) {
        return currentState;
      }

      const wolfVotes: Record<string, number> = {};
      try {
        // 简化逻辑：第一个狼人决定目标，其他狼人自动达成共识
        const firstWolf = wolves[0];
        const wolfOutcome = await generateWolfAction(currentState, firstWolf, {});
        const targetSeat = wolfOutcome?.targetSeat;
        
        await runtime.waitForUnpause();
        if (!runtime.isTokenValid(runtime.token)) return currentState;
        
        if (targetSeat !== undefined) {
          // 所有狼人投票给同一个目标
          for (const wolf of wolves) {
            wolfVotes[wolf.playerId] = targetSeat;
          }
        }

        currentState = {
          ...currentState,
          nightActions: {
            ...currentState.nightActions,
            wolfVotes,
            ...(targetSeat !== undefined ? { wolfTarget: targetSeat } : {}),
            ...(wolfOutcome?.reason ? { wolfReason: wolfOutcome.reason } : {}),
          },
        };
        runtime.setGameState(currentState);
      } catch (error) {
        console.error("[wolfcha] AI wolf vote failed:", error);
        currentState = {
          ...currentState,
          nightActions: { ...currentState.nightActions, wolfVotes },
        };
        runtime.setGameState(currentState);
      }

      runtime.setIsWaitingForAI(false);

      await playNarrator("wolfClose");
    }

    return currentState;
  }

  private async runWitchAction(state: GameState, runtime: NightPhaseRuntime): Promise<GameState> {
    const { t } = getI18n();
    const speakerSystem = t("speakers.system");
    const systemMessages = getSystemMessages();
    const uiText = getUiText();
    const witch = state.players.find((p) => p.role === "Witch" && p.alive);
    const canWitchAct = witch && (!state.roleAbilities.witchHealUsed || !state.roleAbilities.witchPoisonUsed);
    // 真人狼還欠第一夜分工：停在原地等前端對話框寫入計畫，
    // 不能帶著空計畫走完夜裡（白天狼隊只能各自為戰）。
    if (humanWolfNeedsNightInput(state)) return state;
    let currentState = state;
    // 第一夜狼隊商議（主導狼計畫）：刀口落定後、天亮公佈前生成一次，
    // 之後全程注入狼視角；失敗時全場照舊無協調（不攝錯——協調是增強，不是必要步驟）。
    // 所有夜間路徑（純 AI、真人守衛、真人狼）都匯流到這裡，掛點唯一。
    // 但有存活真人狼時改由真人指派（前端對話框寫入 wolfTeamPlan），這裡不搶著生成。
    if (currentState.day === 1 && !currentState.wolfTeamPlan) {
      const aliveHumanWolf = currentState.players.find(
        (p) => isWolfRole(p.role) && p.alive && p.isHuman
      );
      if (!aliveHumanWolf) {
        const plan = await generateWolfTeamPlan(currentState);
        await runtime.waitForUnpause();
        if (!runtime.isTokenValid(runtime.token)) return currentState;
        if (plan) {
          currentState = { ...currentState, wolfTeamPlan: plan };
          runtime.setGameState(currentState);
        }
      }
    }
    currentState = this.transitionPhase(currentState, "NIGHT_WITCH_ACTION");
    currentState = addSystemMessage(currentState, systemMessages.witchActionStart);
    runtime.setGameState(currentState);

    runtime.setIsWaitingForAI(true);
    runtime.setDialogue(speakerSystem, uiText.witchActing, false);
    await playNarrator("witchWake");

    if (!witch || !canWitchAct) {
      await delay(randomFakeActionDelay());
      await runtime.waitForUnpause();
      if (!runtime.isTokenValid(runtime.token)) return currentState;
      runtime.setIsWaitingForAI(false);
      await playNarrator("witchClose");
      return currentState;
    }

    if (witch.isHuman) {
      runtime.setIsWaitingForAI(false);
      runtime.setDialogue(speakerSystem, uiText.waitingWitch, false);
      return currentState;
    }

    const witchAction = await generateWitchAction(currentState, witch, currentState.nightActions.wolfTarget);
    await runtime.waitForUnpause();

    if (!runtime.isTokenValid(runtime.token)) return currentState;

    if (witchAction.type === "save") {
      currentState = {
        ...currentState,
        nightActions: {
          ...currentState.nightActions,
          witchSave: true,
          ...(witchAction.reason ? { witchSaveReason: witchAction.reason } : {}),
        },
        roleAbilities: { ...currentState.roleAbilities, witchHealUsed: true },
      };
    } else if (witchAction.type === "poison" && witchAction.target !== undefined) {
      currentState = {
        ...currentState,
        nightActions: {
          ...currentState.nightActions,
          witchPoison: witchAction.target,
          ...(witchAction.reason ? { witchPoisonReason: witchAction.reason } : {}),
        },
        roleAbilities: { ...currentState.roleAbilities, witchPoisonUsed: true },
      };
    }
    runtime.setGameState(currentState);
    runtime.setIsWaitingForAI(false);

    await playNarrator("witchClose");

    return currentState;
  }

  private async runSeerAction(state: GameState, runtime: NightPhaseRuntime): Promise<GameState> {
    const { t } = getI18n();
    const speakerSystem = t("speakers.system");
    const systemMessages = getSystemMessages();
    const uiText = getUiText();
    const seer = state.players.find((p) => p.role === "Seer" && p.alive);
    let currentState = this.transitionPhase(state, "NIGHT_SEER_ACTION");
    currentState = addSystemMessage(currentState, systemMessages.seerActionStart);
    runtime.setGameState(currentState);

    runtime.setIsWaitingForAI(true);
    runtime.setDialogue(speakerSystem, uiText.seerChecking, false);
    await playNarrator("seerWake");

    if (!seer) {
      await delay(randomFakeActionDelay());
      await runtime.waitForUnpause();
      if (!runtime.isTokenValid(runtime.token)) return currentState;
      runtime.setIsWaitingForAI(false);
      await playNarrator("seerClose");
      return currentState;
    }

    if (seer.isHuman) {
      runtime.setIsWaitingForAI(false);
      runtime.setDialogue(speakerSystem, uiText.waitingSeer, false);
      return currentState;
    }

    const seerOutcome = await generateSeerAction(currentState, seer);
    if (!runtime.isTokenValid(runtime.token)) return currentState;

    if (seerOutcome === undefined) {
      runtime.setGameState(currentState);
      runtime.setIsWaitingForAI(false);
      await playNarrator("seerClose");
      return currentState;
    }

    const targetSeat = seerOutcome.targetSeat;
    const targetPlayer = currentState.players.find((p) => p.seat === targetSeat);
    const isWolf = targetPlayer ? targetPlayer.alignment === "wolf" : false;

    const seerHistory = currentState.nightActions.seerHistory || [];
    currentState = {
      ...currentState,
      nightActions: {
        ...currentState.nightActions,
        seerTarget: targetSeat,
        seerResult: { targetSeat, isWolf: isWolf || false },
        seerHistory: [...seerHistory, { targetSeat, isWolf: isWolf || false, day: currentState.day }],
        ...(seerOutcome.reason ? { seerReason: seerOutcome.reason } : {}),
      },
    };
    runtime.setGameState(currentState);
    runtime.setIsWaitingForAI(false);

    await playNarrator("seerClose");

    return currentState;
  }

  private async runNightPhase(state: GameState, runtime: NightPhaseRuntime): Promise<void> {
    let currentState = state;

    const hasGuard = currentState.players.some((p) => p.role === "Guard");
    if (hasGuard) {
      currentState = await this.runGuardAction(currentState, runtime);
      if (!runtime.isTokenValid(runtime.token)) return;

      const guard = currentState.players.find((p) => p.role === "Guard" && p.alive);
      if (guard?.isHuman && currentState.nightActions.guardTarget === undefined) {
        return;
      }

      await delay(DELAY_CONFIG.NIGHT_PHASE_GAP);
      await runtime.waitForUnpause();
      if (!runtime.isTokenValid(runtime.token)) return;
    }

    // 禁言長老 → 狼人 → 女巫 → 預言家（與真人的續跑鏈共用同一個方法，避免分歧）
    await this.continueNightAfterMute(currentState, runtime);
    return;

  }

  private async continueNightAfterGuard(state: GameState, runtime: NightPhaseRuntime): Promise<void> {
    await this.continueNightAfterMute(state, runtime);
  }

  /** 禁言長老 → 狼人 → 女巫 → 預言家（AI 與真人共用同一條續跑鏈） */
  private async continueNightAfterMute(state: GameState, runtime: NightPhaseRuntime): Promise<void> {
    let currentState = state;

    // 真人禁言長老選完目標後，狀態已停在 NIGHT_MUTE_ACTION，不再重跑一次行動
    if (currentState.phase !== "NIGHT_MUTE_ACTION") {
      const hasMuteElder = currentState.players.some((p) => p.role === "MuteElder");
      if (hasMuteElder) {
        currentState = await this.runMuteAction(currentState, runtime);
        if (!runtime.isTokenValid(runtime.token)) return;

        const elder = currentState.players.find((p) => p.role === "MuteElder" && p.alive);
        if (elder?.isHuman && currentState.nightActions.mutedTarget === undefined) return;

        await delay(DELAY_CONFIG.NIGHT_PHASE_GAP);
        await runtime.waitForUnpause();
        if (!runtime.isTokenValid(runtime.token)) return;
      }
    }

    const afterWolf = await this.runWolfAction(currentState, runtime);
    if (!runtime.isTokenValid(runtime.token)) return;

    if (humanWolfNeedsNightInput(afterWolf)) {
      return;
    }

    await delay(DELAY_CONFIG.NIGHT_PHASE_GAP);
    await runtime.waitForUnpause();
    if (!runtime.isTokenValid(runtime.token)) return;

    await this.continueNightAfterWolf(afterWolf, runtime);
  }

  private async continueNightAfterWolf(state: GameState, runtime: NightPhaseRuntime): Promise<void> {
    // 真人狼還欠第一夜分工時不能往下走：夜間流程要停在狼人階段，
    // 等前端對話框寫入計畫（寫入後由 handleWolfTeamPlanSubmit 推下去）。
    if (humanWolfNeedsNightInput(state)) return;
    const currentState = await this.runWitchAction(state, runtime);
    if (!runtime.isTokenValid(runtime.token)) return;

    const witch = currentState.players.find((p) => p.role === "Witch" && p.alive);
    const canWitchAct = witch && (!currentState.roleAbilities.witchHealUsed || !currentState.roleAbilities.witchPoisonUsed);
    if (witch?.isHuman && canWitchAct) {
      const decided =
        currentState.nightActions.witchSave !== undefined ||
        currentState.nightActions.witchPoison !== undefined;
      if (!decided) return;
    }

    await delay(DELAY_CONFIG.NIGHT_PHASE_GAP);
    await runtime.waitForUnpause();
    if (!runtime.isTokenValid(runtime.token)) return;

    await this.continueNightAfterWitch(currentState, runtime);
  }

  private async continueNightAfterWitch(state: GameState, runtime: NightPhaseRuntime): Promise<void> {
    const currentState = await this.runSeerAction(state, runtime);
    if (!runtime.isTokenValid(runtime.token)) return;

    const seer = currentState.players.find((p) => p.role === "Seer" && p.alive);
    if (seer?.isHuman && currentState.nightActions.seerTarget === undefined) {
      return;
    }

    await delay(DELAY_CONFIG.NIGHT_PHASE_GAP);
    await runtime.waitForUnpause();
    if (!runtime.isTokenValid(runtime.token)) return;

    await runtime.onNightComplete(currentState);
  }

  private buildNightEnhancements(state: GameContext["state"], player: Player) {
    const { t } = getI18n();
    const todayTranscript = buildTodayTranscript(state);
    // 自己的發言已在本日討論記錄裡，不再另拼一段重述。
    return { todayTranscript };
  }

  private buildContextWithDay(
    context: string,
    todayTranscript: string
  ): string {
    const { t } = getI18n();
    return [
      context,
      todayTranscript ? `${t("prompts.night.todayDiscussionLabel")}\n${todayTranscript}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private buildSeerPrompt(state: GameContext["state"], player: Player): PromptResult {
    const { t } = getI18n();
    const context = buildGameContext(state, player);
    const { todayTranscript } = this.buildNightEnhancements(state, player);
    const seerHistory = state.nightActions.seerHistory || [];
    const checkedSeats = seerHistory.map((h) => h.targetSeat);

    const alivePlayers = state.players.filter(
      (p) => p.alive && p.playerId !== player.playerId
    );

    const uncheckedPlayers = alivePlayers.filter((p) => !checkedSeats.includes(p.seat));
    const alreadyChecked = alivePlayers.filter((p) => checkedSeats.includes(p.seat));
    const eligiblePlayers = uncheckedPlayers.length > 0 ? uncheckedPlayers : alivePlayers;

    const checkedList = alreadyChecked
      .map((p) => t("promptUtils.gameContext.seatLabel", { seat: p.seat + 1 }))
      .join(t("promptUtils.gameContext.listSeparator"));
    const optionsList = eligiblePlayers
      .map((p) => t("prompts.night.option", { seat: p.seat + 1, name: p.displayName }))
      .join(t("promptUtils.gameContext.listSeparator"));

    const cacheableContent = bindIdentityAndRoleSetting(t("prompts.night.seer.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText("Seer"),
      coreRules: "",
    }), player, !!state.isGenshinMode);

    const dynamicContent = t("prompts.night.seer.task", {
      checkedLine: alreadyChecked.length > 0 ? t("prompts.night.seer.checkedLine", { list: checkedList }) : "",
      options: optionsList,
    });

    // system 只放全桌逐字相同的共用開場（陣容／規則／攻略）；身分與本輪任務逐人不同，一律進 user。
    const systemParts: SystemPromptPart[] = [...buildSharedSystemParts(state)];
    const system = buildSystemTextFromParts(systemParts);

    const user = t("prompts.night.seer.user", {
      context: [this.buildContextWithDay(context, todayTranscript), cacheableContent, dynamicContent].filter(Boolean).join("\n\n"),
      jsonFormat: JSON.stringify({ seat: (eligiblePlayers[0]?.seat ?? player.seat) + 1, reason: t("promptUtils.gameContext.jsonReasonSeer") }),
    });

    return { system, user, systemParts };
  }

  private buildWolfPrompt(
    state: GameContext["state"],
    player: Player,
    existingVotes: Record<string, number>
  ): PromptResult {
    const { t } = getI18n();
    const context = buildGameContext(state, player);
    const { todayTranscript } = this.buildNightEnhancements(state, player);
    // 狼人可以刀任何存活玩家（包括队友和自己），但通常刀好人
    const alivePlayers = state.players.filter((p) => p.alive);
    const teammates = state.players.filter(
      (p) => isWolfRole(p.role) && p.playerId !== player.playerId && p.alive
    );

    const teammateVotesStr = teammates
      .map((teammate) => {
        const vote = existingVotes[teammate.playerId];
        if (vote === undefined) return null;
        const target = state.players.find((p) => p.seat === vote);
        return t("prompts.night.wolf.voteLine", {
          seat: teammate.seat + 1,
          name: teammate.displayName,
          targetSeat: vote + 1,
          targetName: target ? t("prompts.night.optionName", { name: target.displayName }) : "",
        });
      })
      .filter(Boolean)
      .join("\n");

    const identitySection = bindIdentityAndRoleSetting(t("prompts.night.wolf.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
    }), player, !!state.isGenshinMode);
    const cacheableRules = t("prompts.night.wolf.rules", {
      coreRules: "",
    });
    const teammateVotesSection = teammateVotesStr
      ? t("prompts.night.wolf.teammateVotes", { lines: teammateVotesStr })
      : "";
    const taskSection = t("prompts.night.wolf.task", {
      teammateVotesSection,
      options: alivePlayers
        .map((p) => t("prompts.night.option", { seat: p.seat + 1, name: p.displayName }))
        .join(t("promptUtils.gameContext.listSeparator")),
    });

    // system 只放全桌逐字相同的共用開場（陣容／規則／攻略）；身分（含狼隊友）與本輪任務逐人不同，一律進 user。
    const systemParts: SystemPromptPart[] = [...buildSharedSystemParts(state)];
    const system = buildSystemTextFromParts(systemParts);

    const user = t("prompts.night.wolf.user", {
      context: [this.buildContextWithDay(context, todayTranscript), identitySection, cacheableRules, taskSection].filter(Boolean).join("\n\n"),
      jsonFormat: JSON.stringify({ seat: (alivePlayers[0]?.seat ?? player.seat) + 1, reason: t("promptUtils.gameContext.jsonReasonWolf") }),
    });

    return { system, user, systemParts };
  }

  private buildGuardPrompt(state: GameContext["state"], player: Player): PromptResult {
    const { t } = getI18n();
    const flags = getBoardRuleFlags(state.players.length);
    const context = buildGameContext(state, player);
    const { todayTranscript } = this.buildNightEnhancements(state, player);
    const alivePlayers = state.players.filter((p) => p.alive);
    const lastTarget = state.nightActions.lastGuardTarget;

    const cacheableContent = bindIdentityAndRoleSetting(t("prompts.night.guard.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText("Guard"),
      coreRules: "",
    }), player, !!state.isGenshinMode);
    const eligibleSeats = getGuardEligibleSeats({
      aliveSeats: alivePlayers.map((p) => p.seat),
      lastGuardTarget: lastTarget,
      flags,
    });
    const eligiblePlayers = alivePlayers.filter((p) => eligibleSeats.includes(p.seat));
    const options = eligiblePlayers
      .map((p) => t("prompts.night.option", { seat: p.seat + 1, name: p.displayName }))
      .join(t("promptUtils.gameContext.listSeparator"));
    const lastTargetLine =
      flags.guardCannotRepeat && lastTarget !== undefined
        ? t("prompts.night.guard.lastTarget", { seat: lastTarget + 1 })
        : "";
    const abstainLine = flags.guardCanAbstain ? t("prompts.night.guard.abstainLine") : "";
    const dynamicContent = t("prompts.night.guard.task", {
      options,
      lastTargetLine,
      abstainLine,
    });
    // system 只放全桌逐字相同的共用開場（陣容／規則／攻略）；身分與本輪任務逐人不同，一律進 user。
    const systemParts: SystemPromptPart[] = [...buildSharedSystemParts(state)];
    const system = buildSystemTextFromParts(systemParts);

    const user = t("prompts.night.guard.user", {
      context: [this.buildContextWithDay(context, todayTranscript), cacheableContent, dynamicContent].filter(Boolean).join("\n\n"),
      jsonFormat: JSON.stringify({ seat: (eligiblePlayers[0]?.seat ?? player.seat) + 1, reason: t("promptUtils.gameContext.jsonReasonGuard") }),
    });

    return { system, user, systemParts };
  }

  private buildWitchPrompt(
    state: GameContext["state"],
    player: Player,
    wolfTarget: number | undefined
  ): PromptResult {
    const { t } = getI18n();
    const context = buildGameContext(state, player);
    const { todayTranscript } = this.buildNightEnhancements(state, player);
    const alivePlayers = state.players.filter(
      (p) => p.alive && p.playerId !== player.playerId
    );

    const flags = getBoardRuleFlags(state.players.length);

    const canSave = canWitchSave({
      healUsed: state.roleAbilities.witchHealUsed,
      witchSeat: player.seat,
      wolfTarget,
      flags,
    });
    const canPoison = !state.roleAbilities.witchPoisonUsed;

    const victimInfo =
      wolfTarget !== undefined && !state.roleAbilities.witchHealUsed
        ? state.players.find((p) => p.seat === wolfTarget)
        : null;
    // 刀口是女巫自己、且規則禁止自救：講清楚「這瓶藥救不了你」，避免 AI 硬選 save 觸發重試。
    const selfVictim = wolfTarget !== undefined && wolfTarget === player.seat && !flags.witchCanSelfSave;

    const cacheableContent = bindIdentityAndRoleSetting(t("prompts.night.witch.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText("Witch"),
      coreRules: "",
    }), player, !!state.isGenshinMode);
    const statusHeal = state.roleAbilities.witchHealUsed
      ? t("promptUtils.gameContext.used")
      : t("promptUtils.gameContext.available");
    const statusPoison = state.roleAbilities.witchPoisonUsed
      ? t("promptUtils.gameContext.used")
      : t("promptUtils.gameContext.available");
    const tonightInfo = selfVictim
      ? t("prompts.night.witch.selfVictimLine", { seat: wolfTarget! + 1 })
      : victimInfo
        ? t("prompts.night.witch.victimLine", { seat: wolfTarget! + 1, name: victimInfo.displayName })
        : state.roleAbilities.witchHealUsed
          ? t("prompts.night.witch.noSense")
          : t("prompts.night.witch.noAttack");
    const saveLine = canSave
      ? t("prompts.night.witch.saveOption", { seat: wolfTarget! + 1 })
      : selfVictim
        ? t("prompts.night.witch.saveLineSelfVictim")
        : t("prompts.night.witch.noSave");
    const poisonLine = canPoison ? t("prompts.night.witch.poisonOption") : t("prompts.night.witch.noPoison");
    const poisonTargets = alivePlayers
      .map((p) => t("promptUtils.gameContext.seatLabel", { seat: p.seat + 1 }))
      .join(t("promptUtils.gameContext.listSeparator"));
    const dynamicContent = t("prompts.night.witch.task", {
      healStatus: statusHeal,
      poisonStatus: statusPoison,
      tonightInfo,
      saveLine,
      poisonLine,
      selfSaveRule: flags.witchCanSelfSave
        ? t("prompts.night.witch.selfSaveAllowed")
        : t("prompts.night.witch.selfSaveForbidden"),
      poisonTargets,
      saveJsonFormat: JSON.stringify({ action: "save", reason: t("promptUtils.gameContext.jsonReasonWitch") }),
      poisonJsonFormat: JSON.stringify({ action: "poison", seat: (alivePlayers[0]?.seat ?? player.seat) + 1, reason: t("promptUtils.gameContext.jsonReasonWitch") }),
      passJsonFormat: JSON.stringify({ action: "pass", reason: t("promptUtils.gameContext.jsonReasonWitch") }),
    });
    // system 只放全桌逐字相同的共用開場（陣容／規則／攻略）；身分與本輪任務逐人不同，一律進 user。
    const systemParts: SystemPromptPart[] = [...buildSharedSystemParts(state)];
    const system = buildSystemTextFromParts(systemParts);

    const user = t("prompts.night.witch.user", {
      context: [this.buildContextWithDay(context, todayTranscript), cacheableContent, dynamicContent].filter(Boolean).join("\n\n"),
    });

    return { system, user, systemParts };
  }
}
