import type { GameScenario } from "@/types/game";
import type { CharacterPoolStorage } from "./character-pool";

/**
 * 自訂情境：使用者自建的情境（例：金庸群俠），存在伺服器（.data/ JSON 檔），
 * 供角色池重建時選用。與內建情境（scenarios.ts 的固定清單）並列，可儲存多個備選。
 *
 * - 每筆自訂情境都是完整的 GameScenario（id 以 custom_ 前綴避免與內建撞名）。
 * - 儲存後端由呼叫端注入（伺服器為檔案、測試為記憶體），本模組只管邏輯。
 * - 讀寫失敗一律留警告，不靜默失敗。
 */

/** 自訂情境最多保留幾筆；超過時捨棄最舊的。 */
const MAX_CUSTOM_SCENARIOS = 20;

/** storage 內的鍵名（伺服器檔案版與測試版共用同一鍵）。 */
const CUSTOM_SCENARIOS_STORAGE_KEY = "wolfcha:custom-scenarios:v1";

/** 建立自訂情境時的使用者輸入；id 由本模組產生。 */
export type CustomScenarioInput = Omit<GameScenario, "id">;

const logWarn = (message: string, error?: unknown): void => {
  console.warn(`[custom-scenarios] ${message}`, error ?? "");
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/** 檢查未知資料是否為完整的 GameScenario；供本模組與伺服器端路由共用。 */
export function isValidGameScenario(value: unknown): value is GameScenario {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (["id", "title", "description", "rolesHint"] as const).every((key) =>
    isNonEmptyString(record[key]),
  );
}

/** 讀取所有自訂情境；資料損毀時丟棄並回傳空陣列（留警告）。 */
export function loadCustomScenarios(storage: CharacterPoolStorage): GameScenario[] {
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
    const valid = parsed.filter(isValidGameScenario);
    if (valid.length !== parsed.length) {
      logWarn(`自訂情境有 ${parsed.length - valid.length} 筆格式不符，已略過`);
    }
    return valid;
  } catch (error) {
    logWarn("自訂情境無法解析，已丟棄", error);
    return [];
  }
}

/** 產生不撞名的情境 id：時間戳＋隨機尾碼（同毫秒連續儲存也不會撞）。 */
const generateScenarioId = (): string =>
  `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * 儲存一筆自訂情境並回傳完整物件（id 自動產生）。
 * 超過上限時捨棄最舊的一筆。
 */
export function saveCustomScenario(input: CustomScenarioInput, storage: CharacterPoolStorage): GameScenario | null {
  const scenario: GameScenario = {
    id: generateScenarioId(),
    title: input.title.trim(),
    description: input.description.trim(),
    rolesHint: input.rolesHint.trim(),
  };
  if (!isNonEmptyString(scenario.title) || !isNonEmptyString(scenario.description)) {
    logWarn("自訂情境缺少名稱或描述，未儲存");
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
export function deleteCustomScenario(id: string, storage: CharacterPoolStorage): void {
  const rest = loadCustomScenarios(storage).filter((scenario) => scenario.id !== id);
  try {
    storage.setItem(CUSTOM_SCENARIOS_STORAGE_KEY, JSON.stringify(rest));
  } catch (error) {
    logWarn("自訂情境刪除失敗", error);
  }
}