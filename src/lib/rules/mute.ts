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

/**
 * 禁言資訊對外公開的階段。
 *
 * 規則是「天亮時主持人宣佈誰被禁言」，所以夜間不該揭露（否則狼隊在夜裡就知道
 * 長老禁了誰）；白天（含競選、發言、投票、自爆／決鬥）則全場可見。
 */
export const MUTE_PUBLIC_PHASES: readonly Phase[] = [
  "DAY_BADGE_ELECTION",
  "DAY_BADGE_SPEECH",
  "DAY_PK_SPEECH",
  "DAY_SPEECH",
  "DAY_VOTE",
  "DAY_LAST_WORDS",
  "SELF_DESTRUCT",
  "KNIGHT_DUEL",
] as const;

/** 現在這個階段，禁言資訊是否可以公開（UI 標記與 prompt 公共區塊共用） */
export function isMutePublic(state: GameState): boolean {
  return MUTE_PUBLIC_PHASES.includes(state.phase);
}

/**
 * 當日被禁言的座位，沒有則 null。
 *
 * 天亮公告時 `nightActions.mutedTarget` 會清空（它只是「已指定、待公告」的暫存），
 * 禁言紀錄則寫進 `dayHistory[day].muted`。這裡必須以當日紀錄為準，否則公告之後
 * 就查不到禁言 → 發言順序不會過濾 → 被禁言的人照樣拿到發言輪。
 *
 * 只看當日：禁言不跨日殘留（隔天沒有紀錄就自動失效）。
 */
export function getMutedSeat(state: GameState): number | null {
  const announced = state.dayHistory?.[state.day]?.muted?.seat;
  if (typeof announced === "number" && announced >= 0) return announced;
  const pending = state.nightActions?.mutedTarget;
  return typeof pending === "number" && pending >= 0 ? pending : null;
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
