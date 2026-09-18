/**
 * 角色交手统计：游戏结束时逐人落一行 JSONL，按显示名聚合。
 * 数据文件由服务端 /api/character-stats 维护；本檔只放纯逻辑与客户端 fetch 帮手，
 * 不 import node 模块，保证客户端 bundle 可安全引用。
 */

import { fetchWithTimeout } from "@/lib/request-timeout";
import type { CharacterStat } from "@/types/game";

export interface CharacterStatRecord {
  gameId?: string;
  name: string;
  alignment: "wolf" | "village";
  won: boolean;
  mvp: boolean;
  /** 舊記錄可能無此欄位，parse 時預設 false。 */
  svp: boolean;
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

/** 按名字聚合；同一局多行（重放）不去重——去重由服务端写入时负责。 */
export function aggregateCharacterStats(records: CharacterStatRecord[]): Record<string, CharacterStat> {
  const stats: Record<string, CharacterStat> = {};
  for (const rec of records) {
    const entry = stats[rec.name] ?? { games: 0, wins: 0, mvps: 0, svps: 0 };
    entry.games += 1;
    if (rec.won) entry.wins += 1;
    if (rec.mvp) entry.mvps += 1;
    if (rec.svp) entry.svps += 1;
    stats[rec.name] = entry;
  }
  return stats;
}

/** 读取聚合统计；任何失败（本地 demo、无文件、请求失败）返回 undefined，由调用方静默降级。 */
export async function fetchCharacterStats(): Promise<Record<string, CharacterStat> | undefined> {
  try {
    const res = await fetchWithTimeout("/api/character-stats", { method: "GET" }, 8000);
    if (!res.ok) {
      console.warn("[wolfcha] fetchCharacterStats failed:", res.status);
      return undefined;
    }
    const data = (await res.json()) as { stats?: Record<string, CharacterStat> };
    return data.stats && Object.keys(data.stats).length > 0 ? data.stats : undefined;
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