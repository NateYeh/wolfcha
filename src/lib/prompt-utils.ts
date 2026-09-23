import { areNightResultsVisible } from "./night-visibility";
import type { ChatMessage, GameState, Persona, Phase, Player, Role, WolfTeamPlan } from "@/types/game";
import { isWolfRole } from "@/types/game";
import type { SystemPromptPart } from "@/game/core/types";
import type { LLMMessage } from "./llm";
import { getSystemMessages, getSystemPatterns } from "./game-texts";
import { getI18n } from "@/i18n/translator";
import { getRoleName } from "./game-constants";
import { getMutedSeat, isMutePublic } from "./rules/mute";
import { getRoleConfiguration } from "./role-configuration";
import { ALL_ROLE_KEYS } from "./rules/boards";
import { getDeathShotKind } from "./rules/death-skills";
import {
  resolveBadgeElectionWinner,
  resolveSheriffSeatAtVote,
} from "./historical-vote-snapshots";

/**
 * Prompt helper utilities used by Phase prompts.
 */

export const getRoleText = (role: string) => {
  const { t } = getI18n();
  switch (role) {
    case "Werewolf":
      return t("promptUtils.roleText.werewolf");
    case "WhiteWolfKing":
      return t("promptUtils.roleText.whiteWolfKing");
    case "Seer":
      return t("promptUtils.roleText.seer");
    case "Witch":
      return t("promptUtils.roleText.witch");
    case "Hunter":
      return t("promptUtils.roleText.hunter");
    case "Guard":
      return t("promptUtils.roleText.guard");
    case "Idiot":
      return t("promptUtils.roleText.idiot");
    case "Knight":
      return t("promptUtils.roleText.knight");
    case "MuteElder":
      return t("promptUtils.roleText.muteElder");
    case "WolfKing":
      return t("promptUtils.roleText.wolfKing");
    default:
      return t("promptUtils.roleText.villager");
  }
};


/**
 * 遊戲基本盤：這是什麼遊戲、通用規則、角色與技能一覽（公開知識）。
 * 所有玩家階段都必須帶上——模型不知道自己在玩什麼、規則有哪些，後面的推理都會歪。
 * 此區塊與角色無關（純公開規則），可快取；本局實際陣容仍以【本局公開角色配置】為準。
 */
export const getGameFundamentals = (): string => {
  const { t } = getI18n();
  const keys = ["title", "overview", "basicRules", "roleSkills", "scopeNote"] as const;
  return keys
    .map((key) => t(`promptUtils.gameFundamentals.${key}` as Parameters<typeof t>[0]))
    .join("\n");
};

/**
 * 全桌共用的規則區塊：遊戲基本盤＋「想贏的動機」＋「允許不完美」。
 * 與角色、座位無關，字串逐字相同，因此排在任何 prompt 的最前面當作快取前綴。
 */
export const getSharedPromptRules = (): string => {
  const { t } = getI18n();
  return `${getGameFundamentals()}\n\n${t("promptUtils.winMotivationNote")}\n\n${t("promptUtils.humannessNote")}`;
};

/**
 * 全桌共用的狼人殺攻略（單一真相），**按本局實際陣容動態組合**：
 * 本局沒有的角色（白痴、守衛、騎士…）就不拼它的章節，避免提示模型去猜不存在的角色。
 * 組出來的文字在同一局內逐字相同（全桌同一份），所以放在 system 共用前綴可快取。
 * 不傳 state 時＝全節都拼（測試／預覽用）。
 */
export const getStrategyGuide = (
  state?: Pick<GameState, "players" | "fixedRoles">
): string => {
  const { t } = getI18n();
  const has = (role: Role): boolean => !state || gameHasRole(state, role);
  const section = (key: string, enabled: boolean = true): string =>
    enabled ? t(`promptUtils.strategyGuide.${key}` as Parameters<typeof t>[0]) : "";

  return [
    section("title"),
    section("notice"),
    section("basics"),
    section("goodCamp"),
    // 金水／預言家線：需要場上有預言家
    section("goldWater", has("Seer")),
    section("seer", has("Seer")),
    section("witch", has("Witch")),
    section("guard", has("Guard")),
    section("hunter", has("Hunter")),
    section("idiot", has("Idiot")),
    section("villager", has("Villager")),
    section("knight", has("Knight")),
    section("mute", has("MuteElder")),
    // 狼隊：狼一定在場
    section("wolfTeam"),
    section("wolfBoomWhiteWolfKing", has("WhiteWolfKing")),
    section("wolfGun", has("WolfKing")),
    section("wolfKnife"),
    section("wolfKnifeGuard", has("Guard")),
    section("wolfKnifeHunter", has("Hunter")),
    section("badge"),
    // 警徽流（單驗式／順驗式、金水接徽）：預言家的東西
    section("badgeFlow", has("Seer")),
  ]
    .filter(Boolean)
    .join("\n\n");
};

/**
 * 全桌共用的 system 開場區塊（依主結構：本次陣容 → 規則與角色說明 → 狼人殺攻略 → 心態）。
 * 逐字相同、跨座位與跨階段都能共用同一段前綴快取；個人身分與當輪任務由呼叫端接在後面。
 */
export const buildSharedSystemParts = (
  state: Pick<GameState, "players" | "fixedRoles" | "isAcquaintanceGame" | "characterStats">
): SystemPromptPart[] => {
  const { t } = getI18n();
  const parts: SystemPromptPart[] = [
    { text: buildPublicRoleConfiguration(state), cacheable: true, ttl: "1h" },
    { text: getGameFundamentals(), cacheable: true, ttl: "1h" },
    {
      text: `${getStrategyGuide(state)}\n\n${t("promptUtils.winMotivationNote")}\n\n${t("promptUtils.humannessNote")}`,
      cacheable: true,
      ttl: "1h",
    },
  ];

  // 熟人局素材（全桌每個人的平時印象與交手記錄）整局固定不變、逐字不隨座位改變，
  // 因此放 system 攻略之後；非熟人局或無素材時整段不拼。
  const acquaintanceNotes = buildAcquaintanceNotes(state);
  if (acquaintanceNotes) {
    parts.push({ text: acquaintanceNotes, cacheable: true, ttl: "1h" });
  }
  return parts;
};

/**
 * 本局實際角色組成（單一真相，只回角色不回座位）：
 * 1. 開局後玩家身上已發牌 → 直接數 players（自選角色／版型都不會漂移）；
 * 2. 尚未發牌（單元測試／預覽）→ 退回 fixedRoles（版型組成）；
 * 3. 都沒有 → 該人數的預設版型。
 * 只輸出角色計數，不帶座位與存活資訊，因此不會洩漏座位身分。
 */
export const getGameRoleComposition = (state: Pick<GameState, "players" | "fixedRoles">): Role[] => {
  const playerRoles = state.players.map((p) => p.role).filter((role): role is Role => typeof role === "string");
  if (playerRoles.length > 0 && playerRoles.length === state.players.length) return playerRoles;
  if (state.fixedRoles && state.fixedRoles.length === state.players.length) return state.fixedRoles;
  return getRoleConfiguration(state.players.length);
};

/** 本局是否含有某個角色（供角色專屬戰術提示做條件拼接，如守衛博弈／獵人槍口） */
export const gameHasRole = (state: Pick<GameState, "players" | "fixedRoles">, role: Role): boolean =>
  getGameRoleComposition(state).includes(role);

export const buildPublicRoleConfiguration = (state: Pick<GameState, "players" | "fixedRoles">): string => {
  const { t } = getI18n();
  const counts = new Map<Role, number>();
  getGameRoleComposition(state).forEach((role) => {
    counts.set(role, (counts.get(role) ?? 0) + 1);
  });

  // 順序跟著 ALL_ROLE_KEYS（單一真相）：寫死清單會讓新角色（騎士／禁言長老／狼王）
  // 被這個 filter 靜默吞掉，AI 看到的配置就會少角色、總數對不上座位數。
  const items = ALL_ROLE_KEYS
    .map((role) => ({ role, count: counts.get(role) ?? 0 }))
    .filter(({ count }) => count > 0)
    .map(({ role, count }) =>
      t("promptUtils.gameContext.publicRoleConfigurationItem", {
        role: getRoleName(role),
        count,
      })
    );

  return `<public_role_configuration>
${t("promptUtils.gameContext.publicRoleConfigurationTitle")}
${items.join("\n")}
${t("promptUtils.gameContext.publicWinConditionTitle")}
${t("promptUtils.gameContext.publicWinConditionGood")}
${t("promptUtils.gameContext.publicWinConditionWolf")}
${t("promptUtils.gameContext.publicRoleConfigurationScope")}
${t("promptUtils.gameContext.publicRoleConfigurationCheckRule")}
${t("promptUtils.gameContext.publicWinRule")}
${t("promptUtils.gameContext.publicIdentityRule")}
</public_role_configuration>`;
};

/**
 * 公開技能翻牌的文案：獵人槍與狼王槍都會記在同一欄 `hunterShot`，
 * 必須用槍的種類（死亡技能單一真相）決定講「獵人」還是「狼王」，不能一律當獵人。
 */
const shotRevealLine = (
  state: GameState,
  day: number,
  shot: { hunterSeat: number; targetSeat: number }
): string => {
  const { t } = getI18n();
  const shooter = state.players.find((p) => p.seat === shot.hunterSeat);
  const isWolfGun = getDeathShotKind(shooter?.role ?? "") === "wolf_gun";
  return t(isWolfGun
    ? "promptUtils.gameContext.wolfKingRoleReveal"
    : "promptUtils.gameContext.hunterRoleReveal", {
    day,
    [isWolfGun ? "player" : "hunter"]: formatSeatName(state, shot.hunterSeat),
    target: formatSeatName(state, shot.targetSeat),
  });
};

