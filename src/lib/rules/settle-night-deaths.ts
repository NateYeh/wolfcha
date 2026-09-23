import type { GameState } from "@/types/game";
import type { NightDeathReason } from "./night-resolution";
import { getPendingLastWordsSeats } from "./last-words";

/**
 * 夜晚死亡原因（與 `nightHistory[day].deaths` 一致）；單一真相在 rules/night-resolution。
 */
export type { NightDeathReason };

/** 這次補公布的夜間死亡 */
export interface NewlyAnnouncedDeath {
  nightDay: number;
  seat: number;
  reason: NightDeathReason;
}

/** 標記死亡（與 game-master.killPlayer 同語意，刻意不 import 以免循環引用） */
export function markPlayerDead(state: GameState, seat: number): GameState {
  return {
    ...state,
    players: state.players.map((player) => (player.seat === seat ? { ...player, alive: false } : player)),
  };
}

/**
 * 補公布「已結算但還沒公布」的夜間死亡（＝第一天先競選後報刀時的第一夜死者）。
 *
 * 自爆與騎士決鬥都可能讓當天流程提前結束，因此這個動作用在兩條路徑上：
 * 死亡套用（`alive=false`）、被毒死的獵人失去開槍權、第一夜死者排入遺言佇列、
 * 標記 `resultsAnnounced`。呼叫方負責公告與實際發表遺言。
 */
export function settleUnannouncedNightDeaths(state: GameState): {
  state: GameState;
  newlyAnnouncedDeaths: NewlyAnnouncedDeath[];
  pendingLastWordsSeats: number[];
} {
  let currentState = state;
  const newlyAnnouncedDeaths: NewlyAnnouncedDeath[] = [];
  let pendingLastWordsSeats = [...new Set(currentState.pendingLastWordsSeats ?? [])];
  const history = currentState.nightHistory ?? {};
  const unannouncedDays = Object.entries(history)
    .filter(([, record]) => record && record.resultsAnnounced === false && (record.deaths ?? []).length > 0)
    .sort(([a], [b]) => Number(a) - Number(b));

  const announcedSeats = new Set<number>();
  for (const [day, record] of unannouncedDays) {
    const nightDay = Number(day);
    const deathSeats: number[] = [];
    for (const death of record.deaths ?? []) {
      if (announcedSeats.has(death.seat)) continue; // 同一座位只公告一次
      const victim = currentState.players.find((player) => player.seat === death.seat);
      if (!victim) continue;
      announcedSeats.add(death.seat);
      if (victim.alive) currentState = markPlayerDead(currentState, victim.seat);
      // 被毒死的獵人不能開槍：改由 canUseDeathShot 查夜史（reason=poison）封槍，
      // 不再全域關 hunterCanShoot（否則會誤傷日後狼王被票出開槍）。
      deathSeats.push(death.seat);
      newlyAnnouncedDeaths.push({ nightDay, seat: death.seat, reason: death.reason });
    }
    pendingLastWordsSeats = getPendingLastWordsSeats({
      nightDay,
      deathSeats,
      pending: pendingLastWordsSeats,
    });
    currentState = {
      ...currentState,
      nightHistory: {
        ...currentState.nightHistory,
        [nightDay]: { ...record, resultsAnnounced: true },
      },
    };
  }

  return { state: currentState, newlyAnnouncedDeaths, pendingLastWordsSeats };
}
