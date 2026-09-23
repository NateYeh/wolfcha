import type { Player } from "@/types/game";
import { GamePhase } from "../core/GamePhase";
import type { GameContext, PromptResult, SystemPromptPart } from "../core/types";
import {
  bindIdentityAndRoleSetting,
  buildGameContextParts,
  buildTodayTranscript,
  getRoleText,
  buildSharedSystemParts,
  buildSystemTextFromParts,
} from "@/lib/prompt-utils";
import { getI18n } from "@/i18n/translator";

export class BadgePhase extends GamePhase {
  async onEnter(): Promise<void> {
    return;
  }

  getPrompt(context: GameContext, player: Player): PromptResult {
    const state = context.state;
    if (state.phase === "DAY_BADGE_SIGNUP") {
      return this.buildBadgeSignupPrompt(state, player);
    }
    if (state.phase === "DAY_BADGE_ELECTION") {
      return this.buildBadgeElectionPrompt(state, player);
    }
    if (state.phase === "BADGE_TRANSFER") {
      return this.buildBadgeTransferPrompt(state, player);
    }
    return this.buildBadgeElectionPrompt(state, player);
  }

  async handleAction(): Promise<void> {
    return;
  }

  async onExit(): Promise<void> {
    return;
  }

  private buildBadgeElectionPrompt(state: GameContext["state"], player: Player): PromptResult {
    const { t } = getI18n();
    const candidates = Array.isArray(state.badge?.candidates) ? state.badge.candidates : [];
    const alivePlayers = state.players
      .filter((p) => p.alive && p.playerId !== player.playerId)
      .filter((p) => (candidates.length > 0 ? candidates.includes(p.seat) : true));
    const exampleSeat = (alivePlayers[0]?.seat ?? player.seat) + 1;
    const contextParts = buildGameContextParts(state, player, { excludePendingDeaths: true });

    // system 只放全桌通用的公開規則；逐人內容（身份、勝負條件、任務）全進 user 個人區，
    // 否則 system 第一個 token 就逐人不同，後面的公共區塊全部無法共用快取。
    const identityContent = bindIdentityAndRoleSetting(t("prompts.badge.election.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
      coreRules: "",
    }).trim(), player, !!state.isGenshinMode);
    const dynamicContent =
      t("prompts.badge.election.task", {
        options: alivePlayers
          .map((p) => t("prompts.badge.option", { seat: p.seat + 1, name: p.displayName }))
          .join(t("promptUtils.gameContext.listSeparator")),
        jsonFormat: JSON.stringify({ seat: exampleSeat, reason: t("promptUtils.gameContext.jsonReasonBadgeVote") }),
      });
    const systemParts: SystemPromptPart[] = [
      ...buildSharedSystemParts(state),
    ];
    const system = buildSystemTextFromParts(systemParts);

    // 候选资格只限制投票目标，不能抹去已公开的落选者发言。
    const badgeSpeechText = buildTodayTranscript(state);

    // user 順序：公共上下文與紀錄在前，個人區緊鄰發問處。
    const privateZone = [
      contextParts.private,
      identityContent,
      dynamicContent,
    ].filter(Boolean).join("\n\n");
    const user = t("prompts.badge.election.user", {
      sharedContext: [
        contextParts.shared,
        t("prompts.badge.election.contextHeader", { day: state.day }),
        badgeSpeechText ? t("prompts.badge.election.contextRecent", { text: badgeSpeechText }) : "",
      ].filter(Boolean).join("\n\n"),
      privateContext: privateZone,
    });

    return { system, user, systemParts };
  }

  private buildBadgeSignupPrompt(state: GameContext["state"], player: Player): PromptResult {
    // excludePendingDeaths: true - 警长竞选时夜间死亡还未公布，AI不应知道是否平安夜
    const contextParts = buildGameContextParts(state, player, { excludePendingDeaths: true });
    const todayTranscript = buildTodayTranscript(state);

    const { t } = getI18n();
    
    // system 只放全桌通用的公開規則；逐人內容（身份、勝負條件、任務）全進 user 個人區。
    const identityContent = bindIdentityAndRoleSetting(t("prompts.badge.signup.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
      coreRules: "",
    }).trim(), player, !!state.isGenshinMode);
    const dynamicContent = t("prompts.badge.signup.task");
    const systemParts: SystemPromptPart[] = [
      ...buildSharedSystemParts(state),
    ];
    const system = buildSystemTextFromParts(systemParts);

    const privateZone = [
      contextParts.private,
      identityContent,
      dynamicContent,
    ].filter(Boolean).join("\n\n");
    const user = t("prompts.badge.signup.user", {
      sharedContext: contextParts.shared,
      privateContext: privateZone,
      todayTranscript: todayTranscript || t("prompts.badge.signup.noTranscript"),
    });

    return { system, user, systemParts };
  }

  private buildBadgeTransferPrompt(state: GameContext["state"], player: Player): PromptResult {
    const { t } = getI18n();
    const contextParts = buildGameContextParts(state, player);
    const alivePlayers = state.players.filter(
      (p) => p.alive && p.playerId !== player.playerId
    );
    const exampleSeat = (alivePlayers[0]?.seat ?? player.seat) + 1;

    // system 只放全桌通用的公開規則；逐人內容（身份、勝負條件、任務）全進 user 個人區。
    const identityContent = bindIdentityAndRoleSetting(t("prompts.badge.transfer.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
      coreRules: "",
    }).trim(), player, !!state.isGenshinMode);
    const dynamicContent = t("prompts.badge.transfer.task", {
      options: alivePlayers
        .map((p) => t("prompts.badge.option", { seat: p.seat + 1, name: p.displayName }))
        .join(t("promptUtils.gameContext.listSeparator")),
      jsonFormat: JSON.stringify({ seat: exampleSeat, reason: t("promptUtils.gameContext.jsonReasonBadgeTransfer") }),
      tearJsonFormat: JSON.stringify({ action: "tear", reason: t("promptUtils.gameContext.jsonReasonBadgeTear") }),
    });
    const systemParts: SystemPromptPart[] = [
      ...buildSharedSystemParts(state),
    ];
    const system = buildSystemTextFromParts(systemParts);

    const todayTranscript = buildTodayTranscript(state);

    const privateZone = [
      contextParts.private,
      identityContent,
      dynamicContent,
    ].filter(Boolean).join("\n\n");
    const user = t("prompts.badge.transfer.user", {
      sharedContext: contextParts.shared,
      privateContext: privateZone,
      todayTranscript: todayTranscript || t("prompts.badge.transfer.noTranscript"),
    });

    return { system, user, systemParts };
  }
}
