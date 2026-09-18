"use client";

import { useEffect, useState } from "react";

import { fetchCharacterStats } from "@/lib/character-stats";
import type { CharacterStat } from "@/types/game";

/**
 * 生涯戰績（參賽數／勝率／MVP 數）讀取 hook。
 * 資料來源：/api/character-stats 聚合（按角色 displayName 累計）。
 * 模組層快取：同一次頁面生命週期只打一次 API。
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

/** 依角色名查生涯戰績；無記錄回 undefined（靜默降級，UI 不顯示該區塊）。 */
export function useCareerStats(displayName: string | undefined | null): CharacterStat | undefined {
  const [statsMap, setStatsMap] = useState<Record<string, CharacterStat> | undefined>(careerStatsCache);

  useEffect(() => {
    if (statsMap) return;
    let cancelled = false;
    loadCareerStats()
      .then((map) => {
        if (!cancelled && map) setStatsMap(map);
      })
      .catch((error) => {
        // fetchCharacterStats 內部已記 log；此處僅避免未處理的 rejection
        console.warn("[wolfcha] useCareerStats load failed:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [statsMap]);

  if (!displayName || !statsMap) return undefined;
  return statsMap[displayName];
}