/** 被槍打死者的公開死因文案：同樣要分清獵人槍與狼王槍。 */
const shotDeathCauseLabel = (
  state: GameState,
  shot: { hunterSeat: number }
): string => {
  const { t } = getI18n();
  const shooter = state.players.find((p) => p.seat === shot.hunterSeat);
  return getDeathShotKind(shooter?.role ?? "") === "wolf_gun"
    ? t("promptUtils.gameContext.deathCauseWolfKingShot")
    : t("promptUtils.gameContext.deathCauseHunterShot");
};

const buildPublicRoleReveals = (state: GameState): string => {
  const { t } = getI18n();
  const facts: string[] = [];

  Object.entries(state.nightHistory || {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([day, history]) => {
      if (!history.hunterShot) return;
      facts.push(shotRevealLine(state, Number(day), history.hunterShot));
    });

  Object.entries(state.dayHistory || {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([day, history]) => {
      if (history.hunterShot) {
        facts.push(shotRevealLine(state, Number(day), history.hunterShot));
      }
      if (history.selfDestruct) {
        const boomPlayer = formatSeatName(state, history.selfDestruct.boomSeat);
        facts.push(
          history.selfDestruct.targetSeat !== undefined
            ? t("promptUtils.gameContext.selfDestructRevealWithTarget", {
                day: Number(day),
                player: boomPlayer,
                target: formatSeatName(state, history.selfDestruct.targetSeat),
              })
            : t("promptUtils.gameContext.selfDestructReveal", { day: Number(day), player: boomPlayer })
        );
      }
      if (history.idiotRevealed) {
        facts.push(t("promptUtils.gameContext.idiotRoleReveal", {
          day: Number(day),
          player: formatSeatName(state, history.idiotRevealed.seat),
        }));
      }
    });

  return `<public_role_reveals>
${t("promptUtils.gameContext.publicRoleRevealsTitle")}
${facts.length > 0 ? facts.join("\n") : t("promptUtils.gameContext.publicRoleRevealsNone")}
</public_role_reveals>`;
};

/**
 * 汇总与当前玩家直接相关的公开事实。这里只陈述已发生的记录，不给出回应或发言建议。
 */
export const buildPublicFactsForPlayer = (state: GameState, player: Player): string => {
  // 只在白天阶段附带这些公开事实。
  const isDaySpeech = state.phase.startsWith("DAY_");
  if (!isDaySpeech) return "";

  const { t } = getI18n();
  const facts: string[] = [];

  // --- 1. 当天其他玩家公开点名当前玩家 ---
  const dayStartIndex = getDayStartIndex(state);
  const mentionedBy: number[] = [];
  const seatPattern = new RegExp(`${player.seat + 1}\\s*[号號]`);
  for (let i = dayStartIndex; i < state.messages.length; i++) {
    const m = state.messages[i];
    if (m.isSystem || m.playerId === player.playerId) continue;
    if (seatPattern.test(m.content)) {
      // 这是对"今天谁点名了我"的历史回读：发言已经发生，与说话人此刻是否存活无关。
      // 若按当前 alive 过滤，会吞掉"当天先发言点名、随后被票出/枪杀"玩家的点名。
      const speaker = state.players.find(p => p.playerId === m.playerId);
      if (speaker) mentionedBy.push(speaker.seat);
    }
  }
  if (mentionedBy.length > 0) {
    const who = [...new Set(mentionedBy)]
      .map((s) => t("promptUtils.gameContext.seatLabel", { seat: s + 1 }))
      .join(t("promptUtils.gameContext.listSeparator"));
    facts.push(t("promptUtils.gameContext.factsMentionedBy", { who }));
  }

  // --- 2. 当前玩家与本日已公布出局玩家相邻 ---
  // 必须只取"当天"出局者，而非全程累计死者：否则到第 3、4 天后几乎人人都"与出局者相邻"，
  // 这条空间观察会被永久误触发，并把跨天旧死者当成可聊的相邻死亡。
  // 另外：警长竞选(报名/发言/投票/警徽PK)发生在夜间死亡公布之前，此时不得据"当晚死者"给相邻提示，否则提前泄露死讯。
  const deathsAnnounced = !(
    state.phase === "DAY_BADGE_SIGNUP" ||
    state.phase === "DAY_BADGE_SPEECH" ||
    state.phase === "DAY_BADGE_ELECTION" ||
    (state.phase === "DAY_PK_SPEECH" && state.pkSource === "badge")
  );
  const deadTodaySeats = new Set<number>();
  if (deathsAnnounced) {
    getRecordedNightDeaths(state.nightHistory?.[state.day]).forEach((d) => deadTodaySeats.add(d.seat));
    const todayDayHistory = state.dayHistory?.[state.day];
    if (todayDayHistory?.executed) deadTodaySeats.add(todayDayHistory.executed.seat);
    if (todayDayHistory?.hunterShot) deadTodaySeats.add(todayDayHistory.hunterShot.targetSeat);
    if (todayDayHistory?.selfDestruct) {
      deadTodaySeats.add(todayDayHistory.selfDestruct.boomSeat);
      if (todayDayHistory.selfDestruct.targetSeat !== undefined) {
        deadTodaySeats.add(todayDayHistory.selfDestruct.targetSeat);
      }
    }
  }
  const deadToday = state.players.filter((p) => deadTodaySeats.has(p.seat));
  const totalSeats = state.players.length;
  const adjacentDeadSeats = deadToday.filter(d => {
    const diff = Math.abs(d.seat - player.seat);
    return diff === 1 || diff === totalSeats - 1;
  }).map((deadPlayer) => deadPlayer.seat);
  if (adjacentDeadSeats.length > 0) {
    facts.push(t("promptUtils.gameContext.factsAdjacentDead", {
      seats: adjacentDeadSeats
        .map((seat) => t("promptUtils.gameContext.seatLabel", { seat: seat + 1 }))
        .join(t("promptUtils.gameContext.listSeparator")),
    }));
  }

  // 立场类提示（警长支持/质疑）已移除：与对局事实无关的方向性暗示会推动同一玩家前后立场漂移。
  // 只保留基于真实对局状态的事实类提示。

  // --- 3. 昨日公开票型中与当前玩家同票的人 ---
  if (state.day >= 2 && state.voteHistory) {
    const yesterdayVotes = state.voteHistory[state.day - 1];
    if (yesterdayVotes) {
      // Find who voted the same target as the player yesterday
      const myVote = yesterdayVotes[player.playerId];
      if (myVote !== undefined) {
        const sameVoters = Object.entries(yesterdayVotes)
          .filter(([id, target]) => target === myVote && id !== player.playerId)
          .map(([id]) => state.players.find(p => p.playerId === id))
          .filter((p): p is Player => !!p && p.alive);
        if (sameVoters.length > 0) {
          const names = sameVoters.slice(0, 2)
            .map((p) => t("promptUtils.gameContext.seatLabel", { seat: p.seat + 1 }))
            .join(t("promptUtils.gameContext.listSeparator"));
          facts.push(t("promptUtils.gameContext.factsSameVoteYesterday", {
            seats: names,
            target: t("promptUtils.gameContext.seatLabel", { seat: myVote + 1 }),
          }));
        }
      }
    }
  }

  if (facts.length === 0) return "";

  return `<public_facts_for_player>\n${t("promptUtils.gameContext.factsHeader")}\n${facts.map((fact) => `- ${fact}`).join("\n")}\n</public_facts_for_player>`;
}

/** 决策前的短事实账本：只取主持人已公布的结果和本人行动，绝不把玩家声明升级为事实。 */
export function buildDecisionGrounding(state: GameState, player: Player): string {
  const { t } = getI18n();
  const seatLabel = (seat: number): string => t("promptUtils.gameContext.seatLabel", { seat });
  const lines: string[] = [];
  for (let day = 1; day <= state.day; day++) {
    const night = state.nightHistory?.[day];
    if (!areNightResultsVisible(state, day)) {
      lines.push(t("promptUtils.gameContext.groundingNightPending", { day }));
    } else if (!night || !Array.isArray(night.deaths)) {
      lines.push(t("promptUtils.gameContext.groundingNightMissing", { day }));
    } else {
      const deaths = getRecordedNightDeaths(night);
      lines.push(deaths.length
        ? t("promptUtils.gameContext.groundingNightDeaths", {
            day,
            seats: deaths.map((d) => seatLabel(d.seat + 1)).join(t("promptUtils.gameContext.listSeparator")),
          })
        : t("promptUtils.gameContext.groundingNightClean", { day }));
    }
  }
  for (const round of state.voteRounds ?? []) {
    const target = round.votes[player.playerId];
    const kind = t(round.kind === "badge"
      ? "promptUtils.gameContext.groundingKindBadge"
      : "promptUtils.gameContext.groundingKindExile");
    const vote = typeof target === "number"
      ? target < 0
        ? t("promptUtils.gameContext.groundingAbstain")
        : t("promptUtils.gameContext.groundingVotedFor", { seat: seatLabel(target + 1) })
      : round.candidates.includes(player.seat) && (round.kind === "badge" || round.round > 1)
        ? t("promptUtils.gameContext.groundingCandidateNoVote")
        : t("promptUtils.gameContext.groundingNoVoteRecord");
    lines.push(t("promptUtils.gameContext.groundingMyVoteLine", {
      day: round.day,
      kind,
      round: round.round,
      vote,
    }));
  }
  if ((state.phase === "DAY_BADGE_SPEECH" || (state.phase === "DAY_PK_SPEECH" && state.pkSource === "badge")) &&
      state.badge.candidates.includes(player.seat)) {
    lines.push(t("promptUtils.gameContext.groundingBadgeCandidateNote"));
  }
  return `<decision_grounding>
${lines.join("\n")}
${t("promptUtils.gameContext.groundingRulesLine1")}
${t("promptUtils.gameContext.groundingRulesLine2")}
</decision_grounding>`;
}

/**
 * 人設的「底層欄位」：只有模型自己看得到（逐人不同），用來塑造水平、詞彙與長度。
 * 文案一律走 i18n，簡中／繁中／英文各自正確，不要在這裡寫死中文。
 */
const buildHiddenCommunicationProfileSection = (persona: Persona): string => {
  const { t } = getI18n();
  const lines = ([
    ["promptUtils.persona.hiddenProfileWerewolfExp", persona.werewolfExperience],
    ["promptUtils.persona.hiddenProfileVocabulary", persona.vocabularyStyle],
    ["promptUtils.persona.hiddenProfileReasoning", persona.reasoningStyle],
    ["promptUtils.persona.hiddenProfileLength", persona.speechLengthHabit],
    ["promptUtils.persona.hiddenProfilePressure", persona.pressureStyle],
    ["promptUtils.persona.hiddenProfileUncertainty", persona.uncertaintyStyle],
    ["promptUtils.persona.hiddenProfileMistake", persona.mistakePattern],
    ["promptUtils.persona.hiddenProfileWolfDisguise", persona.wolfDeceptionStyle],
  ] as const)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `- ${t(key, { v: value as string })}`);
  if (lines.length === 0) return "";
  return `\n<hidden_communication_profile>\n${t("promptUtils.persona.hiddenProfileIntro")}\n${lines.join("\n")}\n</hidden_communication_profile>`;
};

const buildHiddenPlayerMindSection = (player: Player): string => {
  const { t } = getI18n();
  const mind = player.agentProfile?.playerMind;
  if (!mind) return "";
  const lines = ([
    ["promptUtils.persona.playerMindCourage", mind.courage],
    ["promptUtils.persona.playerMindMemory", mind.memoryBias],
    ["promptUtils.persona.playerMindSuspicion", mind.suspicionThreshold],
    ["promptUtils.persona.playerMindSelfProtect", mind.selfProtection],
    ["promptUtils.persona.playerMindLogic", mind.logicDepth],
    ["promptUtils.persona.playerMindPresence", mind.tablePresence],
  ] as const)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `- ${t(key, { v: value as string })}`);
  if (lines.length === 0) return "";
  return `\n<hidden_player_mind>\n${t("promptUtils.persona.playerMindIntro")}\n${lines.join("\n")}\n</hidden_player_mind>`;
};

