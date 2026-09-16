import type { GameScenario } from "@/types/game";
import type { GeneratedCharacter } from "./character-generator";

/**
 * 角色池：預先生成一批完整角色（persona + playerMind）存在瀏覽器，開局直接抽用，
 * 省掉每局約 50 秒的角色生成等待。
 *
 * 設計取捨：
 * - 一池綁一個情境（scenario）。角色是照著該情境的名字風格／職業風味生成的，
 *   所以抽用時也沿用同一個情境，避免風味錯配。
 * - 池只管存放與抽樣，不負責生成（生成在 character-pool-refill.ts）。
 * - 任何讀寫失敗都必須留下警告，不得靜默失敗。
 */

export const CHARACTER_POOL_STORAGE_KEY = "wolfcha:character-pool:v1";
/** 池的目標容量＝幾局份；不足時由背景慢慢補到這個量。 */
export const CHARACTER_POOL_ROUNDS = 3;

export interface CharacterPoolStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CharacterPool {
  version: 1;
  scenario: GameScenario;
  characters: GeneratedCharacter[];
  /** 已抽用過的角色索引；全部用完後會重置，允許下一輪重複使用。 */
  usedIndexes: number[];
  updatedAt: number;
}

export interface CharacterPoolTake {
  scenario: GameScenario;
  characters: GeneratedCharacter[];
}

const POOL_VERSION = 1;

const logWarn = (message: string, error?: unknown): void => {
  console.warn(`[character-pool] ${message}`, error ?? "");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const resolveCharacterPoolStorage = (): CharacterPoolStorage | null => {
  try {
    const storage = (globalThis as { localStorage?: CharacterPoolStorage }).localStorage;
    if (!storage) return null;
    return storage;
  } catch (error) {
    logWarn("localStorage 不可用，角色池停用", error);
    return null;
  }
};

const isValidScenario = (value: unknown): value is GameScenario => {
  if (!isRecord(value)) return false;
  return ["id", "title", "description", "rolesHint"].every(
    (key) => typeof value[key] === "string" && String(value[key]).trim() !== "",
  );
};

const isValidCharacter = (value: unknown): value is GeneratedCharacter => {
  if (!isRecord(value)) return false;
  if (typeof value.displayName !== "string" || value.displayName.trim() === "") return false;
  const persona = value.persona;
  if (!isRecord(persona)) return false;
  if (typeof persona.mbti !== "string" || persona.mbti.trim() === "") return false;
  if (typeof persona.age !== "number" || !Number.isFinite(persona.age)) return false;
  if (!Array.isArray(persona.voiceRules)) return false;
  return true;
};

const isValidPool = (value: unknown): value is CharacterPool => {
  if (!isRecord(value)) return false;
  if (value.version !== POOL_VERSION) return false;
  if (!isValidScenario(value.scenario)) return false;
  // 允許空池（綁定情境但角色尚未生成）；補充流程會以綁定情境慢慢補滿。
  if (!Array.isArray(value.characters)) return false;
  if (!value.characters.every(isValidCharacter)) return false;
  if (!Array.isArray(value.usedIndexes)) return false;
  if (!value.usedIndexes.every((index) => Number.isInteger(index))) return false;
  return true;
};

/** 讀取角色池；資料損毀或版本不符時丟棄並回傳 null（留警告，不靜默）。 */
export function readCharacterPool(storage = resolveCharacterPoolStorage()): CharacterPool | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(CHARACTER_POOL_STORAGE_KEY);
  } catch (error) {
    logWarn("讀取角色池失敗", error);
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidPool(parsed)) {
      logWarn("角色池資料格式不符，已丟棄");
      storage.removeItem(CHARACTER_POOL_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch (error) {
    logWarn("角色池資料無法解析，已丟棄", error);
    try {
      storage.removeItem(CHARACTER_POOL_STORAGE_KEY);
    } catch (removeError) {
      logWarn("丟棄損毀的角色池失敗", removeError);
    }
    return null;
  }
}

/** 寫入角色池；失敗回傳 false 並留警告。 */
export function writeCharacterPool(pool: CharacterPool, storage = resolveCharacterPoolStorage()): boolean {
  if (!storage) {
    logWarn("沒有可用的儲存空間，角色池未寫入");
    return false;
  }
  try {
    storage.setItem(
      CHARACTER_POOL_STORAGE_KEY,
      JSON.stringify({ ...pool, updatedAt: Date.now() } satisfies CharacterPool),
    );
    return true;
  } catch (error) {
    logWarn("寫入角色池失敗", error);
    return false;
  }
}

export function clearCharacterPool(storage = resolveCharacterPoolStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(CHARACTER_POOL_STORAGE_KEY);
  } catch (error) {
    logWarn("清空角色池失敗", error);
  }
}

