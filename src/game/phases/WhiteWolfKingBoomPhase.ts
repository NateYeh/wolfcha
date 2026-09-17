import type { Player } from "@/types/game";
import { GamePhase } from "../core/GamePhase";
import type { GameContext, PromptResult, SystemPromptPart } from "../core/types";
import {
  buildDecisionContext,
  buildSeerClaimStateLine,
  getRoleText,
  getWinCondition,
  buildSystemTextFromParts,
} from "@/lib/prompt-utils";
import { getI18n } from "@/i18n/translator";

export class WhiteWolfKingBoomPhase extends GamePhase {
  async onEnter(): Promise<void> {
    return;
  }

  getPrompt(context: GameContext, player: Player): PromptResult {
    const { t } = getI18n();
    const state = context.state;
    const gameContext = buildDecisionContext(state, player);
    const alivePlayers = state.players.filter(
      (p) => p.alive && p.playerId !== player.playerId
    );
    const exampleSeat = (alivePlayers[0]?.seat ?? player.seat) + 1;

    const cacheableContent = t("prompts.whiteWolfKingBoom.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
      winCondition: getWinCondition("WhiteWolfKing"),
    });
    const options = alivePlayers
      .map((p) => t("prompts.night.option", { seat: p.seat + 1, name: p.displayName }))
      .join(t("promptUtils.gameContext.listSeparator"));

    const dynamicContent = t("prompts.whiteWolfKingBoom.task", {
      options,
      tactics: t("prompts.whiteWolfKingBoom.tactics"),
      jsonFormat: JSON.stringify({
        action: "boom",
        seat: exampleSeat,
        farewell: "<一两句翻桌宣言，全场公开>",
        reason: "<一句话：为什么现在炸>",
      }),
      passJsonFormat: JSON.stringify({ action: "pass" }),
    });
    const systemParts: SystemPromptPart[] = [
      { text: cacheableContent, cacheable: true, ttl: "1h" },
      { text: dynamicContent },
    ];
    const system = buildSystemTextFromParts(systemParts);

    // 場上有幾條預言家線是自爆這筆帳的關鍵輸入（純事實陳述，不含策略指引）。
    const seerClaimState = buildSeerClaimStateLine(state);
    const user = t("prompts.whiteWolfKingBoom.user", {
      context: seerClaimState ? `${gameContext}\n\n${seerClaimState}` : gameContext,
      jsonFormat: JSON.stringify({
        action: "boom",
        seat: exampleSeat,
        farewell: "<一两句翻桌宣言，全场公开>",
        reason: "<一句话：为什么现在炸>",
      }),
      passJsonFormat: JSON.stringify({ action: "pass" }),
    });

    return { system, user, systemParts };
  }

  async handleAction(): Promise<void> {
    return;
  }

  async onExit(): Promise<void> {
    return;
  }
}