/**
 * 【身份】與【角色設定】綁成一塊：這兩個屬於同一個「誰在做這件事」的單位，不拆兩處。
 * 所有角色操作（夜間技能、狼隊商議、警徽、發言、投票、開槍、自爆、決鬥）都套用這個包裝。
 */
export const bindIdentityAndRoleSetting = (
  identityText: string,
  player: Player,
  isGenshinMode: boolean = false
): string => {
  const roleSetting = buildPersonaSection(player, isGenshinMode);
  return roleSetting ? `${identityText}\n\n${roleSetting}` : identityText;
};

export const buildPersonaSection = (player: Player, isGenshinMode: boolean = false): string => {
  if (isGenshinMode || !player.agentProfile) return "";
  const { t } = getI18n();
  const { persona } = player.agentProfile;
  const separator = t("promptUtils.gameContext.listSeparator");

  const base = t("promptUtils.persona.section", {
    voiceRules: persona.voiceRules.join(separator),
    riskLabel: t("promptUtils.persona.riskBalanced")
  });
  const extraInfo = persona.basicInfo?.trim()
    ? `\n${t("promptUtils.persona.basicInfo", { basicInfo: persona.basicInfo.trim() })}`
    : "";
  const hiddenCommunicationProfile = buildHiddenCommunicationProfileSection(persona);
  const hiddenPlayerMind = buildHiddenPlayerMindSection(player);
  return `${base}${extraInfo}${hiddenCommunicationProfile}${hiddenPlayerMind}`;
};

/**
 * 熟人局素材：拼入全桌每個人的「平时积累的印象」（persona 行为栏位）与「交手记录」（历史胜率/MVP）。
 * **含自己那一行**：內容逐字不隨座位改變，才能整段進 system 共用前綴（全桌同一份）。
 * 这些内容互相之间平时不可见，但熟人局设定下视为彼此认识多年所知；印象仅供参考，不是事实。
 */
const buildAcquaintanceNotes = (
  state: Pick<GameState, "players" | "isAcquaintanceGame" | "characterStats">
): string => {
  if (!state.isAcquaintanceGame) return "";
  const { t } = getI18n();
  const lines: string[] = [];
  for (const other of state.players) {
    const traits: string[] = [];
    if (other.isHuman) {
      traits.push(t("promptUtils.acquaintance.humanTag"));
    } else {
      const model = other.agentProfile?.modelRef?.model;
      if (model) traits.push(t("promptUtils.acquaintance.fieldModel", { v: model }));
    }
    const persona = other.agentProfile?.persona;
    if (persona) {
      if (persona.werewolfExperience) traits.push(t("promptUtils.acquaintance.fieldWerewolfExp", { v: persona.werewolfExperience }));
      if (persona.reasoningStyle) traits.push(t("promptUtils.acquaintance.fieldReasoning", { v: persona.reasoningStyle }));
      if (persona.vocabularyStyle) traits.push(t("promptUtils.acquaintance.fieldVocabulary", { v: persona.vocabularyStyle }));
      if (persona.speechLengthHabit) traits.push(t("promptUtils.acquaintance.fieldLength", { v: persona.speechLengthHabit }));
      if (persona.pressureStyle) traits.push(t("promptUtils.acquaintance.fieldPressure", { v: persona.pressureStyle }));
      if (persona.uncertaintyStyle) traits.push(t("promptUtils.acquaintance.fieldUncertainty", { v: persona.uncertaintyStyle }));
      if (persona.mistakePattern) traits.push(t("promptUtils.acquaintance.fieldMistake", { v: persona.mistakePattern }));
      if (persona.wolfDeceptionStyle) traits.push(t("promptUtils.acquaintance.fieldWolfDisguise", { v: persona.wolfDeceptionStyle }));
    }
    const mind = other.agentProfile?.playerMind;
    if (mind) {
      if (mind.courage) traits.push(t("promptUtils.acquaintance.fieldCourage", { v: mind.courage }));
      if (mind.selfProtection) traits.push(t("promptUtils.acquaintance.fieldSelfProtect", { v: mind.selfProtection }));
      if (mind.tablePresence) traits.push(t("promptUtils.acquaintance.fieldPresence", { v: mind.tablePresence }));
    }
    const stat = state.characterStats?.[other.characterId ?? other.displayName];
    const record = stat
      ? t("promptUtils.acquaintance.statsLine", {
        games: stat.games,
        rate: stat.games > 0 ? Math.round((stat.wins / stat.games) * 100) : 0,
        mvps: stat.mvps,
      })
      : "";
    if (traits.length === 0 && !record) continue;
    const traitText = traits.length > 0 ? traits.join(t("promptUtils.gameContext.listSeparator")) : "";
    const parts = [traitText, record].filter((part) => part.length > 0);
    lines.push(`- ${other.seat + 1}号${other.displayName}：${parts.join(t("promptUtils.gameContext.listSeparator"))}`);
  }
  if (lines.length === 0) return "";
  return `\n\n<acquaintance_notes>\n${t("promptUtils.acquaintance.header")}\n${lines.join("\n")}\n</acquaintance_notes>`;
};

export const buildAliveCountsSection = (state: GameState): string => {
  const { t } = getI18n();
  const alive = state.players.filter((p) => p.alive);

  return t("promptUtils.aliveCounts", { count: alive.length });
};

type NightHistoryRecord = NonNullable<GameState["nightHistory"]>[number];
type NightDeathRecord = NonNullable<NightHistoryRecord["deaths"]>[number];

const getRecordedNightDeaths = (history: NightHistoryRecord | undefined): NightDeathRecord[] => {
  return Array.isArray(history?.deaths)
    ? history.deaths.filter((death): death is NightDeathRecord => death && typeof death.seat === "number")
    : [];
};

const formatSeatName = (state: GameState, seat: number): string => {
  const { t } = getI18n();
  const player = state.players.find((p) => p.seat === seat);
  return t("promptUtils.gameContext.seatName", { seat: seat + 1, name: player?.displayName || "" });
};

const buildVoteGroupLines = (
  state: GameState,
  voteGroups: Record<number, number[]>,
  sheriffPlayerId?: string,
  includeVoteCount: boolean = true
): string[] => {
  const { t } = getI18n();
  return Object.entries(voteGroups)
    .map(([target, voters]) => {
      const targetSeat = Number(target);
      const weightedVotes = voters.reduce((sum, seat) => {
        const voter = state.players.find((p) => p.seat === seat);
        if (!voter) return sum;
        return sum + (voter.playerId === sheriffPlayerId ? 1.5 : 1);
      }, 0);
      return { targetSeat, voters, weightedVotes };
    })
    .sort((a, b) => b.weightedVotes - a.weightedVotes)
    .map(({ targetSeat, voters, weightedVotes }) => {
      const voterList = voters.map((seat) => seat + 1).join(",");
      if (!includeVoteCount) {
        return `  ${formatSeatName(state, targetSeat)}: {${t("promptUtils.gameContext.voters")}: [${voterList}]}`;
      }
      const voteLabel = Number.isInteger(weightedVotes) ? `${weightedVotes}` : weightedVotes.toFixed(1);
      return `  ${formatSeatName(state, targetSeat)}: {${t("promptUtils.gameContext.voteCount")}: ${voteLabel}, ${t("promptUtils.gameContext.voters")}: [${voterList}]}`;
    });
};

