export type Role = "Villager" | "Werewolf" | "Seer" | "Witch" | "Hunter" | "Guard" | "Idiot" | "WhiteWolfKing";

/** Check if a role belongs to the wolf team (used for seer checks, wolf actions, etc.) */
export function isWolfRole(role: string | undefined): boolean {
  return role === "Werewolf" || role === "WhiteWolfKing";
}

export type DifficultyLevel = "easy" | "normal" | "hard";

export type SpeechDirection = "clockwise" | "counterclockwise";

export type DevPreset = "MILK_POISON_TEST" | "LAST_WORDS_TEST";

export interface StartGameOptions {
  fixedRoles?: Role[];
  devPreset?: DevPreset;
  difficulty?: DifficultyLevel;
  playerCount?: number;
  gameSessionId?: string;
  isGenshinMode?: boolean;
  isSpectatorMode?: boolean;
  /** 熟人局：AI 互相认识（注入印象与交手记录），供读人参考。 */
  isAcquaintanceGame?: boolean;
  /** 角色池 id：一般模式从指定角色池随机抽角色（Genshin 模式忽略）。 */
  rosterPoolId?: string;
  preferredRole?: Role;
}

export type Phase =
  | "LOBBY"
  | "SETUP"
  | "NIGHT_START"
  | "NIGHT_GUARD_ACTION"   // 守卫保护
  | "NIGHT_WOLF_ACTION"    // 狼人出刀
  | "NIGHT_WITCH_ACTION"   // 女巫用药
  | "NIGHT_SEER_ACTION"    // 预言家查验
  | "NIGHT_RESOLVE"
  | "DAY_START"
  | "DAY_BADGE_SIGNUP"     // 警徽竞选报名
  | "DAY_BADGE_SPEECH"     // 警徽竞选发言
  | "DAY_BADGE_ELECTION"   // 警徽评选
  | "DAY_PK_SPEECH"        // PK发言
  | "DAY_SPEECH"
  | "DAY_LAST_WORDS"
  | "DAY_VOTE"
  | "DAY_RESOLVE"
  | "BADGE_TRANSFER"        // 警长移交警徽
  | "HUNTER_SHOOT"          // 猎人开枪
  | "WHITE_WOLF_KING_BOOM"  // 白狼王自爆
  | "GAME_END";

export type Alignment = "village" | "wolf";

 export interface GameScenario {
   id: string;
   title: string;
   description: string;
   rolesHint: string;
 }

/**
 * 頭像外觀的固定指定（手寫角色用）。
 * 未指定的部分仍由 seed（與性別）決定，指定了就固定下來。
 */
export interface AvatarStyle {
  /** 髮型 variant，如 "variant03"；未指定時依性別選池。 */
  hair?: string;
  /** 眼睛 variant，如 "variant01"；未指定時依 seed。 */
  eyes?: string;
  /** true = 一定留鬍子（適合老者、漢子）；未指定或 false 都不留。 */
  beard?: boolean;
  /** true/false = 一定要／一定不要眼鏡；未指定時依 seed 隨機。 */
  glasses?: boolean;
  /** 背景色（十六進位，不含 #）。 */
  backgroundColor?: string;
}

export interface ModelRef {
  provider: "zenmux" | "dashscope" | "tokendance";
  model: string;
  /** Override call-time temperature for this model (e.g. some models only support 1) */
  temperature?: number;
  /** Override call-time reasoning/thinking for this model (e.g. some models must enable it) */
  reasoning?: { enabled: boolean, exclude?: boolean, effort?: "minimal" | "low" | "medium" | "high", max_tokens?: number };
}

export interface Persona {
  styleLabel?: string;
  voiceRules: string[];
  mbti: string;
  gender: "male" | "female" | "nonbinary";
  age: number;
  basicInfo?: string;
  voiceId?: string;
  relationships?: string[];
  logicStyle?: string;
  triggerTopics?: string[];
  socialHabit?: string;
  humorStyle?: string;
  werewolfExperience?: string;
  vocabularyStyle?: string;
  reasoningStyle?: string;
  speechLengthHabit?: string;
  pressureStyle?: string;
  uncertaintyStyle?: string;
  mistakePattern?: string;
  wolfDeceptionStyle?: string;
}

/** 单个角色（按显示名聚合）的历史交手统计。 */
export interface CharacterStat {
  games: number;
  wins: number;
  mvps: number;
  svps: number;
}

