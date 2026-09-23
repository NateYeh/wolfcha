import type { Player } from "@/types/game";
import { GamePhase } from "../core/GamePhase";
import type { GameContext, PromptResult, SystemPromptPart } from "../core/types";
import {
  buildDecisionContext,
  getRoleText,
  buildSharedSystemParts,
  buildSystemTextFromParts,
} from "@/lib/prompt-utils";
import { getBoardRuleFlags } from "@/lib/rules/boards";
import { excludePendingDeathPlayers } from "@/lib/rules/night-deaths";
import { getRoleCapabilities } from "@/lib/rules/roles";
import { getI18n } from "@/i18n/translator";

/**
 * 自爆提示（所有狼陣營角色共用；白狼王另可帶人與競選吞徽）。
 *
 * 決策輸出：`{ action: "boom", seat?, reason }` 或 `{ action: "pass" }`；
 * 沒有自爆宣言，因此不再要求 farewell 欄位。
 */
export class SelfDestructPhase extends GamePhase {
  async onEnter(): Promise<void> {
    return;
  }

  getPrompt(context: GameContext, player: Player): PromptResult {
    const { t } = getI18n();
    const state = context.state;
    const flags = getBoardRuleFlags(state.players.length);
    const capabilities = getRoleCapabilities(player.role);
    const takesPlayer =
      capabilities.boomTakesPlayer && flags.boom.takesPlayerRoles.includes(capabilities.role);
    const gameContext = buildDecisionContext(state, player);
    // 只能帶走「場上存活」的人：已死但死訊未公布的第一夜死者也要排除
    const alivePlayers = excludePendingDeathPlayers(
      state,
      state.players.filter((p) => p.alive && p.playerId !== player.playerId)
    );
    const exampleSeat = (alivePlayers[0]?.seat ?? player.seat) + 1;

    const cacheableContent = t("prompts.selfDestruct.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
      coreRules: "",
    });
    const options = alivePlayers
      .map((p) => t("prompts.night.option", { seat: p.seat + 1, name: p.displayName }))
      .join(t("promptUtils.gameContext.listSeparator"));

    const effectLine = takesPlayer
      ? t("prompts.selfDestruct.effectLineTakesPlayer")
      : t("prompts.selfDestruct.effectLine");
    const electionBooms = state.badge.electionBooms ?? 0;
    const badgeLine =
      state.phase !== "DAY_BADGE_SPEECH"
        ? t("prompts.selfDestruct.badgeLineDay")
        : capabilities.boomSwallowsBadgeOnElection
          ? t("prompts.selfDestruct.badgeLineWhiteWolfKing")
          : electionBooms >= flags.boom.electionBoomSwallowCount - 1
            ? t("prompts.selfDestruct.badgeLineWolfSecond")
            : t("prompts.selfDestruct.badgeLineWolfFirst");

    const boomExample = takesPlayer
      ? { action: "boom", seat: exampleSeat, reason: "<一句话：为什么现在炸>" }
      : { action: "boom", reason: "<一句话：为什么现在炸>" };
    const passExample = { action: "pass" };

    const dynamicContent = t("prompts.selfDestruct.task", {
      options,
      effectLine,
      badgeLine,
      jsonFormat: JSON.stringify(boomExample),
      passJsonFormat: JSON.stringify(passExample),
    });
    // system 只放全桌逐字相同的共用開場（陣容／規則／攻略）；身分與本輪任務逐人不同，一律進 user。
    const systemParts: SystemPromptPart[] = [...buildSharedSystemParts(state)];
    const system = buildSystemTextFromParts(systemParts);

    const user = t("prompts.selfDestruct.user", {
      context: [gameContext, cacheableContent, dynamicContent].filter(Boolean).join("\n\n"),
      jsonFormat: JSON.stringify(boomExample),
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
