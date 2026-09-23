import { areNightResultsVisible } from "./night-visibility";
import { v4 as uuidv4 } from "uuid";
import { generateCompletion, generateCompletionBatch, generateCompletionStream, extractPromptCacheUsage, mergeOptionsFromModelRef, stripMarkdownCodeFences, stripReasoningArtifacts, type GenerateOptions, type LLMMessage } from "./llm";
import type { ChatCompletionResponse, CompletionUsage } from "./llm";
import { StreamingSpeechParser } from "./streaming-speech-parser";
import {
  type GameState,
  type Player,
  type Role,
  type Phase,
  type ChatMessage,
  type Alignment,
  type DailySummaryVoteData,
  type WolfTeamPlan,
  isWolfRole,
  ALL_MODELS,
  PLAYER_MODELS,
  PROJECT_MODELS,
  type ModelRef,
} from "@/types/game";
import { GAME_TEMPERATURE } from "./ai-config";
import { sampleModelRefs, type GeneratedCharacter } from "./character-generator";
import { withCriticalRetry } from "@/lib/critical-retry";
import { isUpstreamTimeoutError } from "@/lib/upstream-timeout";
import { aiLogger } from "./ai-logger";
import { getGeneratorModel, getSummaryModel } from "@/lib/api-keys";
import { PhaseManager } from "@/game/core/PhaseManager";
import type { PromptResult } from "@/game/core/types";
import { bindIdentityAndRoleSetting, buildCachedSystemMessageFromParts, buildSystemTextFromParts, buildSharedSystemParts, buildGameContext, buildFullGameTranscript, buildPastDaysTranscript, getRoleText, getGameFundamentals } from "./prompt-utils";
import { parseLLMJson } from "./llm-json";
import { getI18n } from "@/i18n/translator";
import { buildPublicRecordForRemark } from "@/lib/public-record";
import { getRoleConfiguration } from "@/lib/role-configuration";
import { canWitchSave, getGuardEligibleSeats, isAbstainKeyword } from "@/lib/rules/actions";
import { getBoardRuleFlags } from "@/lib/rules/boards";
import { canDuel } from "@/lib/rules/knight-duel";
import {
  extractSpeechSkillDecision,
  resolveSpeechSkillKind,
  type SpeechSkillDecision,
} from "@/lib/speech-skill";
import { getMuteEligibleSeats } from "@/lib/rules/mute";
import { getPendingDeathSeats } from "@/lib/rules/night-deaths";
import { getRoleCapabilities } from "@/lib/rules/roles";
import { resolveBadgeElectionWinner } from "@/lib/historical-vote-snapshots";

export { getRoleConfiguration } from "@/lib/role-configuration";
export { getSpeakingOrder } from "@/lib/speech-order";

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function getRandomHumanSeat(
  playerCount: number,
  random: () => number = Math.random
): number {
  const safePlayerCount = Math.max(1, Math.floor(playerCount));
  const randomValue = random();
  const normalized = Number.isFinite(randomValue)
    ? Math.min(Math.max(randomValue, 0), 1 - Number.EPSILON)
    : 0;
  return Math.floor(normalized * safePlayerCount);
}

function getRandomModelRef(): ModelRef {
  const fallback = sampleModelRefs(1)[0];
  if (fallback) return fallback;
  if (PLAYER_MODELS.length === 0) {
    // Fallback to GENERATOR_MODEL if no models available
    return getModelRefForModel(getGeneratorModel());
  }
  const randomIndex = Math.floor(Math.random() * PLAYER_MODELS.length);
  return PLAYER_MODELS[randomIndex];
}

const phaseManager = new PhaseManager();

function getModelRefForModel(model: string): ModelRef {
  return (
    PROJECT_MODELS.find((ref) => ref.model === model) ??
    ALL_MODELS.find((ref) => ref.model === model) ??
    { provider: "zenmux" as const, model }
  );
}

function sanitizeModelArtifacts(text: string): string {
  const raw = String(text ?? "");
  if (!raw) return raw;

  return stripReasoningArtifacts(raw)
    .replace(/<\|begin▁of▁sentence\|>/g, "")
    .replace(/<\|end▁of▁sentence\|>/g, "")
    .replace(/<｜begin▁of▁sentence｜>/g, "")
    .replace(/<｜end▁of▁sentence｜>/g, "")
    .trim();
}

/** 賽後感言清理：模型偶爾會吐出字數自檢、標題或重複整段，這裡只保留正文。 */
export function sanitizeGameEndRemark(text: string): string {
  let out = sanitizeModelArtifacts(text).replace(/```[a-z]*\n?/gi, "");
  const header = "【賽後感言】";
  if (out.includes(header)) out = out.slice(out.lastIndexOf(header) + header.length);
  return out
    .replace(/~?\s*[约約]?\s*\d+\s*字[數数]?[，,]?\s*(?:符合要求|自检通过|自檢通過)?[。]?/g, " ")
    .replace(/符合要求[。]?/g, " ")
    .replace(/[`\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeSeatMentions(text: string, players: Player[]): string {
  if (!text) return text;
  const totalSeats = players.length;
  if (!Number.isFinite(totalSeats) || totalSeats <= 0) return text;
  const { t } = getI18n();

  const formatSeatWithName = (
    raw: string,
    numStr: string,
    prefix: string,
    offset: number,
    fullText: string
  ) => {
    const n = Number.parseInt(numStr, 10);
    if (!Number.isFinite(n)) return raw;
    if (n < 1 || n > totalSeats) return t("gameMaster.invalidSeat");
    if (!prefix && fullText[offset - 1] === "@") return raw;
    const player = players.find((p) => p.seat === n - 1);
    if (!player?.displayName) return raw;
    const after = fullText.slice(offset + raw.length);
    const afterTrimmed = after.replace(/^\s+/, "");
    if (afterTrimmed.startsWith(player.displayName)) return raw;
    const label = t("mentions.playerLabel", { seat: n, name: player.displayName });
    return `${prefix}${label}`;
  };

  // Handle @12 / @12号 / @12號（繁中局的模型會寫「號」）
  let out = text.replace(/@(\d+)\s*[号號]?/g, (m, numStr, offset, fullText) =>
    formatSeatWithName(m, numStr, "@", offset as number, fullText)
  );
  // Handle 12号 / 12號
  out = out.replace(/(\d+)\s*[号號]/g, (m, numStr, offset, fullText) =>
    formatSeatWithName(m, numStr, "", offset as number, fullText)
  );
  return out;
}

function resolvePhasePrompt(
  phase: Phase,
  state: GameState,
  player: Player,
  extras?: Record<string, unknown>
) {
  // Override state.phase to ensure correct prompt is returned
  // This is needed when calling prompts for a phase different from state.phase
  const overriddenState = state.phase === phase ? state : {
    ...state, phase,
    nightHistory: {
      ...state.nightHistory,
      [state.day]: { ...state.nightHistory?.[state.day], resultsAnnounced: areNightResultsVisible(state) },
    },
  };
  const prompt = phaseManager.getPrompt(phase, { state: overriddenState, extras }, player);
  if (!prompt) {
    throw new Error(`[wolfcha] Missing phase prompt for ${phase}`);
  }
  // 過往各日紀錄（含投票詳情）當獨立的 user content 送，排在主要 user 訊息之前。
  return { ...prompt, historyUser: buildPastDaysTranscript(overriddenState) };
}

/** 組出送給模型的 messages：system ＋（過往紀錄，若有）＋主要 user。供測試直接驗結構。 */
export function buildMessagesForPrompt(
  prompt: PromptResult,
  useCache: boolean = true
): { messages: LLMMessage[]; systemMessage: LLMMessage } {
  const systemMessage = buildCachedSystemMessageFromParts(
    prompt.systemParts,
    prompt.system,
    useCache
  );

  const historyUser = prompt.historyUser?.trim();
  return {
    systemMessage,
    messages: [
      systemMessage,
      // 過往各日紀錄（【第N天 白天記錄】）單獨成一個 user content，排在主要 user 訊息之前。
      ...(historyUser ? [{ role: "user" as const, content: historyUser }] : []),
      { role: "user", content: prompt.user },
    ],
  };
}

/**
 * 開局狀態要帶的選項。LOBBY 與實際對局（NIGHT_START）必須帶同一組，
 * 漏一個就會靜默遺失：2026-09-20 的日誌就是 NIGHT_START 漏了 isAcquaintanceGame／
 * characterStats，導致熟人局資訊在第一次 AI 呼叫前就掉了。
 */
export type GameStartStateOptions = Pick<
  GameState,
  | "gameSessionId"
  | "scenario"
  | "players"
  | "phase"
  | "day"
  | "difficulty"
  | "isGenshinMode"
  | "isSpectatorMode"
  | "isAcquaintanceGame"
  | "characterStats"
  | "fixedRoles"
>;

/**
 * 用单一建构点产生开局状态（LOBBY 与 NIGHT_START 共用）。
 * 这样开局选项（尤其熟人局旗标与交手统计）不可能在某一个分支被忘掉。
 */
export function buildGameStartState(options: GameStartStateOptions): GameState {
  return { ...createInitialGameState(), ...options };
}

export function createInitialGameState(): GameState {
  return {
    gameId: uuidv4(),
    gameSessionId: null,
    phase: "LOBBY",
    day: 0,
    startTime: Date.now(),
    difficulty: "normal",
    players: [],
    events: [],
    messages: [],
    currentSpeakerSeat: null,
    nextSpeakerSeatOverride: null,
    daySpeechStartSeat: null,
    speechRoundStartMessageIndex: null,
    speechDirection: "clockwise",
    pkTargets: undefined,
    pkSource: undefined,
    badge: {
      holderSeat: null,
      candidates: [],
      signup: {},
      votes: {},
      allVotes: {},
      history: {},
      electionWinners: {},
      revoteCount: 0,
    },
    votes: {},
    voteReasons: {},
    lastVoteReasons: {},
    voteHistory: {},
    dailySummaries: {},
    dailySummaryFacts: {},
    dailySummaryVoteData: {},
    nightActions: {},
    roleAbilities: {
      witchHealUsed: false,
      witchPoisonUsed: false,
      hunterCanShoot: true,
      idiotRevealed: false,
      boomedSeats: [],
  duelUsedSeats: [],
    },
    winner: null,
  };
}

export function setupPlayers(
  characters: GeneratedCharacter[],
  humanSeat: number = 0,
  humanName: string = "",
  playerCount: number = 10,
  fixedRoles?: Role[],
  seedPlayerIds?: string[],
  modelRefs?: ModelRef[],
  aiSeatOrder?: number[],
  preferredRole?: Role,
  fixedRolesSeatOrdered: boolean = false
): Player[] {
  const { t } = getI18n();
  const totalPlayers = playerCount;
  const fallbackHumanName = t("common.you");
  const roles = getRoleConfiguration(totalPlayers);
  // 版型（fixedRoles）只宣告「這一局有哪些角色」，不宣告誰坐哪個座位 → 一律洗牌。
  // 只有開發者自選角色（逐座位指定）才照傳入順序放。以前帶版型就整段跳過洗牌，
  // 導致狼固定坐在 1~4 號（版型表的排列順序）。
  const assignedRoles =
    fixedRoles && fixedRoles.length === totalPlayers
      ? fixedRolesSeatOrdered
        ? [...fixedRoles]
        : shuffleArray(fixedRoles)
      : shuffleArray(roles);

  // 身份偏好：只要該角色在這局的角色組成裡（含版型／開發者指定的組成），就換給真人。
  // 以前只要帶 fixedRoles 就整段跳過，導致「選了版型就不能再用身份偏好」。
  if (preferredRole && humanSeat >= 0 && assignedRoles.includes(preferredRole)) {
    const currentRoleAtHumanSeat = assignedRoles[humanSeat];
    if (currentRoleAtHumanSeat !== preferredRole) {
      const targetIndex = assignedRoles.findIndex(
        (r, i) => r === preferredRole && i !== humanSeat
      );
      if (targetIndex !== -1) {
        assignedRoles[targetIndex] = currentRoleAtHumanSeat;
        assignedRoles[humanSeat] = preferredRole;
      }
    }
  }

  const players: Player[] = [];

  const computeCharIndexForSeat = (() => {
    const aiSeats = Array.from({ length: totalPlayers }, (_, seat) => seat).filter(
      (seat) => seat !== humanSeat
    );

    if (
      Array.isArray(aiSeatOrder) &&
      aiSeatOrder.length === aiSeats.length &&
      new Set(aiSeatOrder).size === aiSeats.length &&
      aiSeatOrder.every((s) => aiSeats.includes(s))
    ) {
      const seatToCharIndex = new Map<number, number>();
      aiSeatOrder.forEach((seat, idx) => seatToCharIndex.set(seat, idx));
      return (seat: number) => seatToCharIndex.get(seat) ?? -1;
    }

    return (seat: number) => (seat > humanSeat ? seat - 1 : seat);
  })();

  const getPlayerIdForSeat = (seat: number) => {
    const id = Array.isArray(seedPlayerIds) ? seedPlayerIds[seat] : undefined;
    return typeof id === "string" && id.trim() ? id : uuidv4();
  };

  for (let seat = 0; seat < totalPlayers; seat++) {
    const role = assignedRoles[seat];
    const alignment: Alignment = isWolfRole(role) ? "wolf" : "village";
    const playerId = getPlayerIdForSeat(seat);

    if (seat === humanSeat) {
      players.push({
        playerId,
        seat,
        displayName: humanName.trim() || fallbackHumanName,
        avatarSeed: playerId,
        alive: true,
        role,
        alignment,
        isHuman: true,
      });
    } else {
      const charIndex = computeCharIndexForSeat(seat);
      const fallbackIndex = seat > humanSeat ? seat - 1 : seat;
      const safeCharIndex =
        Number.isFinite(charIndex) && charIndex >= 0 && charIndex < characters.length
          ? charIndex
          : Math.min(Math.max(0, fallbackIndex), Math.max(0, characters.length - 1));
      const character = characters[safeCharIndex];
      const modelRef = modelRefs?.[safeCharIndex] ?? getRandomModelRef();

      players.push({
        playerId,
        seat,
        characterId: character.id,
        displayName: character.displayName,
        avatarSeed: character.avatarSeed ?? playerId,
        avatarStyle: character.avatarStyle,
        alive: true,
        role,
        alignment,
        isHuman: false,
        agentProfile: {
          modelRef,
          persona: character.persona,
          playerMind: character.playerMind,
        },
      });
    }
  }

  return players;
}

export function addSystemMessage(
  state: GameState,
  content: string
): GameState {
  const { t } = getI18n();
  const message: ChatMessage = {
    id: uuidv4(),
    playerId: "system",
    playerName: t("speakers.host"),
    content,
    timestamp: Date.now(),
    day: state.day,
    phase: state.phase,
    isSystem: true,
  };

  return {
    ...state,
    messages: [...state.messages, message],
  };
}

export function addPlayerMessage(
  state: GameState,
  playerId: string,
  content: string,
  options?: { isLastWords?: boolean; id?: string }
): GameState {
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player) return state;

  const trimmedContent = content.trim();
  if (trimmedContent.length === 0) return state;

  // Auto-detect last words phase or use explicit flag
  const isLastWords = options?.isLastWords ?? state.phase === "DAY_LAST_WORDS";

  // 幂等依据请求与段落 ID，不能按文字去重（重复句可能是合法发言）。
  if (options?.id && state.messages.some((m) => m.id === options.id)) return state;

  const message: ChatMessage = {
    id: options?.id ?? uuidv4(),
    playerId,
    playerName: player.displayName,
    content: trimmedContent,
    timestamp: Date.now(),
    day: state.day,
    phase: state.phase,
    speechRound: state.speechRoundStartMessageIndex ?? undefined,
    pkSource: state.pkSource,
    ...(isLastWords && { isLastWords: true }),
  };

  return {
    ...state,
    messages: [...state.messages, message],
  };
}

export function transitionPhase(state: GameState, newPhase: Phase): GameState {
  // Clear currentSpeakerSeat when transitioning to night phases
  const isNightPhase = newPhase.startsWith("NIGHT_");
  const shouldClearSpeaker = isNightPhase || newPhase === "DAY_VOTE" || newPhase === "DAY_RESOLVE";
  const isSpeechPhase =
    newPhase === "DAY_BADGE_SPEECH" ||
    newPhase === "DAY_PK_SPEECH" ||
    newPhase === "DAY_SPEECH" ||
    newPhase === "DAY_LAST_WORDS";

  return {
    ...state,
    phase: newPhase,
    ...(shouldClearSpeaker && { currentSpeakerSeat: null }),
    speechRoundStartMessageIndex: isSpeechPhase ? state.messages.length : null,
  };
}

export function checkWinCondition(state: GameState): Alignment | null {
  const alivePlayers = state.players.filter((p) => p.alive);
  const aliveWolves = alivePlayers.filter((p) => p.alignment === "wolf");
  const aliveVillagers = alivePlayers.filter((p) => p.alignment === "village");

  if (aliveWolves.length === 0) {
    return "village";
  }

  if (aliveWolves.length >= aliveVillagers.length) {
    return "wolf";
  }

  return null;
}

export function killPlayer(state: GameState, seat: number): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.seat === seat ? { ...p, alive: false } : p
    ),
  };
}