const buildVoteGroupsFromPlayerTargets = (
  state: GameState,
  votes: Record<string, number>
): Record<number, number[]> => {
  const voteGroups: Record<number, number[]> = {};
  const validSeats = new Set(state.players.map((player) => player.seat));
  Object.entries(votes).forEach(([voterId, targetSeat]) => {
    const voter = state.players.find((p) => p.playerId === voterId);
    if (!voter || !validSeats.has(targetSeat)) return;
    if (!voteGroups[targetSeat]) voteGroups[targetSeat] = [];
    voteGroups[targetSeat].push(voter.seat);
  });
  return voteGroups;
};

const buildVoteGroupsFromSeatTargets = (
  state: GameState,
  votes: Record<string, number[]>
): Record<number, number[]> => {
  const voteGroups: Record<number, number[]> = {};
  const validSeats = new Set(state.players.map((player) => player.seat));
  Object.entries(votes).forEach(([target, voters]) => {
    const targetSeat = Number(target);
    if (!Number.isFinite(targetSeat) || !validSeats.has(targetSeat)) return;
    voteGroups[targetSeat] = voters
      .map((seat) => Number(seat))
      .filter((seat) => Number.isFinite(seat) && validSeats.has(seat));
  });
  return voteGroups;
};

/**
 * 把 `[VOTE_RESULT]{...}` 改寫成「投票詳情」與逐票型的人話版（1-based 座位、含警長 1.5 票權重）。
 * JSON 壞掉時只記錄並跳過該段，不讓整份紀錄消失。
 */
const voteRoundKindLabel = (kind: "badge" | "execution"): string =>
  getI18n().t(kind === "badge"
    ? "promptUtils.gameContext.voteRoundKindBadge"
    : "promptUtils.gameContext.voteRoundKindExile");

const voteRoundOutcomeLabel = (outcome: string): string => {
  const { t } = getI18n();
  switch (outcome) {
    case "elected":
      return t("promptUtils.gameContext.voteRoundOutcomeElected");
    case "executed":
      return t("promptUtils.gameContext.voteRoundOutcomeExecuted");
    case "idiot-revealed":
      return t("promptUtils.gameContext.voteRoundOutcomeIdiotRevealed");
    case "tie":
      return t("promptUtils.gameContext.voteRoundOutcomeTie");
    default:
      return t("promptUtils.gameContext.voteRoundOutcomeNoVotes");
  }
};

const formatVoteResultLines = (state: GameState, content: string): string[] => {
  const { t } = getI18n();
  try {
    const parsed = JSON.parse(content.slice("[VOTE_RESULT]".length)) as {
      title?: string;
      results?: Array<{ targetSeat?: number; voterSeats?: number[]; voteCount?: number }>;
    };
    const results = (parsed.results ?? []).filter(
      (r): r is { targetSeat: number; voterSeats?: number[]; voteCount?: number } =>
        typeof r.targetSeat === "number"
    );
    if (results.length === 0) return [];
    const separator = t("promptUtils.gameContext.listSeparator");
    const lines = [
      `${t("promptUtils.gameContext.transcriptSystemPrefix")}${parsed.title || t("badgePhase.voteDetailTitle")}`,
    ];
    for (const result of results) {
      const voters = (result.voterSeats ?? [])
        .map((seat) => formatSeatName(state, seat))
        .join(separator);
      const count = typeof result.voteCount === "number"
        ? (Number.isInteger(result.voteCount) ? `${result.voteCount}` : result.voteCount.toFixed(1))
        : `${(result.voterSeats ?? []).length}`;
      lines.push(t("promptUtils.gameContext.voteDetailLine", {
        target: formatSeatName(state, result.targetSeat),
        count,
        voters,
      }));
    }
    return lines;
  } catch (error) {
    console.warn("[wolfcha] 解析 VOTE_RESULT 失敗，該段票型不寫入白天記錄:", error);
    return [];
  }
};

const shouldIncludeHistoricalSystemLine = (content: string): boolean => {
  const systemMessages = getSystemMessages();
  const systemPatterns = getSystemPatterns();
  const excluded = new Set([
    "天亮了",
    "Dawn breaks, please open your eyes",
    "进入投票环节",
    "Discussion ends, voting begins.",
    systemMessages.dayBreak,
    systemMessages.badgeSpeechStart,
    systemMessages.badgeElectionStart,
    systemMessages.badgeRevote,
    systemMessages.dayDiscussion,
    systemMessages.summarizingDay,
    systemMessages.guardActionStart,
    systemMessages.wolfActionStart,
    systemMessages.witchActionStart,
    systemMessages.seerActionStart,
  ]);

  if (!content || content.startsWith("[VOTE_RESULT]") || excluded.has(content)) return false;
  return !systemPatterns.nightFall.test(content);
};


/**
 * Build full past days' transcripts.
 * The current default model has enough context for complete game history, so do not trim old speeches here.
 */
export const buildPastDaysTranscript = (state: GameState): string => {
  const { t } = getI18n();
  if (state.day <= 1) return "";

  // Group past-day messages by day (excluding current day)
  const dayGroups: { day: number; transcript: string }[] = [];
  for (let d = 1; d < state.day; d++) {
    const transcript = formatTranscriptMessages(state, state.messages.filter((m) => m.day === d));
    dayGroups.push({ day: d, transcript });
  }

  if (dayGroups.length === 0) return "";

  // 標題自成一行（取代舊的 <history> 外框＋【第N天】標籤）：過往白天記錄直接排在 user 最前面。
  const sections = dayGroups.map(({ day, transcript }) => {
    const heading = t("promptUtils.gameContext.pastDayHeading", { day });
    return transcript ? `${heading}\n${transcript}` : heading;
  });

  if (sections.length === 0) return "";
  return sections.join("\n\n");
};

export const getDayStartIndex = (state: GameState): number => {
  const systemMessages = getSystemMessages();
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.isSystem && m.content === systemMessages.dayBreak) return i;
  }
  return 0;
};

export const getVoteStartIndex = (state: GameState): number => {
  const systemMessages = getSystemMessages();
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.isSystem && m.content === systemMessages.voteStart) return i;
  }
  return state.messages.length;
};

const getTranscriptPhaseLabel = (phase: Phase | undefined): string | null => {
  if (!phase) return null;
  const { t } = getI18n();
  switch (phase) {
    case "DAY_BADGE_SPEECH":
      return t("promptUtils.gameContext.transcriptPhaseBadgeSpeech");
    case "DAY_PK_SPEECH":
      return t("promptUtils.gameContext.transcriptPhasePkSpeech");
    case "DAY_SPEECH":
      return t("promptUtils.gameContext.transcriptPhaseDaySpeech");
    case "DAY_LAST_WORDS":
      return t("promptUtils.gameContext.transcriptPhaseLastWords");
    default:
      return null;
  }
};