export interface PlayerMind {
  courage: string;
  memoryBias: string;
  suspicionThreshold: string;
  selfProtection: string;
  logicDepth: string;
  tablePresence: string;
}

export interface AgentProfile {
  modelRef: ModelRef;
  persona: Persona;
  playerMind?: PlayerMind;
}

export interface Player {
  playerId: string;
  seat: number;
  /** 角色池的穩定 id（人類玩家與 AI 即時生成角色為 undefined）；統計與熟人局的 key。 */
  characterId?: string;
  displayName: string;
  avatarSeed?: string;
  /** 頭像外觀的固定指定（手寫角色用）；未指定時依 gender＋seed 產生。 */
  avatarStyle?: AvatarStyle;
  alive: boolean;
  role: Role;
  alignment: Alignment;
  isHuman: boolean;
  agentProfile?: AgentProfile;
}

export type GameEventType =
  | "GAME_START"
  | "ROLE_ASSIGNED"
  | "PHASE_CHANGED"
  | "CHAT_MESSAGE"
  | "SYSTEM_MESSAGE"
  | "NIGHT_ACTION"
  | "VOTE_CAST"
  | "PLAYER_DIED"
  | "GAME_END";

export interface GameEvent {
  id: string;
  ts: number;
  type: GameEventType;
  visibility: "public" | "private";
  visibleTo?: string[];
  payload: unknown;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  content: string;
  timestamp: number;
  day?: number;
  phase?: Phase;
  isSystem?: boolean;
  isStreaming?: boolean;
  speechRound?: number;
  pkSource?: "badge" | "vote";
  isLastWords?: boolean;  // Flag for last words (遗言) messages
}

/** 已结算且公开的投票快照；旧存档中的每日票型仍保留作兼容回退。 */
export interface VoteRound {
  id: string;
  day: number;
  kind: "badge" | "execution";
  round: number;
  candidates: number[];
  votes: Record<string, number>;
  sheriffSeat: number | null;
  winnerSeat: number | null;
  outcome: "elected" | "executed" | "idiot-revealed" | "tie" | "no-votes";
}

/** 狼隊第一夜商定的分工（主導狼計畫）：夜裡商定、白天注入狼視角；座位一律存 0 基索引。 */
export interface WolfTeamPlan {
  /** 主導狼座位。 */
  captainSeat: number;
  /** 悍跳者座位；null＝本局商定不跳。 */
  jumpSeat: number | null;
  /** 商定上警的狼座位（含悍跳者）。 */
  signupSeats: number[];
  /** 各狼分工代碼：jump=悍跳 charge=衝鋒 hook=倒勾 deep=潛伏；鍵為座位索引字串。 */
  postures: Record<string, "jump" | "charge" | "hook" | "deep">;
  /** 主導狼講給隊友的一句話計畫意圖。 */
  reason: string;
  /** 商定時的天數（第一夜＝1）。 */
  day: number;
}