/**
 * 綁定角色池情境：建立（或重設為）「綁定情境的空池」。
 * 之後的背景補充會以此情境生成，開局抽用時沿用同一情境；
 * 與 clearCharacterPool 的差異在於 clear 之後會隨機抽新情境，本函式則明確指定。
 */
export function setCharacterPoolScenario(
  scenario: GameScenario,
  storage = resolveCharacterPoolStorage(),
): boolean {
  if (!isValidScenario(scenario)) {
    logWarn("情境資料不完整，角色池未綁定");
    return false;
  }
  if (!storage) {
    logWarn("沒有可用的儲存空間，角色池未綁定");
    return false;
  }
  return writeCharacterPool(
    { version: POOL_VERSION, scenario, characters: [], usedIndexes: [], updatedAt: Date.now() },
    storage,
  );
}

/** 池內尚未被抽用過的索引。 */
export function unusedCharacterIndexes(pool: CharacterPool): number[] {
  const used = new Set(pool.usedIndexes);
  return pool.characters.map((_, index) => index).filter((index) => !used.has(index));
}

const pickRandom = (indexes: number[], count: number): number[] => {
  const pool = [...indexes];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
};

/**
 * 從池中抽出 count 個未使用角色，並標記為已使用。
 * 未使用數量不足時回傳 null（交由呼叫端即時生成，不抽半套），不消耗池。
 */
export function takeCharactersFromPool(
  count: number,
  storage = resolveCharacterPoolStorage(),
): CharacterPoolTake | null {
  if (!Number.isInteger(count) || count <= 0) return null;
  const pool = readCharacterPool(storage);
  if (!pool) return null;

  const unused = unusedCharacterIndexes(pool);
  if (unused.length < count) return null;

  const picked = pickRandom(unused, count);
  const next: CharacterPool = { ...pool, usedIndexes: [...pool.usedIndexes, ...picked] };
  // 整池剛好用完：重置使用紀錄，讓下一輪可以重複抽用（避免池被永久掏空）。
  if (unusedCharacterIndexes(next).length === 0) {
    next.usedIndexes = [];
  }
  writeCharacterPool(next, storage);

  return {
    scenario: pool.scenario,
    characters: picked.map((index) => pool.characters[index]!),
  };
}

/**
 * 把新生成的角色併入池中。
 * 池不存在時以此情境建立；情境不符時略過（一池綁一個情境）；同名角色不重複加入。
 */
export function appendCharactersToPool(
  scenario: GameScenario,
  characters: GeneratedCharacter[],
  storage = resolveCharacterPoolStorage(),
): CharacterPool | null {
  if (!storage) {
    logWarn("沒有可用的儲存空間，角色池未更新");
    return null;
  }
  const pool = readCharacterPool(storage);

  if (pool && pool.scenario.id !== scenario.id) {
    logWarn(`角色池綁定情境「${pool.scenario.id}」，略過情境「${scenario.id}」的補充`);
    return pool;
  }

  const existingNames = new Set(
    (pool?.characters ?? []).map((character) => character.displayName.trim()),
  );
  const incoming = characters.filter(
    (character) =>
      isValidCharacter(character) && !existingNames.has(character.displayName.trim()),
  );
  if (incoming.length === 0) return pool;

  const next: CharacterPool = pool
    ? { ...pool, characters: [...pool.characters, ...incoming] }
    : { version: POOL_VERSION, scenario, characters: incoming, usedIndexes: [], updatedAt: Date.now() };
  writeCharacterPool(next, storage);
  return next;
}
