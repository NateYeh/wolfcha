import { isWolfRole } from "@/types/game";
import type { GameState, Phase, Player, Role } from "@/types/game";
import { getDeathShotKind } from "./death-skills";
import { hasAlreadyDueled } from "./knight-duel";
import { getRoleCapabilities } from "./roles";
import { hasAlreadyBoomed } from "./self-destruct";

/**
 * 真人玩家的「點座位 → 確認」行動入口。
 *
 * 這裡是**兩件事的單一真相**，兩邊必須同時涵蓋同一個階段：
 *
 * 1. `DialogArea` 的確認面板出不出得來（`canHumanConfirmSeatAction`）
 * 2. `page.tsx` 的 `confirmSelectedSeat` 有沒有把這個階段送去 `handleNightAction`
 *    （`SEAT_ACTION_CONFIRM_PHASES`）
 *
 * 少寫任一邊就會出現「按了沒反應」而不會有任何錯誤訊息：
 *
 * - 只在面板那側 → 面板出現、按下去沒反應（真人攝夢人：面板有、路由漏了）
 * - 只在路由那側 → 連面板都不會出現，階段永遠停在原地（真人狼美人：面板漏了）
 *
 * `human-input.test.ts` 會用狀態機（`PHASE_CONFIGS[...].requiresHumanInput`）反過來
 * 檢查「只要狀態機說真人要行動，這裡就一定接得住」。
 */

/** 由 `confirmSelectedSeat` 轉發到 `handleNightAction` 的階段（其餘階段有自己的處理器）。 */
export const SEAT_ACTION_CONFIRM_PHASES: readonly Phase[] = [
  "NIGHT_GUARD_ACTION",
  "NIGHT_MUTE_ACTION",
  "NIGHT_DREAM_ACTION",
  "NIGHT_MAGICIAN_ACTION",
  "NIGHT_WOLF_ACTION",
  "NIGHT_WOLF_BEAUTY_ACTION",
  "NIGHT_SEER_ACTION",
  "HUNTER_SHOOT",
  "SELF_DESTRUCT",
  "KNIGHT_DUEL",
];

/**
 * 需要**點兩張卡**的階段（目前只有魔術師的交換）。
 *
 * 這是「兩段式選取」的單一真相：面板要收兩張卡、路由要送兩個座位，兩邊都讀這裡。
 * 少寫任一邊的症狀與單座位那批一模一樣（按了沒反應／面板不出現），所以
 * `human-input.test.ts` 會反過來檢查「需要兩張卡的階段一定同時在兩個清單裡」。
 */
export const TWO_SEAT_ACTION_PHASES: readonly Phase[] = ["NIGHT_MAGICIAN_ACTION"];

/** 這個階段要點幾張卡（1 = 舊的單座位行為）。 */
export const seatActionPickCount = (phase: Phase): 1 | 2 => (TWO_SEAT_ACTION_PHASES.includes(phase) ? 2 : 1);

/** 這個階段是否要點兩張卡。 */
export const requiresTwoSeats = (phase: Phase): boolean => seatActionPickCount(phase) === 2;

/** 這個階段的行動是否由「點座位 → 確認」面板送出。 */
export const isSeatActionConfirmPhase = (phase: Phase): boolean => SEAT_ACTION_CONFIRM_PHASES.includes(phase);

/** 夜間行動的階段（給測試與 UI 判斷共用）。 */
export const NIGHT_SEAT_ACTION_PHASES: readonly Phase[] = SEAT_ACTION_CONFIRM_PHASES.filter((phase) =>
  phase.startsWith("NIGHT_")
);

/**
 * 這個階段的人類玩家是否該看到「點座位 → 確認」面板。
 *
 * 逐階段的角色與狀態條件（例如「已經選過就不能再選」）都在這裡，UI 不再自己重寫一份。
 * 女巫與守衛空守另有專屬面板，所以 `NIGHT_WITCH_ACTION`／`NIGHT_GUARD_ACTION` 的
 * 空守分支不在這裡。
 */
export const canHumanConfirmSeatAction = (
  phase: Phase,
  human: Player | null | undefined,
  state: GameState
): boolean => {
  const role = human?.role ?? "Villager";
  switch (phase) {
    case "DAY_VOTE":
      return Boolean(human?.alive);
    case "DAY_BADGE_ELECTION": {
      const badgeCandidates = state.badge.candidates || [];
      return Boolean(human?.alive && !badgeCandidates.includes(human.seat));
    }
    case "NIGHT_SEER_ACTION":
      return Boolean(human?.role === "Seer" && human.alive && state.nightActions.seerTarget === undefined);
    case "NIGHT_WOLF_ACTION":
      // 狼陣營（含狼王、狼美人）一起出刀，所以用 isWolfRole 而不是單一角色。
      return Boolean(human && isWolfRole(role) && human.alive);
    case "NIGHT_GUARD_ACTION":
      return Boolean(human?.role === "Guard" && human.alive);
    case "NIGHT_MUTE_ACTION":
      return Boolean(
        human?.role === "MuteElder" && human.alive && state.nightActions.mutedTarget === undefined
      );
    case "NIGHT_DREAM_ACTION":
      return Boolean(
        human?.role === "Dreamweaver" && human.alive && state.nightActions.dreamTarget === undefined
      );
    case "NIGHT_WOLF_BEAUTY_ACTION":
      return Boolean(
        human?.role === "WolfBeauty" && human.alive && state.nightActions.wolfBeautyTarget === undefined
      );
    case "NIGHT_MAGICIAN_ACTION":
      // 交換是「兩人一組」的決定：寫入 magicianSwap 之後就不再要求輸入
      return Boolean(human?.role === "Magician" && human.alive && state.nightActions.magicianSwap === undefined);
    case "HUNTER_SHOOT":
      return getDeathShotKind(role) !== "none";
    case "BADGE_TRANSFER":
      return Boolean(human && state.badge.holderSeat === human.seat);
    case "SELF_DESTRUCT":
      return Boolean(
        human?.alive &&
          getRoleCapabilities(role).boomTakesPlayer &&
          !hasAlreadyBoomed(state.roleAbilities.boomedSeats, human.seat)
      );
    case "KNIGHT_DUEL":
      return Boolean(
        human?.alive &&
          getRoleCapabilities(role).canDuel &&
          !hasAlreadyDueled(state.roleAbilities.duelUsedSeats, human.seat)
      );
    default:
      return false;
  }
};

/** 由角色推導「這個階段該由誰行動」；測試用。 */
export const seatActionRole = (phase: Phase): Role | undefined => {
  switch (phase) {
    case "NIGHT_SEER_ACTION":
      return "Seer";
    case "NIGHT_WOLF_ACTION":
      return "Werewolf";
    case "NIGHT_GUARD_ACTION":
      return "Guard";
    case "NIGHT_MUTE_ACTION":
      return "MuteElder";
    case "NIGHT_DREAM_ACTION":
      return "Dreamweaver";
    case "NIGHT_WOLF_BEAUTY_ACTION":
      return "WolfBeauty";
    case "NIGHT_MAGICIAN_ACTION":
      return "Magician";
    default:
      return undefined;
  }
};