export interface GameState {
  gameId: string;
  /** 数据库单人游戏会话的唯一身份；进行中的可恢复状态必须存在。 */
  gameSessionId?: string | null;
  phase: Phase;
  day: number;
  startTime?: number;
  devMutationId?: number;
  devPhaseJump?: { to: Phase; ts: number };
  isPaused?: boolean;
  scenario?: GameScenario;
  isGenshinMode?: boolean;
  isSpectatorMode?: boolean;
  /** 熟人局开关（开局面取一次）；开=buildGameContext 注入 <acquaintance_notes>。 */
  isAcquaintanceGame?: boolean;
  /** 各角色历史交手统计（games/wins/mvps），仅熟人局注入 prompt；取不到为 undefined。 */
  characterStats?: Record<string, CharacterStat>;
  difficulty: DifficultyLevel;
  players: Player[];
  events: GameEvent[];
  messages: ChatMessage[];
  currentSpeakerSeat: number | null;
  nextSpeakerSeatOverride?: number | null;
  daySpeechStartSeat: number | null;
  /** 当前发言轮次开始时的 messages 长度；用于隔离同一天重复进入的 PK/竞选发言。 */
  speechRoundStartMessageIndex?: number | null;
  speechDirection?: SpeechDirection;
  pkTargets?: number[];
  pkSource?: "badge" | "vote";
  badge: {
    holderSeat: number | null;
    candidates: number[];
    signup: Record<string, boolean>;
    votes: Record<string, number>;
    allVotes: Record<string, number>;
    history: Record<number, Record<string, number>>;
    /** 每日警徽竞选最终赢家快照；null 表示该日竞选最终无人当选。 */
    electionWinners?: Record<number, number | null>;
    revoteCount: number;
  };
  votes: Record<string, number>;
  voteReasons?: Record<string, string>;
  lastVoteReasons?: Record<string, string>;
  voteRounds?: VoteRound[];
  voteHistory: Record<number, Record<string, number>>; // day -> { voterId -> targetSeat }
  nightHistory?: Record<
    number,
    {
      /** 夜间结算已由主持人公开，不能用提示词的 phase 代替。 */
      resultsAnnounced?: boolean;
      guardTarget?: number;
      wolfTarget?: number;
      witchSave?: boolean;
      witchPoison?: number;
      seerTarget?: number;
      seerResult?: { targetSeat: number; isWolf: boolean };
      deaths?: Array<{ seat: number; reason: "wolf" | "poison" | "milk" }>;
      hunterShot?: { hunterSeat: number; targetSeat: number; reason?: string };
      /** 夜間行動者本人寫下的決策理由；賽中從不公開，只供本人賽後感言引用。 */
      guardReason?: string;
      wolfReason?: string;
      witchSaveReason?: string;
      witchPoisonReason?: string;
      seerReason?: string;
    }
  >;
  dayHistory?: Record<
    number,
    {
      executed?: { seat: number; votes: number };
      voteTie?: boolean;
      /** 当日放逐投票发生时的警长座位；null 表示当时无警长。 */
      sheriffSeatAtVote?: number | null;
      hunterShot?: { hunterSeat: number; targetSeat: number; reason?: string };
      whiteWolfKingBoom?: { boomSeat: number; targetSeat: number; reason?: string };
      idiotRevealed?: { seat: number };
    }
  >;
  dailySummaries: Record<number, string[]>; // day -> summary bullet list
  dailySummaryFacts: Record<number, DailySummaryFact[]>; // day -> structured facts
  dailySummaryVoteData?: Record<number, DailySummaryVoteData>;
  nightActions: {
    guardTarget?: number;        // 守卫保护的目标
    lastGuardTarget?: number;    // 上一晚守卫保护的目标（不能连续保护同一人）
    wolfVotes?: Record<string, number>;
    wolfTarget?: number;         // 狼人出刀目标
    witchSave?: boolean;         // 女巫是否救人
    witchPoison?: number;        // 女巫毒谁
    seerTarget?: number;
    seerResult?: { targetSeat: number; isWolf: boolean };
    /** 夜間行動的私有理由（本人視角的一句話）；結算時寫入 nightHistory 供賽後感言引用。 */
    guardReason?: string;
    wolfReason?: string;
    witchSaveReason?: string;
    witchPoisonReason?: string;
    seerReason?: string;
    seerHistory?: Array<{ targetSeat: number; isWolf: boolean; day: number }>; // 查验历史
    pendingWolfVictim?: number;  // 待公布的狼人击杀目标（警长竞选后公布）
    pendingPoisonVictim?: number; // 待公布的女巫毒杀目标（警长竞选后公布）
  };
  /** 第一夜狼隊商定的分工（主導狼計畫）；生成失敗或無 AI 狼時為 undefined，全場照舊無協調。 */
  wolfTeamPlan?: WolfTeamPlan;
  /** 賽後感言時各 AI 角色的 MVP／SVP 票（含理由）；投票流程跑完前為 []。 */
  endGameVotes?: EndGameVote[];
  /** 賽後投票流程是否已跑完（含失敗跳過）；系統分析要等這個旗標才計票。舊存檔為 undefined。 */
  endGameVotingDone?: boolean;
  // 角色能力使用记录
  roleAbilities: {
    witchHealUsed: boolean;      // 女巫解药是否已用
    witchPoisonUsed: boolean;    // 女巫毒药是否已用
    hunterCanShoot: boolean;     // 猎人是否能开枪（被毒死不能开枪）
    idiotRevealed: boolean;      // 白痴是否已翻牌（翻牌后失去投票权但不死）
    whiteWolfKingBoomUsed: boolean; // 白狼王是否已自爆
  };
  winner: Alignment | null;
}

export interface DailySummaryFact {
  fact: string;
  day?: number;
  speakerSeat?: number | null;
  speakerName?: string;
  targetSeat?: number | null;
  targetName?: string;
  type?: "vote" | "claim" | "suspicion" | "defense" | "alignment" | "death" | "switch" | "other";
  evidence?: string;
}

