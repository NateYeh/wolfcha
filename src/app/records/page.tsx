"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, ClockCounterClockwise, Crown, Skull, Users } from "@phosphor-icons/react";
import { ROLE_NAMES } from "@/components/analysis/constants";
import { useGameRecords } from "@/hooks/useGameRecords";
import { useAppLocale } from "@/i18n/useAppLocale";
import type { GameRecordMeta } from "@/lib/game-records";

/**
 * 遊玩紀錄清單：只列已完賽的局（完賽且賽後分析完成才會寫入，見 `docs/game-records-plan.md`）。
 *
 * 點進去看整局對話、夜晚行動與每個角色身分——詳情頁直接複用賽後分析頁面。
 */
export default function RecordsPage() {
  const t = useTranslations();
  const router = useRouter();
  const { locale } = useAppLocale();
  const { data, isLoading, error, reload } = useGameRecords();

  const formatTime = (timestamp: number): string =>
    new Date(timestamp).toLocaleString(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const renderCard = (record: GameRecordMeta) => {
    const wolfWin = record.result === "wolf_win";
    return (
      <Link
        key={record.id}
        href={`/records/${record.id}`}
        className="block rounded-xl border border-[var(--color-gold)]/20 bg-[var(--bg-card)] p-4 hover:border-[var(--color-gold)]/50 hover:bg-[var(--bg-hover)] transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${
              wolfWin
                ? "bg-[var(--color-wolf-bg)] text-[var(--color-gold)] border-[var(--color-gold)]/40"
                : "bg-[var(--color-gold)]/10 text-[var(--color-gold)] border-[var(--color-gold)]/40"
            }`}
          >
            {wolfWin ? t("records.wolfWin") : t("records.villageWin")}
          </span>
          <span className="text-[11px] text-[var(--text-muted)] tabular-nums">{formatTime(record.savedAt)}</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1.5">
            <Users size={14} />
            {t("records.players", { count: record.playerCount })}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ClockCounterClockwise size={14} />
            {t("records.days", { count: record.dayCount })}
            {" · "}
            {t("records.durationMinutes", { count: Math.max(1, Math.round(record.durationSeconds / 60)) })}
          </span>
          {record.humanRole && (
            <span className="inline-flex items-center gap-1.5">
              {record.humanSurvived === false ? <Skull size={14} /> : <Crown size={14} />}
              {t("records.myRole")}：{ROLE_NAMES[record.humanRole]}
              {" · "}
              {record.humanSurvived === false ? t("records.died") : t("records.survived")}
            </span>
          )}
        </div>

        {record.mvpNames.length > 0 && (
          <div className="mt-2 text-[11px] text-[var(--color-gold)]/80">
            {t("records.mvp")}：{record.mvpNames.join("、")}
          </div>
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg-main)]" data-theme="dark">
      <header className="sticky top-0 z-50 flex items-center gap-3 border-b border-[var(--border-color)] bg-[var(--bg-main)]/90 px-5 py-4 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <ArrowLeft size={14} />
          {t("records.back")}
        </button>
        <div>
          <h1 className="font-bold text-lg text-[var(--color-gold)] tracking-wide">{t("records.title")}</h1>
          <p className="text-[11px] text-[var(--text-muted)]">{t("records.subtitle")}</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-3">
        {isLoading && (
          <p className="py-16 text-center text-sm text-[var(--text-secondary)]">{t("records.loading")}</p>
        )}

        {!isLoading && error && (
          <div className="py-16 text-center">
            <p className="mb-4 text-sm text-red-400">
              {t("records.error")}
              <span className="ml-2 text-[11px] text-[var(--text-muted)]">{error}</span>
            </p>
            <button
              type="button"
              onClick={reload}
              className="rounded-lg bg-[var(--color-gold)] px-5 py-2 text-sm font-bold text-black hover:bg-[var(--color-gold)]/90 transition-colors"
            >
              {t("records.retry")}
            </button>
          </div>
        )}

        {!isLoading && !error && (data?.length ?? 0) === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm text-[var(--text-secondary)]">{t("records.empty")}</p>
            <p className="mx-auto mt-2 max-w-sm text-[11px] text-[var(--text-muted)]">{t("records.emptyHint")}</p>
          </div>
        )}

        {!isLoading && !error && (data ?? []).map(renderCard)}
      </main>
    </div>
  );
}
