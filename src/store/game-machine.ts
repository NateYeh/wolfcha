/**
 * 游戏状态机 - 使用 jotai 实现
 * 清晰定义所有游戏阶段和转换逻辑
 */

import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { GameState, Phase, Player } from "@/types/game";
import { isWolfRole } from "@/types/game";
import type { GameAnalysisData } from "@/types/analysis";
import { createInitialGameState } from "@/lib/game-master";
import { GAME_SESSION_RESUME_WINDOW_MS } from "@/lib/game-session-policy";
import { getI18n } from "@/i18n/translator";
import { getDeathShotKind } from "@/lib/rules/death-skills";
import { getRoleCapabilities } from "@/lib/rules/roles";
import { hasAlreadyDueled } from "@/lib/rules/knight-duel";
import { getSwapEligibleSeats } from "@/lib/rules/magician";
import { isValidMuteTarget } from "@/lib/rules/mute";
import { isValidDreamTarget } from "@/lib/rules/dream";
import { getWolfKnifeEligibleSeats, isValidWolfBeautyTarget } from "@/lib/rules/charm";
import { isPendingDeath } from "@/lib/rules/night-deaths";
import { hasAlreadyBoomed } from "@/lib/rules/self-destruct";
import { PHASE_SEQUENCE } from "@/lib/rules/phases";
import { getRestorePhase, isCheckpointSafe } from "@/lib/rules/checkpoints";

// ============ 游戏状态持久化配置 ============

const GAME_STATE_STORAGE_KEY = "wolfcha.game_state";
export const GAME_STATE_VERSION = 3;

interface PersistedGameState {
  version: number;
  state: GameState;
  savedAt: number;
}

// 「對局進行中」＝權威階段全集扣掉大廳／設定／對局結束。
//
// 這裡原本是手寫清單，漏了後加的 `NIGHT_MUTE_ACTION`／`NIGHT_DREAM_ACTION`／`KNIGHT_DUEL`
// （三者在 `PHASE_SEQUENCE` 裡都存在，是漏寫而非刻意排除）。後果不只是「存檔不安全」：
// `saveGameState` 在每次狀態變更都會先問 `isRestorableGameState`，答案為否就走
// 「清掉存檔」那一支——所以進入禁言階段會**刪掉整局存檔**（刷新直接回大廳），
// 設定面板也會把對局當成已結束（`page.tsx` 的 `isGameInProgress`）。
//
// 改成由權威表以「排除法」推導：新增階段預設算「進行中」，不再需要記得回來補這份清單。
const NOT_IN_PROGRESS_PHASES: readonly Phase[] = ["LOBBY", "SETUP", "GAME_END"];
const IN_PROGRESS_PHASES: readonly Phase[] = PHASE_SEQUENCE.filter(
  (phase) => !NOT_IN_PROGRESS_PHASES.includes(phase)
);

/**
 * Check if a game state represents a game in progress that should be restored
 */
export function isGameInProgress(state: GameState | null | undefined): boolean {
  if (!state) return false;
  return IN_PROGRESS_PHASES.includes(state.phase);
}

/** 只有带数据库会话身份的进行中状态才允许恢复。 */
export function hasGameSessionId(state: GameState | null | undefined): state is GameState & { gameSessionId: string } {
  return typeof state?.gameSessionId === "string" && state.gameSessionId.length > 0;
}

export function isRestorableGameState(state: GameState | null | undefined): boolean {
  return isGameInProgress(state) && hasGameSessionId(state);
}

/**
 * Validate that a game state has all required fields and is structurally valid
 */
// 存檔驗証用的合法階段集合：由權威表衍生（原本手寫清單漏了 KNIGHT_DUEL，
// 該階段的存檔會被當成損壞而清掉；目前因為 isCheckpointSafe 拒絕在該階段落盤
// 而沒有實際發生 —— 兩個判斷不再互相矛盾）。
const VALID_PHASES: readonly string[] = PHASE_SEQUENCE;

function isValidGameState(state: unknown): state is GameState {
  if (!state || typeof state !== "object") return false;
  
  const s = state as Record<string, unknown>;
  
  // Check required string fields
  if (typeof s.gameId !== "string" || !s.gameId) return false;
  if (typeof s.phase !== "string" || !VALID_PHASES.includes(s.phase)) return false;
  
  // Check required number fields
  if (typeof s.day !== "number" || !Number.isFinite(s.day)) return false;
  
  // Check players array
  if (!Array.isArray(s.players)) return false;
  
  // Check required objects
  if (!s.badge || typeof s.badge !== "object") return false;
  if (!s.roleAbilities || typeof s.roleAbilities !== "object") return false;
  if (!s.nightActions || typeof s.nightActions !== "object") return false;
  
  // Check arrays
  if (!Array.isArray(s.messages)) return false;
  if (!Array.isArray(s.events)) return false;
  
  // Check objects (can be empty)
  if (typeof s.votes !== "object" || s.votes === null) return false;
  if (typeof s.voteHistory !== "object" || s.voteHistory === null) return false;
  if (typeof s.dailySummaries !== "object" || s.dailySummaries === null) return false;
  if (typeof s.dailySummaryFacts !== "object" || s.dailySummaryFacts === null) return false;
  
  return true;
}

/**
 * Normalize a game state to ensure all fields have valid values
 * This handles partial or corrupted data by filling in defaults
 */
