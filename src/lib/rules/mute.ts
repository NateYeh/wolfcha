import type { GameState, Phase } from "@/types/game";

/**
 * 禁言長老（MuteElder）規則（單一真相）。
 *
 * - 每晚指定一名**存活玩家**禁言（不能指定自己；沒有次數上限，可以連續禁言同一人）。
 * - 被禁言者**次日白天不能發言**，含警徽競選發言。
 * - 只限制發言：**警徽競選投票、放逐投票、遺言都不受限**。
 * - 禁言是公開資訊（天亮時主持人會宣布誰被禁言），因此 prompt 的公共區塊也看得到。
 *
 * 副作用（規則的自然結果，不是額外限制）：被禁言的狼人當天沒有發言輪，
 * 因此也無法在當天自爆。
 */

/** 會被禁言影響的發言階段（遺言明確不受限） */
export const MUTE_BLOCKED_SPEECH_PHASES: readonly Phase[] = [
  "DAY_SPEECH",
  "DAY_BADGE_SPEECH",
  "DAY_PK_SPEECH",
] as const;

/** 當日被禁言的座位（nightActions.mutedTarget），沒有則 null */
export function getMutedSeat(state: GameState): number | null {
  const seat = state.nightActions?.mutedTarget;
  return typeof seat === "number" && seat >= 0 ? seat : null;
}

/** 這個座位今天是否被禁言 */
export function isMutedSeat(state: GameState, seat: number): boolean {
  return getMutedSeat(state) === seat;
}

/** 這個座位在這個階段能不能發言（唯一判斷點，發言順序與 prompt 共用） */
export function canSpeakInPhase(state: GameState, seat: number, phase: Phase): boolean {
  if (!isMutedSeat(state, seat)) return true;
  return !MUTE_BLOCKED_SPEECH_PHASES.includes(phase);
}

/** 禁言長老可以指定的目標：存活、不能是自己、不能是死訊未公布的死者 */
export function getMuteEligibleSeats(state: GameState, elderSeat: number): number[] {
  const pending = new Set<number>();
  const { pendingWolfVictim, pendingPoisonVictim } = state.nightActions ?? {};
  if (typeof pendingWolfVictim === "number") pending.add(pendingWolfVictim);
  if (typeof pendingPoisonVictim === "number") pending.add(pendingPoisonVictim);
  return state.players
    .filter((player) => player.alive && player.seat !== elderSeat && !pending.has(player.seat))
    .map((player) => player.seat);
}

/** 這個禁言目標是否合法（AI 契約與真人 UI 共用） */
export function isValidMuteTarget(state: GameState, elderSeat: number, targetSeat: number): boolean {
  return getMuteEligibleSeats(state, elderSeat).includes(targetSeat);
}