export { excludePendingDeathPlayers, getPendingDeathSeats } from "@/lib/rules/night-deaths";

export function getNextAliveSeat(
  state: GameState,
  currentSeat: number,
  excludeSheriff = false,
  direction: "clockwise" | "counterclockwise" = "clockwise"
): number | null {
  const sheriffSeat = state.badge.holderSeat;
  let alivePlayers = state.players.filter((p) => p.alive);

  // 如果需要排除警长（警长最后发言），则从候选列表中移除警长
  if (excludeSheriff && sheriffSeat !== null) {
    alivePlayers = alivePlayers.filter((p) => p.seat !== sheriffSeat);
  }

  if (alivePlayers.length === 0) return null;

  const sortedSeats = alivePlayers.map((p) => p.seat).sort((a, b) => a - b);
  if (sortedSeats.length === 0) return null;

  if (direction === "counterclockwise") {
    const prevSeat = [...sortedSeats].reverse().find((s) => s < currentSeat);
    return prevSeat ?? sortedSeats[sortedSeats.length - 1];
  }

  const nextSeat = sortedSeats.find((s) => s > currentSeat);
  return nextSeat ?? sortedSeats[0];
}

/**
 * 计算发言起始座位
 * @param state 游戏状态
 * @param options.deadSeat 死者座位（用于确定从死者下一位开始）
 * @param options.hasSheriff 是否有存活警长（默认自动检测）
 * @returns 起始座位号
 */
export function resolveSpeechStartSeat(
  state: GameState,
  options?: { deadSeat?: number; hasSheriff?: boolean }
): number | null {
  const alivePlayers = state.players.filter((p) => p.alive);
  const aliveSeats = alivePlayers.map((p) => p.seat).sort((a, b) => a - b);

  if (aliveSeats.length === 0) return null;

  const sheriffSeat = state.badge.holderSeat;
  const isSheriffAlive = options?.hasSheriff ??
    (sheriffSeat !== null && aliveSeats.includes(sheriffSeat));

  // 场上存在警长：从警长下一位开始
  if (isSheriffAlive && sheriffSeat !== null) {
    return getNextAliveSeat(state, sheriffSeat, true, "clockwise");
  }

  // 无警长但有死者：从死者下一位开始
  if (options?.deadSeat !== undefined) {
    return getNextAliveSeat(state, options.deadSeat, false, "clockwise");
  }

  // 默认：从最小座位号开始
  return aliveSeats[0];
}

export function tallyVotes(state: GameState): { seat: number; count: number } | null {
  const voteCounts: Record<number, number> = {};
  const sheriffSeat = state.badge.holderSeat;
  const aliveById = new Set(state.players.filter((p) => p.alive).map((p) => p.playerId));
  const aliveBySeat = new Set(state.players.filter((p) => p.alive).map((p) => p.seat));

  // 找到警长的 playerId
  const sheriffPlayer = sheriffSeat !== null
    ? state.players.find((p) => p.seat === sheriffSeat && p.alive)
    : null;
  const sheriffPlayerId = sheriffPlayer?.playerId;

  // 已翻牌白痴的投票不计入
  const revealedIdiotId = state.roleAbilities.idiotRevealed
    ? state.players.find((p) => p.role === "Idiot" && p.alive)?.playerId
    : undefined;

  for (const [voterId, targetSeat] of Object.entries(state.votes)) {
    if (!aliveById.has(voterId)) continue;
    if (!aliveBySeat.has(targetSeat)) continue;
    if (voterId === revealedIdiotId) continue; // 白痴翻牌后失去投票权
    // 警长的票计算为1.5票
    const voteWeight = voterId === sheriffPlayerId ? 1.5 : 1;
    voteCounts[targetSeat] = (voteCounts[targetSeat] || 0) + voteWeight;
  }

  let maxVotes = 0;
  let maxSeat: number | null = null;

  for (const [seat, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      maxSeat = parseInt(seat);
    }
  }

  // 平票判定：如果最高票并列，则无人被放逐
  if (maxVotes > 0) {
    const topSeats = Object.entries(voteCounts)
      .filter(([, c]) => c === maxVotes)
      .map(([s]) => parseInt(s));
    if (topSeats.length !== 1) return null;
  }

  if (maxSeat === null) return null;
  return { seat: maxSeat, count: maxVotes };
}

/** Extract structured vote_data from [VOTE_RESULT] in day messages. Preserves "who voted for whom" so it is not lost when context is trimmed. */
export function extractVoteDataFromDayMessages(
  dayMessages: ChatMessage[],
  state: GameState
): DailySummaryVoteData | undefined {
  const { t } = getI18n();
  const badgeVoteTitle = t("badgePhase.voteDetailTitle");
  const dayVoteTitle = t("votePhase.voteDetailTitle");
  let sheriff: { winner: number; votes: Record<string, number[]> } | undefined;
  let execution: { eliminated: number; votes: Record<string, number[]> } | undefined;

  for (const m of dayMessages) {
    if (!m.isSystem || !m.content.startsWith("[VOTE_RESULT]")) continue;
    try {
      const json = m.content.slice("[VOTE_RESULT]".length);
      const data = JSON.parse(json) as { title?: string; results?: Array<{ targetSeat: number; voterSeats?: number[] }> };
      const results = data.results ?? [];
      const votes: Record<string, number[]> = {};
      for (const r of results) {
        const k = String(r.targetSeat);
        votes[k] = Array.isArray(r.voterSeats) ? r.voterSeats : [];
      }
      if (data.title === badgeVoteTitle && Object.keys(votes).length > 0) {
        const voteGroups = Object.fromEntries(
          Object.entries(votes).map(([targetSeat, voterSeats]) => [Number(targetSeat), voterSeats])
        );
        const winner = resolveBadgeElectionWinner(state, state.day, voteGroups);
        if (typeof winner === "number") sheriff = { winner, votes };
      } else if (data.title === dayVoteTitle && Object.keys(votes).length > 0) {
        const eliminated = state.dayHistory?.[state.day]?.executed?.seat ?? -1;
        execution = { eliminated, votes };
      }
    } catch {
      // skip malformed [VOTE_RESULT]
    }
  }

  if (!sheriff && !execution) return undefined;
  const out: DailySummaryVoteData = {};
  if (sheriff != null && sheriff.winner >= 0) out.sheriff_election = sheriff;
  if (execution != null && execution.eliminated >= 0) out.execution_vote = execution;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function formatDailySummaryTranscriptMessage(
  message: ChatMessage,
  state: GameState,
  systemSpeaker: string
): string | null {
  if (!message.isSystem) {
    const { t } = getI18n();
    const player = state.players.find((candidate) => candidate.playerId === message.playerId);
    const seatLabel = player ? t("mentions.seatLabel", { seat: player.seat + 1 }) : "";
    const nameLabel = player?.displayName || message.playerName;
    const speaker = seatLabel ? `${seatLabel} ${nameLabel}`.trim() : nameLabel;
    return `${speaker}: ${message.content}`;
  }

  if (!message.content.startsWith("[VOTE_RESULT]")) {
    return `${systemSpeaker}: ${message.content}`;
  }

  try {
    const { t } = getI18n();
    const payload = JSON.parse(message.content.slice("[VOTE_RESULT]".length)) as {
      title?: unknown;
      results?: Array<{ targetSeat?: unknown; voterSeats?: unknown; voteCount?: unknown }>;
    };
    const validSeats = new Set(state.players.map((player) => player.seat));
    const results = (Array.isArray(payload.results) ? payload.results : [])
      .flatMap((result) => {
        if (typeof result.targetSeat !== "number" || !validSeats.has(result.targetSeat)) return [];
        const target = state.players.find((player) => player.seat === result.targetSeat);
        const voters = Array.isArray(result.voterSeats)
          ? result.voterSeats.filter((seat): seat is number => typeof seat === "number" && validSeats.has(seat))
          : [];
        const voterLabels = voters.map((seat) => {
          const voter = state.players.find((player) => player.seat === seat);
          return `${t("mentions.seatLabel", { seat: seat + 1 })}${voter ? ` ${voter.displayName}` : ""}`;
        });
        const targetLabel = `${t("mentions.seatLabel", { seat: result.targetSeat + 1 })}${target ? ` ${target.displayName}` : ""}`;
        return [t("gameMaster.dailySummary.voteResultLine", {
          target: targetLabel,
          voters: voterLabels.join(t("promptUtils.gameContext.listSeparator")) || t("gameMaster.dailySummary.noVoters"),
          voteCount: typeof result.voteCount === "number" ? result.voteCount : voters.length,
        })];
      });

    if (results.length === 0) return null;
    const title = typeof payload.title === "string" ? payload.title : t("gameMaster.dailySummary.voteResultTitle");
    return `${systemSpeaker}: ${title}\n${results.join("\n")}`;
  } catch {
    // Internal zero-based vote payloads must never be passed to the model verbatim.
    return null;
  }
}

export async function generateDailySummary(
  state: GameState
): Promise<{ bullets: string[]; voteData?: DailySummaryVoteData }> {
  const { t } = getI18n();
  const startTime = Date.now();
  const summaryModel = getSummaryModel();
  const dayBreakText = t("system.dayBreak");
  const systemSpeaker = t("speakers.system");

  const dayStartIndex = (() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i];
      if (m.isSystem && m.content === dayBreakText) return i;
    }
    return 0;
  })();

  const dayMessages = state.messages.slice(dayStartIndex);
  const voteData = extractVoteDataFromDayMessages(dayMessages, state);

  const transcript = dayMessages
    .map((message) => formatDailySummaryTranscriptMessage(message, state, systemSpeaker))
    .filter((line): line is string => line !== null)
    .join("\n")
    .slice(0, 15000);

  // 記錄員也要知道自己在記什麼遊戲：遊戲基本盤（規則與角色技能）在前，任務指令在後。
  const system = [getGameFundamentals(), t("gameMaster.dailySummary.systemPrompt")].join("\n\n");
  const user = t("gameMaster.dailySummary.userPrompt", { day: state.day, transcript });

  const messages: LLMMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const summaryModelRef = getModelRefForModel(summaryModel);
  const completion = await generateCompletionAndParse(
    {
      model: summaryModel,
      messages,
      temperature: GAME_TEMPERATURE.SUMMARY,
      response_format: structuredResponseFormat(summaryModelRef, "daily_summary", {
        type: "object",
        properties: {
          bullets: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["bullets"],
        additionalProperties: false,
      }),
    },
    (cleaned) => {
      const obj = parseLLMJson<{ bullets?: unknown; summary?: unknown }>(cleaned);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return parseFail();
      if (Array.isArray(obj.bullets)) {
        const bullets = obj.bullets
          .filter((bullet): bullet is string => typeof bullet === "string")
          .map((bullet) => bullet.trim())
          .filter(Boolean);
        if (bullets.length > 0) {
          return parseOk({ bullets, voteData });
        }
      }
      if (typeof obj.summary === "string" && obj.summary.trim()) {
        return parseOk({ bullets: [obj.summary.trim()], voteData });
      }
      return parseFail();
    }
  );

  await aiLogger.log({
    type: "daily_summary",
    request: {
      model: summaryModel,
      messages,
    },
    response: {
      content: completion.cleaned,
      raw: completion.result.content,
      rawResponse: JSON.stringify(completion.result.raw, null, 2),
      finishReason: completion.result.raw.choices?.[0]?.finish_reason,
      parsed: completion.parsed,
      duration: Date.now() - startTime,
    },
  });

  if (completion.parsed) return completion.parsed;
  return { bullets: [], voteData };
}

