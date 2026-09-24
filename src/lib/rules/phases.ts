import type { Phase } from "@/types/game";

/**
 * Phase 的結構性事實（單一真相）。
 *
 * 過去「有哪些階段、順序為何、這階段屬於哪一類」被手寫在十多處：版型資料、跳階工具、
 * 存檔驗證、UI 圖示、i18n 標籤、測試證據矩陣。加一個階段要掃全部，而漏掉一處的後果
 * 不是編譯錯，而是「安靜地少一個分支」（`DAY_PK_SPEECH` 漏在跳階順序、`NIGHT_MUTE_ACTION`
 * 漏在夜間分類、`KNIGHT_DUEL` 漏在存檔驗證與證據矩陣，都是這樣發生的）。
 *
 * 這個 module 把那些事實收成受 `Record<Phase, …>` 型別保護的資料：新增階段時 tsc 會逼你補齊。
 * 行為型判斷（存檔是否安全、回退到哪個階段、真人是否要輸入）留在各自的 module，
 * 但一律以 `Record<Phase, …>` 形式存在，不再用 switch 的 default 吞掉未知階段。
 */

/** 階段性質。夜／晝是流程主幹，特殊階段不屬於任何一天的主幹，系統階段不屬於任何一局。 */
export type PhaseKind = "system" | "night" | "day" | "special";

/** 每個階段的性質（Record 強制補齊：新增 Phase 必漏編譯錯）。 */
export const PHASE_KIND: Record<Phase, PhaseKind> = {
  LOBBY: "system",
  SETUP: "system",

  NIGHT_START: "night",
  NIGHT_GUARD_ACTION: "night",
  NIGHT_MUTE_ACTION: "night",
  NIGHT_DREAM_ACTION: "night",
  NIGHT_WOLF_ACTION: "night",
  NIGHT_WITCH_ACTION: "night",
  NIGHT_SEER_ACTION: "night",
  NIGHT_RESOLVE: "night",

  DAY_START: "day",
  DAY_BADGE_SIGNUP: "day",
  DAY_BADGE_SPEECH: "day",
  DAY_BADGE_ELECTION: "day",
  DAY_PK_SPEECH: "day",
  DAY_SPEECH: "day",
  DAY_LAST_WORDS: "day",
  DAY_VOTE: "day",
  DAY_RESOLVE: "day",

  BADGE_TRANSFER: "special",
  HUNTER_SHOOT: "special",
  SELF_DESTRUCT: "special",
  KNIGHT_DUEL: "special",

  GAME_END: "system",
};

/**
 * 完整線性順序，用於「比較兩個階段誰先誰後」與跳階。
 * `DAY_PK_SPEECH` 排在警徽評選之後、白天發言之前（依 `VALID_TRANSITIONS` 的
 * `DAY_BADGE_ELECTION → DAY_PK_SPEECH`／`DAY_RESOLVE → DAY_PK_SPEECH`）。
 */
export const PHASE_SEQUENCE: readonly Phase[] = [
  "LOBBY",
  "SETUP",
  "NIGHT_START",
  "NIGHT_GUARD_ACTION",
  "NIGHT_MUTE_ACTION",
  "NIGHT_DREAM_ACTION",
  "NIGHT_WOLF_ACTION",
  "NIGHT_WITCH_ACTION",
  "NIGHT_SEER_ACTION",
  "NIGHT_RESOLVE",
  "DAY_START",
  "DAY_BADGE_SIGNUP",
  "DAY_BADGE_SPEECH",
  "DAY_BADGE_ELECTION",
  "DAY_PK_SPEECH",
  "DAY_SPEECH",
  "DAY_VOTE",
  "DAY_RESOLVE",
  "DAY_LAST_WORDS",
  "BADGE_TRANSFER",
  "HUNTER_SHOOT",
  "SELF_DESTRUCT",
  "KNIGHT_DUEL",
  "GAME_END",
];

/** 夜晚角色行動的權威順序（天黑 → 守衛 → 禁言長老 → 攝夢人 → 狼人 → 女巫 → 預言家 → 結算）。 */
export const NIGHT_ACTION_ORDER: readonly Phase[] = [
  "NIGHT_GUARD_ACTION",
  "NIGHT_MUTE_ACTION",
  "NIGHT_DREAM_ACTION",
  "NIGHT_WOLF_ACTION",
  "NIGHT_WITCH_ACTION",
  "NIGHT_SEER_ACTION",
];

/** 需要發言輪的階段（發言順序、逐字稿與發言 UI 都以此為界）。 */
export const SPEECH_PHASES: readonly Phase[] = [
  "DAY_BADGE_SPEECH",
  "DAY_PK_SPEECH",
  "DAY_SPEECH",
  "DAY_LAST_WORDS",
];

/**
 * 跳階時必須補全資料的決策階段。
 * 開發者跳過這些階段時，被跳過的角色決定要由跳階工具補上，否則狀態不完整。
 */
export const ACTION_PHASES: readonly Phase[] = [
  "NIGHT_GUARD_ACTION",
  "NIGHT_MUTE_ACTION",
  "NIGHT_DREAM_ACTION",
  "NIGHT_WOLF_ACTION",
  "NIGHT_WITCH_ACTION",
  "NIGHT_SEER_ACTION",
  "DAY_VOTE",
];

export const isNightPhase = (phase: Phase): boolean => PHASE_KIND[phase] === "night";
export const isDayPhase = (phase: Phase): boolean => PHASE_KIND[phase] === "day";

export const isSpeechPhase = (phase: Phase): boolean => SPEECH_PHASES.includes(phase);

/**
 * 這個階段的行動者 prompt 是否必須帶「當天已公開的證據」（發言、票型、已公開死訊）。
 *
 * 這是證據矩陣（`context-regressions.test.ts`）的來源。矩陣過去是手寫清單，
 * `KNIGHT_DUEL` 上線時漏補，而違反 AGENTS.md「新增階段必須加入證據矩陣」的規定卻沒有守衛
 * 把得到。改成 `Record<Phase, …>` 後，新增階段時 tsc 會逼你決定要不要進矩陣。
 *
 * 註：夜晚階段由 `factual-context.test.ts`／`night-dream-flow.test.ts` 另外覆蓋，
 * 這裡標 false 代表「不由這份矩陣斷言」，不代表夜晚 prompt 不需要公開事實。
 */
export const PROMPT_NEEDS_PUBLIC_EVIDENCE: Record<Phase, boolean> = {
  LOBBY: false,
  SETUP: false,

  NIGHT_START: false,
  NIGHT_GUARD_ACTION: false,
  NIGHT_MUTE_ACTION: false,
  NIGHT_DREAM_ACTION: false,
  NIGHT_WOLF_ACTION: false,
  NIGHT_WITCH_ACTION: false,
  NIGHT_SEER_ACTION: false,
  NIGHT_RESOLVE: false,

  DAY_START: false,
  DAY_BADGE_SIGNUP: true,
  DAY_BADGE_SPEECH: false,
  DAY_BADGE_ELECTION: true,
  DAY_PK_SPEECH: true,
  DAY_SPEECH: true,
  DAY_LAST_WORDS: true,
  DAY_VOTE: true,
  DAY_RESOLVE: false,

  BADGE_TRANSFER: true,
  HUNTER_SHOOT: true,
  SELF_DESTRUCT: true,
  KNIGHT_DUEL: true,

  GAME_END: false,
};