const formatTranscriptMessages = (
  state: GameState,
  messages: ChatMessage[]
): string => {
  const { t } = getI18n();
  const lines: string[] = [];
  let previousPhase: Phase | undefined;
  let previousRound: number | undefined;
  const roundsByPhase = new Map<Phase, number>();
  // 逐日計算「這是今天第幾個 VOTE_RESULT」，用來對上當天的第幾輪投票。
  const voteResultSeen = new Map<number, number>();

  messages.forEach((m) => {
    if (m.isSystem) {
      const systemContent = m.content.trim();
      // 原始 [VOTE_RESULT] 是 0-based 的 JSON，直接餵模型只會混淆；
      // 改寫成人話版「投票詳情」＋逐票型，並且保留它在時間軸上的位置（就在投票之後、遺言之前）。
      if (systemContent.startsWith("[VOTE_RESULT]")) {
        // 當天的第 N 個 VOTE_RESULT 對應當天第 N 輪投票（輪次資料來自 state.voteRounds）。
        const messageDay = m.day ?? state.day;
        const seen = voteResultSeen.get(messageDay) ?? 0;
        voteResultSeen.set(messageDay, seen + 1);
        const round = (state.voteRounds ?? [])
          .filter((r) => r.day === messageDay)
          .sort((a, b) => a.round - b.round)[seen];
        if (round) {
          lines.push(t("promptUtils.gameContext.voteRoundHeader", {
            day: round.day,
            kind: voteRoundKindLabel(round.kind),
            round: round.round,
          }));
          lines.push(`  ${t("promptUtils.gameContext.voteRoundCandidates", {
            list: round.candidates
              .map((seat) => formatSeatName(state, seat))
              .join(t("promptUtils.gameContext.listSeparator")),
          })}`);
        }
        lines.push(...formatVoteResultLines(state, systemContent));
        if (round) {
          lines.push(`  ${t("promptUtils.gameContext.voteRoundResult", {
            text: voteRoundOutcomeLabel(round.outcome),
          })}`);
        }
        return;
      }
      if (shouldIncludeHistoricalSystemLine(systemContent)) {
        lines.push(`${t("promptUtils.gameContext.transcriptSystemPrefix")}${systemContent}`);
      }
      return;
    }
    if (m.phase !== previousPhase || m.speechRound !== previousRound) {
      let phaseLabel = getTranscriptPhaseLabel(m.phase);
      if (m.phase && phaseLabel) {
        const round = (roundsByPhase.get(m.phase) ?? 0) + 1;
        roundsByPhase.set(m.phase, round);
        if (m.phase === "DAY_PK_SPEECH" && m.pkSource) {
          phaseLabel += " / " + t(m.pkSource === "badge" ? "promptUtils.gameContext.transcriptPkBadge" : "promptUtils.gameContext.transcriptPkVote");
        }
        if (m.speechRound !== undefined || round > 1) phaseLabel += " / " + t("promptUtils.gameContext.transcriptRound", { round });
        lines.push(t("promptUtils.gameContext.transcriptPhaseHeader", { phase: phaseLabel }));
      }
      previousPhase = m.phase;
      previousRound = m.speechRound;
    }

    const player = state.players.find((p) => p.playerId === m.playerId);
    const speaker = player ? t("mentions.seatLabel", { seat: player.seat + 1 }) : m.playerName;
    const lastWordsLabel = m.isLastWords ? t("promptUtils.gameContext.lastWordsLabel") : "";
    const statusLabel = m.day === state.day && player && !player.alive ? t("promptUtils.gameContext.transcriptCurrentlyEliminated") : "";
    lines.push(`${lastWordsLabel}${speaker}${statusLabel}: ${m.content}`);
  });

  // 沒有 VOTE_RESULT 訊息可當錨點的輪次（例如舊存檔、回滾後的狀態）補在當天最後，
  // 保證票型不會因為缺少訊息而從 prompt 消失。
  const transcriptDay = messages[0]?.day ?? state.day;
  const roundsOfDay = (state.voteRounds ?? [])
    .filter((r) => r.day === transcriptDay)
    .sort((a, b) => a.round - b.round);
  roundsOfDay.slice(voteResultSeen.get(transcriptDay) ?? 0).forEach((round) => {
    lines.push(t("promptUtils.gameContext.voteRoundHeader", {
      day: round.day,
      kind: voteRoundKindLabel(round.kind),
      round: round.round,
    }));
    lines.push(`  ${t("promptUtils.gameContext.voteRoundCandidates", {
      list: round.candidates
        .map((seat) => formatSeatName(state, seat))
        .join(t("promptUtils.gameContext.listSeparator")),
    })}`);
    const sheriffPlayerId = typeof round.sheriffSeat === "number"
      ? state.players.find((p) => p.seat === round.sheriffSeat)?.playerId
      : undefined;
    lines.push(`${t("promptUtils.gameContext.transcriptSystemPrefix")}${t("badgePhase.voteDetailTitle")}`);
    Object.entries(buildVoteGroupsFromPlayerTargets(state, round.votes))
      .map(([target, voters]) => {
        const weighted = voters.reduce((sum, seat) => {
          const voter = state.players.find((p) => p.seat === seat);
          return sum + (voter && voter.playerId === sheriffPlayerId ? 1.5 : 1);
        }, 0);
        return { target: Number(target), voters, weighted };
      })
      .sort((a, b) => b.weighted - a.weighted)
      .forEach(({ target, voters, weighted }) => {
        lines.push(t("promptUtils.gameContext.voteDetailLine", {
          target: formatSeatName(state, target),
          count: Number.isInteger(weighted) ? `${weighted}` : weighted.toFixed(1),
          voters: voters
            .map((seat) => formatSeatName(state, seat))
            .join(t("promptUtils.gameContext.listSeparator")),
        }));
      });
    lines.push(`  ${t("promptUtils.gameContext.voteRoundResult", {
      text: voteRoundOutcomeLabel(round.outcome),
    })}`);
  });

  return lines.join("\n");
};


export const buildTodayTranscript = (
  state: GameState,
  options?: { excludePlayerId?: string }
): string => {
  const messages = state.messages.filter((m) => {
    if (m.day !== state.day || m.isSystem) return false;
    return !options?.excludePlayerId || m.playerId !== options.excludePlayerId;
  });
  const transcript = formatTranscriptMessages(state, messages);

  if (!transcript) return "";
  return transcript;
};

/**
 * 賽後感言用的「本局完整發言記錄（逐字）」：逐日列出所有公開發言、遺言與主持人公開系統訊息。
 *
 * 為什麼要這份：賽後感言原本只吃各日 AI 摘要（且被硬截 1600 字），模型看不到玩家的原話，
 * 也容易把摘要作者的理解當成事實。逐字記錄讓角色能引用實際說詞、還原當時的語氣。
 *
 * 刻意排除 GAME_END 階段——否則後發言的角色會看到前面角色已發表的感言而互相抄。
 */
export const buildFullGameTranscript = (
  state: GameState,
  options?: { maxChars?: number }
): string => {
  const { t } = getI18n();
  const maxChars = options?.maxChars ?? 14000;
  const sections: string[] = [];
  for (let day = 1; day <= state.day; day++) {
    const dayMessages = state.messages.filter(
      (m) => m.day === day && m.phase !== "GAME_END" && !(m.isSystem && m.content.startsWith("["))
    );
    if (dayMessages.length === 0) continue;
    const transcript = formatTranscriptMessages(state, dayMessages);
    if (!transcript) continue;
    sections.push(`${t("promptUtils.gameContext.dayLabel", { day })}\n${transcript}`);
  }
  const text = sections.join("\n\n");
  if (text.length > maxChars) {
    // 超長時保留最近的日子（後段通常與勝負最相關），開頭標明已省略。
    return `…\n${text.slice(text.length - maxChars)}`;
  }
  return text;
};

export const buildPlayerTodaySpeech = (state: GameState, player: Player): string => {
  const speech = state.messages
    .filter((m) => m.day === state.day)
    .filter((m) => !m.isSystem && m.playerId === player.playerId)
    .map((m) => m.content)
    .join("\n");

  if (!speech) return "";
  return speech;
};

export const buildSystemAnnouncementsSinceDawn = (state: GameState, maxLines?: number): string => {
  const systemMessages = getSystemMessages();
  const systemPatterns = getSystemPatterns();
  const excluded = [
    "天亮了",
    "Dawn breaks, please open your eyes",
    systemMessages.dayBreak,
    "进入投票环节",
    "发言结束，开始投票。",
    "Discussion ends, voting begins.",
    systemMessages.voteStart,
  ];

  const systemLines = state.messages
    .filter((m) => m.day === state.day)
    .filter((m) => m.isSystem)
    .map((m) => String(m.content || "").trim())
    .filter((c) => {
      if (!c) return false;
      // 过滤掉带有 0-based 索引的原始 JSON 数据，避免混淆 AI
      if (c.startsWith("[VOTE_RESULT]")) return false;
      // Filter out dawn and vote start messages in both locales
      if (excluded.includes(c)) return false;
      if (
        systemPatterns.playerKilled.test(c) ||
        systemPatterns.playerPoisoned.test(c) ||
        systemPatterns.playerMilkKilled.test(c)
      ) {
        return false;
      }
      return true;
    });

  if (systemLines.length === 0) return "";
  if (maxLines === undefined || !Number.isFinite(maxLines)) return systemLines.join("\n");
  const limit = Math.max(0, maxLines);
  if (limit === 0) return "";
  return (systemLines.length > limit ? systemLines.slice(-limit) : systemLines).join("\n");
};

/**
 * Build role-specific private information section.
 * This is placed at the TOP of the context to ensure AI sees it first.
 */
