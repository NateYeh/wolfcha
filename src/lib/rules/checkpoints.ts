import type { GameState, Phase } from "@/types/game";
import {
  dreamDecided,
  guardDecided,
  muteDecided,
  seerDecided,
  witchDecided,
  wolfDecided,
} from "./night-progress";

/**
 * 每個階段「這份狀態落盤安不安全」與「動作未完成時退回哪個穩定點」。
 *
 * 這兩張表原本以 `switch` 寫在 `src/store/game-machine.ts`，且**兩者都有 `default`**：
 * `isCheckpointSafe` 的 default 是 `false`、`getRestorePhase` 的 default 是「回退到自己」。
 * 因此不在 case 裡的階段會同時得到「不准存檔」與「回退點是自己」——
 * 禁言長老（`NIGHT_MUTE_ACTION`）與攝夢人（`NIGHT_DREAM_ACTION`）就是掉進去的那兩個：
 *
 * - `useGameLogic` 的恢復鏈**早已**為這兩個階段寫好「已決定則續跑」的判定
 *   （用 `nightActions.mutedTarget`／`dreamTarget`），與守衛／女巫／預言家同一形狀；
 * - 但存檔端的 default 讓它們永遠無法落盤，刷新後只能從更早的檢查點重播。
 *
 * 這是「漏在 default」家族的最後一條（同族的 `DAY_PK_SPEECH`、`NIGHT_MUTE_ACTION` 分類、
 * `KNIGHT_DUEL` 存檔驗證與證據矩陣都已在別處修正）。現在兩張表都是 `Record<Phase, …>`，
 * 新增階段時 tsc 會逼你明示，不再有 default 可以吞。
 *
 * 不變式（由 `checkpoints.test.ts` 斷言）：**動作階段的回退點不得是自己**。
 * 動作階段（`ACTION_PHASES`）的狀態天生可能是「做到一半」的，回退到自己等於把不完整狀態
 * 當成穩定點；若該階段在「已決定」時可存檔，回退點根本不會被諮詢（`getRestorePhase`
 * 先短路回自己），所以「不可存檔 + 回退到自己」只可能是漏寫。
 *
 * 「某一步的決定做完了嗎」由 `./night-progress` 提供（那裡是一夜推進的權威）；
 * 這裡只負責「這份狀態能不能落盤、恢復時退回哪一步」。
 */


/**
 * 每個階段「現在這份狀態存檔安不安全」。投票中的每張已提交票都是穩定事實，
 * 不需要等待整輪完成；未結算的技能中間態仍保留前一個檢查點。
 */
export const CHECKPOINT_SAFE: Record<Phase, (state: GameState) => boolean> = {
  LOBBY: () => false,
  SETUP: () => false,

  // 過渡階段，進入時即可保存
  NIGHT_START: () => true,
  NIGHT_GUARD_ACTION: guardDecided,
  NIGHT_MUTE_ACTION: muteDecided,
  NIGHT_DREAM_ACTION: dreamDecided,
  NIGHT_WOLF_ACTION: wolfDecided,
  NIGHT_WITCH_ACTION: witchDecided,
  NIGHT_SEER_ACTION: seerDecided,
  // 夜晚結算階段很快會進 DAY_START，為安全起見不在這裡保存
  NIGHT_RESOLVE: () => false,

  DAY_START: () => true,
  // 警長競選報名：報名中途也屬「穩定態」，刷新後可繼續等待其他人
  DAY_BADGE_SIGNUP: () => true,
  // 發言階段允許保存（犧牲「刷新後續同一段流式發言」換取恢復顆粒度）
  DAY_BADGE_SPEECH: () => true,
  // 每張已提交的票都是穩定事實；恢復時只補尚未投票的人
  DAY_BADGE_ELECTION: () => true,
  DAY_PK_SPEECH: () => true,
  DAY_SPEECH: () => true,
  DAY_LAST_WORDS: () => true,
  DAY_VOTE: () => true,
  DAY_RESOLVE: () => false,

  BADGE_TRANSFER: () => false,
  HUNTER_SHOOT: () => false,
  SELF_DESTRUCT: () => false,
  KNIGHT_DUEL: () => false,
  GAME_END: () => false,
};