export async function* generateAISpeechStream(
  state: GameState,
  player: Player
): AsyncGenerator<string, void, unknown> {
  const { t } = getI18n();
  const prompt = resolvePhasePrompt(state.phase, state, player);
  const startTime = Date.now();
  const { messages } = buildMessagesForPrompt(prompt);

  let fullResponse = "";
  // 串流 generator 拿不到回傳值，用 onUsage 把 usage 帶出來寫進 log（快取命中原則上量不到）。
  let streamUsage: CompletionUsage | undefined;
  try {
    for await (const chunk of generateCompletionStream(mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
      model: player.agentProfile!.modelRef.model,
      messages,
      promptScope: "gameplay",
      temperature: GAME_TEMPERATURE.SPEECH,
      onUsage: (usage) => { streamUsage = usage; },
    }))) {
      fullResponse += chunk;
      yield chunk;
    }

    const sanitizedSpeech = sanitizeSeatMentions(sanitizeModelArtifacts(fullResponse), state.players);
    await aiLogger.log({
      type: "speech",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        temperature: GAME_TEMPERATURE.SPEECH,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: sanitizedSpeech,
        raw: fullResponse,
        duration: Date.now() - startTime,
        ...(streamUsage ? { cache: extractPromptCacheUsage(streamUsage) } : {}),
      },
    });
  } catch (error) {
    const raw = String(error);
    const isRateLimited = raw.includes("429") || raw.includes("limit_requests");
    const sanitizedSpeech = sanitizeSeatMentions(sanitizeModelArtifacts(fullResponse), state.players);
    const visibleSpeech = isRateLimited && !fullResponse.trim()
      ? t("gameMaster.tooManyRequests")
      : sanitizedSpeech;
    await aiLogger.log({
      type: "speech",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: { content: visibleSpeech, duration: Date.now() - startTime },
      error: raw,
    });

    if (isRateLimited) {
      if (!fullResponse.trim()) {
        yield visibleSpeech;
      }
      return;
    }

    throw error;
  }
}

export async function generateAISpeech(
  state: GameState,
  player: Player
): Promise<string> {
  let result = "";
  for await (const chunk of generateAISpeechStream(state, player)) {
    result += chunk;
  }
  return result;
}

/**
 * 区分「真正解析失败」与「文档已完整、只是尾缀多了一段说明」。
 *
 * 模型常在 JSON 数组后面补一句自我检查（例如 "Wait, need to check message count max 2."），
 * 解析器会把这段尾缀当成格式错误上报。此时公开段落都已产出、预取也会被采用，
 * 解析器自己的注释也写明「完整公开文档之后的垃圾尾缀可以丢弃」，因此不该记成 error。
 *
 * 注意只有尾缀垃圾、且没有触发恢复时才能降级：如果文档内容不合法到需要重新生成
 * （recovered 为 true），那个格式错误是有意义的，必须照旧上报。
 */
export function resolveSpeechParseError(
  parseError: string | undefined,
  parser: StreamingSpeechParser,
  recovered: boolean,
): string | undefined {
  if (!parseError) return undefined;
  if (parser.hasTrailingJunk() && !recovered) {
    console.warn("[speech] 已丢弃 JSON 数组之后的尾缀说明，不作为解析失败处理");
    return undefined;
  }
  return parseError;
}

export async function generateAISpeechSegments(
  state: GameState,
  player: Player
): Promise<string[]> {
  const { t } = getI18n();
  const prompt = resolvePhasePrompt(state.phase, state, player);
  const startTime = Date.now();
  const { messages } = buildMessagesForPrompt(prompt);

  try {
    const result = await generateCompletion(mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
      model: player.agentProfile!.modelRef.model,
      messages,
      promptScope: "gameplay",
      temperature: GAME_TEMPERATURE.SPEECH,
    }));

    let parseError: string | undefined;
    const parser = new StreamingSpeechParser({ onError: (error) => { parseError = error; } });
    parser.processChunk(result.content);
    const publicSegments = parser.end().map((segment) =>
      sanitizeSeatMentions(sanitizeModelArtifacts(segment), state.players)).filter(Boolean);
    const recovery = (!publicSegments.length || !parser.hasCompleteDocument())
      ? await recoverPublicSpeech(state, player, messages, publicSegments)
      : undefined;
    const segments = [...publicSegments, ...(recovery?.segments ?? [])];

    await aiLogger.log({
      type: "speech",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: segments.join("\n"),
        raw: result.content,
        rawResponse: JSON.stringify({ ...result.raw, ...(recovery ? { recovery } : {}) }, null, 2),
        finishReason: result.raw.choices?.[0]?.finish_reason,
        duration: Date.now() - startTime,
      },
      error: resolveSpeechParseError(parseError, parser, Boolean(recovery)),
    });

    return segments;
  } catch (error) {
    const raw = String(error);
    const isRateLimited = raw.includes("429") || raw.includes("limit_requests");
    const fallback = isRateLimited ? t("gameMaster.tooManyRequests") : "";
    await aiLogger.log({
      type: "speech",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: { content: fallback, duration: Date.now() - startTime },
      error: raw,
    });

    if (isRateLimited) {
      return [fallback];
    }

    throw error;
  }
}

export interface StreamingSpeechOptions {
  /** 技能角色（狼／騎士）發言時附帶的技能決定；null＝模型沒寫（呼叫端退回獨立請求） */
  onSkillDecision?: (decision: SpeechSkillDecision | null) => void;
  signal?: AbortSignal;
  onSegmentReceived?: (segment: string, index: number) => void;
  onProgress?: (current: number) => void;
  onComplete?: (segments: string[]) => void;
  onError?: (error: string) => void;
}

/** 只用原始游戏上下文与已公开段落重新生成；损坏响应可能含私有分析，绝不回灌或直接朗读。 */
async function recoverPublicSpeech(
  state: GameState,
  player: Player,
  messages: LLMMessage[],
  confirmed: string[],
  signal?: AbortSignal,
) {
  const { t } = getI18n();
  signal?.throwIfAborted();
  const recoveryStartTime = Date.now();
  const recoveryMessages: LLMMessage[] = [...messages, { role: "user", content:
    `${t("promptUtils.gameContext.speechRecoveryFormatHint", {
      format: '{"segments":["完整公开段落"]}',
    })}${confirmed.length
      ? t("promptUtils.gameContext.speechRecoveryAlreadyPublic", { confirmed: JSON.stringify(confirmed) })
      : t("promptUtils.gameContext.speechRecoveryNothingPublic")}` }];
  const result = await generateCompletion(mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
    model: player.agentProfile!.modelRef.model, messages: recoveryMessages,
    promptScope: "gameplay", temperature: GAME_TEMPERATURE.ACTION, signal,
    response_format: structuredResponseFormat(player.agentProfile!.modelRef, "public_speech", {
      type: "object", properties: { segments: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["segments"], additionalProperties: false,
    }),
  }));
  signal?.throwIfAborted();
  // 恢复结果完整校验之后才提交，重试失败不会再释放一半内容。
  let parsed: unknown;
  try { parsed = JSON.parse(stripMarkdownCodeFences(result.content)); } catch { /* 下方统一报错 */ }
  const segments = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as { segments?: unknown }).segments : undefined;
  // 恢复失败时也要把恢复请求的 raw 回应写入日志：此前只有成功路径留痕，失败路径无从排查模型二次输出了什么。
  const failRecovery = async (message: string): Promise<never> => {
    await aiLogger.log({
      type: "speech",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages: recoveryMessages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: { content: "", raw: result.content, duration: Date.now() - recoveryStartTime },
      error: message,
    });
    throw new Error(message);
  };
  if (!Array.isArray(segments) || !segments.length || segments.some((s) => typeof s !== "string" || !s.trim()) ||
      Object.keys(parsed!).some((key) => key !== "segments")) {
    await failRecovery(t("promptUtils.gameContext.speechRecoveryFailed"));
  }
  let recoveryParseError: string | undefined;
  const parser = new StreamingSpeechParser({ onError: (error) => { recoveryParseError = error; } });
  parser.processChunk(JSON.stringify(segments));
  const sanitized = parser.end().map((s) => sanitizeSeatMentions(sanitizeModelArtifacts(s), state.players)).filter(Boolean);
  if (recoveryParseError) await failRecovery(t("promptUtils.gameContext.speechRecoveryFailedInvalid"));
  // 模型若把已公开的前缀重发，不按文本全局去重，只移除位置一致的完整前缀。
  if (confirmed.length && confirmed.every((s, i) => sanitized[i] === s)) sanitized.splice(0, confirmed.length);
  if (!sanitized.length) await failRecovery(t("promptUtils.gameContext.speechRecoveryFailedNoNew"));
  return { segments: sanitized, raw: result.content, messages: recoveryMessages };
}

/**
 * 流式生成 AI 发言段落
 * 实时输出发言内容，每完成一个段落就立即通知
 */
export async function generateAISpeechSegmentsStream(
  state: GameState,
  player: Player,
  options: StreamingSpeechOptions = {}
): Promise<string[]> {
  const { t } = getI18n();
  const prompt = resolvePhasePrompt(state.phase, state, player);
  const startTime = Date.now();
  const { messages } = buildMessagesForPrompt(prompt);

  // 技能角色（狼／騎士）在同一次發言請求裡附帶技能決定；漏寫時由呼叫端退回獨立請求。
  const skillKind = resolveSpeechSkillKind(state, player);
  const emittedSegments: string[] = [];
  let parseError: string | undefined;
  let recoveryDetails: Awaited<ReturnType<typeof recoverPublicSpeech>> | undefined;
  const parser = new StreamingSpeechParser({
    onSegmentReceived: (segment) => {
      const sanitized = sanitizeSeatMentions(sanitizeModelArtifacts(segment), state.players);
      if (sanitized) {
        const index = emittedSegments.length;
        emittedSegments.push(sanitized);
        options.onSegmentReceived?.(sanitized, index);
      }
    },
    onProgress: options.onProgress,
    onError: (error) => { parseError = error; },
  });

  let accumulatedContent = "";
  // 串流 usage（含 cached_tokens）靠回呼帶出，寫進 AI log 後才能量測快取命中。
  let streamUsage: CompletionUsage | undefined;
  try {
    const stream = generateCompletionStream(mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
      model: player.agentProfile!.modelRef.model,
      messages,
      promptScope: "gameplay",
      temperature: GAME_TEMPERATURE.SPEECH,
      signal: options.signal,
      onUsage: (usage) => { streamUsage = usage; },
    }));

    let chunkCount = 0;

    for await (const chunk of stream) {
      chunkCount++;
      accumulatedContent += chunk;
      parser.processChunk(chunk);

      // 调试：每10个chunk输出一次
      if (chunkCount % 10 === 0) {
        console.log(`[streaming] chunks: ${chunkCount}, accumulated: ${accumulatedContent.length} chars, segments: ${parser.getSegmentCount()}`);
      }
    }

    console.log(`[streaming] done. total chunks: ${chunkCount}, segments emitted: ${parser.getSegmentCount()}, emitted: ${emittedSegments.length}`);

    // 结束解析
    parser.end();

    const logAndComplete = async (result: string[]): Promise<string[]> => {
      const skillDecision = skillKind ? extractSpeechSkillDecision(accumulatedContent, skillKind) : null;
      if (skillKind) options.onSkillDecision?.(skillDecision);
      await aiLogger.log({
        type: "speech",
        request: {
          model: player.agentProfile!.modelRef.model,
          messages,
          player: {
            playerId: player.playerId,
            displayName: player.displayName,
            seat: player.seat,
            role: player.role,
          },
        },
        response: {
          content: result.join("\n"),
          raw: accumulatedContent,
          rawResponse: recoveryDetails ? JSON.stringify({ recovery: recoveryDetails }) : undefined,
          duration: Date.now() - startTime,
          ...(streamUsage ? { cache: extractPromptCacheUsage(streamUsage) } : {}),
          ...(skillKind ? { parsed: { skill: skillDecision ?? "missing" } } : {}),
        },
        error: resolveSpeechParseError(parseError, parser, Boolean(recoveryDetails)),
      });

      options.onComplete?.(result);
      return result;
    };

    // 完整文档后的多余说明可丢弃；正文中断或完全没有公开内容时只恢复一次。
    if (emittedSegments.length === 0 || !parser.hasCompleteDocument()) {
      recoveryDetails = await recoverPublicSpeech(state, player, messages, emittedSegments, options.signal);
      for (const segment of recoveryDetails.segments) {
        options.signal?.throwIfAborted();
        const index = emittedSegments.length;
        emittedSegments.push(segment);
        options.onSegmentReceived?.(segment, index);
      }
    }
    return await logAndComplete(emittedSegments);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const raw = String(error);
    const isRateLimited = raw.includes("429") || raw.includes("limit_requests");
    const rateLimitResult = isRateLimited && !parseError ? [t("gameMaster.tooManyRequests")] : null;
    await aiLogger.log({
      type: "speech",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: {
          playerId: player.playerId,
          displayName: player.displayName,
          seat: player.seat,
          role: player.role,
        },
      },
      response: {
        content: emittedSegments.length ? emittedSegments.join("\n") : rateLimitResult?.join("\n") ?? "",
        raw: accumulatedContent,
        duration: Date.now() - startTime,
      },
      error: raw,
    });

    if (rateLimitResult) {
      if (emittedSegments.length === 0) options.onSegmentReceived?.(rateLimitResult[0], 0);
      options.onComplete?.(emittedSegments.length ? emittedSegments : rateLimitResult);
      return emittedSegments.length ? emittedSegments : rateLimitResult;
    }

    options.onError?.(String(error));
    throw error;
  }
}