const buildRolePrivateInfo = (
  state: GameState,
  player: Player,
  options?: { excludePendingDeaths?: boolean }
): string | null => {
  const { t } = getI18n();
  // 夜间"结果"(刀/守/救是否致死)在天亮公布前不得泄露给当前行动者。目标"身份"(刀谁/守谁/夜里看到的刀口)
  // 本就属于该角色夜间合法所知，可照常展示；这里只对"当晚(state.day)结果"在死亡公布前做门控，过往夜次已公开。
  const outcomeKnownForDay = (day: number): boolean =>
    areNightResultsVisible(state, day) && (!options?.excludePendingDeaths || day < state.day);
  if (player.role === "Seer") {
    const history = state.nightActions.seerHistory || [];
    // 首驗（history 空）不得整段跳過：夜間查驗行動的選人指引就在這一段裡，
    // 提早 return 會讓預言家第一次查驗完全沒有策略提示（曾導致「隨機／名字帶邪氣」當理由）。
    const checks = history.length > 0
      ? history.map((record) => {
          const target = state.players.find((p) => p.seat === record.targetSeat);
          const result = t(record.isWolf
            ? "promptUtils.gameContext.seerResultWolf"
            : "promptUtils.gameContext.seerResultGood");
          return t("promptUtils.gameContext.seerRecordLine", {
            day: record.day,
            seat: t("promptUtils.gameContext.seatLabel", { seat: record.targetSeat + 1 }),
            name: target?.displayName || "",
            result,
          });
        })
      : [t("promptUtils.gameContext.seerHistoryEmpty")];
    
    let seerInfo = `<your_seer_checks>
${t("promptUtils.gameContext.seerChecksHeader")}
${checks.join("\n")}`;
    seerInfo += `\n</your_seer_checks>`;
    return seerInfo;
  }
  
  if (player.role === "Witch") {
    const healStatus = t(state.roleAbilities.witchHealUsed
      ? "promptUtils.gameContext.witchStatusUsed"
      : "promptUtils.gameContext.witchStatusAvailable");
    const poisonStatus = t(state.roleAbilities.witchPoisonUsed
      ? "promptUtils.gameContext.witchStatusUsed"
      : "promptUtils.gameContext.witchStatusAvailable");
    const witchActions: string[] = [];
    const wolfTargetInfo: string[] = [];

    // 女巫只有在"当晚仍持有解药"时才会被告知刀口（与 NightPhase.buildWitchPrompt 的夜间逻辑一致）。
    // 解药在 witchSave 为 true 的那一晚用掉，因此该晚（含）之前可见刀口，之后不再可见，
    // 否则女巫用完解药后白天仍会拿到本不该知道的历史刀口（上帝视角）。
    let healUsedNight: number | null = null;
    if (state.nightHistory) {
      Object.entries(state.nightHistory).forEach(([day, history]) => {
        if (history.witchSave) healUsedNight = Number(day);
      });
    }

    if (state.nightHistory) {
      Object.entries(state.nightHistory).forEach(([day, history]) => {
        // 收集狼人刀口信息：仅在女巫当晚仍可使用解药时才可见
        const witchHadAntidoteThatNight = healUsedNight === null || Number(day) <= healUsedNight;
        if (history.wolfTarget !== undefined && witchHadAntidoteThatNight) {
          const targetPlayer = state.players.find(p => p.seat === history.wolfTarget);
          if (targetPlayer) {
            wolfTargetInfo.push(t("promptUtils.gameContext.witchKnifeLine", {
              day,
              seat: t("promptUtils.gameContext.seatLabel", { seat: history.wolfTarget + 1 }),
              name: targetPlayer.displayName,
            }));
          }
        }

        if (history.witchSave && history.wolfTarget !== undefined) {
          const savedPlayer = state.players.find(p => p.seat === history.wolfTarget);
          if (savedPlayer) {
            // 守+救叠加(milk)等情形下被救者当晚仍会出局，需据当晚结算标注救援是否生效，避免女巫误以为救活了人。
            // 救援"结果"在天亮公布前不展示，与狼/守卫一致显示"结果待天亮公布"（当晚 outcome 门控）。
            const saveNote = !outcomeKnownForDay(Number(day))
              ? t("promptUtils.gameContext.witchSavePending")
              : getRecordedNightDeaths(history).some((d) => d.seat === history.wolfTarget)
                ? t("promptUtils.gameContext.witchSaveFailed")
                : "";
            witchActions.push(t("promptUtils.gameContext.witchSaveLine", {
              day,
              seat: t("promptUtils.gameContext.seatLabel", { seat: history.wolfTarget + 1 }),
              name: savedPlayer.displayName,
              note: saveNote,
            }));
          }
        }
        if (history.witchPoison !== undefined) {
          const poisonedPlayer = state.players.find(p => p.seat === history.witchPoison);
          if (poisonedPlayer) {
            witchActions.push(t("promptUtils.gameContext.witchPoisonLine", {
              day,
              seat: t("promptUtils.gameContext.seatLabel", { seat: history.witchPoison + 1 }),
              name: poisonedPlayer.displayName,
            }));
          }
        }
      });
    }
    let witchInfo = `<your_potions>
${t("promptUtils.gameContext.witchStatusHeader", { heal: healStatus, poison: poisonStatus })}`;
    if (wolfTargetInfo.length > 0) {
      witchInfo += `\n${t("promptUtils.gameContext.witchKnifeHeader")}\n${wolfTargetInfo.join('\n')}`;
    }
    if (witchActions.length > 0) {
      witchInfo += `\n${t("promptUtils.gameContext.witchActionsHeader")}\n${witchActions.join("\n")}`;
    }
    witchInfo += `\n</your_potions>`;
    return witchInfo;
  }
  
  if (player.role === "Guard") {
    const records = Object.entries(state.nightHistory || {})
      .sort(([a], [b]) => Number(a) - Number(b))
      .filter(([, history]) => history.guardTarget !== undefined)
      .map(([day, history]) => {
        const seat = history.guardTarget!;
        const target = state.players.find((p) => p.seat === seat);
        const deaths = getRecordedNightDeaths(history);
        const seatList = deaths
          .map((death) => t("promptUtils.gameContext.seatLabel", { seat: death.seat + 1 }))
          .join(t("promptUtils.gameContext.listSeparator"));
        const result = !outcomeKnownForDay(Number(day))
          ? t("promptUtils.gameContext.guardResultPending")
          : !Array.isArray(history.deaths)
            ? t("promptUtils.gameContext.guardResultMissing")
            : `${
                t(deaths.some((death) => death.seat === seat)
                  ? "promptUtils.gameContext.guardTargetDied"
                  : "promptUtils.gameContext.guardTargetAlive")
              }；${
                deaths.length
                  ? t("promptUtils.gameContext.guardNightSummaryDeaths", { day, seats: seatList })
                  : t("promptUtils.gameContext.guardNightSummaryClean", { day })
              }`;
        return t("promptUtils.gameContext.guardRecordLine", {
          day,
          seat: t("promptUtils.gameContext.seatLabel", { seat: seat + 1 }),
          name: target?.displayName || "",
          result,
        });
      });
    const lastSeat = state.nightActions.lastGuardTarget;
    const lastTarget = state.players.find((p) => p.seat === lastSeat);
    let guardInfo = `<your_guard_info>
${t("promptUtils.gameContext.guardRecordsHeader")}${
      records.length ? `\n${records.join("\n")}` : t("promptUtils.gameContext.guardNoRecords")}
${t("promptUtils.gameContext.guardMeaningNote")}
${
      lastSeat !== undefined
        ? `${t("promptUtils.gameContext.guardLastTarget", {
            seat: t("promptUtils.gameContext.seatLabel", { seat: lastSeat + 1 }),
            name: lastTarget?.displayName || "",
          })}\n${t("promptUtils.gameContext.guardTonightLimit", {
            seat: t("promptUtils.gameContext.seatLabel", { seat: lastSeat + 1 }),
          })}`
        : t("promptUtils.gameContext.guardNoLimit")
    }`;
    guardInfo += `\n</your_guard_info>`;
    return guardInfo;
  }
  
  if (isWolfRole(player.role)) {
    const allWolves = state.players.filter((p) => isWolfRole(p.role));
    const aliveWolves = allWolves.filter((p) => p.alive);
    const formatWolfList = (wolves: Player[]) => wolves.length > 0
      ? wolves
          .map((wolf) => t("promptUtils.gameContext.seatName", {
            seat: wolf.seat + 1,
            name: wolf.displayName,
          }))
          .join(t("promptUtils.gameContext.listSeparator"))
      : t("promptUtils.gameContext.wolfNone");

    // 狼队历次出刀记录：这是狼阵营自己的夜间行动，属于合法私有信息。
    // 缺失它会导致狼人白天对死者归因/悍跳/自爆时与自己真实刀法脱节。
    const killRecords: string[] = [];
    if (state.nightHistory) {
      Object.entries(state.nightHistory)
        .sort(([a], [b]) => Number(a) - Number(b))
        .forEach(([day, history]) => {
          if (history.wolfTarget === undefined) return;
          const target = state.players.find((p) => p.seat === history.wolfTarget);
          if (!target) return;
          // 目标当晚是否出局（基于夜间结算，公开可知，不泄露被守/被救的具体原因）；
          // 当晚结果在天亮公布前不展示（避免狼在竞选发言阶段提前得知刀法是否成功）。
          const outcome = !outcomeKnownForDay(Number(day))
            ? t("promptUtils.gameContext.wolfKillPending")
            : getRecordedNightDeaths(history).some((d) => d.seat === history.wolfTarget)
              ? t("promptUtils.gameContext.wolfKillDied")
              : t("promptUtils.gameContext.wolfKillSurvived");
          killRecords.push(t("promptUtils.gameContext.wolfKillLine", {
            day,
            seat: t("promptUtils.gameContext.seatLabel", { seat: history.wolfTarget + 1 }),
            name: target.displayName,
            outcome,
          }));
        });
    }

    let wolfInfo = `<your_wolf_team>
${t("promptUtils.gameContext.wolfAliveHeader")}${formatWolfList(aliveWolves)}
${t("promptUtils.gameContext.wolfDeadHeader")}${formatWolfList(allWolves.filter((wolf) => !wolf.alive))}
${t("promptUtils.gameContext.wolfAliveCount", { alive: aliveWolves.length, total: allWolves.length })}`;
    if (killRecords.length > 0) {
      wolfInfo += `\n${t("promptUtils.gameContext.wolfKillHeader")}\n${killRecords.join("\n")}`;
    }
    // 第一夜商定的分工：夜裡的事實，注入所有狼視角（報名、發言、投票都看得到）。
    if (state.wolfTeamPlan) {
      wolfInfo += `\n${buildWolfTeamPlanSection(state, state.wolfTeamPlan, player)}`;
    }
    wolfInfo += `\n</your_wolf_team>`;
    return wolfInfo;
  }
  
  return null;
};

/** 狼隊夜裡商定的分工：注入狼視角的計畫區塊。 */
const buildWolfTeamPlanSection = (
  state: GameState,
  plan: WolfTeamPlan,
  self: Player
): string => {
  const { t } = getI18n();
  const captain = state.players.find((p) => p.seat === plan.captainSeat);
  const postureKeyByCode: Record<string, string> = {
    jump: "wolfTeamPlanPostureJump",
    charge: "wolfTeamPlanPostureCharge",
    hook: "wolfTeamPlanPostureHook",
    deep: "wolfTeamPlanPostureDeep",
  };
  const lines: string[] = [
    t("promptUtils.gameContext.wolfTeamPlanHeader", {
      day: plan.day,
      captainSeat: plan.captainSeat + 1,
      captainName: captain?.displayName ?? "",
    }),
  ];
  const seats = Object.keys(plan.postures)
    .map(Number)
    .filter((seat) => Number.isInteger(seat))
    .sort((a, b) => a - b);
  for (const seat of seats) {
    const member = state.players.find((p) => p.seat === seat);
    const lineArgs = {
      seat: seat + 1,
      name: member?.displayName ?? "",
      posture: t(`promptUtils.gameContext.${postureKeyByCode[plan.postures[String(seat)]]}` as Parameters<typeof t>[0]),
      signup: plan.signupSeats.includes(seat)
        ? t("promptUtils.gameContext.wolfTeamPlanSignupYes")
        : t("promptUtils.gameContext.wolfTeamPlanSignupNo"),
    };
    lines.push(
      seat === self.seat
        ? t("promptUtils.gameContext.wolfTeamPlanSelfLine", lineArgs)
        : t("promptUtils.gameContext.wolfTeamPlanMemberLine", lineArgs)
    );
  }
  if (plan.reason) {
    lines.push(
      t("promptUtils.gameContext.wolfTeamPlanReasonLine", { reason: plan.reason })
    );
  }
  lines.push(t("promptUtils.gameContext.wolfTeamPlanAdvisory"));
  return lines.join("\n");
};

