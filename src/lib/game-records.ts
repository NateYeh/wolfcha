import type { GameAnalysisData, PlayerSnapshot } from "@/types/analysis";
import type { Role } from "@/types/game";

/**
 * 遊玩紀錄的共用型別與純函式（client／server 都能 import，不碰 node:fs）。
 *
 * 紀錄內容直接沿用賽後分析的 `GameAnalysisData`——它已含整局對話、夜晚行動與每個角色身分，
 * 且詳情頁可以複用 `PostGameAnalysisPage`（吃 prop，不綁 atom），不必另寫檢視器。
 * 額外的中繼資料只為了讓**清單**不必載入整包紀錄（一局可能數百 KB）。
 */

/** 一筆紀錄的中繼資料（清單用；index.json 就是它們的陣列）。 */
export interface GameRecordMeta {
  /** 檔名用的安全 id（由 gameId 淨化）。 */
  id: string;
  gameId: string;
  /** 寫入伺服器的時間（列表排序依據）。 */
  savedAt: number;
  /** 賽後分析產生的時間。 */
  finishedAt: number;
  playerCount: number;
  difficulty: string;
  result: "village_win" | "wolf_win";
  durationSeconds: number;
  dayCount: number;
  /** 真人玩家的座位（0 基）；找不到時 null。 */
  humanSeat: number | null;
  humanRole: Role | null;
  humanCharacterId: string | null;
  humanSurvived: boolean | null;
  /** MVP 名字（同票並列時多個），清單可直接顯示。 */
  mvpNames: string[];
}

/** 完整紀錄：中繼資料 ＋ 賽後分析。 */
export interface GameRecord extends GameRecordMeta {
  analysis: GameAnalysisData;
}

const MAX_RECORD_ID_LENGTH = 64;
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * 把 gameId 淨化成安全的檔名。
 *
 * 只保留 `[A-Za-z0-9_-]`；淨化後為空或過長時改用時間戳與長度組成的備援 id，
 * 避免路徑穿越（`../`）與超長檔名。
 */
export function sanitizeRecordId(raw: string, fallbackSeed = Date.now()): string {
  const cleaned = (raw ?? "").replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const trimmed = cleaned.slice(0, MAX_RECORD_ID_LENGTH);
  if (trimmed.length > 0) return trimmed;
  return `record-${fallbackSeed}`;
}

/** 檔名淨化後是否可用（讀取時驗證，不接受任何路徑成分）。 */
export function isValidRecordId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_RECORD_ID_LENGTH && RECORD_ID_PATTERN.test(value);
}

/** 一局玩了幾天：取 timeline 與 roundStates 的最大天數聯集。 */
export function countRecordDays(analysis: GameAnalysisData): number {
  let max = 0;
  for (const entry of analysis.timeline ?? []) {
    if (typeof entry.day === "number" && entry.day > max) max = entry.day;
  }
  for (const round of analysis.roundStates ?? []) {
    if (typeof round.day === "number" && round.day > max) max = round.day;
  }
  return max;
}

/** 真人玩家（單人局只有一個）；找不到時 null。 */
export function findHumanPlayer(analysis: GameAnalysisData): PlayerSnapshot | null {
  return (analysis.players ?? []).find((player) => player.isHumanPlayer) ?? null;
}

/**
 * 由賽後分析抽出清單用的中繼資料。
 *
 * `savedAt` 由呼叫端傳入（伺服器寫入時間），其餘一律由紀錄本身推導，不從當前狀態倒推。
 */
export function buildGameRecordMeta(
  analysis: GameAnalysisData,
  options: { difficulty?: string; savedAt?: number } = {},
): GameRecordMeta {
  const human = findHumanPlayer(analysis);
  const mvpNames = (analysis.awards?.mvp ?? []).map((award) => award.playerName).filter((name) => name.length > 0);

  return {
    id: sanitizeRecordId(analysis.gameId),
    gameId: analysis.gameId,
    savedAt: options.savedAt ?? Date.now(),
    finishedAt: analysis.timestamp,
    playerCount: analysis.playerCount,
    difficulty: options.difficulty ?? "",
    result: analysis.result,
    durationSeconds: analysis.duration,
    dayCount: countRecordDays(analysis),
    humanSeat: human ? human.seat : null,
    humanRole: human ? human.role : null,
    humanCharacterId: human?.characterId ?? null,
    humanSurvived: human ? human.isAlive : null,
    mvpNames,
  };
}

/** index.json 讀回時的形狀驗證（壞資料不進列表，但不靜默：由呼叫端記錄問題）。 */
export function isGameRecordMeta(value: unknown): value is GameRecordMeta {
  if (!value || typeof value !== "object") return false;
  const meta = value as Partial<GameRecordMeta>;
  return (
    typeof meta.id === "string"
    && isValidRecordId(meta.id)
    && typeof meta.gameId === "string"
    && typeof meta.savedAt === "number"
    && typeof meta.finishedAt === "number"
    && typeof meta.playerCount === "number"
    && (meta.result === "village_win" || meta.result === "wolf_win")
    && typeof meta.durationSeconds === "number"
    && typeof meta.dayCount === "number"
  );
}

/** 清單依寫入時間新到舊（相同時以 id 排序，排序結果穩定）。 */
export function sortGameRecordMetas(metas: GameRecordMeta[]): GameRecordMeta[] {
  return [...metas].sort((a, b) => (b.savedAt - a.savedAt) || a.id.localeCompare(b.id));
}
