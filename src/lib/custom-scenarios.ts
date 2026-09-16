import type { GameScenario } from "@/types/game";

/**
 * 自訂情境：使用者自建的情境（例：金庸群俠），存在瀏覽器 localStorage，
 * 供角色池重建時選用。與內建情境（scenarios.ts 的固定清單）並列，可儲存多個備選。
 *
 * - 每筆自訂情境都是完整的 GameScenario（id 以 custom_ 前綴避免與內建撞名）。
 * - 讀寫失敗一律留警告，不靜默失敗。
 */

export const CUSTOM_SCENARIOS_STORAGE_KEY = "wolfcha:custom-scenarios:v1";

/** 自訂情境最多保留幾筆；超過時捨棄最舊的。 */
const MAX_CUSTOM_SCENARIOS = 20;

export interface CharacterPoolStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 建立自訂情境時的使用者輸入；id 由本模組產生。 */
export type CustomScenarioInput = Omit<GameScenario, "id">;

const logWarn = (message: string, error?: unknown): void => {
  console.warn(`[custom-scenarios] ${message}`, error ?? "");
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const isValidScenario = (value: unknown): value is GameScenario => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (["id", "title", "description", "rolesHint"] as const).every((key) =>
    isNonEmptyString(record[key]),
  );
};

const resolveStorage = (): Storage | null => {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return null;
    return storage;
  } catch (error) {
    logWarn("localStorage 不可用，自訂情境停用", error);
    return null;
  }
};

/** 讀取所有自訂情境；資料損毀時丟棄並回傳空陣列（留警告）。 */
export function loadCustomScenarios(storage: Storage | null = resolveStorage()): GameScenario[] {
  if (!storage) return [];
  let raw: string | null = null;
  try {
    raw = storage.getItem(CUSTOM_SCENARIOS_STORAGE_KEY);
  } catch (error) {
    logWarn("讀取自訂情境失敗", error);
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logWarn("自訂情境資料格式不符，已丟棄");
      return [];
    }
    const valid = parsed.filter(isValidScenario);
    if (valid.length !== parsed.length) {
      logWarn(`自訂情境有 ${parsed.length - valid.length} 筆格式不符，已略過`);
    }
    return valid;
  } catch (error) {
    logWarn("自訂情境無法解析，已丟棄", error);
    return [];
  }
}

/**
 * 儲存一筆自訂情境並回傳完整物件（id 自動產生）。
 * 超過上限時捨棄最舊的一筆。
 */
export function saveCustomScenario(input: CustomScenarioInput, storage: Storage | null = resolveStorage()): GameScenario | null {
  const scenario: GameScenario = {
    id: `custom_${Date.now().toString(36)}`,
    title: input.title.trim(),
    description: input.description.trim(),
    rolesHint: input.rolesHint.trim(),
  };
  if (!isNonEmptyString(scenario.title) || !isNonEmptyString(scenario.description)) {
    logWarn("自訂情境缺少名稱或描述，未儲存");
    return null;
  }
  if (!storage) {
    logWarn("沒有可用的儲存空間，自訂情境未儲存");
    return null;
  }
  const list = loadCustomScenarios(storage);
  const next = [...list, scenario].slice(-MAX_CUSTOM_SCENARIOS);
  try {
    storage.setItem(CUSTOM_SCENARIOS_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    logWarn("自訂情境寫入失敗", error);
    return null;
  }
  return scenario;
}

/** 刪除指定 id 的自訂情境；不影響目前綁定的角色池。 */
export function deleteCustomScenario(id: string, storage: Storage | null = resolveStorage()): void {
  if (!storage) return;
  const rest = loadCustomScenarios(storage).filter((scenario) => scenario.id !== id);
  try {
    storage.setItem(CUSTOM_SCENARIOS_STORAGE_KEY, JSON.stringify(rest));
  } catch (error) {
    logWarn("自訂情境刪除失敗", error);
  }
}