export type GameContextParts = { shared: string; private: string };

/**
 * 組出對局上下文，分成兩個區塊：
 * - `shared`：公共資訊（公開規則、票型、逐字紀錄等），同一輪裡不同座位的字串完全一致
 * - `private`：個人專屬（身份、私有資訊、熟人印象、個人狀態）
 * 分開回傳是為了前綴快取：呼叫端把 shared 排在前面、private 排在後面，
 * 同一輪的多個 AI 呼叫就能共用同一段前綴（實測快取命中約 99%）。
 */
export const buildGameContextParts = (
  state: GameState,
  player: Player,
  options?: { excludePendingDeaths?: boolean }
): GameContextParts => {
  options = { ...options, excludePendingDeaths: options?.excludePendingDeaths || !areNightResultsVisible(state) };
  const { t } = getI18n();
  const alivePlayers = state.players.filter((p) => p.alive);
  const deadPlayers = state.players.filter((p) => !p.alive);
  const totalSeats = state.players.length;
  const publicGenericDeathCause = t("promptUtils.gameContext.deathCauseDeath");
  const publicExecutionCause = t("promptUtils.gameContext.deathCauseVote");
  // 槍的死因文案不預先取：獵人槍與狼王槍要分開（見 shotDeathCauseLabel）。
  const publicWhiteWolfKingCause = t("promptUtils.gameContext.deathCauseWhiteWolfKing");

  // === 個人專屬區塊集中在最後（前綴快取友善） ===
  const privateParts: string[] = [];
  const privateInfo = buildRolePrivateInfo(state, player, options);
  if (privateInfo) privateParts.push(privateInfo);
  // 過往白天記錄不在這裡：呼叫端把它當成獨立的 user content 排在最前面
  // （見 game-master 的 buildMessagesForPrompt 與 PromptResult.historyUser）。
  let context = "";

  // Build YAML-formatted game state
  const aliveSeats = alivePlayers.map((p) => p.seat + 1);
  const deadInfo = deadPlayers.map((p) => {
    // Find death info
    let cause = publicGenericDeathCause;
    let deathDay = 0;
    for (const [day, history] of Object.entries(state.nightHistory || {})) {
      const match = getRecordedNightDeaths(history).find((death) => death.seat === p.seat);
      if (match) {
        cause = publicGenericDeathCause;
        deathDay = Number(day);
      }
      if (history.hunterShot?.targetSeat === p.seat) {
        cause = shotDeathCauseLabel(state, history.hunterShot);
        deathDay = Number(day);
      }
    }
    for (const [day, history] of Object.entries(state.dayHistory || {})) {
      if (history.executed?.seat === p.seat) { cause = publicExecutionCause; deathDay = Number(day); }
      if (history.hunterShot?.targetSeat === p.seat) {
        cause = shotDeathCauseLabel(state, history.hunterShot);
        deathDay = Number(day);
      }
      if (history.selfDestruct?.boomSeat === p.seat || history.selfDestruct?.targetSeat === p.seat) {
        cause = publicWhiteWolfKingCause;
        deathDay = Number(day);
      }
    }
    return `{seat: ${p.seat + 1}, name: ${p.displayName}, day: ${deathDay}, cause: ${cause}}`;
  });

  const sheriffSeat = state.badge.holderSeat;
  const sheriffInfo = sheriffSeat !== null ? sheriffSeat + 1 : t("promptUtils.gameContext.noSheriff");

  // 明确的时间和身份提示，放在最前面
  const isNight = state.phase.includes("NIGHT");
  const phaseText = isNight ? t("promptUtils.gameContext.night") : t("promptUtils.gameContext.day");
  const timeReminder = t("promptUtils.gameContext.timeReminder", { 
    day: state.day, 
    phase: phaseText, 
    seat: player.seat + 1, 
    name: player.displayName 
  });

  privateParts.push(`<current_status>\n${timeReminder}\n</current_status>`);
  // `you:` 逐字搬到個人區：留在 game_state 裡的話，同一輪 12 個人的公共前綴
  // 會在這一行就分岔，後面所有公共內容都無法共用快取。
  privateParts.push(`you: {seat: ${player.seat + 1}, name: ${player.displayName}}`);

  // 禁言是公開資訊：天亮時主持人會宣布，所以放進公共 game_state（逐日一致、可共用快取）
  // 天亮宣佈前（夜間）不揭露，避免狼隊在夜裡就看到長老禁了誰
  const mutedSeat = isMutePublic(state) ? getMutedSeat(state) : null;
  const mutedLine = mutedSeat !== null
    ? `\nmuted: [${mutedSeat + 1}]`
    : "";

  context += `\n<game_state>
day: ${state.day}
phase: ${phaseText}
phase_code: ${state.phase}
game_status: ${state.winner ? `ended_${state.winner}` : "ongoing"}
total_seats: ${totalSeats}
alive: [${aliveSeats.join(", ")}]
dead: [${deadInfo.join(", ")}]
sheriff: ${sheriffInfo}
alive_count: ${alivePlayers.length}${mutedLine}
</game_state>`;

  const publicRoleReveals = buildPublicRoleReveals(state);
  if (publicRoleReveals) {
    context += `\n\n${publicRoleReveals}`;
  }

  if (options?.excludePendingDeaths) {
    context += `\n\n<unannounced_night_result>\n${t("promptUtils.gameContext.unannouncedNightResult")}\n</unannounced_night_result>`;
  }

  // 自己那一行不加「（你）」標記：這個標記會讓公共名單逐人不同，整段前綴就報廢；
  // 身份在個人區的 <current_status> 已經寫明。
  const playerList = alivePlayers
    .map((p) => `  - ${t("promptUtils.gameContext.seatLabel", { seat: p.seat + 1 })} ${p.displayName}${p.isHuman ? t("promptUtils.gameContext.humanSuffix") : ""}`)
    .join("\n");
  context += `\n\n<alive_players>\n${playerList}\n</alive_players>`;

  const wolfFriendlyFireNote = t("promptUtils.gameContext.wolfFriendlyFireNote");
  const phaseOrderNote =
    state.day === 1
      ? t("promptUtils.gameContext.phaseOrderNoteDay1BadgeBeforeDeath")
      : t("promptUtils.gameContext.phaseOrderNote");
  const noSameDayCausalityNote =
    state.phase.includes("DAY")
      ? t("promptUtils.gameContext.noSameDayCausalityNote")
      : "";
  // Check if guard exists in this game（單一真相：跟著本局實際組成走）
  const hasGuard = gameHasRole(state, "Guard");
  
  // Check if it's a peaceful night (no deaths today)
  const nightHistory = state.nightHistory?.[state.day];
  const isPeacefulNight = !options?.excludePendingDeaths && 
    state.phase.includes("DAY") && 
    nightHistory && 
    Array.isArray(nightHistory.deaths) &&
    getRecordedNightDeaths(nightHistory).length === 0;
  
  // Build rules text with phase order note always included
  let rulesText = wolfFriendlyFireNote;
  if (isPeacefulNight) {
    // Use different peaceful night note based on whether guard exists
    const peacefulNightNote = hasGuard 
      ? t("promptUtils.gameContext.peacefulNightNote")
      : t("promptUtils.gameContext.peacefulNightNoteNoGuard");
    rulesText += `\n${peacefulNightNote}`;
  }
  rulesText += `\n${phaseOrderNote}`;
  if (noSameDayCausalityNote) {
    rulesText += `\n${noSameDayCausalityNote}`;
  }
  if (rulesText) {
    context += `\n\n<rules>\n${rulesText}\n</rules>`;
  }

  const systemAnnouncements = buildSystemAnnouncementsSinceDawn(state);
  if (systemAnnouncements) {
    context += `\n\n<announcements>\n${systemAnnouncements}\n</announcements>`;
  }

  if (deadPlayers.length > 0) {
    // Build today's deaths info (skip if excludePendingDeaths is true - deaths not announced yet)
    if (!options?.excludePendingDeaths) {
      const currentDayDeaths: string[] = [];
      const nightHistory = state.nightHistory?.[state.day];
      getRecordedNightDeaths(nightHistory).forEach((death) => {
        const p = state.players.find(p => p.seat === death.seat);
        if (p && !p.alive) {
          currentDayDeaths.push(`{seat: ${p.seat + 1}, name: ${p.displayName}, cause: ${publicGenericDeathCause}}`);
        }
      });
      const dayHistory = state.dayHistory?.[state.day];
      if (dayHistory?.executed && dayHistory.idiotRevealed?.seat !== dayHistory.executed.seat && typeof dayHistory.executed.seat === 'number') {
        const executedSeat = dayHistory.executed.seat;
        const p = state.players.find(p => p.seat === executedSeat);
        if (p) {
          currentDayDeaths.push(`{seat: ${p.seat + 1}, name: ${p.displayName}, cause: ${publicExecutionCause}}`);
        }
      }
      if (dayHistory?.hunterShot && typeof dayHistory.hunterShot.targetSeat === "number") {
        const p = state.players.find(p => p.seat === dayHistory.hunterShot?.targetSeat);
        if (p && !p.alive) {
          currentDayDeaths.push(`{seat: ${p.seat + 1}, name: ${p.displayName}, cause: ${shotDeathCauseLabel(state, dayHistory.hunterShot)}}`);
        }
      }
      if (nightHistory?.hunterShot && typeof nightHistory.hunterShot.targetSeat === "number") {
        const p = state.players.find(p => p.seat === nightHistory.hunterShot?.targetSeat);
        if (p && !p.alive) {
          currentDayDeaths.push(`{seat: ${p.seat + 1}, name: ${p.displayName}, cause: ${shotDeathCauseLabel(state, nightHistory.hunterShot)}}`);
        }
      }
      if (dayHistory?.selfDestruct) {
        [dayHistory.selfDestruct.boomSeat, dayHistory.selfDestruct.targetSeat].forEach((seat) => {
          const p = state.players.find((player) => player.seat === seat);
          if (p && !p.alive) {
            currentDayDeaths.push(`{seat: ${p.seat + 1}, name: ${p.displayName}, cause: ${publicWhiteWolfKingCause}}`);
          }
        });
      }

      if (currentDayDeaths.length > 0) {
        context += `\n\n<today_deaths>\n${Array.from(new Set(currentDayDeaths)).join("\n")}\n</today_deaths>`;
      }
    }

    // 有人出局才附的發言提醒：死者證據（原話、遺言、票型、刀口）是合法線索，鼓勵引用；
    // 只禁止無新資訊的重複復盤與「請已出局玩家再發言」。
    // 歷史：這裡原本是硬禁止討論死者的 <banned_discussion>，上游 eec1ef6 降級成軟提醒。
    context += `\n\n<focus_reminder>${t("promptUtils.gameContext.focusReminder")}</focus_reminder>`;
  }

  // 票型不再另立 <vote_rounds> 區塊：投票詳情與逐票型已寫進【第N天 白天記錄】的時間軸，
  // 與發言、遺言排在同一段裡（見 formatVoteResultLines）。
  const hasExecutionVotes = state.voteHistory && Object.keys(state.voteHistory).length > 0;
  const hasBadgeVotes = Object.keys(state.badge.history || {}).length > 0 ||
    Object.keys(state.badge.electionWinners || {}).length > 0 ||
    Object.values(state.dailySummaryVoteData || {}).some((voteData) => !!voteData?.sheriff_election);

  if (hasExecutionVotes || hasBadgeVotes) {
    context += `\n\n<votes>`;
    // 已經有結構化輪次資料的日子由 <vote_rounds> 負責（該區塊已併入白天記錄），
    // 這裡只補「沒有輪次資料」的歷史票型，避免同一份票型寫兩次。
    const voteRounds = state.voteRounds || [];

    const badgeVoteDays = new Set<number>();
    Object.keys(state.badge.history || {}).forEach((day) => badgeVoteDays.add(Number(day)));
    Object.keys(state.badge.electionWinners || {}).forEach((day) => badgeVoteDays.add(Number(day)));
    Object.entries(state.dailySummaryVoteData || {}).forEach(([day, voteData]) => {
      if (voteData?.sheriff_election) badgeVoteDays.add(Number(day));
    });

    Array.from(badgeVoteDays)
      .filter((day) => Number.isFinite(day))
      .sort((a, b) => a - b)
      .forEach((day) => {
        if (voteRounds.some((round) => round.day === day && round.kind === "badge")) return;
        const summaryBadgeVote = state.dailySummaryVoteData?.[day]?.sheriff_election;
        const badgeHistoryVotes = state.badge.history?.[day];
        const voteGroups = summaryBadgeVote?.votes
          ? buildVoteGroupsFromSeatTargets(state, summaryBadgeVote.votes)
          : badgeHistoryVotes
            ? buildVoteGroupsFromPlayerTargets(state, badgeHistoryVotes)
            : {};
        const voteLines = buildVoteGroupLines(state, voteGroups);
        const winner = resolveBadgeElectionWinner(state, day, voteGroups);
        if (voteLines.length === 0 && winner === undefined) return;
        context += `\nbadge_day_${day}:`;
        voteLines.forEach((line) => {
          context += `\n${line}`;
        });
        if (typeof winner === "number") {
          context += `\n  ${t("promptUtils.gameContext.result")}: ${formatSeatName(state, winner)} 当选警长`;
        }
      });

    Object.entries(state.voteHistory)
      .sort(([a], [b]) => Number(a) - Number(b))
      .forEach(([day, votes]) => {
        const dayNum = Number(day);
        if (voteRounds.some((round) => round.day === dayNum && round.kind === "execution")) return;
        const voteGroups = buildVoteGroupsFromPlayerTargets(state, votes);
        const sheriffSeatAtVote = resolveSheriffSeatAtVote(state, dayNum);
        const sheriffPlayerId = typeof sheriffSeatAtVote === "number"
          ? state.players.find((p) => p.seat === sheriffSeatAtVote)?.playerId
          : undefined;
        const voteLines = buildVoteGroupLines(
          state,
          voteGroups,
          sheriffPlayerId,
          sheriffSeatAtVote !== undefined
        );
        
        context += `\nday_${day}:`;
        voteLines.forEach((line) => {
          context += `\n${line}`;
        });

        const dayHistory = state.dayHistory?.[dayNum];
        if (dayHistory?.idiotRevealed) {
          context += `\n  ${t("promptUtils.gameContext.voteRoundResult", {
            text: `${formatSeatName(state, dayHistory.idiotRevealed.seat)} ${t("promptUtils.gameContext.voteRoundOutcomeIdiotRevealed")}`,
          })}`;
        } else if (dayHistory?.executed) {
          const executedSeat = dayHistory.executed.seat;
          const executedPlayer = state.players.find(p => p.seat === executedSeat);
          context += `\n  ${t("promptUtils.gameContext.result")}: {${t("promptUtils.gameContext.eliminated").trim()}: ${t("promptUtils.gameContext.seatLabel", { seat: executedSeat + 1 })}${executedPlayer?.displayName || ''}, ${t("promptUtils.gameContext.voteCount")}: ${dayHistory.executed.votes}}`;
        } else if (dayHistory?.voteTie) {
          context += `\n  ${t("promptUtils.gameContext.result")}: ${t("promptUtils.gameContext.tie")}`;
        }
      });
    context += `\n</votes>`;
  }

  // NOTE: Role-specific private information 一律放在 private 區，由呼叫端排在公共區之後
  // （見 buildGameContextParts）：公共前綴才能被同一輪的多個座位共用。

  // NOTE: We intentionally do NOT include <current_votes> during DAY_VOTE phase.
  // Showing real-time votes to later voters causes a "bandwagon effect" where
  // AI players follow earlier votes instead of making independent decisions
  // based on their own analysis and speeches.

  return {
    shared: context.trim(),
    private: privateParts.map((part) => part.trim()).filter(Boolean).join("\n\n"),
  };
};

