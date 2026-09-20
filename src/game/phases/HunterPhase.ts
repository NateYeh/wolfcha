import type { Player } from "@/types/game";
import { GamePhase } from "../core/GamePhase";
import type { GameContext, PromptResult, SystemPromptPart } from "../core/types";
import {
  buildDecisionContext,
  getRoleText,
  getRolePromptCore,
  buildSystemTextFromParts,
} from "@/lib/prompt-utils";
import { getI18n } from "@/i18n/translator";

export class HunterPhase extends GamePhase {
  async onEnter(): Promise<void> {
    return;
  }

  /**
   * 获取猎人的遗言内容（如果有的话）
   * 只作为已经发生的公开记录提供，不从自然语言推断或强制执行动作。
   */
  private getHunterLastWords(context: GameContext, player: Player): string | null {
    const state = context.state;
    // 查找猎人在当天的遗言发言
    const lastWordsMessages = state.messages.filter(
      (m) => !m.isSystem && 
             m.playerId === player.playerId && 
             m.day === state.day &&
             m.phase === "DAY_LAST_WORDS"
    );
    
    if (lastWordsMessages.length === 0) return null;
    
    // 合并所有遗言内容
    return lastWordsMessages.map(m => m.content).join("\n");
  }

  getPrompt(context: GameContext, player: Player): PromptResult {
    const { t } = getI18n();
    const state = context.state;
    const gameContext = buildDecisionContext(state, player);
    const alivePlayers = state.players.filter(
      (p) => p.alive && p.playerId !== player.playerId
    );
    const exampleSeat = (alivePlayers[0]?.seat ?? player.seat) + 1;

    // 获取猎人的遗言
    const lastWords = this.getHunterLastWords(context, player);

    const cacheableContent = t("prompts.hunter.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
      coreRules: getRolePromptCore("Hunter"),
    });
    const options = alivePlayers
      .map((p) => t("prompts.night.option", { seat: p.seat + 1, name: p.displayName }))
      .join(t("promptUtils.gameContext.listSeparator"));
    
    const lastWordsSection = lastWords
      ? t("prompts.hunter.lastWordsContext", { lastWords })
      : "";
    // 开枪守则：禁止射硬认证好人；放逐后先核实预言家查验链；遗言目标与守则冲突时以守则为准。
    const shootingRules = t("prompts.hunter.shootingRules");
    const dynamicContent =
      t("prompts.hunter.task", { options }) + lastWordsSection + shootingRules;
    const systemParts: SystemPromptPart[] = [
      { text: cacheableContent, cacheable: true, ttl: "1h" },
      { text: dynamicContent },
    ];
    const system = buildSystemTextFromParts(systemParts);

    const user = t("prompts.hunter.user", {
      context: gameContext,
      jsonFormat: JSON.stringify({ seat: exampleSeat, reason: "<一句话：这枪为什么打他>" }),
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
