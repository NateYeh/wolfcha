"use client";

import { useEffect, useState } from "react";

import { fetchCharacterStats, resolveCharacterKey } from "@/lib/character-stats";
import type { CharacterStat } from "@/types/game";

/** 無紀錄時顯示的零值戰績：角色卡一律顯示戰績區塊（含 0 參賽）。 */
const EMPTY_CAREER_STAT: CharacterStat = { games: 0, wins: 0, mvps: 0, svps: 0 };

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
    loadCareerStats()
      .then((map) => {
        // 即使回空（或失敗）也標記為已載入，讓角色卡顯示零值戰績而非整塊不見。
        if (!cancelled) setStatsMap(map ?? {});
      })
      .catch((error) => {
        // fetchCharacterStats 內部已記 log；此處僅避免未處理的 rejection
        console.warn("[wolfcha] useCareerStats load failed:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [statsMap]);

  if (!statsMap) return undefined;
  const key = resolveCharacterKey({ characterId: characterId ?? undefined, name: name ?? "" });
  if (!key) return undefined;
  return statsMap[key] ?? EMPTY_CAREER_STAT;
}