/**
 * 完整的對局上下文：公共區在前、個人專屬區在後。
 * 個人資訊緊鄰後面的任務指令，模型不會漏看；
 * 而公共前綴能與同輪其他座位共用（前綴快取）。
 */
export const buildGameContext = (
  state: GameState,
  player: Player,
  options?: { excludePendingDeaths?: boolean }
): string => {
  const { shared, private: privateContext } = buildGameContextParts(state, player, options);
  return [shared, privateContext].filter(Boolean).join("\n\n");
};

/**
 * Build a system message with cache control for static content.
 * Splits the system prompt into cacheable (static rules) and non-cacheable (dynamic state) parts.
 * 
 * @param cacheableContent - Static content that can be cached (role rules, win conditions, etc.)
 * @param dynamicContent - Dynamic content that changes per request (game state, player-specific info)
 * @param useCache - Whether to enable caching (default: true)
 * @param ttl - Cache TTL: "5m" (default) or "1h"
 * @returns LLMMessage with cache_control breakpoints
 */
export function buildSystemTextFromParts(parts: SystemPromptPart[]): string {
  return parts
    .map((part) => part.text)
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function buildCachedSystemMessageFromParts(
  parts: SystemPromptPart[] | undefined,
  fallbackSystem: string,
  useCache: boolean = true
): LLMMessage {
  if (!parts || parts.length === 0 || !useCache) {
    return { role: "system", content: fallbackSystem };
  }

  let cacheCount = 0;
  const contentParts: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral"; ttl?: "1h" };
  }> = [];

  parts.forEach((part) => {
    const text = part.text.trim();
    if (!text) return;
    const cacheable = part.cacheable === true;
    const allowCache = cacheable && cacheCount < 4;
    const cache_control = allowCache
      ? {
          type: "ephemeral" as const,
          ...(part.ttl === "1h" ? { ttl: "1h" as const } : {}),
        }
      : undefined;

    if (allowCache) cacheCount += 1;

    contentParts.push({
      type: "text",
      text,
      ...(cache_control ? { cache_control } : {}),
    });
  });

  if (contentParts.length === 0) {
    return { role: "system", content: fallbackSystem };
  }

  return {
    role: "system",
    content: contentParts,
  };
}

/** 特殊技能决策与正常投票一样需要当天公开发言。 */
export function buildDecisionContext(state: GameState, player: Player): string {
  const transcript = buildTodayTranscript(state);
  return buildGameContext(state, player) + (transcript ? `\n\n<today_transcript>\n${transcript}\n</today_transcript>` : "");
}
