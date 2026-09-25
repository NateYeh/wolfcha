import type { GameState } from "@/types/game";

/**
 * 「夜史要記下哪些夜間行動欄位」的單一真相。
 *
 * 這份清單是**實機測試逼出來的**：魔術師的換位做了角色層、階段層、結算、AI 決策與真人面板，
 * 單元測試全綠，但實際開一局玩到夜間結算時，`nightHistory[1].magicianSwap` 是 `null`——
 * 因為真正的結算（`useSpecialEvents`）手寫了一份欄位清單，而它沒有跟著更新。
 * 同一個病灶先前在狼美人身上發作過一次（記錄裡「魅惑: 無」）；守門測試上線後又抓到第二個：
 * **禁言長老的目標從來沒被寫進夜史**（它從舊的手寫清單就漏掉了）。所以這裡不再用手寫清單：
 * **結算時直接把這份清單攤進夜史**，新增夜間行動只要補這裡一格。
 *
 * `night-record.test.ts` 會反過來掃原始碼：任何 `nightActions.<欄位> =` 的寫入端，
 * 該欄位必須在下面的清單裡，或被明確列進 `NIGHT_RECORD_EXCLUDED_KEYS`（附理由）。
 */

/** 要寫進夜史的夜間行動欄位（公開結果：誰做了什麼）。 */
export const NIGHT_RECORD_ACTION_KEYS = [
  "guardTarget",
  "guardAbstained",
  "mutedTarget",
  "wolfTarget",
  "witchSave",
  "witchPoison",
  "seerTarget",
  "seerResult",
  "dreamTarget",
  "wolfBeautyTarget",
  "magicianSwap",
] as const;

/** 要寫進夜史的「私有理由」欄位（賽中不公開，賽後感言引用）。 */
export const NIGHT_RECORD_REASON_KEYS = [
  "guardReason",
  "muteReason",
  "wolfReason",
  "witchSaveReason",
  "witchPoisonReason",
  "seerReason",
  "dreamReason",
  "wolfBeautyReason",
  "magicianReason",
] as const;

/**
 * 刻意**不**寫進夜史的欄位（跨夜暫存與衍生資料），每一項都要有理由。
 */
export const NIGHT_RECORD_EXCLUDED_KEYS: Record<string, string> = {
  lastGuardTarget: "只為了「不能連守同一人」的跨夜暫存，不是當晚的決定",
  lastDreamTarget: "同上：攝夢人不能連兩晚攝同一人的暫存",
  pendingWolfVictim: "結算中的暫存（狼刀是否真的落到人），已由 deaths 表達",
  pendingPoisonVictim: "結算中的暫存，已由 deaths 表達",
  pendingDreamVictim: "結算中的暫存，已由 deaths 表達",
  wolfVotes: "狼隊分工的原始投票，屬於過程資料而非夜史欄位",
  wolfTeamPlan: "狼隊分工計畫，屬於過程資料",
  seerHistory: "跨夜累積的查驗歷史，另外保存、不隨單夜覆寫",
  hunterShots: "白天才開的槍，記在自己的欄位（不是夜間行動）",
};

/** 夜史欄位的完整鍵集合（行動＋理由）。 */
export const NIGHT_RECORD_KEYS: readonly string[] = [
  ...NIGHT_RECORD_ACTION_KEYS,
  ...NIGHT_RECORD_REASON_KEYS,
];

/**
 * 從當晚的 `nightActions` 取出要寫進夜史的部分。
 *
 * 未決定的欄位一律是 `undefined`（不是省略）：夜史每一格都存在，讀取端不必再判斷 key 在不在。
 */
export const pickNightRecordActions = (
  nightActions: GameState["nightActions"]
): Partial<GameState["nightActions"]> => {
  const picked: Record<string, unknown> = {};
  const source = nightActions as unknown as Record<string, unknown>;
  for (const key of NIGHT_RECORD_KEYS) {
    picked[key] = source[key];
  }
  return picked as Partial<GameState["nightActions"]>;
};
