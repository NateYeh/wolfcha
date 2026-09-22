import type { Phase, Role } from "@/types/game";
import type { RuleFlags } from "./flags";
import { getRoleCapabilities, isWolfRole } from "./roles";

/**
 * 騎士翻牌決鬥（單一真相）。
 *
 * 時機：**白天發言階段**與**警徽競選發言階段**可以翻牌；
 * 警上 PK 發言與遺言階段不可翻牌。
 *
 * 結果：
 * - 挑戰目標是狼人 → 該狼人出局，**隨即進入黑夜**（跳過當天剩餘發言與放逐投票）。
 * - 挑戰目標是好人 → 騎士以死謝罪出局，**白天流程繼續**。
 *
 * 決鬥死亡一律沒有遺言；被決鬥出局的狼人不能發動死亡技能
 * （狼王開槍、白狼王帶人、狼美人殉情；只有自爆是例外，而自爆要活著才能做）。
 */

/** 可以翻牌決鬥的階段（使用者裁定：警上 PK 發言與遺言階段之外） */
export const KNIGHT_DUEL_PHASES: readonly Phase[] = ["DAY_SPEECH", "DAY_BADGE_SPEECH"] as const;

/** 明確不可決鬥的階段（供文件與測試對照） */
export const KNIGHT_DUEL_FORBIDDEN_PHASES: readonly Phase[] = [
  "DAY_PK_SPEECH",
  "DAY_LAST_WORDS",
] as const;

export function isKnightDuelPhase(phase: Phase): boolean {
  return KNIGHT_DUEL_PHASES.includes(phase);
}

/** 該座位的騎士是否已經用過決鬥（一場一次） */
export function hasAlreadyDueled(duelUsedSeats: number[] | undefined, seat: number): boolean {
  return (duelUsedSeats ?? []).includes(seat);
}

/** 這個角色在這張版型／這個階段能不能翻牌決鬥 */
export function canDuel(input: {
  phase: Phase;
  role: Role | string;
  flags: RuleFlags;
  duelUsedSeats?: number[];
  seat: number;
}): boolean {
  const { phase, role, duelUsedSeats, seat } = input;
  if (!getRoleCapabilities(role).canDuel) return false;
  if (!isKnightDuelPhase(phase)) return false;
  return !hasAlreadyDueled(duelUsedSeats, seat);
}

/** 決鬥結果 */
export interface KnightDuelOutcome {
  /** 挑戰目標是不是狼人 */
  targetIsWolf: boolean;
  /** 決鬥成功：目標出局 */
  targetDies: boolean;
  /** 決鬥失敗：騎士以死謝罪出局 */
  duelistDies: boolean;
  /** 決鬥成功後是否直接進入黑夜（跳過當天剩餘流程） */
  goToNight: boolean;
  /** 決鬥死亡的狼人不能發動死亡技能（狼王／白狼王／狼美人） */
  blocksDeathSkill: boolean;
}

/** 依目標角色與旗標結算決鬥結果 */
export function resolveKnightDuelOutcome(input: {
  targetRole: Role | string;
  flags: RuleFlags;
}): KnightDuelOutcome {
  const { targetRole, flags } = input;
  const targetIsWolf = isWolfRole(targetRole);
  if (targetIsWolf) {
    return {
      targetIsWolf: true,
      targetDies: true,
      duelistDies: false,
      goToNight: flags.duel.wolfDiesGoesToNight,
      blocksDeathSkill: flags.duel.duelDeathBlocksDeathSkills,
    };
  }
  return {
    targetIsWolf: false,
    targetDies: false,
    duelistDies: true,
    goToNight: false,
    blocksDeathSkill: false,
  };
}

/** 死亡原因（用於判斷死亡技能是否可發動） */
export type DeathCause = "wolf" | "poison" | "vote" | "hunter" | "boom" | "duel";

/**
 * 死亡技能是否可以在這個死因下發動。
 *
 * 目前會看死因的死亡技能：狼王開槍（被毒死不能開槍，被決鬥出局也不能）、
 * 狼美人殉情、白狼王帶人（只限自爆）。獵人開槍由既有規則處理（被毒死不能開槍）。
 */
export const DEATH_SKILL_BLOCKED_CAUSES: readonly DeathCause[] = ["poison", "duel"] as const;

export function canTriggerDeathSkill(cause: DeathCause, role: Role | string, flags: RuleFlags): boolean {
  if (cause === "duel" && !flags.duel.duelDeathBlocksDeathSkills) return true;
  if (DEATH_SKILL_BLOCKED_CAUSES.includes(cause)) return false;
  // 白狼王的帶人只有自爆能發動，其他死因一律不能
  if (getRoleCapabilities(role).boomTakesPlayer) return cause === "boom";
  return true;
}