/** Structured vote data extracted from [VOTE_RESULT] to preserve "who voted for whom" for later days. */
export interface DailySummaryVoteData {
  sheriff_election?: { winner: number; votes: Record<string, number[]> };
  execution_vote?: { eliminated: number; votes: Record<string, number[]> };
}

/**
 * 賽後感言時由 AI 角色投出的 MVP／SVP 票。
 * 每張票各自帶理由；解析失敗的項目為 null（票不會進計分，但仍保留供 UI 顯示）。
 */
export interface EndGameVote {
  voterId: string;
  voterName: string;
  voterRole: Role;
  mvpPlayerId: string | null;
  mvpReason: string;
  svpPlayerId: string | null;
  svpReason: string;
}

// Shared model IDs
export const MODEL_IDS = {
  zenmux: {
    geminiFlashLite: "google/gemini-3.1-flash-lite",
    geminiFlashPreview: "google/gemini-3-flash-preview",
    deepseek: "deepseek/deepseek-v3.2",
    gpt52Chat: "openai/gpt-5.2-chat",
    claudeHaiku45: "anthropic/claude-haiku-4.5",
    claudeSonnet45: "anthropic/claude-sonnet-4.5",
    claudeOpus45: "anthropic/claude-opus-4.5",
    deepseekV4Flash: "deepseek/deepseek-v4-flash",
    grok4: "x-ai/grok-4.5",
    glm47: "z-ai/glm-4.7",
    minimaxM21: "minimax/minimax-m2.1",
  },
  dashscope: {
    deepseek: "deepseek-v3.2",
  },
  tokendance: {
    minimaxM27: "minimax-m2.7",
    deepseekV4Pro: "deepseek-v4-pro",
    deepseekV4Flash0731: "deepseek-v4-flash-0731",
    // [LOCAL DEV PATCH] 指向本地 gpt-load2 閘道器實際註冊的模型名稱
    // deepseekV41Flash 已停用：思考過久，常觸發 60 秒逾時（僅保留名稱供參考）。
    deepseekV41Flash: "deepseek-v4.1-flash:cloud",
    glm53Flash: "glm-5.3-flash:cloud",
    gemma431b: "gemma4:31b-cloud",
    qwen3Max: "qwen3-max",
    glm5: "glm-5",
    kimiK25: "kimi-k2.5",
    deepseekV32: "deepseek-v3.2",
  },
} as const;

const BUILTIN_GLM53_FLASH_MODEL: ModelRef = {
  provider: "tokendance",
  model: MODEL_IDS.tokendance.glm53Flash,
  reasoning: { enabled: false },
};

const BUILTIN_GEMMA4_31B_MODEL: ModelRef = {
  provider: "tokendance",
  model: MODEL_IDS.tokendance.gemma431b,
  reasoning: { enabled: false },
};

export const DEFAULT_MODEL_CONFIG = {
  // [LOCAL DEV PATCH] 本地實驗統一使用 tokendance(自架閘道器) 模型，避免依賴 ZenMux Key
  // 產生／摘要／覆盤原本走 deepseek-v4.1-flash:cloud，現改用 gemma4:31b-cloud。
  // 這只是「使用者還沒在 UI 選過」的預設值；實際選擇存 localStorage，可於設定介面調整。
  generator: MODEL_IDS.tokendance.gemma431b,
  summary: BUILTIN_GEMMA4_31B_MODEL.model,
  review: BUILTIN_GEMMA4_31B_MODEL.model,
  validation: {
    zenmux: MODEL_IDS.zenmux.geminiFlashLite,
    dashscope: MODEL_IDS.dashscope.deepseek,
    tokendance: MODEL_IDS.tokendance.minimaxM27,
  },
} as const;

// Models for summary & character generation
export const GENERATOR_MODEL = DEFAULT_MODEL_CONFIG.generator;
export const SUMMARY_MODEL = DEFAULT_MODEL_CONFIG.summary;
export const REVIEW_MODEL = DEFAULT_MODEL_CONFIG.review;
export const ZENMUX_VALIDATION_MODEL = DEFAULT_MODEL_CONFIG.validation.zenmux;
export const DASHSCOPE_VALIDATION_MODEL = DEFAULT_MODEL_CONFIG.validation.dashscope;
export const TOKENDANCE_VALIDATION_MODEL = DEFAULT_MODEL_CONFIG.validation.tokendance;

