import type { GameState, HunterShot } from "@/types/game";

/**
 * 開槍紀錄（`nightHistory[day].hunterShots` / `dayHistory[day].hunterShots`）的單一真相。
 *
 * 為什麼是陣列：一個晚上可以開很多槍——獵人被槍打死時自己也開槍（槍打槍），
 * 「八獵四狼」更是八個獵人輪流開。過去這個欄位是單一物件，同一晚的第二槍會**覆蓋**第一槍，
 * 於是事件紀錄／賽後分析只看得到最後一槍（系統訊息與對話是每一槍都有，所以更難察覺）。
 *
 * 語意分工：
 * - **公告、動畫、單筆摘要**只要最後一槍 → `lastHunterShot`。
 * - **死因、封槍、跳轉回放**要「這一槍有沒有打到他」→ `findHunterShotByTarget`。
 * - **賽後分析**要「他開過槍沒」→ `findHunterShotByShooter`。
 */

/**
 * 任何歷史片段（夜史或日史）。刻意收寬：呼叫端常常只拿到「某一天的紀錄」區域變數
 * （型別被收斂成不含 `hunterShots` 的物件），讀取器不該因此擋人。
 */
export type HunterShotsCarrier = { hunterShots?: unknown } | Record<string, unknown> | null | undefined;

/** 這一晚／這一天的開槍紀錄（沒有紀錄、或形狀不是陣列時一律回空陣列） */
export const getHunterShots = (record: HunterShotsCarrier): HunterShot[] => {
  // 執行期守衛：舊存檔／外部來源可能不是陣列，寧可當成沒有紀錄也不要爆掉
  const raw = (record as { hunterShots?: unknown } | null | undefined)?.hunterShots;
  return Array.isArray(raw) ? (raw as HunterShot[]) : [];
};

/** 最後一槍：公告與動畫用（槍鏈要的是「剛剛那一槍」） */
export const lastHunterShot = (record: HunterShotsCarrier): HunterShot | undefined => {
  const shots = getHunterShots(record);
  return shots.length > 0 ? shots[shots.length - 1] : undefined;
};

/** 這個座位開的槍（同一人一晚只會開一次，但槍鏈上每個獵人各一筆） */
export const findHunterShotByShooter = (
  record: HunterShotsCarrier,
  hunterSeat: number,
): HunterShot | undefined => getHunterShots(record).find((shot) => shot.hunterSeat === hunterSeat);

/** 打在這個座位上的槍（死因與跳轉回放用） */
export const findHunterShotByTarget = (
  record: HunterShotsCarrier,
  targetSeat: number,
): HunterShot | undefined => getHunterShots(record).find((shot) => shot.targetSeat === targetSeat);

type NightRecord = NonNullable<GameState["nightHistory"]>[number];
type DayRecord = NonNullable<GameState["dayHistory"]>[number];

/** 把一槍追加進「今晚」的紀錄（同一晚的槍鏈會累積，不再互相覆蓋） */
export function appendNightHunterShot(state: GameState, shot: HunterShot): GameState {
  const prev: NightRecord | undefined = state.nightHistory?.[state.day];
  return {
    ...state,
    nightHistory: {
      ...(state.nightHistory ?? {}),
      [state.day]: { ...prev, hunterShots: [...getHunterShots(prev), shot] },
    },
  };
}

/** 把一槍追加進「今天」的紀錄 */
export function appendDayHunterShot(state: GameState, shot: HunterShot): GameState {
  const prev: DayRecord | undefined = state.dayHistory?.[state.day];
  return {
    ...state,
    dayHistory: {
      ...(state.dayHistory ?? {}),
      [state.day]: { ...prev, hunterShots: [...getHunterShots(prev), shot] },
    },
  };
}