function normalizeGameState(state: GameState): GameState {
  const initial = createInitialGameState();

  // 舊存檔相容：白狼王自爆階段已更名為 SELF_DESTRUCT（所有狼陣營角色共用），
  // 舊的 roleAbilities.whiteWolfKingBoomUsed 也要換算成 boomedSeats。
  const legacyPhase = (state.phase as string | undefined) === "WHITE_WOLF_KING_BOOM" ? "SELF_DESTRUCT" : state.phase;
  const legacyBoomUsed =
    (state.roleAbilities as { whiteWolfKingBoomUsed?: boolean } | undefined)?.whiteWolfKingBoomUsed === true;
  const legacyBoomSeats = legacyBoomUsed
    ? state.players.filter((p) => p.role === "WhiteWolfKing").map((p) => p.seat)
    : undefined;

  return {
    ...initial,
    ...state,
    // Ensure required fields have valid values
    gameId: state.gameId || initial.gameId,
    gameSessionId: hasGameSessionId(state) ? state.gameSessionId : null,
    phase: legacyPhase || initial.phase,
    day: typeof state.day === "number" && Number.isFinite(state.day) ? state.day : initial.day,
    difficulty: state.difficulty || initial.difficulty,
    players: Array.isArray(state.players) ? state.players : initial.players,
    events: Array.isArray(state.events) ? state.events : initial.events,
    messages: Array.isArray(state.messages) ? state.messages : initial.messages,
    votes: state.votes && typeof state.votes === "object" ? state.votes : initial.votes,
    voteHistory: state.voteHistory && typeof state.voteHistory === "object" ? state.voteHistory : initial.voteHistory,
    dailySummaries: state.dailySummaries && typeof state.dailySummaries === "object" ? state.dailySummaries : initial.dailySummaries,
    dailySummaryFacts: state.dailySummaryFacts && typeof state.dailySummaryFacts === "object" ? state.dailySummaryFacts : initial.dailySummaryFacts,
    badge: state.badge && typeof state.badge === "object" ? {
      ...initial.badge,
      ...state.badge,
      electionWinners:
        state.badge.electionWinners && typeof state.badge.electionWinners === "object"
          ? state.badge.electionWinners
          : initial.badge.electionWinners,
    } : initial.badge,
    nightActions: state.nightActions && typeof state.nightActions === "object" ? state.nightActions : initial.nightActions,
    roleAbilities: state.roleAbilities && typeof state.roleAbilities === "object" ? {
      ...initial.roleAbilities,
      ...state.roleAbilities,
      ...(legacyBoomSeats ? { boomedSeats: legacyBoomSeats } : {}),
    } : initial.roleAbilities,
    winner: state.winner ?? null,
  };
}

/**
 * Load and validate game state from localStorage
 * Returns initial state if no valid saved state exists
 */
function loadPersistedGameState(): GameState {
  const initial = createInitialGameState();
  
  // SSR safety check
  if (typeof window === "undefined") {
    return initial;
  }
  
  try {
    const raw = localStorage.getItem(GAME_STATE_STORAGE_KEY);
    if (!raw) return initial;
    
    const parsed: PersistedGameState = JSON.parse(raw);
    
    // Version check for future migrations
    if (parsed.version !== GAME_STATE_VERSION) {
      console.warn(`[wolfcha] Game state version mismatch: ${parsed.version} !== ${GAME_STATE_VERSION}`);
      localStorage.removeItem(GAME_STATE_STORAGE_KEY);
      return initial;
    }
    
    // Check if the saved state is too old
    const age = Date.now() - parsed.savedAt;
    if (age > GAME_SESSION_RESUME_WINDOW_MS) {
      console.info("[wolfcha] Saved game state expired, starting fresh");
      localStorage.removeItem(GAME_STATE_STORAGE_KEY);
      return initial;
    }
    
    // Validate the state structure
    if (!isValidGameState(parsed.state)) {
      console.warn("[wolfcha] Invalid saved game state structure");
      localStorage.removeItem(GAME_STATE_STORAGE_KEY);
      return initial;
    }
    
    // Only restore if game is in progress and has an explicit database identity.
    // A pre-sessionId checkpoint must never be resumed into a new/unknown session.
    if (!isRestorableGameState(parsed.state)) {
      console.info("[wolfcha] Saved game not in progress, starting fresh");
      localStorage.removeItem(GAME_STATE_STORAGE_KEY);
      return initial;
    }
    
    // Players must exist for a valid in-progress game
    if (parsed.state.players.length === 0) {
      console.warn("[wolfcha] Saved game has no players");
      localStorage.removeItem(GAME_STATE_STORAGE_KEY);
      return initial;
    }
    
    // 细粒度恢复：如果当前阶段的动作未完成，回退到上一个稳定点
    const savedState = normalizeGameState(parsed.state);
    const restorePhase = getRestorePhase(savedState);
    
    if (restorePhase !== savedState.phase) {
      console.info(`[wolfcha] Phase ${savedState.phase} action incomplete, restoring to ${restorePhase}`);
      // 回退 phase，但保留已完成的 nightActions
      const restoredState = {
        ...savedState,
        phase: restorePhase,
      };
      console.info(`[wolfcha] Restoring game from ${new Date(parsed.savedAt).toLocaleString()} at phase ${restorePhase} (rolled back from ${savedState.phase})`);
      return restoredState;
    }
    
    console.info(`[wolfcha] Restoring game from ${new Date(parsed.savedAt).toLocaleString()} at phase ${parsed.state.phase}`);
    return savedState;
    
  } catch (error) {
    console.error("[wolfcha] Failed to load saved game state:", error);
    // Clear potentially corrupted data
    try {
      localStorage.removeItem(GAME_STATE_STORAGE_KEY);
    } catch {
      // Ignore errors when clearing
    }
    return initial;
  }
}

