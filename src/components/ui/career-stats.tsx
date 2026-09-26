"use client";

import { useTranslations } from "next-intl";

import type { CharacterStat } from "@/types/game";

/**
 * 生涯戰績格子（場次／勝率／MVP／SVP ＋ 陣營勝率）。
 *
 * 遊戲中的玩家卡與賽後分析的玩家卡原本各抄一份 JSX；加「陣營勝率」時就會變成兩邊各改一次
 * （漏改一邊只會讓兩個地方顯示不同的數字，沒有任何錯誤訊息）。這裡收成一份，兩邊共用。
 */
export interface CareerStatsGridProps {
  stats: CharacterStat;
}

/** 勝率百分比；沒有場次時回「—」（避免 0/0 顯示成 0% 讓人以為打過但全敗）。 */
function winRateText(games: number, wins: number): string {
  return games > 0 ? String(Math.round((wins / games) * 100)) : "—";
}

export function CareerStatsGrid({ stats }: CareerStatsGridProps) {
  const t = useTranslations();
  const camps: Array<{ key: "campVillage" | "campWolf"; games: number; wins: number }> = [
    { key: "campVillage", games: stats.villageGames, wins: stats.villageWins },
    { key: "campWolf", games: stats.wolfGames, wins: stats.wolfWins },
  ];

  return (
    <div className="rounded-lg bg-black/5 dark:bg-white/10 px-2 py-2">
      <div className="grid grid-cols-4">
        <div className="min-w-0">
          <div className="text-sm font-bold text-[var(--text-primary)] whitespace-nowrap">
            {t("playerDetail.statGamesValue", { games: stats.games })}
          </div>
          <div className="mt-0.5 text-[11px] leading-tight text-[var(--text-muted)] whitespace-nowrap">
            {t("playerDetail.statGamesLabel")}
          </div>
        </div>
        <div className="min-w-0 border-l border-black/5 dark:border-white/10">
          <div className="text-sm font-bold text-[var(--text-primary)] whitespace-nowrap">
            {stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0}%
          </div>
          <div className="mt-0.5 text-[11px] leading-tight text-[var(--text-muted)] whitespace-nowrap">
            {t("playerDetail.statWinRateLabel")}
          </div>
        </div>
        <div className="min-w-0 border-l border-black/5 dark:border-white/10">
          <div className="text-sm font-bold text-[var(--text-primary)] whitespace-nowrap">
            {t("playerDetail.statCountValue", { count: stats.mvps })}
          </div>
          <div className="mt-0.5 text-[11px] leading-tight text-[var(--text-muted)] whitespace-nowrap">
            {t("playerDetail.statMvpLabel")}
          </div>
        </div>
        <div className="min-w-0 border-l border-black/5 dark:border-white/10">
          <div className="text-sm font-bold text-[var(--text-primary)] whitespace-nowrap">
            {t("playerDetail.statCountValue", { count: stats.svps ?? 0 })}
          </div>
          <div className="mt-0.5 text-[11px] leading-tight text-[var(--text-muted)] whitespace-nowrap">
            {t("playerDetail.statSvpLabel")}
          </div>
        </div>
      </div>

      {/* 陣營分開看：同一個人在好人與狼人時的勝率常常差很多，只給總勝率看不出來 */}
      <div className="mt-2 flex items-center justify-center gap-3 border-t border-black/5 pt-1.5 text-[11px] leading-tight text-[var(--text-muted)] dark:border-white/10">
        {camps.map((camp) => (
          <span key={camp.key} className="whitespace-nowrap">
            {camp.games > 0
              ? t("playerDetail.campWinRate", {
                  camp: t(camp.key === "campVillage" ? "alignments.good" : "alignments.wolf"),
                  rate: winRateText(camp.games, camp.wins),
                  games: camp.games,
                })
              : t("playerDetail.campWinRateEmpty", {
                  camp: t(camp.key === "campVillage" ? "alignments.good" : "alignments.wolf"),
                })}
          </span>
        ))}
      </div>
    </div>
  );
}