/** 這份狀態現在落盤安不安全。 */
export function isCheckpointSafe(state: GameState): boolean {
  return CHECKPOINT_SAFE[state.phase](state);
}

/**
 * 每個階段「動作未完成時該退到哪個穩定點」。
 *
 * 夜晚的規則是「退到前一個『已決定』的階段，都沒有就退到 `NIGHT_START`」，
 * 與 `CHECKPOINT_SAFE` 用同一組判定（同一個角色不會有兩種『已決定』）。
 *
 * 大廳／設定／自爆／決鬥／對局結束的「回退點＝自己」是正確的：它們是靜止點，
 * 不是「做到一半」的動作階段，所以不適用不變式。
 */
export const RESTORE_FALLBACK: Record<Phase, (state: GameState) => Phase> = {
  LOBBY: (state) => state.phase,
  SETUP: (state) => state.phase,

  NIGHT_START: (state) => state.phase,
  NIGHT_GUARD_ACTION: () => "NIGHT_START",
  NIGHT_MUTE_ACTION: (state) => (guardDecided(state) ? "NIGHT_GUARD_ACTION" : "NIGHT_START"),
  NIGHT_DREAM_ACTION: (state) => {
    if (muteDecided(state)) return "NIGHT_MUTE_ACTION";
    return guardDecided(state) ? "NIGHT_GUARD_ACTION" : "NIGHT_START";
  },
  NIGHT_WOLF_ACTION: (state) => (guardDecided(state) ? "NIGHT_GUARD_ACTION" : "NIGHT_START"),
  NIGHT_WITCH_ACTION: (state) =>
    // 這裡刻意直接看欄位（不用 wolfDecided）：沒有存活狼人時 wolfTarget 仍是 undefined，
    // 回退到 NIGHT_START 與原本行為一致，而該階段的續跑會自行判斷狼人是否存在。
    state.nightActions.wolfTarget !== undefined ? "NIGHT_WOLF_ACTION" : "NIGHT_START",
  NIGHT_SEER_ACTION: (state) => {
    if (witchDecided(state)) return "NIGHT_WITCH_ACTION";
    return state.nightActions.wolfTarget !== undefined ? "NIGHT_WOLF_ACTION" : "NIGHT_START";
  },
  // 回到預言家階段
  NIGHT_RESOLVE: () => "NIGHT_SEER_ACTION",

  // 以下白天階段的 CHECKPOINT_SAFE 恆為 true，不會走到這裡；保留明確值以滿足 Record
  DAY_START: () => "DAY_START",
  DAY_BADGE_SIGNUP: () => "DAY_START",
  DAY_BADGE_SPEECH: () => "DAY_START",
  DAY_BADGE_ELECTION: () => "DAY_START",
  DAY_PK_SPEECH: () => "DAY_START",
  DAY_SPEECH: () => "DAY_START",
  DAY_LAST_WORDS: () => "DAY_START",
  DAY_VOTE: () => "DAY_START",
  // 白天的複雜階段，回到 DAY_START
  DAY_RESOLVE: () => "DAY_START",

  BADGE_TRANSFER: () => "DAY_START",
  HUNTER_SHOOT: () => "DAY_START",
  SELF_DESTRUCT: (state) => state.phase,
  KNIGHT_DUEL: (state) => state.phase,
  GAME_END: (state) => state.phase,
};

/**
 * 還原存檔時使用的 phase：動作已完成就直接回到當前階段，否則回退到上一個穩定點。
 */
export function getRestorePhase(state: GameState): Phase {
  if (isCheckpointSafe(state)) {
    return state.phase;
  }
  return RESTORE_FALLBACK[state.phase](state);
}