/**
 * 放逐投票的 prompt 與請求參數。
 * 暖機與正式請求共用同一份 plan，保證兩者的公共前綴逐字相同（否則快取對不上）。
 */
function planVoteRequest(
  state: GameState,
  player: Player
): { messages: LLMMessage[]; validSeats: number[]; options: GenerateOptions } | null {
  const prompt = resolvePhasePrompt("DAY_VOTE", state, player);
  const eligibleSeats = state.pkSource === "vote" && state.pkTargets && state.pkTargets.length > 0
    ? new Set(state.pkTargets)
    : null;
  const alivePlayers = state.players.filter(
    (p) => p.alive && p.playerId !== player.playerId && (!eligibleSeats || eligibleSeats.has(p.seat))
  );
  const { messages } = buildMessagesForPrompt(prompt);
  const validSeats = alivePlayers.map((p) => p.seat);
  if (validSeats.length === 0) return null;

  return {
    messages,
    validSeats,
    options: mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
      model: player.agentProfile!.modelRef.model,
      messages,
      promptScope: "gameplay",
      temperature: GAME_TEMPERATURE.ACTION,
      response_format: seatSelectionResponseFormat(player.agentProfile!.modelRef, "day_vote", validSeats),
    }),
  };
}

export async function generateAIVote(
  state: GameState,
  player: Player
): Promise<{ seat: number; reason: string }> {
  const { t } = getI18n();
  const plan = planVoteRequest(state, player);
  const startTime = Date.now();
  if (!plan) {
    return { seat: AI_VOTE_ABSTAIN, reason: t("gameMaster.voteFallback.noTargets") };
  }
  const { messages, validSeats, options } = plan;

  try {
    const parseSeatValue = (value: unknown): number | null => {
      const displaySeat =
        typeof value === "number"
          ? value
          : typeof value === "string" && /^\d+$/.test(value.trim())
            ? Number.parseInt(value.trim(), 10)
            : NaN;
      if (!Number.isFinite(displaySeat)) return null;
      const seat = displaySeat - 1;
      return validSeats.includes(seat) ? seat : null;
    };

    const completion = await generateCompletionAndParse(
      options,
      (cleaned) => {
        const parsed = parseLLMJson<{
          seat?: unknown;
          targetSeat?: unknown;
          target?: unknown;
          vote?: unknown;
          reason?: unknown;
        }>(cleaned);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parseFail();

        const seat =
          parseSeatValue(parsed.seat) ??
          parseSeatValue(parsed.targetSeat) ??
          parseSeatValue(parsed.target) ??
          parseSeatValue(parsed.vote);
        if (seat === null) return parseFail();

        const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
        return parseOk({ seat, reason: reason || t("gameMaster.voteFallback.missingReason") });
      }
    );

    const parsedResult = completion.parsed ?? {
      seat: AI_VOTE_ABSTAIN,
      reason: validSeats.length === 0
        ? t("gameMaster.voteFallback.noTargets")
        : t("gameMaster.voteFallback.parseFailedAbstain"),
    };

    // Log with both raw and parsed data
    await aiLogger.log({
      type: "vote",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: parsedResult,
        duration: Date.now() - startTime
      }
    });

    return parsedResult;
  } catch (error) {
    const fallbackResult = {
      seat: AI_VOTE_ABSTAIN,
      reason: validSeats.length === 0
        ? t("gameMaster.voteFallback.noTargets")
        : t("gameMaster.voteFallback.apiFailedAbstain"),
    };

    await aiLogger.log({
      type: "vote",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: "",
        parsed: fallbackResult,
        duration: Date.now() - startTime
      },
      error: String(error),
    });

    return fallbackResult;
  }
}

/** Sentinel for abstain when AI fails to vote or parse. Counting logic skips -1 via aliveBySeat.has(seat). */
export const AI_VOTE_ABSTAIN = -1;

/** Sentinel for abstain when AI fails to vote or parse. Counting logic skips -1 via aliveBySeat.has(seat). */
export const BADGE_VOTE_ABSTAIN = -1;

export const BADGE_TRANSFER_TORN = -1;

function parseDisplaySeatValue(value: unknown, validSeats: number[]): number | null {
  const displaySeat =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value.trim())
        ? Number.parseInt(value.trim(), 10)
        : NaN;

  if (!Number.isFinite(displaySeat)) return null;
  const seat = displaySeat - 1;
  return validSeats.includes(seat) ? seat : null;
}

function parseLLMDisplaySeat(raw: string, validSeats: number[], keys: string[] = ["seat", "targetSeat", "target", "vote"]): number | null {
  if (validSeats.length === 0) return null;

  const cleaned = stripMarkdownCodeFences(raw).trim();
  const parsed = parseLLMJson<unknown>(cleaned);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    for (const key of keys) {
      const seat = parseDisplaySeatValue(record[key], validSeats);
      if (seat !== null) return seat;
    }
  }

  return null;
}

function firstSeat(validSeats: number[]): number | undefined {
  return [...validSeats].sort((a, b) => a - b)[0];
}

/**
 * 判斷守衛的回應是否為「空守」（今晚不保護任何人）。
 *
 * 接受的寫法：`seat: 0`（顯示座位從 1 起算）、`seat: null`、或 action 字樣含
 * abstain／skip／pass／none。寬鬆解析是為了避免 AI 選空守時被誤判成格式錯誤而觸發重試。
 */
function isGuardAbstainResponse(cleaned: string): boolean {
  const parsed = parseLLMJson<unknown>(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  const seatValue = record.seat ?? record.targetSeat ?? record.target ?? record.protect;
  if (seatValue === null || seatValue === 0 || seatValue === "0") return true;
  if (record.abstain === true || record.abstain === "true") return true;
  return isAbstainKeyword(record.action ?? record.type ?? record.decision);
}

function supportsStrictJsonSchema(modelRef: Pick<ModelRef, "provider" | "model">): boolean {
  if (modelRef.provider === "dashscope") return false;
  const model = modelRef.model.toLowerCase();
  return model.startsWith("deepseek/") || model.startsWith("deepseek-");
}

function structuredResponseFormat(
  modelRef: Pick<ModelRef, "provider" | "model">,
  name: string,
  schema: unknown
): NonNullable<GenerateOptions["response_format"]> {
  if (!supportsStrictJsonSchema(modelRef)) return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: { name, strict: true, schema },
  };
}

function seatSelectionResponseFormat(
  modelRef: Pick<ModelRef, "provider" | "model">,
  name: string,
  validSeats: number[],
  options?: { allowAbstain?: boolean }
): NonNullable<GenerateOptions["response_format"]> {
  // 夜間行動（查验/出刀/守護）與白天放逐投票一樣帶 reason：留一句思路供日誌除錯與賽後復盤。
  const withReason = ["day_vote", "seer_action", "wolf_action", "guard_action", "badge_vote"].includes(name);
  // 空守（守衛可選擇不守護任何人）以「0」表示：顯示坐位從 1 起算，0 不會與真實坐位衝突，
  // 且留在 enum 內可讓 strict json_schema 繼續通過驗證。
  const seatEnum = options?.allowAbstain
    ? [0, ...validSeats.map((seat) => seat + 1)]
    : validSeats.map((seat) => seat + 1);
  return structuredResponseFormat(modelRef, name, {
    type: "object",
    properties: {
      seat: {
        type: "integer",
        enum: seatEnum,
      },
      ...(withReason ? { reason: { type: "string" } } : {}),
    },
    required: withReason ? ["seat", "reason"] : ["seat"],
    additionalProperties: false,
  });
}

type ParseAttempt<T> = { ok: true; value: T } | { ok: false };

type ParsedCompletion<T> = {
  result: { content: string; raw: ChatCompletionResponse };
  cleaned: string;
  parsed: T | null;
  attempts: number;
};

function parseOk<T>(value: T): ParseAttempt<T> {
  return { ok: true, value };
}

function parseFail(): ParseAttempt<never> {
  return { ok: false };
}

async function generateCompletionAndParse<T>(
  options: GenerateOptions,
  parse: (cleaned: string) => ParseAttempt<T>
): Promise<ParsedCompletion<T>> {
  const result = await generateCompletion(options);
  const cleaned = stripMarkdownCodeFences(result.content).trim();
  const parsed = parse(cleaned);
  return {
    result,
    cleaned,
    parsed: parsed.ok ? parsed.value : null,
    attempts: 1,
  };
}

/**
 * 使用 SUMMARY_MODEL 批量判断玩家是否上警。
 * 每个 request 都是对应玩家独立的 DAY_BADGE_SIGNUP Prompt，批量只复用 HTTP 请求。
 */
export async function generateAIBadgeSignupBatch(
  state: GameState,
  players: Player[]
): Promise<Record<string, boolean>> {
  if (!players || players.length === 0) return {};

  // 報不報名是角色行為：用該角色自己的模型，跟發言／投票／夜間行動同一把尺。
  // 只有角色缺少 agentProfile（例如測試夾具）時才退回摘要模型，並留下紀錄，不靜默。
  const resolveSignupModelRef = (player: Player): ModelRef => {
    const ref = player.agentProfile?.modelRef;
    if (ref) return ref;
    console.warn(
      "[badge_signup] 角色缺少 agentProfile.modelRef，暫用摘要模型",
      { playerId: player.playerId, seat: player.seat + 1 }
    );
    return getModelRefForModel(getSummaryModel());
  };
  const requests = players.map((player) => {
    const modelRef = resolveSignupModelRef(player);
    const model = modelRef.model;
    const prompt = resolvePhasePrompt("DAY_BADGE_SIGNUP", state, player);
    const { messages } = buildMessagesForPrompt(prompt);
    return {
      player,
      model,
      messages,
      request: {
        model,
        messages,
        promptScope: "gameplay" as const,
        temperature: GAME_TEMPERATURE.BADGE_SIGNUP,
        response_format: structuredResponseFormat(modelRef, "badge_signup", {
          type: "object",
          properties: { signup: { type: "boolean" }, reason: { type: "string" } },
          required: ["signup", "reason"],
          additionalProperties: false,
        }),
      },
    };
  });
  const parsedByPlayer: Record<string, boolean> = Object.fromEntries(
    players.map((player) => [player.playerId, false])
  );
  const startTime = Date.now();

  const parseBadgeSignupDecision = (content: string): { signup: boolean; reason: string } | null => {
    const cleaned = stripMarkdownCodeFences(String(content ?? "")).trim();
    const parsed = parseLLMJson<{ signup?: unknown; reason?: unknown }>(cleaned);
    if (typeof parsed?.signup !== "boolean") return null;
    return {
      signup: parsed.signup,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  };

  try {
    const results = await generateCompletionBatch(requests.map(({ request }) => request));
    await Promise.all(
      requests.map(async ({ player, model, messages }, index) => {
        const result = results[index];
        const decision = result?.ok ? parseBadgeSignupDecision(result.content) : null;
        if (decision !== null) parsedByPlayer[player.playerId] = decision.signup;

        await aiLogger.log({
          type: "badge_signup",
          request: {
            model,
            messages,
            player: {
              playerId: player.playerId,
              displayName: player.displayName,
              seat: player.seat,
              role: player.role,
            },
          },
          response: result?.ok
            ? {
                content: result.content,
                raw: result.raw.choices?.[0]?.message?.content,
                rawResponse: JSON.stringify(result.raw, null, 2),
                finishReason: result.raw.choices?.[0]?.finish_reason,
                parsed: { signup: decision?.signup ?? false, reason: decision?.reason ?? "" },
                duration: Date.now() - startTime,
              }
            : {
                content: "",
                parsed: { signup: false, reason: "" },
                duration: Date.now() - startTime,
              },
          ...(!result?.ok
            ? { error: result?.error ?? "Missing batch response" }
            : decision === null
              ? { error: "Invalid badge signup response: expected boolean schema" }
              : {}),
        });
      })
    );
  } catch (error) {
    await Promise.all(
      requests.map(({ player, model, messages }) =>
        aiLogger.log({
          type: "badge_signup",
          request: {
            model,
            messages,
            player: {
              playerId: player.playerId,
              displayName: player.displayName,
              seat: player.seat,
              role: player.role,
            },
          },
          response: {
            content: "",
            parsed: { signup: false, reason: "" },
            duration: Date.now() - startTime,
          },
          error: String(error),
        })
      )
    );
  }

  return parsedByPlayer;
}

/** 警徽投票的 prompt 與請求參數；暖機與正式請求共用。 */
function planBadgeVoteRequest(
  state: GameState,
  player: Player
): { messages: LLMMessage[]; validSeats: number[]; options: GenerateOptions } | null {
  const prompt = resolvePhasePrompt("DAY_BADGE_ELECTION", state, player);
  const candidates = Array.isArray(state.badge?.candidates) ? state.badge.candidates : [];
  const alivePlayers = state.players
    .filter((p) => p.alive && p.playerId !== player.playerId)
    .filter((p) => (candidates.length > 0 ? candidates.includes(p.seat) : true));
  const { messages } = buildMessagesForPrompt(prompt);
  const validSeats = alivePlayers.map((p) => p.seat);
  if (validSeats.length === 0) return null;

  return {
    messages,
    validSeats,
    options: mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
      model: player.agentProfile!.modelRef.model,
      messages,
      promptScope: "gameplay",
      temperature: GAME_TEMPERATURE.ACTION,
      response_format: seatSelectionResponseFormat(player.agentProfile!.modelRef, "badge_vote", validSeats),
    }),
  };
}

