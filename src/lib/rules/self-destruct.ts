import type { Phase, Role } from "@/types/game";
import type { RuleFlags } from "./flags";
import { getRoleCapabilities } from "./roles";

/**
 * 自爆系統（單一真相）。
 *
 * 規則（2026-09-22 拍板）：
 * - 時機：只有「當前發言者＝自己」，且階段為競選發言／白天發言／PK 發言時可自爆。
 * - 所有狼陣營角色皆可自爆（`RuleFlags.boom.anyWolf`）；自爆者立即出局，
 *   **沒有遺言、也沒有自爆宣言**。
 * - 只有白狼王自爆能帶走一名玩家；被帶走的人沒有遺言，但獵人仍可開槍。
 * - 自爆後直接天黑（跳過當天剩餘發言與放逐投票）。
 * - 警徽競選階段：
 *   - 白狼王競選發言自爆 → 帶走一人＋**警徽流失**（本局再無警長）。
 *   - 普通狼競選發言自爆 → 第 1 次：競選順延到隔天（天亮後**繼續競選**）；
 *     同一個競選階段出現第 2 次狼自爆（雙爆）→ **競選結束、警徽流失**。
 */

/** 可以自爆的階段（只有自己的發言輪才輪得到） */
export const SELF_DESTRUCT_PHASES: readonly Phase[] = [
  "DAY_BADGE_SPEECH",
  "DAY_SPEECH",
  "DAY_PK_SPEECH",
] as const;

/** 自爆結果 */
export interface SelfDestructOutcome {
  /** 是否帶走一名玩家 */
  takesPlayer: boolean;
  /** 是否讓警徽流失（本局再無警長） */
  swallowBadge: boolean;
  /** 是否中斷警徽競選（天亮後續辦） */
  suspendElection: boolean;
}

/** 該階段是否允許自爆 */
export function isSelfDestructPhase(phase: Phase): boolean {
  return SELF_DESTRUCT_PHASES.includes(phase);
}

/** 這個角色現在能不能自爆（階段＋角色能力＋規則旗標） */
export function canSelfDestruct(options: { phase: Phase; role: Role; flags: RuleFlags }): boolean {
  const { phase, role, flags } = options;
  if (!isSelfDestructPhase(phase)) return false;
  const capabilities = getRoleCapabilities(role);
  if (!capabilities.canBoom) return false;
  return flags.boom.anyWolf || capabilities.role === "WhiteWolfKing";
}

/**
 * 結算自爆效果。
 *
 * @param electionBooms 這個競選階段「已經」發生的狼自爆次數（不含本次）
 */
export function resolveSelfDestructOutcome(options: {
  phase: Phase;
  role: Role;
  flags: RuleFlags;
  electionBooms: number;
}): SelfDestructOutcome {
  const { phase, role, flags, electionBooms } = options;
  const capabilities = getRoleCapabilities(role);
  const takesPlayer =
    capabilities.boomTakesPlayer && flags.boom.takesPlayerRoles.includes(capabilities.role);

  // 非競選階段：只跳過當天剩餘流程直接天黑，不動警徽（警長若死則沿用撕徽規則）
  if (phase !== "DAY_BADGE_SPEECH") {
    return { takesPlayer, swallowBadge: false, suspendElection: false };
  }

  // 競選階段：白狼王自爆直接吞警徽；普通狼要「雙爆」才吞
  if (takesPlayer && capabilities.boomSwallowsBadgeOnElection) {
    return { takesPlayer, swallowBadge: true, suspendElection: false };
  }
  const isSecondBoom = electionBooms >= flags.boom.electionBoomSwallowCount - 1;
  return isSecondBoom
    ? { takesPlayer, swallowBadge: true, suspendElection: false }
    : { takesPlayer, swallowBadge: false, suspendElection: true };
}

/** 是否還有自爆機會（自爆者出局，因此以 boomedSeats 防重複） */
export function hasAlreadyBoomed(boomedSeats: number[] | undefined, seat: number): boolean {
  return (boomedSeats ?? []).includes(seat);
}

/** 警徽競選是否被自爆中斷、需要在天亮後續辦 */
export function shouldResumeBadgeElection(state: {
  badge: { holderSeat: number | null; lost?: boolean; electionSuspended?: boolean };
}): boolean {
  return (
    state.badge.electionSuspended === true &&
    state.badge.holderSeat === null &&
    state.badge.lost !== true
  );
}
