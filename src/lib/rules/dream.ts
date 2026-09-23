import type { GameState, Role } from "@/types/game";
import { getRoleCapabilities } from "./roles";

/**
 * 攝夢人（Dreamweaver）規則（單一真相）。
 *
 * 規則（本局採官方進階版）：
 * 1. 每晚**必須**指定一名存活玩家成為夢游者（不能選自己、不能空攝）；
 *    AI 沒給出合法目標時由系統隨機指定（見 `pickRandomDreamTarget`）。
 * 2. 夢游者當晚**免疫夜間傷害**（狼刀／女巫毒藥）：技能視為已使用但落空。
 * 3. **連續兩晚**成為夢游者 → 該玩家出局（夢死，女巫解藥救不活）。
 * 4. 攝夢人**夜間出局**（被刀／被毒） → 當晚夢游者一并出局。
 * 5. 被夢帶走出局者（第 3、4 條）**不能發動死亡技能**（獵人槍／狼王槍），
 *    比照被毒封槍（見 `death-skills.canUseDeathShot` 的查夜史）。
 *
 * 玩家端可見性：夢游狀態**不公開**（夢游者自己也不知道）；天亮只公布「誰出局」，
 * 不公布死因，所以夢死與其他夜死在外觀上没有差別。
 *
 * 為什麼第 3、4 條可以並存：官方規則是「可以連續兩晚攝同一人，但連續兩晚被攝必死」，
 * 因此不存在「禁止重複」的硬性限制——重複的代價就是死亡（女巫救不活）。
 */

/** 夢游者的死因標記（與 `nightHistory[day].deaths` 的 reason 一致） */
export const DREAM_DEATH_REASON = "dream" as const;

/** 攝夢人這個角色能不能自己攝自己（目前規則：不行） */
export function canDreamSelf(): boolean {
  return getRoleCapabilities("Dreamweaver").canSelfTarget;
}

/**
 * 今晚可以攝的座位：存活玩家、不含自己（見 canDreamSelf）、
 * 排除「已死但尚未公布」的死者（他們在邏輯上已經出局）。
 *
 * 沒有限制不能連續兩晚攝同一人——連攝會讓對方出局，那是代價不是禁令。
 */
export function getDreamEligibleSeats(state: GameState, dreamerSeat: number): number[] {
  const pending = new Set<number>();
  const { pendingWolfVictim, pendingPoisonVictim, pendingDreamVictim } = state.nightActions ?? {};
  for (const seat of [pendingWolfVictim, pendingPoisonVictim, pendingDreamVictim]) {
    if (typeof seat === "number") pending.add(seat);
  }
  const allowSelf = canDreamSelf();
  return state.players
    .filter(
      (player) =>
        player.alive &&
        (allowSelf || player.seat !== dreamerSeat) &&
        !pending.has(player.seat),
    )
    .map((player) => player.seat);
}

/** 這個攝夢目標是否合法（AI 契約與真人 UI 共用） */
export function isValidDreamTarget(state: GameState, dreamerSeat: number, targetSeat: number): boolean {
  return getDreamEligibleSeats(state, dreamerSeat).includes(targetSeat);
}

/**
 * 「未操作則系統隨機指定」的實作：從合法座位裡隨機挑一個。
 * 沒有合法座位（例如只剩攝夢人自己存活）時回 undefined——此時這一晚沒有夢游者。
 */
export function pickRandomDreamTarget(state: GameState, dreamerSeat: number): number | undefined {
  const seats = getDreamEligibleSeats(state, dreamerSeat);
  if (seats.length === 0) return undefined;
  return seats[Math.floor(Math.random() * seats.length)];
}

/** 這個角色是不是攝夢人 */
export function isDreamweaver(role: Role | string | undefined): boolean {
  return role === "Dreamweaver";
}
