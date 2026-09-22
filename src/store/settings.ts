import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { ALL_ROLE_KEYS, getBoardById } from "@/lib/rules/boards";
import { ROSTER_POOL_IDS } from "@/lib/roster-pool-ids";
import type { DifficultyLevel, Role } from "@/types/game";

export interface AudioSettings {
  bgmVolume: number;
  isSoundEnabled: boolean;
  isAiVoiceEnabled: boolean;
  isGenshinMode: boolean;
  isAutoAdvanceDialogueEnabled: boolean;
  isSpectatorMode: boolean;
  isAcquaintanceGame: boolean;
}

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  bgmVolume: 0.35,
  isSoundEnabled: true,
  isAiVoiceEnabled: true,
  isGenshinMode: false,
  isAutoAdvanceDialogueEnabled: false,
  isSpectatorMode: false,
  isAcquaintanceGame: false,
};

const clampVolume = (value: number) => Math.min(1, Math.max(0, value));

const normalizeAudioSettings = (value: Partial<AudioSettings>): AudioSettings => ({
  bgmVolume: clampVolume(
    typeof value.bgmVolume === "number" ? value.bgmVolume : DEFAULT_AUDIO_SETTINGS.bgmVolume
  ),
  isSoundEnabled:
    typeof value.isSoundEnabled === "boolean" ? value.isSoundEnabled : DEFAULT_AUDIO_SETTINGS.isSoundEnabled,
  isAiVoiceEnabled:
    typeof value.isAiVoiceEnabled === "boolean" ? value.isAiVoiceEnabled : DEFAULT_AUDIO_SETTINGS.isAiVoiceEnabled,
  isGenshinMode:
    typeof value.isGenshinMode === "boolean" ? value.isGenshinMode : DEFAULT_AUDIO_SETTINGS.isGenshinMode,
  isAutoAdvanceDialogueEnabled:
    typeof value.isAutoAdvanceDialogueEnabled === "boolean"
      ? value.isAutoAdvanceDialogueEnabled
      : DEFAULT_AUDIO_SETTINGS.isAutoAdvanceDialogueEnabled,
  isSpectatorMode:
    typeof value.isSpectatorMode === "boolean" ? value.isSpectatorMode : DEFAULT_AUDIO_SETTINGS.isSpectatorMode,
  isAcquaintanceGame:
    typeof value.isAcquaintanceGame === "boolean"
      ? value.isAcquaintanceGame
      : DEFAULT_AUDIO_SETTINGS.isAcquaintanceGame,
});

const rawAudioSettingsAtom = atomWithStorage<AudioSettings>("wolfcha.settings.audio", DEFAULT_AUDIO_SETTINGS);

export const audioSettingsAtom = atom(
  (get) => normalizeAudioSettings(get(rawAudioSettingsAtom)),
  (get, set, update: AudioSettings | ((prev: AudioSettings) => AudioSettings)) => {
    const prev = normalizeAudioSettings(get(rawAudioSettingsAtom));
    const next = typeof update === "function" ? update(prev) : update;
    set(rawAudioSettingsAtom, normalizeAudioSettings(next));
  }
);

const DEFAULT_PLAYER_COUNT = 10;
const MIN_PLAYER_COUNT = 8;
const MAX_PLAYER_COUNT = 12;

const normalizePlayerCount = (value: number) => {
  if (!Number.isFinite(value)) return DEFAULT_PLAYER_COUNT;
  return Math.min(MAX_PLAYER_COUNT, Math.max(MIN_PLAYER_COUNT, Math.round(value)));
};

const rawPlayerCountAtom = atomWithStorage<number>("wolfcha.settings.player_count", DEFAULT_PLAYER_COUNT);

export const playerCountAtom = atom(
  (get) => normalizePlayerCount(get(rawPlayerCountAtom)),
  (get, set, update: number | ((prev: number) => number)) => {
    const prev = normalizePlayerCount(get(rawPlayerCountAtom));
    const next = typeof update === "function" ? update(prev) : update;
    set(rawPlayerCountAtom, normalizePlayerCount(next));
  }
);

// Preferred role setting (empty string means random)
// 角色清單以規則層為單一真相：新增角色（騎士、禁言長老…）不必再改這裡，
// 否則舊的硬編清單會把新角色的偏好直接清成「隨機」。
const normalizePreferredRole = (value: string): Role | "" =>
  ALL_ROLE_KEYS.includes(value as Role) ? (value as Role) : "";

const rawPreferredRoleAtom = atomWithStorage<Role | "">("wolfcha.settings.preferred_role", "");

export const preferredRoleAtom = atom(
  (get) => normalizePreferredRole(get(rawPreferredRoleAtom)),
  (get, set, update: (Role | "") | ((prev: Role | "") => Role | "")) => {
    const prev = normalizePreferredRole(get(rawPreferredRoleAtom));
    const next = typeof update === "function" ? update(prev) : update;
    set(rawPreferredRoleAtom, normalizePreferredRole(next));
  }
);

/**
 * 版型選擇（空字串＝依人數使用預設版型）。
 *
 * 版型決定：開局角色組成、大廳的角色數量摘要、**身份偏好清單**。
 * 人數改變時不需要清掉這裡的值：人數與版型不符時會自動退回該人數的預設版型
 * （見 rules/boards.ts 的 resolveBoardPreset）。
 */
const normalizeBoardId = (value: string): string => (getBoardById(value) ? value : "");

const rawBoardIdAtom = atomWithStorage<string>("wolfcha.settings.board_id", "");

export const boardIdAtom = atom(
  (get) => normalizeBoardId(get(rawBoardIdAtom)),
  (get, set, update: string | ((prev: string) => string)) => {
    const prev = normalizeBoardId(get(rawBoardIdAtom));
    const next = typeof update === "function" ? update(prev) : update;
    set(rawBoardIdAtom, normalizeBoardId(next));
  }
);

const DEFAULT_DIFFICULTY: DifficultyLevel = "normal";
const DIFFICULTY_OPTIONS: DifficultyLevel[] = ["easy", "normal", "hard"];

const normalizeDifficulty = (value: DifficultyLevel) =>
  DIFFICULTY_OPTIONS.includes(value) ? value : DEFAULT_DIFFICULTY;

const rawDifficultyAtom = atomWithStorage<DifficultyLevel>("wolfcha.settings.difficulty", DEFAULT_DIFFICULTY);

const normalizeRosterPoolId = (value: string) =>
  (ROSTER_POOL_IDS as readonly string[]).includes(value) ? value : ROSTER_POOL_IDS[0]!;

const rawRosterPoolIdAtom = atomWithStorage<string>("wolfcha.settings.rosterPool", ROSTER_POOL_IDS[0]!);

export const rosterPoolIdAtom = atom(
  (get) => normalizeRosterPoolId(get(rawRosterPoolIdAtom)),
  (get, set, update: string | ((prev: string) => string)) => {
    const prev = normalizeRosterPoolId(get(rawRosterPoolIdAtom));
    const next = typeof update === "function" ? update(prev) : update;
    set(rawRosterPoolIdAtom, normalizeRosterPoolId(next));
  }
);

export const difficultyAtom = atom(
  (get) => normalizeDifficulty(get(rawDifficultyAtom)),
  (get, set, update: DifficultyLevel | ((prev: DifficultyLevel) => DifficultyLevel)) => {
    const prev = normalizeDifficulty(get(rawDifficultyAtom));
    const next = typeof update === "function" ? update(prev) : update;
    set(rawDifficultyAtom, normalizeDifficulty(next));
  }
);