export async function generateAIBadgeVote(
  state: GameState,
  player: Player
): Promise<number> {
  const plan = planBadgeVoteRequest(state, player);
  const startTime = Date.now();
  // 警徽投票也要 reason：與放逐投票同一把尺，供覆盤「警徽票為什麼這樣投」。
  let parsedReason = "";
  if (!plan) return BADGE_VOTE_ABSTAIN;
  const { messages, validSeats, options } = plan;

  try {
    const completion = await generateCompletionAndParse<number>(
      options,
      (cleaned) => {
        const parsedObject = parseLLMJson<{ reason?: unknown }>(cleaned);
        parsedReason = typeof parsedObject?.reason === "string" ? parsedObject.reason : "";
        const parsedSeat = parseLLMDisplaySeat(cleaned, validSeats, ["seat", "targetSeat", "target", "vote"]);
        return parsedSeat === null ? parseFail() : parseOk(parsedSeat);
      }
    );
    const parsedSeat = completion.parsed ?? BADGE_VOTE_ABSTAIN;

    await aiLogger.log({
      type: "badge_vote",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: { targetSeat: parsedSeat, reason: parsedReason, attempts: completion.attempts },
        duration: Date.now() - startTime,
      },
    });

    return parsedSeat;
  } catch (error) {
    // Network/API error: treat as abstain so the phase does not get stuck
    console.warn("[wolfcha] generateAIBadgeVote failed, treating as abstain:", error);
    await aiLogger.log({
      type: "badge_vote",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: { content: "", duration: Date.now() - startTime },
      error: String(error),
    });
    return BADGE_VOTE_ABSTAIN;
  }
}

export async function generateBadgeTransfer(
  state: GameState,
  player: Player
): Promise<number> {
  const prompt = resolvePhasePrompt("BADGE_TRANSFER", state, player);
  const alivePlayers = state.players.filter(
    (p) => p.alive && p.playerId !== player.playerId
  );
  const confirmedWolfSeats = new Set(
    (state.nightActions.seerHistory || [])
      .filter((x) => x && x.isWolf)
      .map((x) => x.targetSeat)
  );
  const startTime = Date.now();
  // 關鍵決策：上游逾時會自動重試一次；這裡記錄實際發出幾次請求，寫進 log 分辨「逾時」與「AI 自己的選擇」。
  let attempts = 0;
  // 給徽要有理由：模型回傳的 reason 一併記進 log（跟 wolf_action/vote 同一把尺）。
  let parsedReason = "";
  const { messages } = buildMessagesForPrompt(prompt);
  const validSeats = alivePlayers.map((p) => p.seat);

  try {
    const pickSafeSeat = (): number => {
      if (player.alignment === "village" && player.role === "Seer" && confirmedWolfSeats.size > 0) {
        const safeSeat = firstSeat(validSeats.filter((s) => !confirmedWolfSeats.has(s)));
        return safeSeat ?? BADGE_TRANSFER_TORN;
      }

      return BADGE_TRANSFER_TORN;
    };

    const completion = await withCriticalRetry(
      "badge_transfer",
      async () => {
        attempts += 1;
        return await generateCompletionAndParse(
          mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
            model: player.agentProfile!.modelRef.model,
            messages,
            promptScope: "gameplay",
            temperature: GAME_TEMPERATURE.ACTION,
            response_format: { type: "json_object" },
          }),
          (cleaned) => {
            const parsedTransfer = parseLLMJson<{ seat?: unknown; targetSeat?: unknown; target?: unknown; transfer?: unknown; action?: unknown; reason?: unknown }>(cleaned);
            if (!parsedTransfer || typeof parsedTransfer !== "object" || Array.isArray(parsedTransfer)) return parseFail();

            parsedReason = typeof parsedTransfer.reason === "string" ? parsedTransfer.reason : "";
            const action = String(parsedTransfer.action ?? "").toLowerCase();
            const rawSeat = parsedTransfer.seat ?? parsedTransfer.targetSeat ?? parsedTransfer.target ?? parsedTransfer.transfer;
            const wantsTear =
              action.includes("tear") ||
              action.includes("destroy") ||
              action.includes("撕") ||
              rawSeat === 0 ||
              rawSeat === "0";
            if (wantsTear) return parseOk(BADGE_TRANSFER_TORN);

            const parsedSeat = parseLLMDisplaySeat(cleaned, validSeats, ["seat", "targetSeat", "target", "transfer"]);
            if (parsedSeat === null) return parseFail();
            if (player.alignment === "village" && player.role === "Seer" && confirmedWolfSeats.has(parsedSeat)) {
              return parseOk(pickSafeSeat());
            }
            return parseOk(parsedSeat);
          }
        );
      },
    );

    const parsedSeat = completion.parsed ?? BADGE_TRANSFER_TORN;

    await aiLogger.log({
      type: "badge_transfer",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: { targetSeat: parsedSeat, reason: parsedReason },
        attempts,
        duration: Date.now() - startTime,
      }
    });

    return parsedSeat;
  } catch (error) {
    console.warn("[wolfcha] generateBadgeTransfer failed, tearing badge:", error);
    await aiLogger.log({
      type: "badge_transfer",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: "",
        parsed: { targetSeat: BADGE_TRANSFER_TORN },
        attempts,
        duration: Date.now() - startTime,
        failure: isUpstreamTimeoutError(error) ? "upstream_timeout" : "error",
      },
      error: String(error),
    });
    return BADGE_TRANSFER_TORN;
  }
}

// 從夜間行動的 cleaned JSON 抽出 reason 一句話（僅供日誌；非字串或缺失回空字串，不影響行動本身）。
function extractActionReason(cleaned: string): string {
  try {
    const parsed = JSON.parse(cleaned) as { reason?: unknown };
    return typeof parsed?.reason === "string" ? parsed.reason.trim().slice(0, 200) : "";
  } catch {
    return "";
  }
}

// 從 cleaned JSON 抽出指定字串欄位（僅供日誌／自爆宣言；非字串或缺失回空字串，不影響行動本身）。
function extractJsonTextField(cleaned: string, field: string, maxLen = 200): string {
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const value = parsed?.[field];
    return typeof value === "string" ? value.trim().slice(0, maxLen) : "";
  } catch {
    return "";
  }
}

/** 單人夜間行動結果：座位＋本人寫下的理由（理由只進本人賽後感言，賽中不公開）。 */
export interface NightActionOutcome {
  targetSeat: number;
  reason: string;
}

export async function generateSeerAction(
  state: GameState,
  player: Player
): Promise<NightActionOutcome | undefined> {
  const prompt = resolvePhasePrompt("NIGHT_SEER_ACTION", state, player);
  const alivePlayers = state.players.filter(
    (p) => p.alive && p.playerId !== player.playerId
  );
  const startTime = Date.now();
  // 關鍵決策：上游逾時會自動重試一次；這裡記錄實際發出幾次請求，寫進 log 分辨「逾時」與「AI 自己的選擇」。
  let attempts = 0;
  const { messages } = buildMessagesForPrompt(prompt);
  const validSeats = alivePlayers.map((p) => p.seat);

  if (validSeats.length === 0) return undefined;

  try {
    const completion = await withCriticalRetry(
      "seer_action",
      async () => {
        attempts += 1;
        return await generateCompletionAndParse(
          mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
            model: player.agentProfile!.modelRef.model,
            messages,
            promptScope: "gameplay",
            temperature: GAME_TEMPERATURE.ACTION,
            response_format: seatSelectionResponseFormat(player.agentProfile!.modelRef, "seer_action", validSeats),
          }),
          (cleaned) => {
            const parsedSeat = parseLLMDisplaySeat(cleaned, validSeats, ["seat", "targetSeat", "target", "check"]);
            return parsedSeat === null ? parseFail() : parseOk(parsedSeat);
          }
        );
      },
    );
    const parsedSeat = completion.parsed ?? undefined;

    await aiLogger.log({
      type: "seer_action",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: { targetSeat: parsedSeat, reason: extractActionReason(completion.cleaned) },
        attempts,
        duration: Date.now() - startTime
      },
    });

    return parsedSeat === undefined ? undefined : { targetSeat: parsedSeat, reason: extractActionReason(completion.cleaned) };
  } catch (error) {
    console.warn("[wolfcha] generateSeerAction failed, skipping seer check:", error);
    await aiLogger.log({
      type: "seer_action",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: "",
        parsed: { targetSeat: undefined },
        attempts,
        duration: Date.now() - startTime,
        failure: isUpstreamTimeoutError(error) ? "upstream_timeout" : "error",
      },
      error: String(error),
    });
    return undefined;
  }
}

export async function generateWolfAction(
  state: GameState,
  player: Player,
  existingVotes: Record<string, number> = {}
): Promise<NightActionOutcome | undefined> {
  const prompt = resolvePhasePrompt("NIGHT_WOLF_ACTION", state, player, { existingVotes });
  const alivePlayers = state.players.filter((p) => p.alive);
  const startTime = Date.now();
  // 關鍵決策：上游逾時會自動重試一次；這裡記錄實際發出幾次請求，寫進 log 分辨「逾時」與「AI 自己的選擇」。
  let attempts = 0;
  const { messages } = buildMessagesForPrompt(prompt);
  const validSeats = alivePlayers.map((p) => p.seat);

  try {
    const completion = await withCriticalRetry(
      "wolf_action",
      async () => {
        attempts += 1;
        return await generateCompletionAndParse(
          mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
            model: player.agentProfile!.modelRef.model,
            messages,
            promptScope: "gameplay",
            temperature: GAME_TEMPERATURE.ACTION,
            response_format: seatSelectionResponseFormat(player.agentProfile!.modelRef, "wolf_action", validSeats),
          }),
          (cleaned) => {
            const parsedSeat = parseLLMDisplaySeat(cleaned, validSeats, ["seat", "targetSeat", "target", "kill"]);
            return parsedSeat === null ? parseFail() : parseOk(parsedSeat);
          }
        );
      },
    );
    const parsedSeat = completion.parsed ?? undefined;

    await aiLogger.log({
      type: "wolf_action",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: { targetSeat: parsedSeat, reason: extractActionReason(completion.cleaned) },
        attempts,
        duration: Date.now() - startTime
      },
    });

    return parsedSeat === undefined ? undefined : { targetSeat: parsedSeat, reason: extractActionReason(completion.cleaned) };
  } catch (error) {
    console.warn("[wolfcha] generateWolfAction failed, skipping wolf kill:", error);
    await aiLogger.log({
      type: "wolf_action",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: "",
        parsed: { targetSeat: undefined },
        attempts,
        duration: Date.now() - startTime,
        failure: isUpstreamTimeoutError(error) ? "upstream_timeout" : "error",
      },
      error: String(error),
    });
    return undefined;
  }
}

/** 主導狼計畫的原始模型輸出（未驗證）。 */
export type RawWolfTeamPlan = {
  jumpSeat?: unknown;
  signupSeats?: unknown;
  postures?: unknown;
  reason?: unknown;
};

export interface WolfTeamPlanInput {
  /** 存活狼座位（0 基）。 */
  wolfSeats: number[];
  /** 真人狼座位（0 基）——不可被指定悍跳。 */
  humanSeats: number[];
  captainSeat: number;
  day: number;
}

/**
 * 驗證並標準化主導狼計畫：座位一律轉回 0 基索引。
 * - jumpSeat 限制在存活 AI 狼内；0 或非法值＝本局不跳
 * - signupSeats 限定存活狼；悍跳者必上警（系統自動補上）
 * - postures 代碼白名單外的降為 deep；非悍跳者卻領 jump 的重映射
 * - 無存活狼時回傳 null（無從商定）
 */
export function normalizeWolfTeamPlan(
  raw: RawWolfTeamPlan,
  input: WolfTeamPlanInput
): WolfTeamPlan | null {
  const validSeats = new Set(input.wolfSeats);
  const humanSeats = new Set(input.humanSeats);
  if (validSeats.size === 0) return null;

  const rawJump = Number(raw.jumpSeat ?? 0);
  const jumpSeat =
    Number.isInteger(rawJump) &&
    rawJump - 1 >= 0 &&
    validSeats.has(rawJump - 1) &&
    !humanSeats.has(rawJump - 1)
      ? rawJump - 1
      : null;

  const signupSeats = Array.isArray(raw.signupSeats)
    ? [
        ...new Set(
          raw.signupSeats
            .map((s) => Number(s))
            .filter((s) => Number.isInteger(s) && validSeats.has(s - 1))
            .map((s) => s - 1),
        ),
      ]
    : [];
  if (jumpSeat !== null && !signupSeats.includes(jumpSeat)) {
    signupSeats.push(jumpSeat);
  }

  const allowed = new Set<string>(["jump", "charge", "hook", "deep"]);
  const rawPostures =
    typeof raw.postures === "object" && raw.postures !== null
      ? (raw.postures as Record<string, unknown>)
      : {};
  const postures: WolfTeamPlan["postures"] = {};
  for (const seat of input.wolfSeats) {
    const code = rawPostures[String(seat + 1)];
    const normalized: WolfTeamPlan["postures"][string] =
      typeof code === "string" && allowed.has(code) ? (code as WolfTeamPlan["postures"][string]) : "deep";
    postures[String(seat)] = normalized;
  }
  if (jumpSeat !== null) {
    for (const [key, code] of Object.entries(postures)) {
      if (code === "jump" && Number(key) !== jumpSeat) postures[key] = "charge";
    }
  } else {
    for (const [key, code] of Object.entries(postures)) {
      if (code === "jump") postures[key] = "deep";
    }
  }

  const reason =
    typeof raw.reason === "string" ? raw.reason.trim().slice(0, 120) : "";

  return {
    captainSeat: input.captainSeat,
    jumpSeat,
    signupSeats,
    postures,
    reason,
    day: input.day,
  };
}

