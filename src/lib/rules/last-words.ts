/**
 * 遺言規則（單一真相）。
 *
 * - 第一夜死亡的玩家：一定有遺言，無論死亡人數、無論死因（刀殺、毒殺、奶穿）。
 * - 第二夜起夜間死亡的玩家：沒有遺言。
 * - 投票放逐者的遺言不受此規則影響（仍然有）。
 * - 自爆者、被白狼王帶走的人沒有遺言（見 RuleFlags.boom）。
 */

/** 第一夜＝遊戲開始後的第一個夜晚（`state.day === 1` 時的夜晚階段） */
export const LAST_WORDS_NIGHT_DAY = 1;

/** 該夜的死亡者是否有遺言（依夜晚所屬天數判定） */
export function canNightDeathHaveLastWords(nightDay: number): boolean {
  return nightDay === LAST_WORDS_NIGHT_DAY;
}

/**
 * 計算夜晚結算後應排入的遺言佇列。
 *
 * @param nightDay 剛結算完成的夜晚所屬天數（第一夜＝1）
 * @param deathSeats 該夜死亡的座位（結算順序：刀口在前、毒殺在後）
 * @param pending 既有的待發表佇列（被中斷時會累積）
 */
export function getPendingLastWordsSeats(options: {
  nightDay: number;
  deathSeats: number[];
  pending?: number[];
}): number[] {
  const { nightDay, deathSeats, pending } = options;
  const queue = pending ? [...pending] : [];
  if (!canNightDeathHaveLastWords(nightDay)) return queue;
  for (const seat of deathSeats) {
    if (!queue.includes(seat)) queue.push(seat);
  }
  return queue;
}

/** 取出佇列中下一位遺言者與剩餘佇列 */
export function takeNextLastWordsSeat(queue: number[] | undefined): {
  seat: number | null;
  rest: number[] | undefined;
} {
  if (!queue || queue.length === 0) return { seat: null, rest: undefined };
  const [seat, ...rest] = queue;
  return { seat, rest: rest.length > 0 ? rest : undefined };
}
