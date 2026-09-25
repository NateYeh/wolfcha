import type { GameState } from "@/types/game";
import { getRoleCapabilities } from "./roles";

/**
 * 魔術師（`Magician`）規則（單一真相）。
 *
 * 來源：<https://werewolves.games/lang-wang-mo-shu-shi/>。
 * 規則：每晚選**兩名玩家交換**，當晚**指向其中一人的技能結算到另一人身上**。
 * 來源點名受影響的是**刀口、毒口、查驗、守護**；槍口明確排除
 * （「魔術師換位主要影響夜間指向結算」，獵人槍／狼王槍是**白天**才開）。
 *
 * 本作裁定（2026-09-24，使用者拍板）：
 * 1. **守護一起換位**——守的人被換走時，守護也改判到換到的對象。
 * 2. **槍口不換位**——白天才開槍，夜間換位不影響。
 * 3. **可以換自己**——魔術師可以是兩名被交換者之一（`canSelfTarget: true`）。
 * 4. **允許重複被換**——不採來源的「通常整局只能換一次」，本作不做任何記錄與限制。
 * 5. **交換不公告**——遊戲中不公告，只寫進 `nightHistory[day].magicianSwap` 供賽後分析與 DevTools 使用。
 *
 * 為什麼單獨一個模組：換位是「指標層」的改寫，`night-resolution` 只負責讀改寫後的名字；
 * 把這份對照寫在規則模組裡，AI 契約、真人 UI、跳轉回放與賽後分析才能共用同一份判定。
 */

/** 一晚的換位組合（座標一律是 0 基的 `seat`） */
export type MagicianSwap = [number, number];

/**
 * 今晚可以參與交換的座位：**存活玩家全部**（含魔術師自己，裁定 3）。
 *
 * 相對於攝夢人／狼美人會排除「已死但尚未公布」的死者，這裡沒有這個問題：
 * 魔術師排在夜晚最前面（見 `PHASE_SEQUENCE`），執行時還沒有任何當晚死亡被決定。
 */
export function getSwapEligibleSeats(state: GameState): number[] {
  return state.players.filter((player) => player.alive).map((player) => player.seat);
}

/** 魔術師這個角色能不能把自己換進去（目前規則：可以，裁定 3） */
export function canSwapSelf(): boolean {
  return getRoleCapabilities("Magician").canSelfTarget;
}

/** 這組交換是否合法：兩個**不同**的座位，且都在存活名單裡 */
export function isValidSwap(state: GameState, swap: MagicianSwap | undefined): boolean {
  if (!swap) return false;
  const [a, b] = swap;
  if (a === b) return false;
  const eligible = new Set(getSwapEligibleSeats(state));
  return eligible.has(a) && eligible.has(b);
}

/** 「未操作則系統隨機指定」的實作：從存活玩家裡抽兩個不同的人 */
export function pickRandomSwap(state: GameState): MagicianSwap | undefined {
  const seats = getSwapEligibleSeats(state);
  if (seats.length < 2) return undefined;
  const firstIndex = Math.floor(Math.random() * seats.length);
  const first = seats[firstIndex];
  const rest = seats.filter((seat) => seat !== first);
  const second = rest[Math.floor(Math.random() * rest.length)];
  return [first, second];
}

/**
 * 把一個目標座位過一次換位：在組合裡的換到對面，不在組合裡的原樣回傳。
 *
 * 這是所有「夜間指向」唯一該走的函式——守護、狼刀、毒藥、查驗、攝夢、魅惑都一樣；
 * 槍口（`death-skills` 的白天槍）刻意**不**走這裡（裁定 2）。
 */
export function redirectSeat(seat: number | undefined, swap: MagicianSwap | readonly number[] | undefined): number | undefined {
  if (seat === undefined || !swap) return seat;
  const [a, b] = swap as readonly number[];
  if (seat === a) return b;
  if (seat === b) return a;
  return seat;
}

/** 從夜史／動作紀錄裡安全取出換位組合（形狀不對就當作沒有，不丟例外） */
export function getMagicianSwap(record: { magicianSwap?: unknown } | Record<string, unknown> | null | undefined): MagicianSwap | undefined {
  const raw = (record as { magicianSwap?: unknown } | null | undefined)?.magicianSwap;
  if (!Array.isArray(raw) || raw.length !== 2) return undefined;
  const [a, b] = raw;
  if (typeof a !== "number" || typeof b !== "number") return undefined;
  return [a, b];
}