/**
 * 狼隊夜間商議（第一夜）：隨機挑一隻 AI 狼當主導狼，商定白天分工
 * （誰悍跳、誰上警、誰衝鋒/倒勾/潛伏）。計畫不編假查殺脚本——
 * 查殺對象與警徽流由悍跳者臨場自己定，與真人局一致。
 * 失敗或無 AI 狼時回傳 null：全場照舊無協調，不攝錯——協調是增強，不是必要步驟。
 */
/**
 * 狼隊夜間商議的 prompt 組裝（純函式：可單獨驗證共用前綴與人設綁定）。
 * 與其他階段一致：system 只放全桌同文的陣容／規則／攻略；身分＋角色設定＋商議任務進 user。
 */
export function buildWolfTeamPlanPrompt(state: GameState, captain: Player): PromptResult {
  const { t } = getI18n();
  const aliveWolves = state.players.filter((p) => isWolfRole(p.role) && p.alive);
  const teammates = aliveWolves
    .map((wolf) => t("promptUtils.gameContext.seatName", {
      seat: wolf.seat + 1,
      name: wolf.displayName,
    }))
    .join(t("promptUtils.gameContext.listSeparator"));
  const humanWolves = aliveWolves.filter((p) => p.isHuman);
  const humanNote =
    humanWolves.length > 0
      ? t("prompts.night.wolfTeamPlan.humanNote", {
          seats: humanWolves.map((p) => p.seat + 1).join("、"),
        })
      : "";
  const knifeTarget =
    state.nightActions.wolfTarget !== undefined
      ? state.players.find((p) => p.seat === state.nightActions.wolfTarget)
      : undefined;
  const knifeLine = knifeTarget
    ? t("prompts.night.wolfTeamPlan.knifeLine", {
        seat: knifeTarget.seat + 1,
        name: knifeTarget.displayName,
      })
    : t("prompts.night.wolfTeamPlan.knifeLineNone");
  // 範例填真實座位、postures 輪換展示四種代碼；悍跳與否由主導狼自己定。
  const postureCodes = ["jump", "charge", "hook", "deep"] as const;
  const jsonFormat = JSON.stringify({
    jumpSeat: aliveWolves[0].seat + 1,
    signupSeats: aliveWolves.map((wolf) => wolf.seat + 1),
    postures: Object.fromEntries(
      aliveWolves.map((wolf, index) => [
        String(wolf.seat + 1),
        postureCodes[index % postureCodes.length],
      ])
    ),
    reason: t("promptUtils.gameContext.jsonReasonWolfPlan"),
  });

  const base = bindIdentityAndRoleSetting(
    t("prompts.night.wolfTeamPlan.base", {
      seat: captain.seat + 1,
      name: captain.displayName,
      role: getRoleText(captain.role),
      coreRules: "",
      teammates,
    }),
    captain,
    !!state.isGenshinMode
  );
  const intro = t("prompts.night.wolfTeamPlan.intro");
  const knowledge = t("prompts.night.wolfTeamPlan.knowledge");
  const task = t("prompts.night.wolfTeamPlan.task", { knifeLine, jsonFormat });
  // 與其他 prompt 一致的開場：本次陣容 → 規則 → 攻略（全桌同文，可快取）。
  // 狼隊商議要決定悍跳／上警分工，攻略（狼隊協作、夜間出刀、警徽）必須看得到。
  // system 只放全桌逐字相同的共用開場（陣容／規則／攻略）；身分與商議任務逐人不同，進 user。
  const systemParts = [...buildSharedSystemParts(state)];
  const system = buildSystemTextFromParts(systemParts);
  const user = t("prompts.night.wolfTeamPlan.user", {
    context: [buildGameContext(state, captain), base, intro, knowledge, task].filter(Boolean).join("\n\n"),
    humanNote,
    jsonFormat,
  });
  return { system, user, systemParts, historyUser: buildPastDaysTranscript(state) };
}

export async function generateWolfTeamPlan(
  state: GameState
): Promise<WolfTeamPlan | null> {
  const aliveWolves = state.players.filter((p) => isWolfRole(p.role) && p.alive);
  const aiWolves = aliveWolves.filter((p) => !p.isHuman);
  if (aiWolves.length === 0) return null;
  const captain = aiWolves[Math.floor(Math.random() * aiWolves.length)];

  const humanWolves = aliveWolves.filter((p) => p.isHuman);
  const { messages } = buildMessagesForPrompt(buildWolfTeamPlanPrompt(state, captain));

  const validSeats = aliveWolves.map((wolf) => wolf.seat + 1);
  const startTime = Date.now();
  let attempts = 0;

  try {
    const completion = await withCriticalRetry(
      "wolf_team_plan",
      async () => {
        attempts += 1;
        return await generateCompletionAndParse(
          mergeOptionsFromModelRef(captain.agentProfile!.modelRef, {
            model: captain.agentProfile!.modelRef.model,
            messages,
            promptScope: "gameplay",
            temperature: GAME_TEMPERATURE.BADGE_SIGNUP,
            response_format: structuredResponseFormat(
              captain.agentProfile!.modelRef,
              "wolf_team_plan",
              {
                type: "object",
                properties: {
                  jumpSeat: { type: "integer", enum: [0, ...validSeats] },
                  signupSeats: {
                    type: "array",
                    items: { type: "integer", enum: validSeats },
                  },
                  postures: {
                    type: "object",
                    properties: Object.fromEntries(
                      validSeats.map((seat) => [
                        String(seat),
                        { type: "string", enum: ["jump", "charge", "hook", "deep"] },
                      ])
                    ),
                    required: validSeats.map(String),
                    additionalProperties: false,
                  },
                  reason: { type: "string" },
                },
                required: ["jumpSeat", "signupSeats", "postures", "reason"],
                additionalProperties: false,
              }
            ),
          }),
          (cleaned) => {
            const raw = parseLLMJson<RawWolfTeamPlan>(cleaned);
            if (!raw) return parseFail();
            const plan = normalizeWolfTeamPlan(raw, {
              wolfSeats: aliveWolves.map((wolf) => wolf.seat),
              humanSeats: humanWolves.map((wolf) => wolf.seat),
              captainSeat: captain.seat,
              day: state.day,
            });
            return plan ? parseOk(plan) : parseFail();
          }
        );
      }
    );
    const plan = completion.parsed;

    await aiLogger.log({
      type: "wolf_chat",
      request: {
        model: captain.agentProfile!.modelRef.model,
        messages,
        player: {
          playerId: captain.playerId,
          displayName: captain.displayName,
          seat: captain.seat,
          role: captain.role,
        },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: plan,
        attempts,
        duration: Date.now() - startTime,
      },
    });

    return plan;
  } catch (error) {
    console.warn("[wolfcha] generateWolfTeamPlan failed, wolves stay uncoordinated:", error);
    await aiLogger.log({
      type: "wolf_chat",
      request: {
        model: captain.agentProfile!.modelRef.model,
        messages,
        player: {
          playerId: captain.playerId,
          displayName: captain.displayName,
          seat: captain.seat,
          role: captain.role,
        },
      },
      response: {
        content: "",
        parsed: null,
        attempts,
        duration: Date.now() - startTime,
        failure: isUpstreamTimeoutError(error) ? "upstream_timeout" : "error",
      },
      error: String(error),
    });
    return null;
  }
}

/**
 * 真人狼自己指派的狼隊分工（第一夜）。與 AI 主導狼計畫同一套清洗，
 * 差別只在不再排除真人座位：真人可以指定任何人（含自己）悍跳。
 * 無存活真人狼或無存活狼時回傳 null。
 */
export interface HumanWolfTeamPlanChoice {
  /** 悍跳者座位（1 基）；0 或 null＝本局不跳。 */
  jumpSeat?: number | null;
  /** 上警的狼座位（1 基）；悍跳者由 normalizeWolfTeamPlan 自動補上。 */
  signupSeats?: number[];
  /** 各狼分工代碼，鍵為 1 基座位字串。 */
  postures?: Record<string, unknown>;
  /** 真人講給隊友聽的一句話計畫意圖。 */
  reason?: string;
}

export function buildHumanWolfTeamPlan(
  state: GameState,
  choice: HumanWolfTeamPlanChoice
): WolfTeamPlan | null {
  const aliveWolves = state.players.filter((p) => isWolfRole(p.role) && p.alive);
  const humanWolf = aliveWolves.find((p) => p.isHuman);
  if (!humanWolf) return null;
  return normalizeWolfTeamPlan(
    {
      jumpSeat: choice.jumpSeat ?? 0,
      signupSeats: choice.signupSeats ?? [],
      postures: choice.postures ?? {},
      reason: choice.reason ?? "",
    },
    {
      wolfSeats: aliveWolves.map((wolf) => wolf.seat),
      humanSeats: [],
      captainSeat: humanWolf.seat,
      day: state.day,
    }
  );
}

/**
 * 真人狼還欠第一夜夜間輸入嗎：
 * - 還沒選刀口
 * - 第一夜還沒指派狼隊分工（沒指派就進白天，狼隊只能各自為戰）
 * 交還 AI 主導狼（wolfTeamPlanDelegated）或該局無存活真人狼時都不再擋。
 * NightPhase 的夜間流程與前端對話框共用這個判斷，兩邊必須一致才不會互等卡死。
 */
export function humanWolfNeedsNightInput(state: GameState): boolean {
  const humanWolf = state.players.find((p) => isWolfRole(p.role) && p.alive && p.isHuman);
  if (!humanWolf) return false;
  if (state.nightActions.wolfTarget === undefined) return true;
  return state.day === 1 && !state.wolfTeamPlan && !state.wolfTeamPlanDelegated;
}

export type WitchAction =
  | { type: "save"; reason?: string }
  | { type: "poison"; target: number; reason?: string }
  | { type: "pass"; reason?: string };

export async function generateWitchAction(
  state: GameState,
  player: Player,
  wolfTarget: number | undefined
): Promise<WitchAction> {
  const prompt = resolvePhasePrompt("NIGHT_WITCH_ACTION", state, player, { wolfTarget });
  const startTime = Date.now();
  // 關鍵決策：上游逾時會自動重試一次；這裡記錄實際發出幾次請求，寫進 log 分辨「逾時」與「AI 自己的選擇」。
  let attempts = 0;
  const { messages } = buildMessagesForPrompt(prompt);
  const canSave = canWitchSave({
    healUsed: state.roleAbilities.witchHealUsed,
    witchSeat: player.seat,
    wolfTarget,
    flags: getBoardRuleFlags(state.players.length),
  });
  const canPoison = !state.roleAbilities.witchPoisonUsed;
  const validPoisonSeats = state.players
    .filter((p) => p.alive && p.playerId !== player.playerId)
    .map((p) => p.seat);
  const passAction: WitchAction = { type: "pass" };

  try {
    const completion = await withCriticalRetry(
      "witch_action",
      async () => {
        attempts += 1;
        return await generateCompletionAndParse<WitchAction>(
          mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
            model: player.agentProfile!.modelRef.model,
            messages,
            promptScope: "gameplay",
            temperature: GAME_TEMPERATURE.ACTION,
            response_format: { type: "json_object" },
          }),
          (cleaned) => {
            const parsed = parseLLMJson<unknown>(cleaned);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parseFail();

            const record = parsed as Record<string, unknown>;
            const action = String(record.action ?? record.type ?? "").trim().toLowerCase();
            const seatValue = record.seat ?? record.targetSeat ?? record.target ?? record.poison;
            const wantsPass =
              action.includes("pass") ||
              action.includes("skip") ||
              action.includes("none") ||
              seatValue === null ||
              seatValue === 0 ||
              seatValue === "0";

            if (wantsPass) return parseOk(passAction);
            if (action === "save" || action === "heal") {
              return canSave ? parseOk({ type: "save" }) : parseFail();
            }
            if (action === "poison") {
              if (!canPoison) return parseFail();
              const target = parseLLMDisplaySeat(cleaned, validPoisonSeats, ["seat", "targetSeat", "target", "poison"]);
              return target === null ? parseFail() : parseOk({ type: "poison", target });
            }

            return parseFail();
          }
        );
      },
    );
    const baseAction = completion.parsed ?? passAction;
    const actionReason = extractActionReason(completion.cleaned);
    const parsedAction: WitchAction =
      baseAction.type === "poison"
        ? { type: "poison", target: baseAction.target, reason: actionReason }
        : { type: baseAction.type, reason: actionReason };

    await aiLogger.log({
      type: "witch_action",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: { ...parsedAction, attempts: completion.attempts, reason: actionReason },
        attempts,
        duration: Date.now() - startTime,
      },
    });

    return parsedAction;
  } catch (error) {
    console.warn("[wolfcha] generateWitchAction failed, passing witch action:", error);
    await aiLogger.log({
      type: "witch_action",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: "",
        parsed: passAction,
        attempts,
        duration: Date.now() - startTime,
        failure: isUpstreamTimeoutError(error) ? "upstream_timeout" : "error",
      },
      error: String(error),
    });
    return passAction;
  }
}

// ...

