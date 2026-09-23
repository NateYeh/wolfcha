import type { Player } from "@/types/game";
import { GamePhase } from "../core/GamePhase";
import type { GameContext, PromptResult, SystemPromptPart } from "../core/types";
import {
  bindIdentityAndRoleSetting,
  buildDecisionContext,
  getRoleText,
  buildSharedSystemParts,
  buildSystemTextFromParts,
} from "@/lib/prompt-utils";
import { excludePendingDeathPlayers } from "@/lib/rules/night-deaths";
import { getI18n } from "@/i18n/translator";

/**
 * 騎士翻牌決鬥提示。
 *
 * 決策輸出：`{ action: "duel", seat, reason }` 或 `{ action: "pass" }`。
 * 時機：騎士自己的白天發言輪（警上 PK 發言與遺言階段不能發動）。
 * 結果：目標是狼人 → 他出局並直接進黑夜；目標是好人 → 騎士以死謝罪、白天繼續。
 */
export class KnightDuelPhase extends GamePhase {
  async onEnter(): Promise<void> {
    return;
  }

  getPrompt(context: GameContext, player: Player): PromptResult {
    const { t } = getI18n();
    const state = context.state;
    const gameContext = buildDecisionContext(state, player);
    // 只能挑戰「場上存活」的人：已死但死訊未公布的第一夜死者也要排除
    const alivePlayers = excludePendingDeathPlayers(
      state,
      state.players.filter((p) => p.alive && p.playerId !== player.playerId)
    );
    const exampleSeat = (alivePlayers[0]?.seat ?? player.seat) + 1;
    const cacheableContent = bindIdentityAndRoleSetting(t("prompts.knightDuel.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
      coreRules: "",
    }), player, !!state.isGenshinMode);
    const options = alivePlayers
      .map((p) => t("prompts.night.option", { seat: p.seat + 1, name: p.displayName }))
      .join(t("promptUtils.gameContext.listSeparator"));

    const effectLine = t("prompts.knightDuel.effectLine");

    const duelExample = { action: "duel", seat: exampleSeat, reason: "<一句话：为什么现在翻牌，挑战谁>" };
    const passExample = { action: "pass" };

    const dynamicContent = t("prompts.knightDuel.task", {
      options,
      effectLine,
      jsonFormat: JSON.stringify(duelExample),
      passJsonFormat: JSON.stringify(passExample),
    });
    // system 只放全桌逐字相同的共用開場（陣容／規則／攻略）；身分與本輪任務逐人不同，一律進 user。
    const systemParts: SystemPromptPart[] = [...buildSharedSystemParts(state)];
    const system = buildSystemTextFromParts(systemParts);

    const user = t("prompts.knightDuel.user", {
      context: [gameContext, cacheableContent, dynamicContent].filter(Boolean).join("\n\n"),
      jsonFormat: JSON.stringify(duelExample),
      passJsonFormat: JSON.stringify(passExample),
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
