import type { Alignment, AvatarStyle, Persona, Role } from "./game";

export type NightEventType = "kill" | "save" | "poison" | "check" | "guard";
export type DayEventType = "exile" | "badge" | "hunter_shot" | "white_wolf_king_boom" | "idiot_reveal";

export interface NightEvent {
  type: NightEventType;
  source: string;
  target: string;
  result?: string;
  blocked?: boolean;
}

export interface VoteRecord {
  voterSeat: number;
  targetSeat: number;
}

export interface DayEvent {
  type: DayEventType;
  target: string;
  voteCount?: number;
  votes?: VoteRecord[];
}

export interface PlayerSpeech {
  seat: number;
  content: string;
}

export interface DayPhase {
  type: "election" | "discussion" | "pk";
  summary?: string;
  speeches?: PlayerSpeech[];
  event?: DayEvent;
  hunterEvent?: DayEvent;
  whiteWolfKingBoomEvent?: DayEvent;
  idiotRevealEvent?: DayEvent;
}

export interface TimelineEntry {
  day: number;
  summary: string;
  nightEvents: NightEvent[];
  dayEvents: DayEvent[];
  dayPhases?: DayPhase[];
  speeches?: PlayerSpeech[];
}

export interface PlayerAward {
  playerId: string;
  playerName: string;
  reason: string;
  avatar: string;
  /** 角色性別：決定頭像发型與角色一致（人類玩家可能沒有）。 */
  gender?: Persona["gender"];
  /** 手寫角色的固定外觀指定。 */
  avatarStyle?: AvatarStyle;
  role: Role;
}

/** 一筆 MVP／SVP 票（含投票者資訊與理由）；weight：AI = 1、系統客觀票 = 1.5。 */
export interface AwardVote {
  voterId: string;
  voterName: string;
  /** 投票者角色；系統客觀票為 null（UI 另外標示）。 */
  voterRole: Role | null;
  /** 投票者座位（0 基）；系統客觀票為 -1。 */
  voterSeat: number;
  /** 被投者的顯示資料；解析失敗的票不會出現在計分列表裡。 */
  targetPlayerId: string;
  targetName: string;
  /** 被投者座位（0 基）。 */
  targetSeat: number;
  reason: string;
  weight: number;
  /** true = 系統客觀分析票（權重 1.5，同票時多 0.5）。 */
  isSystem: boolean;
}

export interface RadarStats {
  logic: number;
  speech: number;
  survival: number;
  skillOrHide: number;
  voteOrTicket: number;
}

export interface PersonalStats {
  role: Role;
  userName: string;
  avatar: string;
  /** 角色性別：決定頭像发型與角色一致（人類玩家可能沒有）。 */
  gender?: Persona["gender"];
  /** 手寫角色的固定外觀指定。 */
  avatarStyle?: AvatarStyle;
  alignment: Alignment;
  tags: string[];
  radarStats: RadarStats;
  highlightQuote: string;
  totalScore: number;
}

export interface PlayerReview {
  fromPlayerId: string;
  fromCharacterName: string;
  avatar: string;
  /** 角色性別：決定頭像发型與角色一致。 */
  gender?: Persona["gender"];
  /** 手寫角色的固定外觀指定。 */
  avatarStyle?: AvatarStyle;
  content: string;
  relation: "ally" | "enemy";
  role: Role;
}

export type DeathCause = "killed" | "exiled" | "poisoned" | "shot" | "milk" | "boom";

export interface PlayerSnapshot {
  playerId: string;
  seat: number;
  name: string;
  avatar: string;
  /** 角色性別：決定頭像发型與角色一致（人類玩家可能沒有）。 */
  gender?: Persona["gender"];
  /** 手寫角色的固定外觀指定。 */
  avatarStyle?: AvatarStyle;
  role: Role;
  alignment: Alignment;
  isAlive: boolean;
  deathDay?: number;
  deathCause?: DeathCause;
  isSheriff?: boolean;
  isHumanPlayer?: boolean;
}

export interface RoundState {
  day: number;
  phase: "night" | "day";
  sheriffSeat?: number;
  aliveCount: { village: number; wolf: number };
  players: PlayerSnapshot[];
}

export interface GameAnalysisData {
  gameId: string;
  analysisVersion?: number;
  sourceFingerprint?: string;
  timestamp: number;
  duration: number;
  playerCount: number;
  result: "village_win" | "wolf_win";

  awards: {
    /** 最高票者（同票並列時含全部並列者，依座位排序）。 */
    mvp: PlayerAward[];
    svp: PlayerAward[];
  };

  /** MVP／SVP 投票明細：各 AI 角色 + 系統客觀票（1.5 票）。 */
  awardVotes?: {
    mvp: AwardVote[];
    svp: AwardVote[];
  };

  timeline: TimelineEntry[];

  players: PlayerSnapshot[];

  roundStates: RoundState[];

  personalStats: PersonalStats;

  reviews: PlayerReview[];
}

export const RADAR_LABELS_VILLAGE = [
  "逻辑严密",
  "发言清晰",
  "存活评分",
  "技能价值",
  "投票准确",
] as const;

export const RADAR_LABELS_WOLF = [
  "逻辑严密",
  "发言清晰",
  "存活评分",
  "隐匿程度",
  "冲票贡献",
] as const;
