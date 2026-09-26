/**
 * 角色交手统计：游戏结束时逐人落一行 JSONL，按角色 id 聚合。
 * 数据文件由服务端 /api/character-stats 维护；本檔只放纯逻辑与客户端 fetch 帮手，
 * 不 import node 模块，保证客户端 bundle 可安全引用。
 */

import { fetchWithTimeout } from "@/lib/request-timeout";
import type { CharacterStat } from "@/types/game";
import CHARACTER_NAMES from "@/lib/character-pool/character-names.json";

export interface CharacterStatRecord {
  gameId?: string;
  /** 角色池穩定 id；舊紀錄可能無此欄位，聚合時會用 name 反查。 */
  characterId?: string;
  name: string;
  alignment: "wolf" | "village";
  won: boolean;
  mvp: boolean;
  /** 舊記錄可能無此欄位，parse 時預設 false。 */
  svp: boolean;
}

/** 名稱（繁／簡／英）→ 角色 id；供舊紀錄（只有 name）正規化與跨語系查詢。 */
export const NAME_TO_ID: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const names = CHARACTER_NAMES as Record<string, Record<string, string>>;
  for (const [id, localized] of Object.entries(names)) {
    for (const value of Object.values(localized)) {
      if (value && !(value in map)) map[value] = id;
    }
  }
  return map;
})();

/** 把一筆紀錄化成統計 key：優先 characterId，其次名稱反查，最後才退回原始名字。 */
export function resolveCharacterKey(record: { characterId?: string; name: string }): string {
  const id = record.characterId?.trim();
  if (id) return id;
  return NAME_TO_ID[record.name] ?? record.name;
}

/** 解析一行 JSONL 统计记录；格式不符返回 null（坏行直接跳过，不让一个坏记录毁掉全部聚合）。 */
export function parseStatLine(raw: string): CharacterStatRecord | null {
  const line = raw.trim();
  if (!line) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.name !== "string" || !rec.name.trim()) return null;
  if (rec.alignment !== "wolf" && rec.alignment !== "village") return null;
  if (typeof rec.won !== "boolean" || typeof rec.mvp !== "boolean") return null;
  return {
    gameId: typeof rec.gameId === "string" ? rec.gameId : undefined,
    characterId: typeof rec.characterId === "string" ? rec.characterId : undefined,
    name: rec.name.trim(),
    alignment: rec.alignment,
    won: rec.won,
    mvp: rec.mvp,
    svp: rec.svp === true,
  };
}

export function serializeStatRecord(record: CharacterStatRecord): string {
  return JSON.stringify(record);
}

/**
 * 按角色 id 聚合；同一局多行（重放）不去重——去重由服务端写入时负责。
 * 舊紀錄沒有 characterId 時，用 name 反查 id，繁簡／英三種寫法會合併成同一角色。
 */
export function aggregateCharacterStats(records: CharacterStatRecord[]): Record<string, CharacterStat> {
  const stats: Record<string, CharacterStat> = {};
  for (const rec of records) {
    const key = resolveCharacterKey(rec);
    const entry = stats[key] ?? {
      games: 0,
      wins: 0,
      mvps: 0,
      svps: 0,
      villageGames: 0,
      villageWins: 0,
      wolfGames: 0,
      wolfWins: 0,
    };
    entry.games += 1;
    if (rec.won) entry.wins += 1;
    if (rec.mvp) entry.mvps += 1;
    if (rec.svp) entry.svps += 1;
    // 陣營分開累計：同一個人在好人與狼人時的勝率常常差很多
    if (rec.alignment === "wolf") {
      entry.wolfGames += 1;
      if (rec.won) entry.wolfWins += 1;
    } else {
      entry.villageGames += 1;
      if (rec.won) entry.villageWins += 1;
    }
    stats[key] = entry;
  }
  return stats;
}

/** 读取聚合统计；请求失败返回 undefined，空资料集返回空物件（让角色卡仍显示 0 参赛）。 */
export async function fetchCharacterStats(): Promise<Record<string, CharacterStat> | undefined> {
  try {
    const res = await fetchWithTimeout("/api/character-stats", { method: "GET" }, 8000);
    if (!res.ok) {
      console.warn("[wolfcha] fetchCharacterStats failed:", res.status);
      return undefined;
    }
    const data = (await res.json()) as { stats?: Record<string, CharacterStat> };
    return data.stats ?? {};
  } catch (error) {
    console.warn("[wolfcha] fetchCharacterStats failed:", error);
    return undefined;
  }
}

/** 游戏结束时上报一次逐人记录；fire-and-forget，失败只 warn 不影响结算流程。 */
export async function recordCharacterStats(
  gameId: string | undefined,
  records: CharacterStatRecord[]
): Promise<void> {
  if (records.length === 0) return;
  try {
    const res = await fetchWithTimeout(
      "/api/character-stats",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId, records }),
      },
      8000,
    );
    if (!res.ok) {
      console.warn("[wolfcha] recordCharacterStats failed:", res.status);
    }
  } catch (error) {
    console.warn("[wolfcha] recordCharacterStats failed:", error);
  }
}
