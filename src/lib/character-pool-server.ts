/**
 * 角色池／自訂情境的伺服器端儲存：
 * 資料存放在專案的 `.data/` 目錄（JSON 檔），所有瀏覽器透過 API 共用同一份。
 *
 * - 重用 character-pool.ts / custom-scenarios.ts 的純邏輯（注入檔案版 storage）。
 * - 所有寫入操作以模組層級的 promise 鎖序列化，避免並發讀寫互相覆蓋。
 * - 寫檔採「先寫暫存檔再改名」，降低寫到一半損毀的風險（rename 在 Linux 上為原子操作）。
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  appendCharactersToPool,
  clearCharacterPool,
  isCharacterPoolLocked,
  readCharacterPool,
  setCharacterPoolLock,
  setCharacterPoolScenario,
  takeCharactersFromPool,
  type CharacterPool,
  type CharacterPoolStorage,
} from "./character-pool";
import {
  deleteCustomScenario,
  isValidGameScenario,
  loadCustomScenarios,
  saveCustomScenario,
  type CustomScenarioInput,
} from "./custom-scenarios";
import type { GameScenario } from "@/types/game";
import type { GeneratedCharacter } from "./character-generator";

/** 資料目錄；可用環境變數覆寫（測試用）。 */
const resolveDataDir = (): string =>
  process.env.WOLFCHA_POOL_DATA_DIR ?? path.join(process.cwd(), ".data");

const POOL_FILE = "character-pool.json";
const CUSTOM_SCENARIOS_FILE = "custom-scenarios.json";

const logWarn = (message: string, error?: unknown): void => {
  console.warn(`[character-pool-server] ${message}`, error ?? "");
};

/** 原子寫入：先寫暫存檔，再改名覆蓋目標檔。 */
const atomicWriteFile = (targetPath: string, content: string): void => {
  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, content, "utf-8");
  try {
    renameSync(tmpPath, targetPath);
  } catch (error) {
    logWarn("改名暫存檔失敗，改用直接寫入", error);
    writeFileSync(targetPath, content, "utf-8");
  } finally {
    rmSync(tmpPath, { force: true });
  }
};

/** 建立以單一 JSON 檔為後端的 storage 轉接器（與 localStorage 同介面）。 */
const createFileStorage = (fileName: string): CharacterPoolStorage => {
  const filePath = (): string => path.join(resolveDataDir(), fileName);
  return {
    getItem: (_key: string): string | null => {
      try {
        return readFileSync(filePath(), "utf-8");
      } catch {
        // 檔案不存在或讀取失敗視同沒有資料（readCharacterPool 會回 null）。
        return null;
      }
    },
    setItem: (_key: string, value: string): void => {
      try {
        mkdirSync(resolveDataDir(), { recursive: true });
      } catch (error) {
        logWarn("建立資料目錄失敗", error);
        throw error;
      }
      atomicWriteFile(filePath(), value);
    },
    removeItem: (_key: string): void => {
      try {
        rmSync(filePath(), { force: true });
      } catch (error) {
        logWarn("刪除資料檔失敗", error);
      }
    },
  };
};

const poolFileStorage = createFileStorage(POOL_FILE);
const customScenariosFileStorage = createFileStorage(CUSTOM_SCENARIOS_FILE);

/** 模組層級的 promise 鎖：同一時間只允許一個寫入操作，避免並發覆蓋。 */
const createMutex = (): <T>(operation: () => Promise<T> | T) => Promise<T> => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T> | T): Promise<T> => {
    const next = tail.then(operation, operation);
    // 鎖的尾巴必須吞掉錯誤，否則後續操作不會執行；錯誤仍透過 next 回傳給呼叫端。
    tail = next.catch(() => undefined);
    return next;
  };
};

const withPoolLock = createMutex();
const withCustomLock = createMutex();

// ---------------------------------------------------------------------------
// 角色池動作（供 API 路由呼叫）
// ---------------------------------------------------------------------------

export const readServerPool = (): CharacterPool | null => readCharacterPool(poolFileStorage);

export const takeServerPool = async (count: number): Promise<Awaited<ReturnType<typeof takeCharactersFromPool>>> =>
  withPoolLock(() => takeCharactersFromPool(count, poolFileStorage));

export const appendServerPool = async (
  scenario: GameScenario,
  characters: GeneratedCharacter[],
): Promise<CharacterPool | null> => withPoolLock(() => appendCharactersToPool(scenario, characters, poolFileStorage));

/** 切換「固定班底」：開啟後補池流程不再生成新角色。 */
export const setServerPoolLock = async (locked: boolean): Promise<boolean> =>
  withPoolLock(() => setCharacterPoolLock(locked, poolFileStorage));

/** 伺服器池是否為固定班底模式。 */
export const isServerPoolLocked = (): boolean => isCharacterPoolLocked(readServerPool());

export const setServerPoolScenario = async (scenario: GameScenario): Promise<boolean> =>
  withPoolLock(() => setCharacterPoolScenario(scenario, poolFileStorage));

export const clearServerPool = async (): Promise<void> => withPoolLock(() => clearCharacterPool(poolFileStorage));

// ---------------------------------------------------------------------------
// 自訂情境動作（供 API 路由呼叫）
// ---------------------------------------------------------------------------

export const listServerCustomScenarios = (): GameScenario[] => loadCustomScenarios(customScenariosFileStorage);

export const saveServerCustomScenario = async (input: CustomScenarioInput): Promise<GameScenario | null> =>
  withCustomLock(() => saveCustomScenario(input, customScenariosFileStorage));

export const deleteServerCustomScenario = async (id: string): Promise<void> =>
  withCustomLock(() => deleteCustomScenario(id, customScenariosFileStorage));

export { isValidGameScenario };