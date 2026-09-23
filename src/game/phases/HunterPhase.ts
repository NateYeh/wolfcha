import type { Player } from "@/types/game";
import { GamePhase } from "../core/GamePhase";
import type { GameContext, PromptResult, SystemPromptPart } from "../core/types";
import { getDeathShotKind } from "@/lib/rules/death-skills";
import {
  buildDecisionContext,
  getRoleText,
  buildSharedSystemParts,
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
      coreRules: "",
    });
    const options = alivePlayers
      .map((p) => t("prompts.night.option", { seat: p.seat + 1, name: p.displayName }))
      .join(t("promptUtils.gameContext.listSeparator"));
    
    const lastWordsSection = lastWords
      ? t("prompts.hunter.lastWordsContext", { lastWords })
      : "";
    // 開槍守則依角色不同：獵人是「好人最後一槍」，狼王是「狼隊的槍」（目標互換）。
    const isWolfShot = getDeathShotKind(player.role) === "wolf_gun";
    const dynamicContent =
      t(isWolfShot ? "prompts.wolfKingShot.task" : "prompts.hunter.task", { options }) +
      lastWordsSection;
    // system 只放全桌逐字相同的共用開場（陣容／規則／攻略）；身分與本輪任務逐人不同，一律進 user。
    const systemParts: SystemPromptPart[] = [...buildSharedSystemParts(state)];
    const system = buildSystemTextFromParts(systemParts);

    const user = t("prompts.hunter.user", {
      context: [gameContext, cacheableContent, dynamicContent].filter(Boolean).join("\n\n"),
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
