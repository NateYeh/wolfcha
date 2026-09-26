"use client";

import { useEffect, useState } from "react";

import { fetchCharacterStats, resolveCharacterKey } from "@/lib/character-stats";
import type { CharacterStat } from "@/types/game";

/** 無紀錄時顯示的零值戰績：角色卡一律顯示戰績區塊（含 0 參賽）。 */
const EMPTY_CAREER_STAT: CharacterStat = {
  games: 0,
  wins: 0,
  mvps: 0,
  svps: 0,
  villageGames: 0,
  villageWins: 0,
  wolfGames: 0,
  wolfWins: 0,
};

/**
 * 生涯戰績（參賽數／勝率／MVP／SVP）讀取 hook。
 * 資料來源：/api/character-stats 聚合（角色按 id、人類玩家按名字；舊紀錄用名字反查 id）。
 * 模組層快取：同一次頁面生命週期只打一次 API。
 *
 * 回傳值：
 * - 尚未載入完成 → undefined（UI 可據此顯示載入中／暫不顯示）。
 * - 載入完成後 → 一律回 CharacterStat；該角色無紀錄時回零值，讓卡片一定顯示戰績。
 */
let careerStatsCache: Record<string, CharacterStat> | undefined;
let careerStatsCachePromise: Promise<Record<string, CharacterStat> | undefined> | null = null;

function loadCareerStats(): Promise<Record<string, CharacterStat> | undefined> {
  if (careerStatsCache) return Promise.resolve(careerStatsCache);
  if (!careerStatsCachePromise) {
    careerStatsCachePromise = fetchCharacterStats()
      .then((stats) => {
        if (stats) careerStatsCache = stats;
        return stats;
      })
      .finally(() => {
        careerStatsCachePromise = null;
      });
  }
  return careerStatsCachePromise;
}

/**
 * 查生涯戰績。
 * @param characterId 角色池穩定 id（AI 角色才有）。
 * @param name 顯示名；人類玩家沒有 characterId，改用名字查（同名角色會合併到該角色）。
 */
export function useCareerStats(
  characterId: string | undefined | null,
  name?: string | undefined | null,
): CharacterStat | undefined {
  const [statsMap, setStatsMap] = useState<Record<string, CharacterStat> | undefined>(careerStatsCache);

  useEffect(() => {
    if (statsMap) return;
    let cancelled = false;
    let attempt = 0;
    const tryLoad = async (): Promise<void> => {
      const map = await loadCareerStats();
      if (cancelled) return;
      if (map) {
        setStatsMap(map);
        return;
      }
      // 載入失敗（例如 dev server 正在重編譯、請求逾時）：退避重試兩次，
      // 都失敗才落零值戰績——避免一次逾時讓角色卡永遠卡在 0。
      attempt += 1;
      if (attempt < 3) {
        window.setTimeout(() => {
          void tryLoad();
        }, 2500 * attempt);
        return;
      }
      setStatsMap({});
    };
    void tryLoad();
    return () => {
      cancelled = true;
    };
  }, [statsMap]);

  if (!statsMap) return undefined;
  const key = resolveCharacterKey({ characterId: characterId ?? undefined, name: name ?? "" });
  if (!key) return undefined;
  return statsMap[key] ?? EMPTY_CAREER_STAT;
}
