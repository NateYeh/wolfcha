import { areNightResultsVisible } from "./night-visibility";
import type { ChatMessage, GameState, Persona, Phase, Player, Role, WolfTeamPlan } from "@/types/game";
import { isWolfRole } from "@/types/game";
import type { SystemPromptPart } from "@/game/core/types";
import type { LLMMessage } from "./llm";
import { getSystemMessages, getSystemPatterns } from "./game-texts";
import { getI18n } from "@/i18n/translator";
import { getRoleName } from "./game-constants";
import { getRoleConfiguration } from "./role-configuration";
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
    default:
      return t("promptUtils.roleText.villager");
  }
};

/** 勝負條件＋兩個全域區塊（想贏的動機、允許不完美）。 */
const withPlayerMindset = (winConditionLine: string): string => {
  const { t } = getI18n();
  return `${winConditionLine}\n\n${t("promptUtils.winMotivationNote")}\n\n${t("promptUtils.humannessNote")}`;
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
 * {coreRules} 佔位符攜帶的整塊內容：遊戲基本盤＋勝負條件＋心態區塊。
 * 每個玩家階段的 base 模板都插這個佔位符，所以基本盤會跟著到每一隻玩家手上。
 */
export const getRolePromptCore = (role: string) => {
  const { t } = getI18n();
  const raw = ((): string => {
    switch (role) {
      case "Werewolf":
        return t("promptUtils.winCondition.werewolf");
      case "WhiteWolfKing":
        return t("promptUtils.winCondition.whiteWolfKing");
      case "Seer":
        return t("promptUtils.winCondition.seer");
      case "Witch":
        return t("promptUtils.winCondition.witch");
      case "Hunter":
        return t("promptUtils.winCondition.hunter");
      case "Guard":
        return t("promptUtils.winCondition.guard");
      case "Idiot":
        return t("promptUtils.winCondition.idiot");
      default:
        return t("promptUtils.winCondition.villager");
    }
    })();
  return `${getGameFundamentals()}\n\n${withPlayerMindset(raw)}`;
};

const PUBLIC_ROLE_ORDER: Role[] = [
  "Werewolf",
  "WhiteWolfKing",
  "Seer",
  "Witch",
  "Hunter",
  "Guard",
  "Idiot",
  "Villager",
];

/**
 * Build the role composition shown publicly before the game starts.
 * This deliberately reads the public player-count configuration instead of
 * state.players, so no seat-to-role or alive-role information can leak.
 */
export const buildPublicRoleConfiguration = (playerCount: number): string => {
  const { t } = getI18n();
  const counts = new Map<Role, number>();
  getRoleConfiguration(playerCount).forEach((role) => {
    counts.set(role, (counts.get(role) ?? 0) + 1);
  });

  const items = PUBLIC_ROLE_ORDER
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
${t("promptUtils.gameContext.publicRoleConfigurationScope")}
${t("promptUtils.gameContext.publicRoleConfigurationCheckRule")}
${t("promptUtils.gameContext.publicWinRule")}
${t("promptUtils.gameContext.publicIdentityRule")}
</public_role_configuration>`;
};

const buildPublicRoleReveals = (state: GameState): string => {
  const { t } = getI18n();
  const facts: string[] = [];

  Object.entries(state.nightHistory || {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([day, history]) => {
      if (!history.hunterShot) return;
      facts.push(t("promptUtils.gameContext.hunterRoleReveal", {
        day: Number(day),
        hunter: formatSeatName(state, history.hunterShot.hunterSeat),
        target: formatSeatName(state, history.hunterShot.targetSeat),
      }));
    });

  Object.entries(state.dayHistory || {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([day, history]) => {
      if (history.hunterShot) {
        facts.push(t("promptUtils.gameContext.hunterRoleReveal", {
          day: Number(day),
          hunter: formatSeatName(state, history.hunterShot.hunterSeat),
          target: formatSeatName(state, history.hunterShot.targetSeat),
        }));
      }
      if (history.whiteWolfKingBoom) {
        facts.push(t("promptUtils.gameContext.whiteWolfKingRoleReveal", {
          day: Number(day),
          player: formatSeatName(state, history.whiteWolfKingBoom.boomSeat),
          target: formatSeatName(state, history.whiteWolfKingBoom.targetSeat),
        }));
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

  const facts: string[] = [];

  // --- 1. 当天其他玩家公开点名当前玩家 ---
  const dayStartIndex = getDayStartIndex(state);
  const mentionedBy: number[] = [];
  const seatStr = `${player.seat + 1}号`;
  for (let i = dayStartIndex; i < state.messages.length; i++) {
    const m = state.messages[i];
    if (m.isSystem || m.playerId === player.playerId) continue;
    if (m.content.includes(seatStr)) {
      // 这是对"今天谁点名了我"的历史回读：发言已经发生，与说话人此刻是否存活无关。
      // 若按当前 alive 过滤，会吞掉"当天先发言点名、随后被票出/枪杀"玩家的点名。
      const speaker = state.players.find(p => p.playerId === m.playerId);
      if (speaker) mentionedBy.push(speaker.seat);
    }
  }
  if (mentionedBy.length > 0) {
    const who = [...new Set(mentionedBy)].map(s => `${s + 1}号`).join("、");
    facts.push(`今天已有公开发言中，${who}点名提到过你`);
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
    if (todayDayHistory?.whiteWolfKingBoom) {
      deadTodaySeats.add(todayDayHistory.whiteWolfKingBoom.boomSeat);
      deadTodaySeats.add(todayDayHistory.whiteWolfKingBoom.targetSeat);
    }
  }
  const deadToday = state.players.filter((p) => deadTodaySeats.has(p.seat));
  const totalSeats = state.players.length;
  const adjacentDeadSeats = deadToday.filter(d => {
    const diff = Math.abs(d.seat - player.seat);
    return diff === 1 || diff === totalSeats - 1;
  }).map((deadPlayer) => deadPlayer.seat);
  if (adjacentDeadSeats.length > 0) {
    facts.push(`本日已公布出局的${adjacentDeadSeats.map((seat) => `${seat + 1}号`).join("、")}与你座位相邻`);
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
          const names = sameVoters.slice(0, 2).map(p => `${p.seat + 1}号`).join("、");
          facts.push(`昨天你与${names}都投给了${myVote + 1}号`);
        }
      }
    }
  }

  if (facts.length === 0) return "";

  return `<public_facts_for_player>\n【与你有关的公开事实】\n${facts.map((fact) => `- ${fact}`).join("\n")}\n</public_facts_for_player>`;
}

const buildHiddenCommunicationProfileSection = (persona: Persona, locale: string): string => {
  if (locale !== "en") {
    const lines: string[] = [];
    if (persona.werewolfExperience) lines.push(`狼人杀理解：${persona.werewolfExperience}`);
    if (persona.vocabularyStyle) lines.push(`词汇习惯：${persona.vocabularyStyle}`);
    if (persona.reasoningStyle) lines.push(`推理方式：${persona.reasoningStyle}`);
    if (persona.speechLengthHabit) lines.push(`发言长短：${persona.speechLengthHabit}`);
    if (persona.pressureStyle) lines.push(`压力反应：${persona.pressureStyle}`);
    if (persona.uncertaintyStyle) lines.push(`不确定性：${persona.uncertaintyStyle}`);
    if (persona.mistakePattern) lines.push(`常见误判：${persona.mistakePattern}`);
    if (persona.wolfDeceptionStyle) lines.push(`拿狼伪装：${persona.wolfDeceptionStyle}`);
    if (lines.length === 0) return "";
    return `\n<hidden_communication_profile>\n这些信息只用于塑造你的狼人杀水平、词汇和发言长度，不要向其他玩家明说。其中的缺陷和不确定倾向偶尔体现即可，不要每次发言都表现出来。\n${lines.map((line) => `- ${line}`).join("\n")}\n</hidden_communication_profile>`;
  }

  const lines: string[] = [];
  if (persona.werewolfExperience) lines.push(`Werewolf understanding: ${persona.werewolfExperience}`);
  if (persona.vocabularyStyle) lines.push(`Vocabulary habit: ${persona.vocabularyStyle}`);
  if (persona.reasoningStyle) lines.push(`Reasoning style: ${persona.reasoningStyle}`);
  if (persona.speechLengthHabit) lines.push(`Speech length habit: ${persona.speechLengthHabit}`);
  if (persona.pressureStyle) lines.push(`Pressure response: ${persona.pressureStyle}`);
  if (persona.uncertaintyStyle) lines.push(`Uncertainty style: ${persona.uncertaintyStyle}`);
  if (persona.mistakePattern) lines.push(`Common wrong reads: ${persona.mistakePattern}`);
  if (persona.wolfDeceptionStyle) lines.push(`Wolf disguise habit: ${persona.wolfDeceptionStyle}`);
  if (lines.length === 0) return "";
  return `\n<hidden_communication_profile>\nUse this only to shape your Werewolf skill, vocabulary, and speech length. Do not state it to other players. Let the flaws and uncertainty show only occasionally, not in every speech.\n${lines.map((line) => `- ${line}`).join("\n")}\n</hidden_communication_profile>`;
};

/** 决策前的短事实账本：只取主持人已公布的结果和本人行动，绝不把玩家声明升级为事实。 */
export function buildDecisionGrounding(state: GameState, player: Player): string {
  const lines: string[] = [];
  for (let day = 1; day <= state.day; day++) {
    const night = state.nightHistory?.[day];
    if (!areNightResultsVisible(state, day)) {
      lines.push(`第${day}夜：结果尚未公布。`);
    } else if (!night || !Array.isArray(night.deaths)) {
      lines.push(`第${day}夜：记录缺失，不能判为平安夜。`);
    } else {
      const deaths = getRecordedNightDeaths(night);
      lines.push(`第${day}夜：${deaths.length ? `${deaths.map((d) => `${d.seat + 1}号`).join("、")}出局，不是平安夜` : "无人出局（平安夜）"}。`);
    }
  }
  for (const round of state.voteRounds ?? []) {
    const target = round.votes[player.playerId];
    const kind = round.kind === "badge" ? "警徽选举" : "放逐";
    const vote = typeof target === "number" ? target < 0 ? "弃票" : `投给${target + 1}号`
      : round.candidates.includes(player.seat) && (round.kind === "badge" || round.round > 1)
        ? "作为候选人没有投票资格" : "没有本人投票记录";
    lines.push(`本人第${round.day}天${kind}第${round.round}轮：${vote}。`);
  }
  if ((state.phase === "DAY_BADGE_SPEECH" || (state.phase === "DAY_PK_SPEECH" && state.pkSource === "badge")) &&
      state.badge.candidates.includes(player.seat)) lines.push("本轮你是警徽候选人，没有选举投票权，不存在投自己或投他人的选举票。");
  return `<decision_grounding>
${lines.join("\n")}
复述票型要区分警徽和放逐、投票人和被投人；累计几次平安夜不等于连续几夜。玩家原话是声明，身份只有主持人翻牌才算公开确认；被投出不等于已验明狼人。
引用发言要核对发言人、日期和完整上下句。对方说错的话（口误）可能是狼露的马脚，也可能只是紧张、打错字——这两种在桌上都会发生，值不值得记他一笔，你自己判断。没有查验记录的座位不能凭空补成金水——「某人说了一句可信」不构成依据；但主持人已公布的事件（谁出局、警徽移交给谁、公开技能翻牌）属于事实，可以作为推论的起点：唯一跳预言家者被夜刀后把警徽交给的人，应按「死者最后的信任／倾向金水」理解，不是「说法矛盾」。你的真实身份与私有查验用于自己判断，不得误把自己列入待查身份；策略性隐瞒或悍跳可以保留。
</decision_grounding>`;
}

const buildHiddenPlayerMindSection = (player: Player, locale: string): string => {
  const mind = player.agentProfile?.playerMind;
  if (!mind) return "";

  if (locale !== "en") {
    const lines: string[] = [
      `胆量：${mind.courage}`,
      `记忆偏好：${mind.memoryBias}`,
      `怀疑阈值：${mind.suspicionThreshold}`,
      `自保倾向：${mind.selfProtection}`,
      `逻辑水平：${mind.logicDepth}`,
      `桌面存在感：${mind.tablePresence}`,
    ];
    return `\n<hidden_player_mind>\n这些信息是你稳定的玩家心智，只用于塑造你如何判断、站边、承压和发言，不要向其他玩家明说。\n${lines.map((line) => `- ${line}`).join("\n")}\n</hidden_player_mind>`;
  }

  const lines: string[] = [
    `Courage: ${mind.courage}`,
    `Memory bias: ${mind.memoryBias}`,
    `Suspicion threshold: ${mind.suspicionThreshold}`,
    `Self-protection: ${mind.selfProtection}`,
    `Logic depth: ${mind.logicDepth}`,
    `Table presence: ${mind.tablePresence}`,
  ];
  return `\n<hidden_player_mind>\nUse this as your stable player mind. It shapes how you judge, take sides, handle pressure, and speak. Do not state it to other players.\n${lines.map((line) => `- ${line}`).join("\n")}\n</hidden_player_mind>`;
};

export const buildPersonaSection = (player: Player, isGenshinMode: boolean = false): string => {
  if (isGenshinMode || !player.agentProfile) return "";
  const { t, locale } = getI18n();
  const { persona } = player.agentProfile;
  const separator = t("promptUtils.gameContext.listSeparator");

  const base = t("promptUtils.persona.section", {
    voiceRules: persona.voiceRules.join(separator),
    riskLabel: t("promptUtils.persona.riskBalanced")
  });
  const extraInfo = persona.basicInfo?.trim()
    ? `\n${t("promptUtils.persona.basicInfo", { basicInfo: persona.basicInfo.trim() })}`
    : "";
  const hiddenCommunicationProfile = buildHiddenCommunicationProfileSection(persona, locale);
  const hiddenPlayerMind = buildHiddenPlayerMindSection(player, locale);
  return `${base}${extraInfo}${hiddenCommunicationProfile}${hiddenPlayerMind}`;
};

/**
 * 熟人局素材：对其他玩家拼入「平时积累的印象」（persona 行为栏位）与「交手记录」（历史胜率/MVP）。
 * 这些内容互相之间平时不可见，但熟人局设定下视为彼此认识多年所知；印象仅供参考，不是事实。
 */
const buildAcquaintanceNotes = (state: GameState, player: Player): string => {
  if (!state.isAcquaintanceGame) return "";
  const { t } = getI18n();
  const lines: string[] = [];
  for (const other of state.players) {
    if (other.playerId === player.playerId) continue;
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
  const player = state.players.find((p) => p.seat === seat);
  return `${seat + 1}号${player?.displayName || ""}`;
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

const shouldIncludeHistoricalSystemLine = (content: string): boolean => {
  const systemMessages = getSystemMessages();
  const systemPatterns = getSystemPatterns();
  const excluded = new Set([
    "天亮了",
    "Dawn breaks, please open your eyes",
    "进入投票环节",
    "发言结束，开始投票。",
    "Discussion ends, voting begins.",
    systemMessages.dayBreak,
    systemMessages.voteStart,
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

  const sections = dayGroups.map(({ day, transcript }) => {
    const dayLabel = t("promptUtils.gameContext.dayLabel", { day });
    return transcript ? `${dayLabel}\n${transcript}` : dayLabel;
  });

  if (sections.length === 0) return "";
  return `<history>\n${sections.join("\n\n")}\n</history>`;
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

  messages.forEach((m) => {
    if (m.isSystem) {
      if (shouldIncludeHistoricalSystemLine(m.content.trim())) lines.push(`系统: ${m.content.trim()}`);
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

/** 发言类消息 phase 集合：用于识别「自称预言家」的公开发言。 */
const SEER_CLAIM_PHASES = new Set(["DAY_BADGE_SPEECH", "DAY_SPEECH", "DAY_LAST_WORDS", "DAY_PK_SPEECH"]);
/**
 * 自称预言家的典型表述（含简繁）。
 * 只用第一人称措辞；「别人的金水/支持谁」这类第三人称一律交给反例挡掉。
 */
const SEER_CLAIM_PATTERNS = [
  /我是(那个|那個)?(预言|預言)家/,
  /我(才|就)是(预言|預言)家/,
  /我[^。！？\n]{0,6}是(预言|預言)家/,
  /我(来|來)?(跳|悍跳)(预言|預言)家/,
  /我(摊牌|攤牌|明说|明說|直说|直說)[^。！？\n]{0,12}(预言|預言)家/,
  /我是\d{1,2}\s*号[^。！？\n]{0,12}(预言|預言)家/,
  /我[^。！？\n]{0,6}(昨晚|昨天|首夜|第一夜|第[一二三四五]夜)?[^。！？\n]{0,4}(验|驗|查)(了|的|过|過)[^。！？\n]{0,8}\d{1,2}\s*号/,
  /(^|[。！？\n，,])(第[一二三四五]夜|首夜|昨晚|昨夜)(我)?(验|驗|查)(了|的)?[^。！？\n]{0,8}\d{1,2}\s*号/,
];
/** 反例表述：这些「预言家」字样不是自称，不作数。 */
const SEER_CLAIM_NEGATIVE_PATTERNS = [
  /(不是|不是真的|并非|並非|没跳|沒跳|没跳过|沒跳過|不可能|不会是|不會是)[^。！？\n]{0,4}(预言|預言)家/,
  /(自称|自稱|声称|聲稱|说自己是|說自己是|如果|假如|要是|万一|萬一)[^。！？\n]{0,6}(预言|預言)家/,
  /(信|站|跟|认|認|相信|支持|质疑|質疑|怀疑|懷疑)[^。！？\n]{0,8}(预言|預言)家/,
  /(没人|沒人|无人|無人|没有人|沒有人|还没人|還沒人|还没|還沒|没有|沒有)[^。！？\n]{0,5}(跳|对跳|對跳)?[^。！？\n]{0,4}(预言|預言)家/,
  /(报|報|给|給|发|發|拿|被)[^。！？\n]{0,3}我的(查验|查驗|查殺|查杀)/,
];

/** 句子里的座位号（用来判断这句話说的是自己还是别人）。 */
const SEAT_MENTION_PATTERN = /(\d{1,2})\s*号/g;

/** 命中片段是否只在说「自己这个座位」——含别人的座位号就不算自称。 */
const isSelfClaimWindow = (window: string, ownSeat: number): boolean => {
  const seats = [...window.matchAll(SEAT_MENTION_PATTERN)].map((match) => Number(match[1]));
  return seats.every((seat) => seat === ownSeat);
};

/**
 * 从公开发言中识别「自称预言家」的玩家（存活者）。
 * 只用公开信息，不借用引擎的真实身份，避免泄漏真预言家身份。
 */
export const findSeerClaimants = (state: GameState): Player[] => {
  const claimantSeats = new Set<number>();
  for (const m of state.messages) {
    if (m.isSystem) continue;
    if (!m.phase || !SEER_CLAIM_PHASES.has(m.phase)) continue;
    const speaker = state.players.find((p) => p.playerId === m.playerId);
    if (!speaker?.alive) continue;
    const content = m.content;
    if (SEER_CLAIM_NEGATIVE_PATTERNS.some((p) => p.test(content))) continue;

    const ownSeat = speaker.seat + 1;
    const windows = SEER_CLAIM_PATTERNS.flatMap((pattern) =>
      [...content.matchAll(pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`))]
        .map((match) => match[0])
    );
    // 自己报座位号的跳法（例如「那我摊牌了，7号令狐冲，预言家」）。
    const ownSeatPattern = new RegExp(`${ownSeat}\\s*号[^。！？\\n]{0,12}(预言|預言)家`);
    const ownSeatMatch = content.match(ownSeatPattern);
    if (ownSeatMatch) windows.push(ownSeatMatch[0]);

    if (windows.some((window) => isSelfClaimWindow(window, ownSeat))) claimantSeats.add(speaker.seat);
  }
  return [...claimantSeats]
    .sort((a, b) => a - b)
    .map((seat) => state.players.find((p) => p.seat === seat))
    .filter((p): p is Player => Boolean(p));
};

