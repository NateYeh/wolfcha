import type { GameState, Player, Phase } from "@/types/game";

export type SystemPromptPart = {
  text: string;
  cacheable?: boolean;
  ttl?: "5m" | "1h";
};

export interface PromptResult {
  system: string;
  user: string;
  systemParts?: SystemPromptPart[];
  /**
   * 過往各日紀錄（【第N天 白天記錄】）：呼叫端要把它當成**獨立的 user content**、
   * 排在主要 user 訊息之前送出（見 game-master 的 buildMessagesForPrompt）。
   */
  historyUser?: string;
  /**
   * 角色與任務區塊：整個 prompt 裡**唯一逐任務（甚至逐人）不同的部分**。
   * 呼叫端要把它當成獨立 user content、排在所有 user 訊息的最後面送出
   * （見 game-master 的 buildMessagesForPrompt）——共用前綴才能被快取，
   * 任務指令也才能吃到「最近位置」的注意力。
   */
  finalUser?: string;
}

export type GameAction =
  | { type: "START_NIGHT" }
  | { type: "CONTINUE_NIGHT_AFTER_GUARD" }
  | { type: "CONTINUE_NIGHT_AFTER_MUTE" }
  | { type: "CONTINUE_NIGHT_AFTER_DREAM" }
  | { type: "CONTINUE_NIGHT_AFTER_WOLF" }
  | { type: "CONTINUE_NIGHT_AFTER_WITCH" }
  | { type: "START_DAY_SPEECH_AFTER_BADGE"; options?: { skipAnnouncements?: boolean } }
  | { type: "ADVANCE_SPEAKER" }
  | { type: "ANNOUNCE_NIGHT_RESULTS"; options?: { skipAnnouncements?: boolean } }
  | { type: "RESOLVE_VOTES" }
  | { type: "RESUME_VOTES" }
  | { type: "VOTE"; targetSeat: number }
  | { type: "NIGHT_ACTION"; targetSeat: number; witchAction?: "save" | "poison" | "pass" }
  | { type: "CUSTOM"; payload: unknown };

export interface GameContext {
  state: GameState;
  phase?: Phase;
  actor?: Player;
  extras?: Record<string, unknown>;
}
