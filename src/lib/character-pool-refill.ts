import type { GameScenario } from "@/types/game";
import { generateCharacters, type GeneratedCharacter } from "./character-generator";
import { getRandomScenario } from "./scenarios";
import { CHARACTER_POOL_ROUNDS, unusedCharacterIndexes, type CharacterPool } from "./character-pool";
import { appendToServerPool, clearServerPoolRemote, fetchServerPool } from "./character-pool-api";

/**
 * 角色池的背景補充（伺服器共用池版）：一次補「一局份」的角色（不阻塞開局）。
 *
 * 呼叫端（歡迎畫面）在閒置時反覆呼叫本函式，直到池達到目標容量；
 * 生成失敗只留警告，不影響遊戲（開局時池不足就照舊即時生成）。
 * 池本體存在伺服器（.data/），多個瀏覽器共用；同一時間各瀏覽器
 * 最多各跑一批補充，重複生成由伺服器端的名字去重擋下。
 */

/** 同一視窗內只允許一個補充批次在跑，避免重複生成與重複計費。 */
let refillInFlight = false;

export const isCharacterPoolRefillInFlight = (): boolean => refillInFlight;

export interface CharacterPoolStatus {
  /** 池內尚未被抽用過的角色數。 */
  unused: number;
  /** 池內角色總數。 */
  total: number;
  /** 池綁定的情境；尚未建立時為 null。 */
  scenarioId: string | null;
  scenarioTitle: string | null;
  /** 目標容量＝一局需要的角色數 × CHARACTER_POOL_ROUNDS。 */
  target: number;
  refilling: boolean;
}

/** 由池物件計算狀態；pool 為 null 表示伺服器上還沒有池。 */
export function getCharacterPoolStatus(
  charactersPerGame: number,
  pool: CharacterPool | null,
): CharacterPoolStatus {
  const target = Math.max(1, charactersPerGame) * CHARACTER_POOL_ROUNDS;
  return {
    unused: pool ? unusedCharacterIndexes(pool).length : 0,
    total: pool?.characters.length ?? 0,
    scenarioId: pool?.scenario.id ?? null,
    scenarioTitle: pool?.scenario.title ?? null,
    target,
    refilling: refillInFlight,
  };
}

/**
 * 補一批角色進伺服器池（若池已達標則不做任何事）。
 * - `skipped`：已達標或已有補充批次在跑
 * - `refilled`：本次真的生成並寫入
 * - `failed`：生成或寫入失敗（已留警告，開局時會即時生成）
 */
export type CharacterPoolRefillResult = "skipped" | "refilled" | "failed";

/** 生成一批角色的函式；預設走正式生成，測試可注入假實作。 */
export type CharacterBatchGenerator = (
  count: number,
  scenario: GameScenario,
) => Promise<GeneratedCharacter[]>;

const defaultGenerator: CharacterBatchGenerator = (count, scenario) =>
  generateCharacters(count, scenario, { logSource: "pool_refill" });

export async function refillCharacterPoolOnce(
  charactersPerGame: number,
  generate: CharacterBatchGenerator = defaultGenerator,
): Promise<CharacterPoolRefillResult> {
  const perGame = Math.max(1, Math.floor(charactersPerGame));
  if (refillInFlight) return "skipped";

  const pool = await fetchServerPool();
  const unused = pool ? unusedCharacterIndexes(pool).length : 0;
  const target = perGame * CHARACTER_POOL_ROUNDS;
  if (unused >= target) return "skipped";

  refillInFlight = true;
  try {
    // 一池綁一個情境：續用池既有情境，首次建立才抽新情境。
    const scenario = pool?.scenario ?? getRandomScenario();
    const characters = await generate(perGame, scenario);
    if (characters.length === 0) {
      console.warn("[character-pool] 補充批次沒有產出角色，池維持不變");
      return "failed";
    }
    const appended = await appendToServerPool(scenario, characters);
    if (!appended) {
      console.warn("[character-pool] 補充批次寫回伺服器失敗，池維持不變");
      return "failed";
    }
    return "refilled";
  } catch (error) {
    console.warn("[character-pool] 背景補充角色失敗，開局時將即時生成：", error);
    return "failed";
  } finally {
    refillInFlight = false;
  }
}

/** 換一個情境重建角色池：清空伺服器池，下一次補充會以新情境重新建立。 */
export async function resetCharacterPoolScenario(): Promise<void> {
  await clearServerPoolRemote();
}