export async function generateGuardAction(
  state: GameState,
  player: Player
): Promise<NightActionOutcome | undefined> {
  const prompt = resolvePhasePrompt("NIGHT_GUARD_ACTION", state, player);
  const flags = getBoardRuleFlags(state.players.length);
  const lastTarget = state.nightActions.lastGuardTarget;
  const eligibleSeats = getGuardEligibleSeats({
    aliveSeats: state.players.filter((p) => p.alive).map((p) => p.seat),
    lastGuardTarget: lastTarget,
    flags,
  });
  const alivePlayers = state.players.filter((p) => eligibleSeats.includes(p.seat));
  const startTime = Date.now();
  // 關鍵決策：上游逾時會自動重試一次；這裡記錄實際發出幾次請求，寫進 log 分辨「逾時」與「AI 自己的選擇」。
  let attempts = 0;
  const { messages } = buildMessagesForPrompt(prompt);
  const validSeats = alivePlayers.map((p) => p.seat);

  if (validSeats.length === 0 && !flags.guardCanAbstain) return undefined;

  try {
    const completion = await withCriticalRetry(
      "guard_action",
      async () => {
        attempts += 1;
        return await generateCompletionAndParse(
          mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
            model: player.agentProfile!.modelRef.model,
            messages,
            promptScope: "gameplay",
            temperature: GAME_TEMPERATURE.ACTION,
            response_format: seatSelectionResponseFormat(player.agentProfile!.modelRef, "guard_action", validSeats, {
              allowAbstain: flags.guardCanAbstain,
            }),
          }),
          (cleaned) => {
            // 空守：允許明確回報 abstain／seat:null／seat:0（規則見 RuleFlags.guardCanAbstain）
            if (flags.guardCanAbstain && isGuardAbstainResponse(cleaned)) {
              return parseOk(undefined);
            }
            const parsedSeat = parseLLMDisplaySeat(cleaned, validSeats, ["seat", "targetSeat", "target", "protect"]);
            return parsedSeat === null ? parseFail() : parseOk(parsedSeat);
          }
        );
      },
    );
    const parsedSeat = completion.parsed ?? undefined;

    await aiLogger.log({
      type: "guard_action",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: {
          targetSeat: parsedSeat ?? null,
          abstain: parsedSeat === undefined,
          reason: extractActionReason(completion.cleaned),
        },
        attempts,
        duration: Date.now() - startTime,
      },
    });

    return parsedSeat === undefined ? undefined : { targetSeat: parsedSeat, reason: extractActionReason(completion.cleaned) };
  } catch (error) {
    console.warn("[wolfcha] generateGuardAction failed, skipping guard protection:", error);
    await aiLogger.log({
      type: "guard_action",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: "",
        parsed: { targetSeat: undefined },
        attempts,
        duration: Date.now() - startTime,
        failure: isUpstreamTimeoutError(error) ? "upstream_timeout" : "error",
      },
      error: String(error),
    });
    return undefined;
  }
}

// ...

/**
 * 禁言長老的夜間行動：指定明天不能發言的人。
 *
 * 只能選存活玩家、不能選自己（見 lib/rules/mute.ts）；禁言只限制發言，
 * 警徽競選投票、放逐投票與遺言都不受限。
 */
export async function generateMuteAction(
  state: GameState,
  player: Player
): Promise<NightActionOutcome | undefined> {
  const prompt = resolvePhasePrompt("NIGHT_MUTE_ACTION", state, player);
  const eligibleSeats = getMuteEligibleSeats(state, player.seat);
  const eligiblePlayers = state.players.filter((p) => eligibleSeats.includes(p.seat));
  const startTime = Date.now();
  let attempts = 0;
  const { messages } = buildMessagesForPrompt(prompt);
  const validSeats = eligiblePlayers.map((p) => p.seat);

  if (validSeats.length === 0) return undefined;

  try {
    const completion = await withCriticalRetry(
      "mute_action",
      async () => {
        attempts += 1;
        return await generateCompletionAndParse<number>(
          mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
            model: player.agentProfile!.modelRef.model,
            messages,
            promptScope: "gameplay",
            temperature: GAME_TEMPERATURE.ACTION,
            response_format: seatSelectionResponseFormat(player.agentProfile!.modelRef, "mute_action", validSeats),
          }),
          (cleaned) => {
            const parsedSeat = parseLLMDisplaySeat(cleaned, validSeats, ["seat", "targetSeat", "target", "mute", "silence"]);
            return parsedSeat === null ? parseFail() : parseOk(parsedSeat);
          }
        );
      },
    );
    const parsedSeat = completion.parsed ?? undefined;
    await aiLogger.log({
      type: "mute_action",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: { targetSeat: parsedSeat, attempts: completion.attempts },
        attempts,
        duration: Date.now() - startTime,
      },
    });
    return parsedSeat === undefined ? undefined : { targetSeat: parsedSeat, reason: extractActionReason(completion.cleaned) };
  } catch (error) {
    console.warn("[wolfcha] generateMuteAction failed, skipping silence:", error);
    await aiLogger.log({
      type: "mute_action",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: "",
        parsed: { targetSeat: undefined },
        attempts,
        duration: Date.now() - startTime,
        failure: isUpstreamTimeoutError(error) ? "upstream_timeout" : "error",
      },
      error: String(error),
    });
    return undefined;
  }
}

export async function generateHunterShoot(
  state: GameState,
  player: Player
): Promise<{ targetSeat: number | null; reason: string }> {
  const prompt = resolvePhasePrompt("HUNTER_SHOOT", state, player);
  const alivePlayers = state.players.filter(
    (p) => p.alive && p.playerId !== player.playerId
  );
  const startTime = Date.now();
  // 關鍵決策：上游逾時會自動重試一次；這裡記錄實際發出幾次請求，寫進 log 分辨「逾時」與「AI 自己的選擇」。
  let attempts = 0;
  const { messages } = buildMessagesForPrompt(prompt);
  const validSeats = alivePlayers.map((p) => p.seat);

  try {
    const completion = await withCriticalRetry(
      "hunter_shoot",
      async () => {
        attempts += 1;
        return await generateCompletionAndParse<number | null>(
          mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
            model: player.agentProfile!.modelRef.model,
            messages,
            promptScope: "gameplay",
            temperature: GAME_TEMPERATURE.ACTION,
            response_format: { type: "json_object" },
          }),
          (cleaned) => {
            const parsed = parseLLMJson<{ seat?: unknown; targetSeat?: unknown; target?: unknown; shoot?: unknown; action?: unknown }>(cleaned);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parseFail();

            const action = String(parsed.action ?? "").toLowerCase();
            const rawSeat = parsed.seat ?? parsed.targetSeat ?? parsed.target ?? parsed.shoot;
            const wantsPass =
              action.includes("pass") ||
              action.includes("skip") ||
              action.includes("不开") ||
              rawSeat === null ||
              rawSeat === 0 ||
              rawSeat === "0" ||
              rawSeat === "pass";
            if (wantsPass) return parseOk(null);

            const parsedTarget = parseLLMDisplaySeat(cleaned, validSeats, ["seat", "targetSeat", "target", "shoot"]);
            return parsedTarget === null ? parseFail() : parseOk(parsedTarget);
          }
        );
      },
    );
    const parsedTarget = completion.parsed;
    const shotReason = extractActionReason(completion.cleaned);

    await aiLogger.log({
      type: "hunter_shoot",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: { targetSeat: parsedTarget, reason: shotReason },
        attempts,
        duration: Date.now() - startTime,
      },
    });

    return { targetSeat: parsedTarget, reason: shotReason };
  } catch (error) {
    console.warn("[wolfcha] generateHunterShoot failed, passing hunter shot:", error);
    await aiLogger.log({
      type: "hunter_shoot",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: "",
        parsed: { targetSeat: null, reason: "" },
        attempts,
        duration: Date.now() - startTime,
        failure: isUpstreamTimeoutError(error) ? "upstream_timeout" : "error",
      },
      error: String(error),
    });
    return { targetSeat: null, reason: "" };
  }
}

/** 私有決策理由的種類；賽中從不公開，只在本人賽後感言中還原。 */
export type PrivateActionNoteType =
  | "boom"
  | "shot"
  | "guard"
  | "wolf"
  | "witchSave"
  | "witchPoison"
  | "seer";

/** 單筆私有決策理由（結構化；reason 為行動者當時寫下的一句話）。 */
export interface PrivateActionNote {
  day: number;
  type: PrivateActionNoteType;
  /** 該行動指向的座位（0 基）：自爆／開槍為帶走的人，其餘為用藥、查驗、守人、刀口目標。 */
  targetSeat: number;
  reason: string;
}

/** 私有理由→ i18n key（賽後感言用）。 */
const PRIVATE_ACTION_NOTE_KEYS: Record<PrivateActionNoteType, string> = {
  boom: "specialEvents.remarkPrivateBoom",
  shot: "specialEvents.remarkPrivateShot",
  guard: "specialEvents.remarkPrivateGuard",
  wolf: "specialEvents.remarkPrivateWolf",
  witchSave: "specialEvents.remarkPrivateWitchSave",
  witchPoison: "specialEvents.remarkPrivateWitchPoison",
  seer: "specialEvents.remarkPrivateSeer",
};

/** 私有理由長度上限：避免賽後 prompt 被長句撐爆（與其他 reason 欄位一致）。 */
const PRIVATE_NOTE_REASON_MAX = 120;

/**
 * 蒐集「本人」在賽中寫下的私有決策理由，供賽後感言還原「那一手為什麼這麼做」。
 * 只還原本人參與的行動（夜間行動只有本人知道自己的動機）；人類玩家的行動不記理由，故自然為空。
 */
export function collectPrivateActionNotes(state: GameState, seat: number): PrivateActionNote[] {
  const notes: PrivateActionNote[] = [];
  const push = (day: number, type: PrivateActionNoteType, targetSeat: number | undefined, reason: string | undefined): void => {
    if (targetSeat === undefined || !reason) return;
    const trimmed = reason.trim().slice(0, PRIVATE_NOTE_REASON_MAX);
    if (!trimmed) return;
    notes.push({ day, type, targetSeat, reason: trimmed });
  };
  for (const [dayStr, record] of Object.entries(state.dayHistory ?? {})) {
    const day = Number(dayStr);
    const boom = record.selfDestruct;
    if (boom && boom.boomSeat === seat) push(day, "boom", boom.targetSeat, boom.reason);
    const shot = record.hunterShot;
    if (shot && shot.hunterSeat === seat) push(day, "shot", shot.targetSeat, shot.reason);
  }
  const role = state.players.find((p) => p.seat === seat)?.role;
  for (const [dayStr, record] of Object.entries(state.nightHistory ?? {})) {
    const day = Number(dayStr);
    const shot = record.hunterShot;
    if (shot && shot.hunterSeat === seat) push(day, "shot", shot.targetSeat, shot.reason);
    if (role === "Guard") push(day, "guard", record.guardTarget, record.guardReason);
    if (role && isWolfRole(role)) push(day, "wolf", record.wolfTarget, record.wolfReason);
    if (role === "Witch") {
      // 解藥救的是狼刀目標（存活的那一位），毒藥毒的是自己選的目標。
      push(day, "witchSave", record.wolfTarget, record.witchSaveReason);
      push(day, "witchPoison", record.witchPoison, record.witchPoisonReason);
    }
    if (role === "Seer") push(day, "seer", record.seerTarget, record.seerReason);
  }
  return notes.sort((a, b) => a.day - b.day);
}

/**
 * 赛后感言：游戏结束、全员身份公开后，单个 AI 角色的复盘发言。
 * 赢家点评真神/调侃对方「卧底」，输家吐槽猪队友；失败返回空串（调用方跳过）。
 */
/** 賽後感言＋投票的 JSON 範例；放程式碼而不是 i18n，避免 ICU 把大括號當佔位符。 */
const GAME_END_VOTE_JSON_FORMAT =
  '{"remark":"...","mvpSeat":1,"mvpReason":"...","svpSeat":2,"svpReason":"..."}';

/** 賽後感言＋投票的一次呼叫結果：感言正文與該角色投出的 MVP／SVP 票。 */
export interface GameEndRemarkResult {
  remark: string;
  mvpPlayerId: string | null;
  mvpReason: string;
  svpPlayerId: string | null;
  svpReason: string;
}

