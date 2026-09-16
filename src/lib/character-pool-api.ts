/**
 * 角色池／自訂情境的客戶端 API 層：
 * 把原本直接讀寫 localStorage 的操作，改為呼叫伺服器 API（所有瀏覽器共用同一份池）。
 *
 * 一律不拋出例外：失敗回 null / false 並留警告，呼叫端自行兜底（開局時即時生成）。
 */

import type { GeneratedCharacter } from "./character-generator";
import type { CharacterPool, CharacterPoolTake } from "./character-pool";
import { isValidGameScenario, type CustomScenarioInput } from "./custom-scenarios";
import type { GameScenario } from "@/types/game";

const logWarn = (message: string, error?: unknown): void => {
  console.warn(`[character-pool-api] ${message}`, error ?? "");
};

/** 讀取伺服器上的角色池；失敗回 null（視同沒有池）。 */
export async function fetchServerPool(): Promise<CharacterPool | null> {
  try {
    const response = await fetch("/api/character-pool", { cache: "no-store" });
    if (!response.ok) {
      logWarn(`讀取角色池失敗（HTTP ${response.status}）`);
      return null;
    }
    const data = (await response.json()) as { pool?: unknown };
    if (!data.pool) return null;
    return isValidPoolShape(data.pool) ? data.pool : null;
  } catch (error) {
    logWarn("讀取角色池失敗", error);
    return null;
  }
}

const isValidPoolShape = (value: unknown): value is CharacterPool => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isValidGameScenario(record.scenario) && Array.isArray(record.characters) && Array.isArray(record.usedIndexes);
};

const postPoolAction = async (body: unknown): Promise<boolean> => {
  try {
    const response = await fetch("/api/character-pool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      logWarn(`角色池操作失敗（HTTP ${response.status}）`);
      return false;
    }
    return true;
  } catch (error) {
    logWarn("角色池操作失敗", error);
    return false;
  }
};

/** 從伺服器池抽用角色（開局時）；失敗回 null，呼叫端改走即時生成。 */
export async function takeServerPoolCharacters(count: number): Promise<CharacterPoolTake | null> {
  try {
    const response = await fetch("/api/character-pool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "take", count }),
    });
    if (!response.ok) {
      logWarn(`抽用角色池失敗（HTTP ${response.status}）`);
      return null;
    }
    const data = (await response.json()) as {
      pooled?: { scenario: unknown; characters: unknown } | null;
    };
    if (!data.pooled || !isValidGameScenario(data.pooled.scenario) || !Array.isArray(data.pooled.characters)) {
      return null;
    }
    return {
      scenario: data.pooled.scenario,
      characters: data.pooled.characters as CharacterPoolTake["characters"],
    };
  } catch (error) {
    logWarn("抽用角色池失敗", error);
    return null;
  }
}

/** 把新生成的一批角色寫回伺服器池。 */
export async function appendToServerPool(scenario: GameScenario, characters: GeneratedCharacter[]): Promise<boolean> {
  return postPoolAction({ action: "append", scenario, characters });
}

/** 綁定指定情境並重建整池（建立綁定情境的空池）。 */
export async function setServerPoolScenarioRemote(scenario: GameScenario): Promise<boolean> {
  return postPoolAction({ action: "set-scenario", scenario });
}

/** 清空伺服器池（下一次補充會抽新情境）。 */
export async function clearServerPoolRemote(): Promise<boolean> {
  return postPoolAction({ action: "clear" });
}

// ---------------------------------------------------------------------------
// 自訂情境
// ---------------------------------------------------------------------------

/** 讀取伺服器上的自訂情境清單；失敗回空陣列。 */
export async function fetchCustomScenariosRemote(): Promise<GameScenario[]> {
  try {
    const response = await fetch("/api/custom-scenarios", { cache: "no-store" });
    if (!response.ok) {
      logWarn(`讀取自訂情境失敗（HTTP ${response.status}）`);
      return [];
    }
    const data = (await response.json()) as { scenarios?: unknown };
    if (!Array.isArray(data.scenarios)) return [];
    return data.scenarios.filter(isValidGameScenario);
  } catch (error) {
    logWarn("讀取自訂情境失敗", error);
    return [];
  }
}

/** 儲存一筆自訂情境；失敗回 null。 */
export async function saveCustomScenarioRemote(input: Omit<GameScenario, "id">): Promise<GameScenario | null> {
  try {
    const response = await fetch("/api/custom-scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      logWarn(`儲存自訂情境失敗（HTTP ${response.status}）`);
      return null;
    }
    const data = (await response.json()) as { scenario?: unknown };
    return isValidGameScenario(data.scenario) ? data.scenario : null;
  } catch (error) {
    logWarn("儲存自訂情境失敗", error);
    return null;
  }
}

/** 刪除指定 id 的自訂情境。 */
export async function deleteCustomScenarioRemote(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/custom-scenarios?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      logWarn(`刪除自訂情境失敗（HTTP ${response.status}）`);
      return false;
    }
    return true;
  } catch (error) {
    logWarn("刪除自訂情境失敗", error);
    return false;
  }
}