// 发言阶段 throttle：避免流式消息追加导致频繁 JSON 序列化
const SPEECH_SAVE_THROTTLE_MS = 3000;
let lastSpeechSaveTimestamp = 0;
let pendingSpeechSaveTimer: ReturnType<typeof setTimeout> | null = null;

// Phases where throttled saving is applied (frequent state updates during speech)
const THROTTLED_SAVE_PHASES: Phase[] = [
  "DAY_BADGE_SPEECH",
  "DAY_PK_SPEECH",
  "DAY_SPEECH",
  "DAY_LAST_WORDS",
];

/**
 * Save game state to localStorage
 * 细粒度保存：保存可恢复的稳定状态（包含投票中途）
 * 这样刷新后可以恢复到最近完成的检查点
 * 
 * 发言阶段使用 throttle 策略，避免频繁序列化影响性能
 */
function saveGameState(state: GameState): void {
  // SSR safety check
  if (typeof window === "undefined") return;
  
  // Clear saved state when game ends or returns to lobby
  if (!isRestorableGameState(state)) {
    // Clear any pending throttled save
    if (pendingSpeechSaveTimer !== null) {
      clearTimeout(pendingSpeechSaveTimer);
      pendingSpeechSaveTimer = null;
    }
    try {
      localStorage.removeItem(GAME_STATE_STORAGE_KEY);
    } catch {
      // Ignore errors
    }
    return;
  }
  
  // 只写可恢复检查点；投票可以保留部分已经完成的行动。
  if (!isCheckpointSafe(state)) {
    // 进入不可恢复的结算中间态时，也必须取消上一阶段捕获的延迟写入。
    if (pendingSpeechSaveTimer !== null) {
      clearTimeout(pendingSpeechSaveTimer);
      pendingSpeechSaveTimer = null;
    }
    return;
  }
  
  // 发言阶段使用 throttle：降低频繁 JSON.stringify 的性能损耗
  // 但遗言阶段需要立即保存，因为它是关键的阶段转换点
  if (THROTTLED_SAVE_PHASES.includes(state.phase) && state.phase !== "DAY_LAST_WORDS") {
    const now = Date.now();
    const elapsed = now - lastSpeechSaveTimestamp;
    
    if (elapsed < SPEECH_SAVE_THROTTLE_MS) {
      // 距离上次保存不足阈值，延迟保存（确保最终一定会保存最新状态）
      if (pendingSpeechSaveTimer !== null) {
        clearTimeout(pendingSpeechSaveTimer);
      }
      pendingSpeechSaveTimer = setTimeout(() => {
        pendingSpeechSaveTimer = null;
        doSaveGameState(state);
        lastSpeechSaveTimestamp = Date.now();
      }, SPEECH_SAVE_THROTTLE_MS - elapsed);
      return;
    }
    
    lastSpeechSaveTimestamp = now;
  }
  
  // Clear any pending throttled save since we're saving now
  if (pendingSpeechSaveTimer !== null) {
    clearTimeout(pendingSpeechSaveTimer);
    pendingSpeechSaveTimer = null;
  }
  
  doSaveGameState(state);
}

/** Internal: actually write state to localStorage */
function doSaveGameState(state: GameState): void {
  // Double-check: don't save if game is no longer in progress
  // This handles the case where a throttled timer fires after the user exits the game
  if (!isRestorableGameState(state)) {
    return;
  }
  
  try {
    const persisted: PersistedGameState = {
      version: GAME_STATE_VERSION,
      state,
      savedAt: Date.now(),
    };
    const serialized = JSON.stringify(persisted);
    localStorage.setItem(GAME_STATE_STORAGE_KEY, serialized);
    // 帶上大小（KB）：localStorage 配額有限，出現 QuotaExceededError 時可直接看出對局存檔有多大。
    console.debug(`[wolfcha] Saved checkpoint at ${state.phase}, day ${state.day} (${Math.round(serialized.length * 2 / 1024)} KB)`);
  } catch (error) {
    console.error("[wolfcha] Failed to save game state:", error);
  }
}

/**
 * Clear persisted game state from localStorage
 */
