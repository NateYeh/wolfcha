import type { RuleFlags } from "./flags";

/**
 * 夜晚行動的共用常數與規則判定。
 *
 * 「不動作」的座位值沿用既有慣例（獵人棄槍用 `-1`），新增守衛空守共用同一個值，
 * 避免各處各自約定 0／-1／null 造成解析歧義（女巫 `pass` 就是用 `0`）。
 */

/** 代表「不動作／放棄行動」的座位值 */
export const ABSTAIN_SEAT = -1;

/** 是否為「不動作」的座位值 */
export function isAbstainSeat(seat: number | null | undefined): boolean {
  return seat === ABSTAIN_SEAT;
}

/** AI 回傳中代表「不動作」的字樣（用於寬鬆解析） */
export const ABSTAIN_KEYWORDS = ["abstain", "skip", "pass", "none", "no_action", "hold"] as const;

/** 判斷 AI 回傳的 action 字樣是否代表「不動作」 */
export function isAbstainKeyword(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return ABSTAIN_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/** 守衛今晚可以選擇的守護對象座位（排除不能連守的上一晚目標） */
export function getGuardEligibleSeats(options: {
  aliveSeats: number[];
  lastGuardTarget: number | undefined;
  flags: RuleFlags;
}): number[] {
  const { aliveSeats, lastGuardTarget, flags } = options;
  if (!flags.guardCannotRepeat || lastGuardTarget === undefined) return [...aliveSeats];
  return aliveSeats.filter((seat) => seat !== lastGuardTarget);
}

/** 女巫今晚是否可以使用解藥救這個刀口（遵守「不可自救」規則） */
export function canWitchSave(options: {
  healUsed: boolean;
  witchSeat: number;
  wolfTarget: number | undefined;
  flags: RuleFlags;
}): boolean {
  const { healUsed, witchSeat, wolfTarget, flags } = options;
  if (healUsed || wolfTarget === undefined) return false;
  return flags.witchCanSelfSave || wolfTarget !== witchSeat;
}
