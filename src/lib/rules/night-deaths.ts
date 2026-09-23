import type { GameState } from "@/types/game";

/**
 * 「已死但尚未公布」的座位（單一真相）。
 *
 * 遊戲是「第一天先競選、後報刀」：第一夜死者要等競選結束、死亡公告之後才公開，
 * 但他們在邏輯上**已經出局**。因此：
 * - 不能報名警徽競選、不能發言、不能投票（見 useBadgePhase）。
 * - **不能成為白狼王自爆帶走的目標，也不能被攝夢人指定**：技能只能指向場上存活玩家，
 *   指定已出局者視為技能無效（不帶走任何人）。
 * - 他們的死亡尚未公布，所以 `alive` 名單必須保持原樣，否則等於提前洩漏死訊。
 */
export function getPendingDeathSeats(state: GameState): number[] {
  const seats: number[] = [];
  const { pendingWolfVictim, pendingPoisonVictim, pendingDreamVictim } = state.nightActions ?? {};
  for (const seat of [pendingWolfVictim, pendingPoisonVictim, pendingDreamVictim]) {
    if (seat !== undefined && !seats.includes(seat)) seats.push(seat);
  }
  return seats;
}

/** 該座位是否為「已死但尚未公布」 */
export function isPendingDeath(state: GameState, seat: number): boolean {
  return getPendingDeathSeats(state).includes(seat);
}

/** 從參與名單中剔除「已死但尚未公布」的玩家（警徽報名／發言／投票／自爆目標用） */
export function excludePendingDeathPlayers<T extends { seat: number }>(
  state: GameState,
  players: T[]
): T[] {
  const pending = new Set(getPendingDeathSeats(state));
  if (pending.size === 0) return players;
  return players.filter((player) => !pending.has(player.seat));
}