export async function generateGameEndRemark(
  state: GameState,
  player: Player,
  winner: Alignment
): Promise<GameEndRemarkResult> {
  const { t } = getI18n();
  const reveal = state.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) =>
      t("specialEvents.remarkRevealLine", {
        seat: p.seat + 1,
        name: p.displayName,
        role: getRoleText(p.role),
        human: p.isHuman ? t("specialEvents.remarkHumanTag") : "",
      })
    )
    .join("\n");
  // 关键事件：用各日总结压缩成赛后盘点素材。封顶放宽到 3200 字，让 5 天以内的逐日摘要完整落进 prompt，
  // 不再出现最后一天被从中间截断的情况。
  const keyEvents = Object.entries(state.dailySummaries ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([day, bullets]) => t("promptUtils.gameContext.gameEndRemarkDaySummary", {
      day,
      bullets: (bullets ?? []).join("；"),
    }))
    .join("\n")
    .slice(0, 3200);
  // 完整逐字发言记录：摘要再详细也是二手转述，逐字记录才是原话；赛后感言要点名具体行为，需要原话。
  const transcript = buildFullGameTranscript(state);
  const transcriptSection = transcript
    ? t("specialEvents.remarkTranscriptTitle") + transcript + "\n\n"
    : "";
  const persona = player.agentProfile?.persona;
  const personaLine = persona?.voiceRules?.length
    ? persona.voiceRules.join(t("promptUtils.gameContext.listSeparator"))
    : "";

  // 私有决策回顾：本人当时写下的决策理由（白狼王自爆／猎人开枪／用药／查验／守人／刀口）。
  // 这些理由赛中从未公开，但赛后全员身份公开，自己的感言可以讲清「那一手为什么这么做」。
  const privateNotes = collectPrivateActionNotes(state, player.seat).map((note) =>
    t(PRIVATE_ACTION_NOTE_KEYS[note.type] as Parameters<typeof t>[0], {
      day: note.day,
      target: note.targetSeat + 1,
      reason: note.reason,
    })
  );
  // 主持人公開記錄：只列客觀結果（出局、放逐、自爆、開槍、翻牌），不帶任何玩家說詞。
  const publicFacts = buildPublicRecordForRemark(state).join("\n").slice(0, 1200);
  const publicFactsSection = publicFacts ? t("specialEvents.remarkPublicFactsTitle") + publicFacts + "\n\n" : "";
  const privateNotesSection = privateNotes.length
    ? "\n\n" + t("specialEvents.remarkPrivateNotes", { notes: privateNotes.join("\n") })
    : "";

  const prompt: PromptResult = {
    // 賽後感言也要知道自己在玩什麼遊戲：基本盤在前，感言指令在後。
    system: [
      getGameFundamentals(),
      t("specialEvents.remarkSystem", {
        seat: player.seat + 1,
        name: player.displayName,
        role: getRoleText(player.role),
        resultLine:
          (player.alignment === "wolf") === (winner === "wolf")
            ? t("specialEvents.remarkResultWin")
            : t("specialEvents.remarkResultLose"),
        jsonFormat: GAME_END_VOTE_JSON_FORMAT,
      }),
    ].join("\n\n"),
    user: t("specialEvents.remarkUser", {
      reveal,
      publicFactsSection,
      keyEvents: keyEvents || t("specialEvents.remarkNoEvents"),
      transcriptSection,
      claimsRule: t("specialEvents.remarkClaimsRule"),
      privateNotes: privateNotesSection,
      personaLine,
    }),
  };
  const { messages } = buildMessagesForPrompt(prompt, false);
  const startTime = Date.now();
  const allSeats = state.players.map((p) => p.seat);

  try {
    const result = await generateCompletion(
      mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
        model: player.agentProfile!.modelRef.model,
        messages,
        promptScope: "gameplay",
        temperature: GAME_TEMPERATURE.SPEECH,
        response_format: structuredResponseFormat(player.agentProfile!.modelRef, "game_end_remark", {
          type: "object",
          properties: {
            remark: { type: "string" },
            mvpSeat: { type: "integer", enum: allSeats.map((s) => s + 1) },
            mvpReason: { type: "string" },
            svpSeat: { type: "integer", enum: allSeats.map((s) => s + 1) },
            svpReason: { type: "string" },
          },
          required: ["remark", "mvpSeat", "mvpReason", "svpSeat", "svpReason"],
          additionalProperties: false,
        }),
      })
    );

    // 模型若不吐 JSON（或吐壞了），仍保留正文當感言，只是這一票作廢。
    const cleaned = stripMarkdownCodeFences(String(result.content ?? "")).trim();
    const parsedRaw = parseLLMJson<Record<string, unknown>>(cleaned);
    const parsed =
      parsedRaw && typeof parsedRaw === "object" && !Array.isArray(parsedRaw) ? parsedRaw : null;
    const rawRemark = parsed && typeof parsed.remark === "string" ? parsed.remark : result.content;
    const remark = sanitizeGameEndRemark(rawRemark).slice(0, 300);

    const mvpSeat = parsed ? parseLLMDisplaySeat(cleaned, allSeats, ["mvpSeat", "mvp"]) : null;
    const svpSeat = parsed ? parseLLMDisplaySeat(cleaned, allSeats, ["svpSeat", "svp"]) : null;
    const mvpReason = parsed ? extractJsonTextField(cleaned, "mvpReason", 80) : "";
    const svpReason = parsed ? extractJsonTextField(cleaned, "svpReason", 80) : "";
    // 不校正投錯邊：模型投誰就記誰，供賽後 UI 顯示與人工評估。
    const mvpPlayerId =
      mvpSeat === null ? null : state.players.find((p) => p.seat === mvpSeat)?.playerId ?? null;
    const svpPlayerId =
      svpSeat === null ? null : state.players.find((p) => p.seat === svpSeat)?.playerId ?? null;

    await aiLogger.log({
      type: "game_end_remark",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: remark,
        raw: result.content,
        rawResponse: JSON.stringify(result.raw, null, 2),
        finishReason: result.raw.choices?.[0]?.finish_reason,
        parsed: { mvpSeat, mvpReason, svpSeat, svpReason },
        duration: Date.now() - startTime,
      },
    });
    return { remark, mvpPlayerId, mvpReason, svpPlayerId, svpReason };
  } catch (error) {
    console.warn("[wolfcha] generateGameEndRemark failed:", player.displayName, error);
    await aiLogger.log({
      type: "game_end_remark",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: { content: "", duration: Date.now() - startTime },
      error: String(error),
    });
    return { remark: "", mvpPlayerId: null, mvpReason: "", svpPlayerId: null, svpReason: "" };
  }
}

/**
 * AI 自爆決策：`boom` 為 true 表示自爆；只有能帶人的角色（白狼王）才會有 `targetSeat`。
 *
 * 自爆沒有宣言、也沒有遺言，因此不再要求模型寫翻桌台詞；普通狼自爆不帶人。
 */
export async function generateSelfDestructDecision(
  state: GameState,
  player: Player,
  options?: { fromSpeech?: SpeechSkillDecision }
): Promise<{ boom: boolean; targetSeat: number | null; reason: string }> {
  // 發言請求已經附帶決定時，直接沿用（不再送第二次完整 context）；只記錄 log。
  if (options?.fromSpeech) {
    const fromSpeech = options.fromSpeech;
    const takesPlayerNow =
      getRoleCapabilities(player.role).boomTakesPlayer &&
      getBoardRuleFlags(state.players.length).boom.takesPlayerRoles.includes(player.role);
    const boom = fromSpeech.action === "use";
    const targetSeat = boom && takesPlayerNow ? fromSpeech.seat : null;
    await aiLogger.log({
      type: "self_destruct_decision",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages: [{ role: "system", content: "[由發言請求附帶的 skill 欄位取得，未另送請求]" }],
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: JSON.stringify({ action: boom ? "boom" : "none", seat: fromSpeech.seat }),
        parsed: { boom, targetSeat, attempts: 0, reason: fromSpeech.reason, source: "speech" },
        attempts: 0,
        duration: 0,
      },
    });
    return { boom, targetSeat, reason: fromSpeech.reason };
  }

  const prompt = resolvePhasePrompt("SELF_DESTRUCT", state, player);
  const takesPlayer = getRoleCapabilities(player.role).boomTakesPlayer;
  const alivePlayers = state.players.filter(
    (p) => p.alive && p.playerId !== player.playerId
  );
  const startTime = Date.now();
  // 關鍵決策：上游逾時會自動重試一次；這裡記錄實際發出幾次請求，寫進 log 分辨「逾時」與「AI 自己的選擇」。
  let attempts = 0;
  const { messages } = buildMessagesForPrompt(prompt);
  const validSeats = alivePlayers.map((p) => p.seat);
  const noBoom = { boom: false, targetSeat: null } as const;

  if (takesPlayer && validSeats.length === 0) return { ...noBoom, reason: "" };

  try {
    const completion = await withCriticalRetry(
      "self_destruct_decision",
      async () => {
        attempts += 1;
        return await generateCompletionAndParse<{ boom: boolean; targetSeat: number | null }>(
          mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
            model: player.agentProfile!.modelRef.model,
            messages,
            promptScope: "gameplay",
            temperature: GAME_TEMPERATURE.ACTION,
            response_format: { type: "json_object" },
          }),
          (cleaned) => {
            const parsed = parseLLMJson<unknown>(cleaned);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parseFail();

            const record = parsed as Record<string, unknown>;
            const action = String(record.action ?? record.type ?? "").trim().toLowerCase();
            const seatValue = record.seat ?? record.targetSeat ?? record.target ?? record.boom;
            const wantsPass =
              action.includes("pass") ||
              action.includes("skip") ||
              action.includes("none") ||
              seatValue === null ||
              seatValue === 0 ||
              seatValue === "0";

            if (wantsPass) return parseOk(noBoom);
            const wantsBoom =
              action === "" ||
              action.includes("boom") ||
              action.includes("explode") ||
              action.includes("self");
            if (!wantsBoom) return parseFail();

            // 普通狼自爆不帶人：即使模型給了座位也只當作「自爆」
            if (!takesPlayer) return parseOk({ boom: true, targetSeat: null });

            const target = parseLLMDisplaySeat(cleaned, validSeats, ["seat", "targetSeat", "target", "boom"]);
            return target === null ? parseFail() : parseOk({ boom: true, targetSeat: target });
          }
        );
      },
    );
    const decision = completion.parsed ?? noBoom;
    const boomReason = extractJsonTextField(completion.cleaned, "reason");

    await aiLogger.log({
      type: "self_destruct_decision",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: { boom: decision.boom, targetSeat: decision.targetSeat, attempts: completion.attempts, reason: boomReason },
        attempts,
        duration: Date.now() - startTime,
      },
    });

    return { boom: decision.boom, targetSeat: decision.targetSeat, reason: boomReason };
  } catch (error) {
    console.warn("[wolfcha] generateSelfDestructDecision failed, passing self-destruct:", error);
    await aiLogger.log({
      type: "self_destruct_decision",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: "",
        parsed: { boom: false, targetSeat: null, attempts: 1, reason: "" },
        attempts,
        duration: Date.now() - startTime,
        failure: isUpstreamTimeoutError(error) ? "upstream_timeout" : "error",
      },
    });
    return { ...noBoom, reason: "" };
  }
}


/**
 * 騎士翻牌決鬥決策（AI）：只在騎士自己的白天發言輪被呼叫。
 *
 * 回傳 `{ duel: false }` 表示不發動；`targetSeat` 為 0 基座位。
 * 解析失敗或上游逾時一律視為不發動（翻牌是不可逆的豪賭，寧可保守）。
 */
export async function generateKnightDuelDecision(
  state: GameState,
  player: Player,
  options?: { fromSpeech?: SpeechSkillDecision }
): Promise<{ duel: boolean; targetSeat: number | null; reason: string }> {
  // 發言請求已經附帶決定時，直接沿用（不再送第二次完整 context）；只記錄 log。
  if (options?.fromSpeech) {
    const fromSpeech = options.fromSpeech;
    const duel = fromSpeech.action === "use";
    await aiLogger.log({
      type: "knight_duel_decision",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages: [{ role: "system", content: "[由發言請求附帶的 skill 欄位取得，未另送請求]" }],
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: JSON.stringify({ action: duel ? "duel" : "none", seat: fromSpeech.seat }),
        parsed: { duel, targetSeat: duel ? fromSpeech.seat : null, attempts: 0, reason: fromSpeech.reason, source: "speech" },
        attempts: 0,
        duration: 0,
      },
    });
    return { duel, targetSeat: duel ? fromSpeech.seat : null, reason: fromSpeech.reason };
  }

  const prompt = resolvePhasePrompt("KNIGHT_DUEL", state, player);
  const flags = getBoardRuleFlags(state.players.length);
  const pendingDeathSeats = getPendingDeathSeats(state);
  const alivePlayers = state.players.filter(
    (p) => p.alive && p.playerId !== player.playerId && !pendingDeathSeats.includes(p.seat)
  );
  const startTime = Date.now();
  let attempts = 0;
  const { messages } = buildMessagesForPrompt(prompt);
  const validSeats = alivePlayers.map((p) => p.seat);
  const noDuel = { duel: false, targetSeat: null } as const;

  if (!canDuel({
    phase: state.phase,
    role: player.role,
    flags,
    duelUsedSeats: state.roleAbilities.duelUsedSeats,
    seat: player.seat,
  }) || validSeats.length === 0) {
    return { ...noDuel, reason: "" };
  }

  try {
    const completion = await withCriticalRetry(
      "knight_duel_decision",
      async () => {
        attempts += 1;
        return await generateCompletionAndParse<{ duel: boolean; targetSeat: number | null }>(
          mergeOptionsFromModelRef(player.agentProfile!.modelRef, {
            model: player.agentProfile!.modelRef.model,
            messages,
            promptScope: "gameplay",
            temperature: GAME_TEMPERATURE.ACTION,
            response_format: { type: "json_object" },
          }),
          (cleaned) => {
            const parsed = parseLLMJson<unknown>(cleaned);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parseFail();

            const record = parsed as Record<string, unknown>;
            const action = String(record.action ?? record.type ?? "").trim().toLowerCase();
            const seatValue = record.seat ?? record.targetSeat ?? record.target ?? record.duel;
            const wantsPass =
              action.includes("pass") ||
              action.includes("skip") ||
              action.includes("none") ||
              seatValue === null ||
              seatValue === 0 ||
              seatValue === "0";

            if (wantsPass) return parseOk(noDuel);
            const wantsDuel =
              action === "" ||
              action.includes("duel") ||
              action.includes("challenge") ||
              action.includes("reveal");
            if (!wantsDuel) return parseFail();

            const target = parseLLMDisplaySeat(cleaned, validSeats, ["seat", "targetSeat", "target", "duel"]);
            return target === null ? parseFail() : parseOk({ duel: true, targetSeat: target });
          }
        );
      },
    );
    const decision = completion.parsed ?? noDuel;
    const duelReason = extractJsonTextField(completion.cleaned, "reason");

    await aiLogger.log({
      type: "knight_duel_decision",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: completion.cleaned,
        raw: completion.result.content,
        rawResponse: JSON.stringify(completion.result.raw, null, 2),
        finishReason: completion.result.raw.choices?.[0]?.finish_reason,
        parsed: { duel: decision.duel, targetSeat: decision.targetSeat, attempts: completion.attempts, reason: duelReason },
        attempts,
        duration: Date.now() - startTime,
      },
    });

    return { duel: decision.duel, targetSeat: decision.targetSeat, reason: duelReason };
  } catch (error) {
    console.warn("[wolfcha] generateKnightDuelDecision failed, passing duel:", error);
    await aiLogger.log({
      type: "knight_duel_decision",
      request: {
        model: player.agentProfile!.modelRef.model,
        messages,
        player: { playerId: player.playerId, displayName: player.displayName, seat: player.seat, role: player.role },
      },
      response: {
        content: "",
        parsed: { duel: false, targetSeat: null, attempts: 1, reason: "" },
        attempts,
        duration: Date.now() - startTime,
        failure: isUpstreamTimeoutError(error) ? "upstream_timeout" : "error",
      },
    });
    return { ...noDuel, reason: "" };
  }
}

/** 预取仅在实际提示词完全一致时复用，消息数量不足以代表上下文。 */
export function getSpeechContextKey(state: GameState, player: Player): string {
  const prompt = resolvePhasePrompt(state.phase, state, player);
  return JSON.stringify([player.agentProfile?.modelRef, prompt.system, prompt.user]);
}