// [LOCAL DEV PATCH] 只保留 glm-5.3-flash:cloud 與 gemma4:31b-cloud；deepseek-v4.1-flash:cloud
// 因為思考過久（常見 60 秒超時、發言被迫走逾時兜底）已從所有可用池移除。
export const BUILTIN_PLAYER_MODELS: ModelRef[] = [
  BUILTIN_GEMMA4_31B_MODEL,
  BUILTIN_GLM53_FLASH_MODEL,
];

// Default built-in models exposed to the app when custom key is not enabled.
// This list includes system defaults plus the small built-in player pool.
// 順序有意義：使用者沒在 UI 選過時，api-keys.ts 在 tokenpay 路徑取 AVAILABLE_MODELS[0]
// 當產生／摘要／覆盤的預設模型。
export const AVAILABLE_MODELS: ModelRef[] = [
  BUILTIN_GEMMA4_31B_MODEL,
  BUILTIN_GLM53_FLASH_MODEL,
];

// Built-in project-key models that the server may call internally.
// These are intentionally not exposed in the custom-key model selector.
export const PROJECT_MODELS: ModelRef[] = [
  ...AVAILABLE_MODELS,
  // Provider-specific validation models for user API key checks.
  { provider: "dashscope", model: MODEL_IDS.dashscope.deepseek },
  { provider: "zenmux", model: MODEL_IDS.zenmux.geminiFlashLite },
];

// User-selectable models when custom key is enabled.
export const ALL_MODELS: ModelRef[] = [
  { provider: "dashscope", model: MODEL_IDS.dashscope.deepseek },
  { provider: "zenmux", model: MODEL_IDS.zenmux.geminiFlashLite },
  { provider: "zenmux", model: MODEL_IDS.zenmux.deepseek },
  { provider: "zenmux", model: MODEL_IDS.zenmux.deepseekV4Flash },
  { provider: "zenmux", model: MODEL_IDS.zenmux.geminiFlashPreview },
  { provider: "zenmux", model: MODEL_IDS.zenmux.gpt52Chat },
  { provider: "zenmux", model: MODEL_IDS.zenmux.claudeHaiku45 },
  { provider: "zenmux", model: MODEL_IDS.zenmux.claudeSonnet45 },
  { provider: "zenmux", model: MODEL_IDS.zenmux.claudeOpus45 },
  { provider: "zenmux", model: MODEL_IDS.zenmux.grok4 },
  { provider: "zenmux", model: MODEL_IDS.zenmux.glm47, temperature: 1, reasoning: { enabled: false } },
  { provider: "zenmux", model: MODEL_IDS.zenmux.minimaxM21, temperature: 1, reasoning: { enabled: false } },
  { provider: "tokendance", model: MODEL_IDS.tokendance.minimaxM27, temperature: 1, reasoning: { enabled: false } },
  { provider: "tokendance", model: MODEL_IDS.tokendance.deepseekV4Pro, reasoning: { enabled: false } },
  { provider: "tokendance", model: MODEL_IDS.tokendance.deepseekV4Flash0731, reasoning: { enabled: false } },
  { provider: "tokendance", model: MODEL_IDS.tokendance.glm53Flash, reasoning: { enabled: false } },
  { provider: "tokendance", model: MODEL_IDS.tokendance.qwen3Max, reasoning: { enabled: false } },
  { provider: "tokendance", model: MODEL_IDS.tokendance.glm5, temperature: 1, reasoning: { enabled: false } },
  { provider: "tokendance", model: MODEL_IDS.tokendance.kimiK25, temperature: 1, reasoning: { enabled: false } },
  { provider: "tokendance", model: MODEL_IDS.tokendance.deepseekV32, reasoning: { enabled: false } },
];

// Models not allowed for in-game players (summary & generation only).
// Compare provider + model so a project system model does not accidentally
// exclude the same model ID from a playable provider pool.
export const NON_PLAYER_MODELS: ModelRef[] = [];

export function filterPlayerModels(models: ModelRef[]): ModelRef[] {
  const filtered = models.filter(
    (ref) =>
      !NON_PLAYER_MODELS.some(
        (blocked) => blocked.provider === ref.provider && blocked.model === ref.model,
      ),
  );
  return filtered.length > 0 ? filtered : models;
}

// Built-in player model pool used when custom key is disabled.
export const PLAYER_MODELS: ModelRef[] = BUILTIN_PLAYER_MODELS;