/** 白天規則裡的「場上現況」：目前誰自稱預言家、有無對跳（純事實陳述）。 */
export const buildSeerClaimStateLine = (state: GameState): string => {
  const { t } = getI18n();
  const claimants = findSeerClaimants(state);
  if (claimants.length === 1) {
    const [only] = claimants;
    return t("promptUtils.gameContext.seerClaimStateLone", { seat: only.seat + 1, name: only.displayName });
  }
  if (claimants.length > 1) {
    return t("promptUtils.gameContext.seerClaimStateMultiple", {
      count: claimants.length,
      list: claimants.map((p) => `${p.seat + 1}号 ${p.displayName}`).join("、"),
    });
  }
  return "";
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
          const resultEmoji = record.isWolf ? "🐺 狼人" : "✓ 好人";
          return `  第${record.day}夜 → ${record.targetSeat + 1}号${target?.displayName || ""} = ${resultEmoji}`;
        })
      : [t("promptUtils.gameContext.seerHistoryEmpty")];
    
    let seerInfo = `<your_seer_checks>
【你的查验记录】
${checks.join("\n")}`;
    // 白天（含警徽競選 DAY_BADGE_*）才需要公布決策指引：跳/不跳/何時跳；夜間查验行動有自己的提示。
    if (state.phase.includes("DAY")) {
      seerInfo += `\n${t("promptUtils.gameContext.seerClaimGuidance")}`;
      // 警上三件事：報查驗、打警徽流、聊心路歷程（含沒拿到警徽/被對跳後怎麼打）。
      seerInfo += `\n${t("promptUtils.gameContext.seerCampaignNote")}`;
    } else {
      // 夜間：首驗選人本身就是策略（別用名字氣場當依據）。
      seerInfo += `\n${t("promptUtils.gameContext.seerCheckChoiceNote")}`;
    }
    seerInfo += `\n</your_seer_checks>`;
    return seerInfo;
  }
  
  if (player.role === "Witch") {
    const healStatus = state.roleAbilities.witchHealUsed ? "已用" : "可用";
    const poisonStatus = state.roleAbilities.witchPoisonUsed ? "已用" : "可用";
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
            wolfTargetInfo.push(`  第${day}夜：狼目标为 ${history.wolfTarget + 1}号${targetPlayer.displayName}`);
          }
        }

        if (history.witchSave && history.wolfTarget !== undefined) {
          const savedPlayer = state.players.find(p => p.seat === history.wolfTarget);
          if (savedPlayer) {
            // 守+救叠加(milk)等情形下被救者当晚仍会出局，需据当晚结算标注救援是否生效，避免女巫误以为救活了人。
            // 救援"结果"在天亮公布前不展示，与狼/守卫一致显示"结果待天亮公布"（当晚 outcome 门控）。
            const saveNote = !outcomeKnownForDay(Number(day))
              ? "（结果待天亮公布）"
              : getRecordedNightDeaths(history).some((d) => d.seat === history.wolfTarget)
                ? "（救援未生效，仍出局）"
                : "";
            witchActions.push(`  第${day}夜：救了 ${history.wolfTarget + 1}号${savedPlayer.displayName}${saveNote}`);
          }
        }
        if (history.witchPoison !== undefined) {
          const poisonedPlayer = state.players.find(p => p.seat === history.witchPoison);
          if (poisonedPlayer) {
            witchActions.push(`  第${day}夜：毒了 ${history.witchPoison + 1}号${poisonedPlayer.displayName}`);
          }
        }
      });
    }
    let witchInfo = `<your_potions>
【你的药水状态】解药: ${healStatus} | 毒药: ${poisonStatus}`;
    if (wolfTargetInfo.length > 0) {
      witchInfo += `\n【刀口信息】\n${wolfTargetInfo.join('\n')}`;
    }
    if (witchActions.length > 0) {
      witchInfo += `\n【用药记录】\n${witchActions.join("\n")}`;
    }
    // 用藥記錄的讀法：救過的人＝狼當晚目標（偏好人），日夜都用得到，兩邊都拼。
    witchInfo += `\n${t("promptUtils.gameContext.witchPotionReadingNote")}`;
    // 解藥的時機：首夜救人的價值 vs 留著自救；日夜都拼（白天要盤算、被質疑時也要用得上）。
    witchInfo += `\n${t("promptUtils.gameContext.witchHealTimingNote")}`;
    // 毒藥的時機：修正「等確認的狼人才用」導致毒藥留到死的傾向，日夜都拼（白天也要盤算）。
    witchInfo += `\n${t("promptUtils.gameContext.witchPoisonTimingNote")}`;
    // 白天才需要報帳與保命指引（何時公開、報什麼、票壓上來怎麼處理）；
    // 夜間用藥決策有自己的提示。
    if (state.phase.includes("DAY")) {
      witchInfo += `\n${t("promptUtils.gameContext.witchAccountGuidance")}`;
      // 藥在人活：被票出去＝兩瓶藥一起廢，白天發言要先保住自己這張牌。
      witchInfo += `\n${t("promptUtils.gameContext.witchSelfPreservationNote")}`;
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
        const result = !outcomeKnownForDay(Number(day)) ? "守护结果待天亮公布"
          : !Array.isArray(history.deaths) ? "当夜结算记录缺失，不能判断目标生死或是否平安夜"
          : `${deaths.some((death) => death.seat === seat) ? "守护目标当夜出局" : "守护目标当夜未出局"}；全场第${day}夜：${deaths.length
            ? `${deaths.map((death) => `${death.seat + 1}号`).join("、")}出局，并非平安夜`
            : "无人出局（平安夜）"}`;
        return `  第${day}夜 → ${seat + 1}号${target?.displayName || ""}：${result}`;
      });
    const lastSeat = state.nightActions.lastGuardTarget;
    const lastTarget = state.players.find((p) => p.seat === lastSeat);
    let guardInfo = `<your_guard_info>
【守护记录】${records.length ? `\n${records.join("\n")}` : "暂无已记录的守护行动"}
【记录含义】守护目标未出局不代表全场平安夜，也不能证明守护生效或目标被狼人袭击。以每夜全场公开结果为准，不得为维护先前发言而改写死亡日期。
${lastSeat !== undefined ? `【上次守护】${lastSeat + 1}号${lastTarget?.displayName || ""}\n【今晚限制】不能连续守护 ${lastSeat + 1}号` : "【今晚限制】无，可以守护任何存活玩家"}`;
    // 白天要的是報帳指引（報什麼、怎麼報）；夜間是選人決策——狼隊會反制
    // （繞開明牌預言家、利用連守限制、收網階段刀守衛），這些是選人時要擺進去的帳。
    if (state.phase.includes("DAY")) {
      guardInfo += `\n${t("promptUtils.gameContext.guardAccountGuidance")}`;
    } else {
      guardInfo += `\n${t("promptUtils.gameContext.guardProtectChoiceNote")}`;
    }
    guardInfo += `\n</your_guard_info>`;
    return guardInfo;
  }
  
  if (player.role === "Villager") {
    // 村民沒有夜間行動，只有白天發言與投票——知識集中拼在白天；
    // 票的理由已由投票 JSON 的 reason 記錄，這裡教的是「敢表態＋表水」。
    if (state.phase.includes("DAY")) {
      return `<your_villager_notes>\n${t("promptUtils.gameContext.villagerPlayNote")}\n</your_villager_notes>`;
    }
    return null;
  }

  if (player.role === "Idiot") {
    // 白痴没有夜间行动，知识集中在白天；免死翻牌由游戏自动触发，这里教的是定位、表水与报明时机的取舍。
    if (state.phase.includes("DAY")) {
      return `<your_idiot_notes>\n${t("promptUtils.gameContext.idiotPlayNote")}\n</your_idiot_notes>`;
    }
    return null;
  }

  if (player.role === "Hunter") {
    // 獵人沒有可報的帳（無查驗、無用藥記錄），白天要的是打法與帶隊時機；
    // 出局當下的一槍走 prompts.hunter.shootingRules，不在這裡重複。
    if (state.phase.includes("DAY")) {
      return `<your_gun>\n${t("promptUtils.gameContext.hunterPlayNote")}\n</your_gun>`;
    }
    return null;
  }

  if (isWolfRole(player.role)) {
    const allWolves = state.players.filter((p) => isWolfRole(p.role));
    const aliveWolves = allWolves.filter((p) => p.alive);
    const formatWolfList = (wolves: Player[]) => wolves.length > 0
      ? wolves.map((wolf) => `${wolf.seat + 1}号${wolf.displayName}`).join("、")
      : "无";

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
            ? "结果待天亮公布"
            : getRecordedNightDeaths(history).some((d) => d.seat === history.wolfTarget)
              ? "目标当晚出局"
              : "目标当晚存活（被守护或被解药救下）";
          killRecords.push(`  第${day}夜：刀 ${history.wolfTarget + 1}号${target.displayName} → ${outcome}`);
        });
    }

    let wolfInfo = `<your_wolf_team>
【存活狼队】${formatWolfList(aliveWolves)}
【已出局狼队】${formatWolfList(allWolves.filter((wolf) => !wolf.alive))}
【狼人存活】${aliveWolves.length}/${allWolves.length}`;
    if (killRecords.length > 0) {
      wolfInfo += `\n【狼队出刀记录】\n${killRecords.join("\n")}`;
    }
    // 第一夜商定的分工：夜裡的事實，注入所有狼視角（報名、發言、投票都看得到）。
    if (state.wolfTeamPlan) {
      wolfInfo += `\n${buildWolfTeamPlanSection(state, state.wolfTeamPlan, player)}`;
    }
    // 獵人的槍口風險：夜間刀口、白狼王自爆、白天要不要碰自稱獵人的人都要算這筆帳，
    // 日夜都拼入（處理獵人的三種方式代價不同）。
    wolfInfo += `\n${t("promptUtils.gameContext.hunterGunThreatNote")}`;
    // 白天才有保人与切割的取舍：队友劣势时无脑硬保会把狼队绑成一条线一起暴露。
    // 夜间出刀与本原则无关，因此只在白天阶段拼入。
    if (state.phase.includes("DAY")) {
      // 守衛刀口帳：夜間出刀已有 prompts.night.wolf.guardMindGame，這裡補白天
      // （評估今晚刀誰、自稱守衛的人怎麼處理、算刀數時怎麼算被守住的機率）。
      wolfInfo += `\n${t("promptUtils.gameContext.wolfGuardAwarenessNote")}`;
      wolfInfo += `\n${t("promptUtils.gameContext.wolfTeamPrinciples")}`;
      // 落後局（人数落后、悍跳队友被翻牌）跟領先局的打法不同：硬撑只会整队暴露。
      wolfInfo += `\n${t("promptUtils.gameContext.wolfLosingPositionNote")}`;
      // 衝鋒／倒勾分工與白天讀神民：都是發言與站邊層面的知識，夜間無關。
      wolfInfo += `\n${t("promptUtils.gameContext.wolfChargeHookNote")}`;
      wolfInfo += `\n${t("promptUtils.gameContext.wolfGodVillagerReadingNote")}`;
      // 悍跳守則：白天想跳預言家的狼需要一套不容易被證偽的假查验打法；夜間無關。
      wolfInfo += `\n${t("promptUtils.gameContext.wolfFakeSeerGuidance")}`;
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

export const buildGameContext = (
  state: GameState,
  player: Player,
  options?: { excludePendingDeaths?: boolean }
): string => {
  options = { ...options, excludePendingDeaths: options?.excludePendingDeaths || !areNightResultsVisible(state) };
  const { t } = getI18n();
  const alivePlayers = state.players.filter((p) => p.alive);
  const deadPlayers = state.players.filter((p) => !p.alive);
  const totalSeats = state.players.length;
  const publicGenericDeathCause = t("promptUtils.gameContext.deathCauseDeath");
  const publicExecutionCause = t("promptUtils.gameContext.deathCauseVote");
  const publicHunterShotCause = t("promptUtils.gameContext.deathCauseHunterShot");
  const publicWhiteWolfKingCause = t("promptUtils.gameContext.deathCauseWhiteWolfKing");

  // === 第一优先级：角色私有信息（放在最前面） ===
  const privateInfo = buildRolePrivateInfo(state, player, options);
  let context = privateInfo ? `${privateInfo}\n\n` : "";

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
      if (history.hunterShot?.targetSeat === p.seat) { cause = publicHunterShotCause; deathDay = Number(day); }
    }
    for (const [day, history] of Object.entries(state.dayHistory || {})) {
      if (history.executed?.seat === p.seat) { cause = publicExecutionCause; deathDay = Number(day); }
      if (history.hunterShot?.targetSeat === p.seat) { cause = publicHunterShotCause; deathDay = Number(day); }
      if (history.whiteWolfKingBoom?.boomSeat === p.seat || history.whiteWolfKingBoom?.targetSeat === p.seat) {
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

  context += `<current_status>\n${timeReminder}\n</current_status>

<game_state>
day: ${state.day}
phase: ${phaseText}
phase_code: ${state.phase}
game_status: ${state.winner ? `ended_${state.winner}` : "ongoing"}
you: {seat: ${player.seat + 1}, name: ${player.displayName}}
total_seats: ${totalSeats}
alive: [${aliveSeats.join(", ")}]
dead: [${deadInfo.join(", ")}]
sheriff: ${sheriffInfo}
alive_count: ${alivePlayers.length}
</game_state>`;

  // Public setup information only: aggregate role counts and public rules.
  // Never derive this section from seat assignments in state.players.
  context += `\n\n${buildPublicRoleConfiguration(totalSeats)}`;

  const publicRoleReveals = buildPublicRoleReveals(state);
  if (publicRoleReveals) {
    context += `\n\n${publicRoleReveals}`;
  }

  if (options?.excludePendingDeaths) {
    context += `\n\n<unannounced_night_result>\n${t("promptUtils.gameContext.unannouncedNightResult")}\n</unannounced_night_result>`;
  }

  // Add alive players list for reference
  const playerList = alivePlayers
    .map((p) => `  - ${t("promptUtils.gameContext.seatLabel", { seat: p.seat + 1 })} ${p.displayName}${p.isHuman ? t("promptUtils.gameContext.humanSuffix") : ""}${p.playerId === player.playerId ? t("promptUtils.gameContext.youSuffix") : ""}`)
    .join("\n");
  context += `\n\n<alive_players>\n${playerList}\n</alive_players>`;

  // 熟人局：其他玩家的行为印象与交手记录（日夜都拼——读人不是白天专利）。
  context += buildAcquaintanceNotes(state, player);

  const wolfFriendlyFireNote = t("promptUtils.gameContext.wolfFriendlyFireNote");
  const phaseOrderNote =
    state.day === 1
      ? t("promptUtils.gameContext.phaseOrderNoteDay1BadgeBeforeDeath")
      : t("promptUtils.gameContext.phaseOrderNote");
  const noSameDayCausalityNote =
    state.phase.includes("DAY")
      ? t("promptUtils.gameContext.noSameDayCausalityNote")
      : "";
  const isDayPhase = state.phase.includes("DAY");
  // 票型不能当铁证：狼人也可以投队友做局，因此白天凡是涉及投票的环节都要提示。
  // 夜间没有投票，不拼入以免干扰出刀判断。
  // 讀票型／讀刀口／預言家線／線索獨立／警徽／金水：白天推理用的知識區塊，夜間不拼入。
  const voteReadingNote = isDayPhase ? t("promptUtils.gameContext.voteReadingNote") : "";
  const nightKillReadingNote = isDayPhase ? t("promptUtils.gameContext.nightKillReadingNote") : "";
  const seerLineReadingNote = isDayPhase ? t("promptUtils.gameContext.seerLineReadingNote") : "";
  const evidenceIndependenceNote = isDayPhase ? t("promptUtils.gameContext.evidenceIndependenceNote") : "";
  const badgeNote = isDayPhase ? t("promptUtils.gameContext.badgeNote") : "";
  const goldWaterNote = isDayPhase ? t("promptUtils.gameContext.goldWaterNote") : "";
  // 有人跳獵人怎麼讀：獵人報身份沒有可核對的帳目（不像查驗、用藥），白天推理用；夜間不拼入。
  const hunterClaimReadingNote = isDayPhase ? t("promptUtils.gameContext.hunterClaimReadingNote") : "";
  // 守衛規則與自報怎麼讀：連守限制是全場規則（不只守衛自己知道），否則好人會拿「前晚守過、昨晚卻死」
  // 當矛盾去砸真守衛；只在白天拼入。
  const guardClaimReadingNote = isDayPhase ? t("promptUtils.gameContext.guardClaimReadingNote") : "";
  // 場上現況（誰自稱預言家、有無對跳）：只陳述公開事實，不下指令。
  const seerClaimStateNote = isDayPhase ? buildSeerClaimStateLine(state) : "";
  // 警長職責：只有拿徽者收到，避免狼警長免費收割「跟警徽走」的權威；僅白天拼入。
  const sheriffDutyNote = isDayPhase && state.badge?.holderSeat === player.seat
    ? t("promptUtils.gameContext.sheriffDutyNote")
    : "";
  
  // Check if guard exists in this game
  const hasGuard = state.players.some(p => p.role === "Guard");
  
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
  if (voteReadingNote) {
    rulesText += `\n${voteReadingNote}`;
  }
  if (nightKillReadingNote) {
    rulesText += `\n${nightKillReadingNote}`;
  }
  // 場上現況緊貼預言家線：先看事實，再看讀法。
  if (seerClaimStateNote) {
    rulesText += `\n${seerClaimStateNote}`;
  }
  if (seerLineReadingNote) {
    rulesText += `\n${seerLineReadingNote}`;
  }
  if (evidenceIndependenceNote) {
    rulesText += `\n${evidenceIndependenceNote}`;
  }
  if (badgeNote) {
    rulesText += `\n${badgeNote}`;
  }
  if (goldWaterNote) {
    rulesText += `\n${goldWaterNote}`;
  }
  if (hunterClaimReadingNote) {
    rulesText += `\n${hunterClaimReadingNote}`;
  }
  if (guardClaimReadingNote) {
    rulesText += `\n${guardClaimReadingNote}`;
  }
  // 警長職責放最後：對拿徽者是最直接的行動指令（歸票）。
  if (sheriffDutyNote) {
    rulesText += `\n${sheriffDutyNote}`;
  }
  
  if (rulesText) {
    context += `\n\n<rules>\n${rulesText}\n</rules>`;
  }

  const pastDaysSection = buildPastDaysTranscript(state);
  if (pastDaysSection) {
    context += `\n\n${pastDaysSection}`;
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
          currentDayDeaths.push(`{seat: ${p.seat + 1}, name: ${p.displayName}, cause: ${publicHunterShotCause}}`);
        }
      }
      if (nightHistory?.hunterShot && typeof nightHistory.hunterShot.targetSeat === "number") {
        const p = state.players.find(p => p.seat === nightHistory.hunterShot?.targetSeat);
        if (p && !p.alive) {
          currentDayDeaths.push(`{seat: ${p.seat + 1}, name: ${p.displayName}, cause: ${publicHunterShotCause}}`);
        }
      }
      if (dayHistory?.whiteWolfKingBoom) {
        [dayHistory.whiteWolfKingBoom.boomSeat, dayHistory.whiteWolfKingBoom.targetSeat].forEach((seat) => {
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

    // Dead players note - softer guideline, allow referencing death causes but focus on alive players
    context += `\n\n<focus_reminder>${t("promptUtils.gameContext.focusReminder")}</focus_reminder>`;
  }

  const voteRounds = state.voteRounds || [];
  if (voteRounds.length) {
    const outcomes = { elected: "当选警长", executed: "被放逐出局", "idiot-revealed": "白痴翻牌免死（失去投票权）", tie: "平票", "no-votes": "无有效票" };
    const rounds = [...voteRounds].sort((a, b) => a.day - b.day || (a.kind === b.kind ? a.round - b.round : a.kind === "badge" ? -1 : 1));
    context += `\n\n<vote_rounds>`;
    for (const round of rounds) {
      const sheriffId = round.sheriffSeat === null ? undefined : state.players.find((p) => p.seat === round.sheriffSeat)?.playerId;
      const lines = buildVoteGroupLines(state, buildVoteGroupsFromPlayerTargets(state, round.votes), sheriffId, true);
      context += `\n第${round.day}天 ${round.kind === "badge" ? "警徽选举" : "放逐投票"} 第${round.round}轮：`;
      context += `\n  候选: ${round.candidates.map((seat) => formatSeatName(state, seat)).join("、")}`;
      context += `\n${lines.join("\n")}`;
      context += `\n  结果: ${round.winnerSeat === null ? "" : formatSeatName(state, round.winnerSeat) + " "}${outcomes[round.outcome]}`;
    }
    context += `\n</vote_rounds>`;
  }

  const hasExecutionVotes = state.voteHistory && Object.keys(state.voteHistory).length > 0;
  const hasBadgeVotes = Object.keys(state.badge.history || {}).length > 0 ||
    Object.keys(state.badge.electionWinners || {}).length > 0 ||
    Object.values(state.dailySummaryVoteData || {}).some((voteData) => !!voteData?.sheriff_election);

  if (hasExecutionVotes || hasBadgeVotes) {
    context += `\n\n<votes>`;

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
          context += `\n  结果: ${formatSeatName(state, dayHistory.idiotRevealed.seat)} 白痴翻牌免死（失去投票权）`;
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

  // NOTE: Role-specific private information is now at the TOP of the context
  // via buildRolePrivateInfo() to ensure AI sees it first.

  // NOTE: We intentionally do NOT include <current_votes> during DAY_VOTE phase.
  // Showing real-time votes to later voters causes a "bandwagon effect" where
  // AI players follow earlier votes instead of making independent decisions
  // based on their own analysis and speeches.

  return context;
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
