import type { GeneratedCharacter } from "./character-generator";
import { getLocale } from "@/i18n/locale-store";
import { DEFAULT_POOL_ID } from "./roster-pool-ids";
import POOL_ZH_CN from "@/lib/character-pool/jin-yong-pool.zh-CN.json";
import POOL_ZH_TW from "@/lib/character-pool/jin-yong-pool.zh-TW.json";

/**
 * 角色池：金庸群俠（46 人）。
 *
 * 角色資料在 src/lib/character-pool/jin-yong-pool.zh-*.json：
 * - zh-CN：手寫班底 12 人 ＋ 角色池生成內容 34 人（含每人 voiceId，供 TTS 依角色選聲）。
 * - zh-TW：由 OpenCC s2twp 轉換產生（產物，勿手改；要改請改來源後重跑轉換）。
 * - en 使用 zh-CN 文案（角色本為武俠人物）。
 *
 * 開局一律從整池隨機抽取，不再有寫死的固定班底；新增／移除角色改 JSON 即可
 * （欄位見 types/game.ts 的 Persona／PlayerMind，voiceRules 為必填）。
 */
const POOL_ZH_CN_CHARACTERS = POOL_ZH_CN as unknown as GeneratedCharacter[];
const POOL_ZH_TW_CHARACTERS = POOL_ZH_TW as unknown as GeneratedCharacter[];

/**
 * 角色池：一個 id 對一組角色。
 * 新增池（如三國志、其他系列）時：在 buildPools 加一筆、roster-pool-ids 同步加 id、
 * i18n 補 rosterPools.<id>.name 三語即可，UI 下拉自動出現。
 */
export interface RosterPool {
  id: string;
  characters: GeneratedCharacter[];
}

/** 依目前語系組出池清單（zh-TW 用繁中版，其餘用 zh-CN 文案）。 */
function buildPools(): RosterPool[] {
  const characters = getLocale() === "zh-TW" ? POOL_ZH_TW_CHARACTERS : POOL_ZH_CN_CHARACTERS;
  return [{ id: "jin_yong", characters }];
}

/** 可選池 id（定義在輕量模組，避免 UI／settings 連角色資料一起載入）。 */
export { ROSTER_POOL_IDS, DEFAULT_POOL_ID, type RosterPoolId } from "./roster-pool-ids";

/** 取指定池；id 未帶或無效時退回預設池。 */
export function getRosterPool(poolId: string = DEFAULT_POOL_ID): RosterPool {
  const pools = buildPools();
  return pools.find((pool) => pool.id === poolId) ?? pools[0]!;
}

/** 從角色池隨機抽 count 名角色；池子不足時循環補齊（正常 8-12 人局不會觸發）。 */
export function sampleRosterCharacters(count: number, poolId?: string): GeneratedCharacter[] {
  const roster = getRosterPool(poolId).characters;
  const shuffled = [...roster];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  if (count <= shuffled.length) return shuffled.slice(0, count);
  const out = [...shuffled];
  while (out.length < count) out.push(shuffled[out.length % shuffled.length]!);
  return out;
}
