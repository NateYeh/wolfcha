import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildGameRecordMeta,
  isGameRecordMeta,
  isValidRecordId,
  sortGameRecordMetas,
  type GameRecord,
  type GameRecordMeta,
} from "@/lib/game-records";
import type { GameAnalysisData } from "@/types/analysis";

/**
 * 遊玩紀錄的伺服器端檔案儲存（only server）。
 *
 * 沿用 `api/dev-ai-logs` 的既有慣例（env 指定目錄、依數量輪替），但在 production 也生效——
 * 這是給玩家看的資料，不是開發工具；可存取範圍由 ownerKey 目錄決定。
 *
 * 結構：`<dir>/<ownerKey>/<recordId>.json`（完整紀錄）＋ `index.json`（清單用的中繼資料）。
 * 索引只是快取，壞掉或不存在時由檔案重建，不會讓列表整個消失。
 */

const INDEX_FILE_NAME = "index.json";
const DEFAULT_KEEP = 100;

/** 紀錄目錄：`WOLFCHA_GAME_RECORD_DIR`，未設定時用 repo 下的 `data/game-records`。 */
export function resolveRecordDir(): string {
  const configured = (process.env.WOLFCHA_GAME_RECORD_DIR ?? "").trim();
  return configured === "" ? path.join(process.cwd(), "data", "game-records") : path.resolve(configured);
}

/** 保留幾局（依寫入時間），其餘刪除。 */
export function resolveRecordKeep(): number {
  const parsed = Number.parseInt(process.env.WOLFCHA_GAME_RECORD_KEEP ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_KEEP;
}

/**
 * 身分 → 目錄名。
 *
 * 使用者輸入不能直接當路徑（`../`、超長、非 ASCII），因此只取 sha256 前 16 碼；
 * 同一身分穩定對應同一目錄，且無從反推原始 id。
 */
export function ownerStorageKey(ownerId: string): string {
  return createHash("sha256").update(ownerId).digest("hex").slice(0, 16);
}

function resolveOwnerDir(ownerId: string): string {
  return path.join(resolveRecordDir(), ownerStorageKey(ownerId));
}

function resolveRecordPath(ownerId: string, recordId: string): string {
  if (!isValidRecordId(recordId)) {
    throw new Error(`不合法的紀錄 id：${recordId}`);
  }
  return path.join(resolveOwnerDir(ownerId), `${recordId}.json`);
}

/** 讀索引；檔案不存在回空陣列，內容壞掉則記錄問題並略過該筆。 */
async function readIndex(dir: string): Promise<GameRecordMeta[] | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, INDEX_FILE_NAME), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(`[game-records] 讀取索引失敗（${dir}）:`, error);
    }
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error(`[game-records] 索引不是陣列，將由檔案重建（${dir}）`);
      return null;
    }
    const metas: GameRecordMeta[] = [];
    for (const entry of parsed) {
      if (isGameRecordMeta(entry)) metas.push(entry);
      else console.error("[game-records] 索引中有形狀不合的中繼資料，已略過:", entry);
    }
    return metas;
  } catch (error) {
    console.error(`[game-records] 索引解析失敗，將由檔案重建（${dir}）:`, error);
    return null;
  }
}

/** 原子寫入索引（tmp + rename），避免中斷時留下半寫的 JSON。 */
async function writeIndex(dir: string, metas: GameRecordMeta[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, INDEX_FILE_NAME);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(sortGameRecordMetas(metas), null, 2), "utf8");
  await rename(tmp, target);
}

/** 由實際檔案重建索引：讀每筆紀錄的中繼資料，順便清掉讀不動的檔案。 */
async function rebuildIndexFromFiles(dir: string): Promise<GameRecordMeta[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") console.error(`[game-records] 讀取紀錄目錄失敗（${dir}）:`, error);
    return [];
  }

  const metas: GameRecordMeta[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name === INDEX_FILE_NAME) continue;
    try {
      const parsed = JSON.parse(await readFile(path.join(dir, name), "utf8")) as Partial<GameRecord>;
      if (isGameRecordMeta(parsed)) metas.push(parsed);
      else console.error(`[game-records] 紀錄形狀不合，重建索引時略過（${name}）`);
    } catch (error) {
      console.error(`[game-records] 讀取紀錄失敗，重建索引時略過（${name}）:`, error);
    }
  }

  const sorted = sortGameRecordMetas(metas);
  await writeIndex(dir, sorted);
  return sorted;
}

/** 只保留最新 keep 筆：刪掉多餘檔案，回傳留下的中繼資料（呼叫端負責寫索引）。 */
async function pruneOldRecords(dir: string, metas: GameRecordMeta[], keep: number): Promise<GameRecordMeta[]> {
  const sorted = sortGameRecordMetas(metas);
  const kept = sorted.slice(0, keep);
  const excess = sorted.slice(keep);

  for (const meta of excess) {
    try {
      await unlink(path.join(dir, `${meta.id}.json`));
      console.info(`[game-records] 已輪替刪除舊紀錄: ${meta.id}`);
    } catch (error) {
      console.error(`[game-records] 刪除舊紀錄失敗（${meta.id}）:`, error);
    }
  }

  return kept;
}

/** 存一局（完賽後由客戶端送來賽後分析）。回傳寫入的中繼資料。 */
export async function saveGameRecord(
  ownerId: string,
  analysis: GameAnalysisData,
  options: { difficulty?: string } = {},
): Promise<GameRecordMeta> {
  const dir = resolveOwnerDir(ownerId);
  await mkdir(dir, { recursive: true });

  const meta = buildGameRecordMeta(analysis, {
    difficulty: options.difficulty,
    savedAt: Date.now(),
  });
  const record: GameRecord = { ...meta, analysis };

  const target = resolveRecordPath(ownerId, meta.id);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(record), "utf8");
  await rename(tmp, target);

  // 先確保索引是新鮮的（可能不存在或壞掉），再把這一筆併進去；
  // 順序錯了就會出現「檔案在、索引沒有」→ 列表看不到這一局。
  const existing = (await readIndex(dir)) ?? (await rebuildIndexFromFiles(dir));
  const merged = [...existing.filter((entry) => entry.id !== meta.id), meta];
  const kept = await pruneOldRecords(dir, merged, resolveRecordKeep());
  await writeIndex(dir, kept);

  return meta;
}

/** 列出自己的紀錄（新到舊）；索引缺失時由檔案重建。 */
export async function listGameRecords(ownerId: string): Promise<GameRecordMeta[]> {
  const dir = resolveOwnerDir(ownerId);
  const indexed = await readIndex(dir);
  if (indexed) return sortGameRecordMetas(indexed).slice(0, resolveRecordKeep());
  return rebuildIndexFromFiles(dir);
}

/** 讀單局完整紀錄；不存在或 id 不合法回 null（呼叫端轉 404／400）。 */
export async function loadGameRecord(ownerId: string, recordId: string): Promise<GameRecord | null> {
  if (!isValidRecordId(recordId)) return null;
  try {
    const parsed = JSON.parse(await readFile(resolveRecordPath(ownerId, recordId), "utf8")) as GameRecord;
    if (!parsed || typeof parsed !== "object" || !parsed.analysis) {
      console.error(`[game-records] 紀錄內容不完整（${recordId}）`);
      return null;
    }
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(`[game-records] 讀取紀錄失敗（${recordId}）:`, error);
    }
    return null;
  }
}
