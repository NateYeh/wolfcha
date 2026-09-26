"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PostGameAnalysisPage } from "@/components/analysis";
import { useGameRecord } from "@/hooks/useGameRecords";

/**
 * 單局紀錄詳情：整局對話、夜晚行動、每個角色身分。
 *
 * 直接複用賽後分析頁（`PostGameAnalysisPage` 吃 prop、不綁 atom），因此不必另寫檢視器，
 * 也不會動到當前進行中的對局狀態。
 */
export default function RecordDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const recordId = typeof params?.id === "string" ? params.id : "";
  const { data, isLoading, error } = useGameRecord(recordId);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center">
        <p className="text-sm text-[var(--text-secondary)]">{t("records.loading")}</p>
      </div>
    );
  }

  if (error || !data) {
    const notFound = error === "not_found" || error === "missing_id";
    return (
      <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-sm text-[var(--text-secondary)]">
            {notFound ? t("records.notFound") : t("records.error")}
          </p>
          <button
            type="button"
            onClick={() => router.push("/records")}
            className="rounded-lg border border-[var(--color-gold)]/30 px-5 py-2 text-sm text-[var(--text-secondary)] hover:bg-white/5 transition-colors"
          >
            {t("records.back")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <PostGameAnalysisPage
      data={data.analysis}
      onReturn={() => router.push("/records")}
    />
  );
}