export function clearPersistedGameState(): void {
  if (typeof window === "undefined") return;
  // Clear any pending throttled save
  if (pendingSpeechSaveTimer !== null) {
    clearTimeout(pendingSpeechSaveTimer);
    pendingSpeechSaveTimer = null;
  }
  try {
    localStorage.removeItem(GAME_STATE_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}

// ============ 基础状态 Atoms ============

// 持久化存储
export const humanNameAtom = atomWithStorage("wolfcha_human_name", "");
export const apiKeyConfirmedAtom = atom(false);

// Raw game state atom with localStorage persistence
const rawGameStateAtom = atom<GameState>(loadPersistedGameState());

// 游戏核心状态 - wraps raw atom to handle persistence
export const gameStateAtom = atom(
  (get) => get(rawGameStateAtom),
  (get, set, update: GameState | ((prev: GameState) => GameState)) => {
    const prev = get(rawGameStateAtom);
    const next = typeof update === "function" ? update(prev) : update;
    set(rawGameStateAtom, next);
    // Persist to localStorage
    saveGameState(next);
  }
);

// UI 状态
export const uiStateAtom = atom({
  isLoading: false,
  isWaitingForAI: false,
  showTable: false,
  selectedSeat: null as number | null,
  showRoleReveal: false,
  showLog: false,
});

// 当前对话状态
export interface DialogueState {
  speaker: string;
  text: string;
  isStreaming: boolean;
}
export const dialogueAtom = atom<DialogueState | null>(null);

// 输入文本
export const inputTextAtom = atom("");

// 游戏分析数据 - 使用 localStorage 持久化存储
export const gameAnalysisAtom = atomWithStorage<GameAnalysisData | null>("wolfcha_analysis_data", null);
export const analysisLoadingAtom = atom(false);
export const analysisErrorAtom = atom<string | null>(null);

// ============ 派生状态 Atoms ============

// 人类玩家
export const humanPlayerAtom = atom((get) => {
  const gameState = get(gameStateAtom);
  return gameState.players.find((p) => p.isHuman) || null;
});

// 是否夜晚
export const isNightAtom = atom((get) => {
  const gameState = get(gameStateAtom);
  return gameState.phase.includes("NIGHT");
});

// 存活玩家
export const alivePlayersAtom = atom((get) => {
  const gameState = get(gameStateAtom);
  return gameState.players.filter((p) => p.alive);
});

// AI 玩家（排除人类）
export const aiPlayersAtom = atom((get) => {
  const gameState = get(gameStateAtom);
  return gameState.players.filter((p) => !p.isHuman);
});

// ============ 阶段相关逻辑 ============

// 阶段配置 - 定义每个阶段的行为
export interface PhaseConfig {
  phase: Phase;
  description: string;
  humanDescription?: (humanPlayer: Player | null, gameState: GameState) => string;
  requiresHumanInput: (humanPlayer: Player | null, gameState: GameState) => boolean;
  canSelectPlayer: (humanPlayer: Player | null, targetPlayer: Player, gameState: GameState) => boolean;
  actionType: "none" | "speech" | "vote" | "night_action" | "special";
}

export const PHASE_CONFIGS: Record<Phase, PhaseConfig> = {
  LOBBY: {
    phase: "LOBBY",
    description: "phase.lobby.description",
    requiresHumanInput: () => false,
    canSelectPlayer: () => false,
    actionType: "none",
  },
  SETUP: {
    phase: "SETUP",
    description: "phase.setup.description",
    requiresHumanInput: () => false,
    canSelectPlayer: () => false,
    actionType: "none",
  },
  NIGHT_START: {
    phase: "NIGHT_START",
    description: "phase.nightStart.description",
    requiresHumanInput: () => false,
    canSelectPlayer: () => false,
    actionType: "none",
  },
  NIGHT_GUARD_ACTION: {
    phase: "NIGHT_GUARD_ACTION",
    description: "phase.nightGuard.description",
    humanDescription: (hp) => {
      const { t } = getI18n();
      return hp?.role === "Guard" ? t("phase.nightGuard.human") : t("phase.nightGuard.description");
    },
    requiresHumanInput: (hp) => hp?.alive && hp?.role === "Guard" || false,
    canSelectPlayer: (hp, target, gs) => {
      if (!hp || hp.role !== "Guard" || !target.alive) return false;
      // 不能连续保护同一人
      if (gs.nightActions.lastGuardTarget === target.seat) return false;
      return true;
    },
    actionType: "night_action",
  },
  NIGHT_MUTE_ACTION: {
    phase: "NIGHT_MUTE_ACTION",
    description: "phase.nightMute.description",
    humanDescription: () => {
      const { t } = getI18n();
      return t("phase.nightMute.human");
    },
    // 真人禁言長老：選一個存活玩家（不能選自己、不能選死訊未公布的死者）
    requiresHumanInput: (hp) => hp?.alive && hp?.role === "MuteElder" || false,
    canSelectPlayer: (hp, target, gs) => {
      if (!hp || hp.role !== "MuteElder") return false;
      return isValidMuteTarget(gs, hp.seat, target.seat);
    },
    actionType: "night_action",
  },
  NIGHT_WOLF_BEAUTY_ACTION: {
    phase: "NIGHT_WOLF_BEAUTY_ACTION",
    description: "phase.nightWolfBeauty.description",
    humanDescription: () => {
      const { t } = getI18n();
      return t("phase.nightWolfBeauty.human");
    },
    // 真人狼美人：選一名存活玩家魅惑（不能選自己、不能選死訊未公布的死者）
    requiresHumanInput: (hp) => (hp?.alive && hp?.role === "WolfBeauty") || false,
    canSelectPlayer: (hp, target, gs) => {
      if (!hp || hp.role !== "WolfBeauty") return false;
      return isValidWolfBeautyTarget(gs, hp.seat, target.seat);
    },
    actionType: "night_action",
  },
  NIGHT_DREAM_ACTION: {
    phase: "NIGHT_DREAM_ACTION",
    description: "phase.nightDream.description",
    humanDescription: () => {
      const { t } = getI18n();
      return t("phase.nightDream.human");
    },
    // 真人攝夢人：選一名存活玩家當夢游者（不能選自己、不能選死訊未公布的死者）
    requiresHumanInput: (hp) => hp?.alive && hp?.role === "Dreamweaver" || false,
    canSelectPlayer: (hp, target, gs) => {
      if (!hp || hp.role !== "Dreamweaver") return false;
      return isValidDreamTarget(gs, hp.seat, target.seat);
    },
    actionType: "night_action",
  },
  NIGHT_MAGICIAN_ACTION: {
    phase: "NIGHT_MAGICIAN_ACTION",
    description: "phase.nightMagician.description",
    humanDescription: () => {
      const { t } = getI18n();
      return t("phase.nightMagician.human");
    },
    // 真人魔術師要選**兩張卡**（交換是兩人一組的決定）。面板與路由都讀
    // rules/human-input.ts 的 TWO_SEAT_ACTION_PHASES——那份清單是單一真相，
    // human-input.test.ts 會反過來檢查這裡宣告的階段一定接得住。
    requiresHumanInput: (hp, state) =>
      hp?.role === "Magician" && hp.alive && state.nightActions.magicianSwap === undefined,
    canSelectPlayer: (hp, target, gs) => {
      if (!hp || hp.role !== "Magician") return false;
      return getSwapEligibleSeats(gs).includes(target.seat);
    },
    actionType: "night_action",
  },
  NIGHT_WOLF_ACTION: {
    phase: "NIGHT_WOLF_ACTION",
    description: "phase.nightWolf.description",
    humanDescription: (hp) => {
      const { t } = getI18n();
      return hp ? isWolfRole(hp.role) ? t("phase.nightWolf.human") : t("phase.nightWolf.description") : t("phase.nightWolf.description");
    },
    requiresHumanInput: (hp) => hp?.alive && isWolfRole(hp?.role ?? "Villager") || false,
    canSelectPlayer: (hp, target, state) => {
      if (!hp || !isWolfRole(hp.role) || !target.alive) return false;
      // 狼人可以刀任何存活玩家（包括队友和自己），但不能刀狼美人（官方規則：不能自刀）
      return getWolfKnifeEligibleSeats(state).includes(target.seat);
    },
    actionType: "night_action",
  },
  NIGHT_WITCH_ACTION: {
    phase: "NIGHT_WITCH_ACTION",
    description: "phase.nightWitch.description",
    humanDescription: (hp) => {
      const { t } = getI18n();
      return hp?.role === "Witch" ? t("phase.nightWitch.human") : t("phase.nightWitch.description");
    },
    requiresHumanInput: (hp, gs) => {
      if (!hp?.alive || hp?.role !== "Witch") return false;
      return !gs.roleAbilities.witchHealUsed || !gs.roleAbilities.witchPoisonUsed;
    },
    canSelectPlayer: (hp, target, gs) => {
      if (!hp || hp.role !== "Witch" || !target.alive) return false;
      // 毒药已用则不能选
      if (gs.roleAbilities.witchPoisonUsed) return false;
      return true;
    },
    actionType: "special",
  },
  NIGHT_SEER_ACTION: {
    phase: "NIGHT_SEER_ACTION",
    description: "phase.nightSeer.description",
    humanDescription: (hp) => {
      const { t } = getI18n();
      return hp?.role === "Seer" ? t("phase.nightSeer.human") : t("phase.nightSeer.description");
    },
    requiresHumanInput: (hp) => hp?.alive && hp?.role === "Seer" || false,
    canSelectPlayer: (hp, target, gs) => {
      if (!hp || hp.role !== "Seer" || !target.alive || target.isHuman) return false;
      // Seer can only check once per night
      if (gs.nightActions.seerTarget !== undefined) return false;
      return true;
    },
    actionType: "night_action",
  },
  NIGHT_RESOLVE: {
    phase: "NIGHT_RESOLVE",
    description: "phase.nightResolve.description",
    requiresHumanInput: () => false,
    canSelectPlayer: () => false,
    actionType: "none",
  },
  DAY_START: {
    phase: "DAY_START",
    description: "phase.dayStart.description",
    requiresHumanInput: () => false,
    canSelectPlayer: () => false,
    actionType: "none",
  },
  DAY_BADGE_SIGNUP: {
    phase: "DAY_BADGE_SIGNUP",
    description: "phase.badgeSignup.description",
    humanDescription: (hp, gs) => {
      const { t } = getI18n();
      return hp?.alive && typeof gs.badge.signup?.[hp.playerId] !== "boolean"
        ? t("phase.badgeSignup.human")
        : t("phase.badgeSignup.description");
    },
    requiresHumanInput: (hp, gs) => hp?.alive && typeof gs.badge.signup?.[hp.playerId] !== "boolean" || false,
    canSelectPlayer: () => false,
    actionType: "special",
  },
  DAY_BADGE_SPEECH: {
    phase: "DAY_BADGE_SPEECH",
    description: "phase.badgeSpeech.description",
    humanDescription: (hp, gs) => {
      const { t } = getI18n();
      return gs.currentSpeakerSeat === hp?.seat
        ? t("phase.speechYourTurn")
        : t("phase.badgeSpeech.description");
    },
    requiresHumanInput: (hp, gs) => hp?.alive && gs.currentSpeakerSeat === hp?.seat || false,
    canSelectPlayer: () => false,
    actionType: "speech",
  },
  DAY_BADGE_ELECTION: {
    phase: "DAY_BADGE_ELECTION",
    description: "phase.badgeElection.description",
    humanDescription: (hp, gs) => {
      const { t } = getI18n();
      const candidates = gs.badge.candidates || [];
      if (candidates.length === 0) return t("phase.badgeElection.description");
      if (hp && candidates.includes(hp.seat)) return t("phase.badgeElection.noVote");
      return hp?.alive && typeof gs.badge.votes[hp.playerId] !== "number"
        ? t("phase.badgeElection.human")
        : t("phase.badgeElection.description");
    },
    requiresHumanInput: (hp, gs) => {
      if (!hp?.alive) return false;
      // 候选人不需要投票
      const candidates = gs.badge.candidates || [];
      if (candidates.length === 0) return false;
      if (candidates.includes(hp.seat)) return false;
      return typeof gs.badge.votes[hp.playerId] !== "number";
    },
    canSelectPlayer: (hp, target, gs) => {
      if (!hp?.alive || !target.alive) return false;
      if (target.isHuman) return false;
      // 候选人不能投票
      const candidates = gs.badge.candidates || [];
      if (candidates.length === 0) return false;
      if (candidates.includes(hp.seat)) return false;
      if (typeof gs.badge.votes[hp.playerId] === "number") return false;
      if (candidates.length > 0 && !candidates.includes(target.seat)) return false;
      return true;
    },
    actionType: "vote",
  },
  DAY_PK_SPEECH: {
    phase: "DAY_PK_SPEECH",
    description: "phase.pkSpeech.description",
    humanDescription: (hp, gs) => {
      const { t } = getI18n();
      return gs.currentSpeakerSeat === hp?.seat ? t("phase.speechYourTurn") : t("phase.pkSpeech.description");
    },
    requiresHumanInput: (hp, gs) => hp?.alive && gs.currentSpeakerSeat === hp?.seat || false,
    canSelectPlayer: () => false,
    actionType: "speech",
  },
  DAY_SPEECH: {
    phase: "DAY_SPEECH",
    description: "phase.daySpeech.description",
    humanDescription: (hp, gs) => {
      const { t } = getI18n();
      return gs.currentSpeakerSeat === hp?.seat ? t("phase.speechYourTurn") : t("phase.daySpeech.description");
    },
    requiresHumanInput: (hp, gs) => hp?.alive && gs.currentSpeakerSeat === hp?.seat || false,
    canSelectPlayer: () => false,
    actionType: "speech",
  },
  DAY_LAST_WORDS: {
    phase: "DAY_LAST_WORDS",
    description: "phase.lastWords.description",
    requiresHumanInput: (hp, gs) => gs.currentSpeakerSeat === hp?.seat || false,
    canSelectPlayer: () => false,
    actionType: "speech",
  },
  DAY_VOTE: {
    phase: "DAY_VOTE",
    description: "phase.dayVote.description",
    humanDescription: (hp, gs) => {
      const { t } = getI18n();
      // 已翻牌白痴不能投票
      if (hp?.role === "Idiot" && gs.roleAbilities.idiotRevealed) {
        return t("phase.dayVote.noVoteIdiot");
      }
      // PK投票时，参与PK的人不能投票
      if (gs.pkSource === "vote" && Array.isArray(gs.pkTargets) && gs.pkTargets.length > 0) {
        if (hp && gs.pkTargets.includes(hp.seat)) {
          return t("phase.dayVote.noVotePk");
        }
      }
      return hp?.alive && typeof gs.votes[hp?.playerId || ""] !== "number"
        ? t("phase.dayVote.human")
        : t("phase.dayVote.description");
    },
    requiresHumanInput: (hp, gs) => {
      if (!hp?.alive) return false;
      // Revealed Idiot cannot vote
      if (hp.role === "Idiot" && gs.roleAbilities.idiotRevealed) return false;
      // PK投票时，参与PK的人不需要投票
      if (gs.pkSource === "vote" && Array.isArray(gs.pkTargets) && gs.pkTargets.length > 0) {
        if (gs.pkTargets.includes(hp.seat)) return false;
      }
      return typeof gs.votes[hp?.playerId || ""] !== "number";
    },
    canSelectPlayer: (hp, target, gs) => {
      if (!hp?.alive || target.isHuman || !target.alive) return false;
      // Revealed Idiot cannot vote
      if (hp.role === "Idiot" && gs.roleAbilities.idiotRevealed) return false;
      if (typeof gs.votes[hp.playerId] === "number") return false;
      // PK投票时，参与PK的人不能投票
      if (gs.pkSource === "vote" && Array.isArray(gs.pkTargets) && gs.pkTargets.length > 0) {
        if (gs.pkTargets.includes(hp.seat)) return false;
        return gs.pkTargets.includes(target.seat);
      }
      if (gs.pkSource === "vote" && Array.isArray(gs.pkTargets) && gs.pkTargets.length === 0) {
        return false;
      }
      return true;
    },
    actionType: "vote",
  },
  DAY_RESOLVE: {
    phase: "DAY_RESOLVE",
    description: "phase.dayResolve.description",
    requiresHumanInput: () => false,
    canSelectPlayer: () => false,
    actionType: "none",
  },
  BADGE_TRANSFER: {
    phase: "BADGE_TRANSFER",
    description: "phase.badgeTransfer.description",
    humanDescription: () => {
      const { t } = getI18n();
      return t("phase.badgeTransfer.human");
    },
    requiresHumanInput: (hp, gs) => {
      // 只有当人类玩家是死亡的警长时才需要输入
      const sheriffSeat = gs.badge.holderSeat;
      return hp?.seat === sheriffSeat && !hp?.alive || false;
    },
    canSelectPlayer: (hp, target, gs) => {
      // 只能选择存活的非自己的玩家
      if (!target.alive || target.isHuman) return false;
      const sheriffSeat = gs.badge.holderSeat;
      if (hp?.seat !== sheriffSeat) return false;
      return true;
    },
    actionType: "vote",
  },
  HUNTER_SHOOT: {
    phase: "HUNTER_SHOOT",
    description: "phase.hunterShoot.description",
    humanDescription: (hp) => {
      const { t } = getI18n();
      // 獵人槍與狼王槍共用這個開槍窗口
      return hp && getDeathShotKind(hp.role) !== "none"
        ? t("phase.hunterShoot.human")
        : t("phase.hunterShoot.description");
    },
    requiresHumanInput: (hp, gs) =>
      Boolean(hp && getDeathShotKind(hp.role) !== "none" && gs.roleAbilities.hunterCanShoot) || false,
    canSelectPlayer: (hp, target) => {
      if (!hp || getDeathShotKind(hp.role) === "none" || !target.alive || target.isHuman) return false;
      return true;
    },
    actionType: "night_action",
  },
  SELF_DESTRUCT: {
    phase: "SELF_DESTRUCT",
    description: "phase.selfDestruct.description",
    humanDescription: (hp) => {
      const { t } = getI18n();
      return getRoleCapabilities(hp?.role ?? "Villager").boomTakesPlayer
        ? t("phase.selfDestruct.human")
        : t("phase.selfDestruct.description");
    },
    // 只有「能帶人」的角色需要選目標（白狼王）；普通狼自爆不選人
    requiresHumanInput: (hp, gs) =>
      Boolean(
        hp?.alive &&
          getRoleCapabilities(hp.role).boomTakesPlayer &&
          !hasAlreadyBoomed(gs.roleAbilities.boomedSeats, hp.seat)
      ) || false,
    canSelectPlayer: (hp, target, gs) => {
      if (!hp || !getRoleCapabilities(hp.role).boomTakesPlayer || !target.alive || target.isHuman) return false;
      // 第一夜死者即使死訊還沒公布也已經算出局，不能當作自爆帶走的目標
      if (isPendingDeath(gs, target.seat)) return false;
      return true;
    },
    actionType: "night_action",
  },
  KNIGHT_DUEL: {
    phase: "KNIGHT_DUEL",
    description: "phase.knightDuel.description",
    humanDescription: () => {
      const { t } = getI18n();
      return t("phase.knightDuel.human");
    },
    // 騎士翻牌後進入這個階段選目標（一場一次）
    requiresHumanInput: (hp, gs) =>
      Boolean(
        hp?.alive &&
          getRoleCapabilities(hp.role).canDuel &&
          !hasAlreadyDueled(gs.roleAbilities.duelUsedSeats, hp.seat)
      ) || false,
    canSelectPlayer: (hp, target, gs) => {
      if (!hp?.alive || !getRoleCapabilities(hp.role).canDuel) return false;
      if (!target.alive || target.isHuman) return false;
      if (target.seat === hp.seat) return false;
      // 已經出局的人（含死訊未公布的第一夜死者）不能挑戰
      if (isPendingDeath(gs, target.seat)) return false;
      return true;
    },
    actionType: "night_action",
  },
  GAME_END: {
    phase: "GAME_END",
    description: "phase.gameEnd.description",
    humanDescription: (_, gs) => {
      const { t } = getI18n();
      return gs.winner === "village" ? t("phase.gameEnd.villageWin") : t("phase.gameEnd.wolfWin");
    },
    requiresHumanInput: () => false,
    canSelectPlayer: () => false,
    actionType: "none",
  },
};

// 当前阶段配置// 当前阶段描述// 是否需要人类输入// 检查是否可以选择某个玩家// 当前操作类型// ============ UI 操作 Atoms ============

// 设置选中的座位// 设置加载状态
export const setLoadingAtom = atom(
  null,
  (get, set, isLoading: boolean) => {
    set(uiStateAtom, (prev) => ({ ...prev, isLoading }));
  }
);

// 设置等待 AI 状态
export const setWaitingForAIAtom = atom(
  null,
  (get, set, isWaitingForAI: boolean) => {
    set(uiStateAtom, (prev) => ({ ...prev, isWaitingForAI }));
  }
);

// 切换日志显示
export const toggleLogAtom = atom(
  null,
  (get, set) => {
    set(uiStateAtom, (prev) => ({ ...prev, showLog: !prev.showLog }));
  }
);

// 设置角色揭示弹窗
export const setRoleRevealAtom = atom(
  null,
  (get, set, show: boolean) => {
    set(uiStateAtom, (prev) => ({ ...prev, showRoleReveal: show }));
  }
);

// 重置游戏（用于开始新游戏，保留持久化状态直到新游戏开始）
export const resetGameAtom = atom(null, (get, set) => {
  set(gameStateAtom, createInitialGameState());
  set(dialogueAtom, null);
  set(inputTextAtom, "");
  set(uiStateAtom, {
    isLoading: false,
    isWaitingForAI: false,
    showTable: false,
    selectedSeat: null,
    showRoleReveal: false,
    showLog: false,
  });
  set(gameAnalysisAtom, null);
  set(analysisLoadingAtom, false);
  set(analysisErrorAtom, null);
});

// ============ 状态机转换规则 ============

/**
 * 定义有效的阶段转换
 * key: 当前阶段
 * value: 可转换到的阶段列表
 */
export const VALID_TRANSITIONS: Record<Phase, Phase[]> = {
  LOBBY: ["SETUP"],
  SETUP: ["NIGHT_START"],
  
  // 夜晚流程: 守卫 -> 禁言长老 -> 摄梦人 -> 狼人 -> 女巫 -> 预言家 -> 结算
  NIGHT_START: ["NIGHT_GUARD_ACTION", "NIGHT_MUTE_ACTION", "NIGHT_DREAM_ACTION", "NIGHT_MAGICIAN_ACTION", "NIGHT_WOLF_ACTION"],
  NIGHT_GUARD_ACTION: ["NIGHT_MUTE_ACTION", "NIGHT_DREAM_ACTION", "NIGHT_MAGICIAN_ACTION", "NIGHT_WOLF_ACTION"],
  NIGHT_MUTE_ACTION: ["NIGHT_DREAM_ACTION", "NIGHT_MAGICIAN_ACTION", "NIGHT_WOLF_ACTION"],
  NIGHT_DREAM_ACTION: ["NIGHT_MAGICIAN_ACTION", "NIGHT_WOLF_ACTION"],
  NIGHT_MAGICIAN_ACTION: ["NIGHT_WOLF_ACTION"],
  // 沒有狼美人的盤：狼刀之後直接進女巫（與禁言長老／攝夢人同樣會整步略過）
  NIGHT_WOLF_ACTION: ["NIGHT_WOLF_BEAUTY_ACTION", "NIGHT_WITCH_ACTION"],
  NIGHT_WOLF_BEAUTY_ACTION: ["NIGHT_WITCH_ACTION"],
  NIGHT_WITCH_ACTION: ["NIGHT_SEER_ACTION"],
  NIGHT_SEER_ACTION: ["NIGHT_RESOLVE"],
  NIGHT_RESOLVE: ["DAY_START", "HUNTER_SHOOT", "BADGE_TRANSFER", "GAME_END"],
  
  // 白天流程: 开始 -> 发言 -> 投票 -> 结算
  DAY_START: ["DAY_BADGE_SIGNUP", "DAY_SPEECH"],
  DAY_BADGE_SIGNUP: ["DAY_BADGE_SPEECH", "DAY_SPEECH"],
  DAY_BADGE_SPEECH: ["DAY_BADGE_ELECTION", "SELF_DESTRUCT"],
  DAY_BADGE_ELECTION: ["DAY_PK_SPEECH", "DAY_SPEECH"],
  DAY_PK_SPEECH: ["DAY_BADGE_ELECTION", "DAY_VOTE", "SELF_DESTRUCT"],
  DAY_SPEECH: ["DAY_VOTE", "SELF_DESTRUCT", "KNIGHT_DUEL"],
  DAY_VOTE: ["DAY_RESOLVE"],
  DAY_RESOLVE: ["DAY_PK_SPEECH", "DAY_LAST_WORDS", "BADGE_TRANSFER", "NIGHT_START", "GAME_END"],
  DAY_LAST_WORDS: ["NIGHT_START", "HUNTER_SHOOT", "BADGE_TRANSFER", "GAME_END"],
  
  // 特殊阶段
  BADGE_TRANSFER: ["DAY_LAST_WORDS", "HUNTER_SHOOT", "NIGHT_START", "DAY_SPEECH", "GAME_END"],
  HUNTER_SHOOT: ["DAY_START", "NIGHT_START", "BADGE_TRANSFER", "GAME_END"],
  SELF_DESTRUCT: ["NIGHT_START", "HUNTER_SHOOT", "GAME_END", "BADGE_TRANSFER", "DAY_LAST_WORDS"],
  // 決鬥成功＝直接天黑（也可能先移交警徽或補發表遺言）；失敗＝回到白天發言階段繼續
  KNIGHT_DUEL: ["NIGHT_START", "HUNTER_SHOOT", "GAME_END", "BADGE_TRANSFER", "DAY_LAST_WORDS", "DAY_SPEECH"],
  GAME_END: ["LOBBY"], // 允许重新开始
};

/**
 * 检查阶段转换是否有效
 */
export function isValidTransition(from: Phase, to: Phase): boolean {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets?.includes(to) ?? false;
}

/**
 * 安全的阶段转换 atom
 * 如果转换无效，会抛出错误（开发环境）或记录警告（生产环境）
 */// ============ 夜晚阶段处理 ============

/**
 * 检查某个角色是否需要在当前夜晚行动
 *//**
 * 获取下一个夜晚阶段
 */