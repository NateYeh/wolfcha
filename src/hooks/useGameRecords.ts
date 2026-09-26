"use client";

import { useCallback, useEffect, useState } from "react";
import type { GameRecord, GameRecordMeta } from "@/lib/game-records";
import { getAuthHeaders } from "@/lib/auth-headers";
import { withTimeout } from "@/lib/request-timeout";

/** 遊玩紀錄的讀取（清單與單局）；身分沿用 `getAuthHeaders()`（帳號 token 或 guest id）。 */

const LOAD_TIMEOUT_MS = 15_000;

interface RecordsState<T> {
  data: T | null;
  isLoading: boolean;
  error: string;
}

export function useGameRecords() {
  const [state, setState] = useState<RecordsState<GameRecordMeta[]>>({
    data: null,
    isLoading: true,
    error: "",
  });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setState({ data: null, isLoading: true, error: "" });
      try {
        const headers = await getAuthHeaders();
        const response = await withTimeout(
          fetch("/api/game-records", { headers }),
          LOAD_TIMEOUT_MS,
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const payload = await response.json() as { records?: GameRecordMeta[] };
        if (cancelled) return;
        setState({ data: payload.records ?? [], isLoading: false, error: "" });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "unknown";
        console.error("[game-records] 讀取清單失敗:", error);
        setState({ data: null, isLoading: false, error: message });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { ...state, reload };
}

export function useGameRecord(recordId: string) {
  const [state, setState] = useState<RecordsState<GameRecord>>({
    data: null,
    isLoading: true,
    error: "",
  });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!recordId) {
      setState({ data: null, isLoading: false, error: "missing_id" });
      return;
    }

    let cancelled = false;

    const load = async () => {
      setState({ data: null, isLoading: true, error: "" });
      try {
        const headers = await getAuthHeaders();
        const response = await withTimeout(
          fetch(`/api/game-records/${encodeURIComponent(recordId)}`, { headers }),
          LOAD_TIMEOUT_MS,
        );
        if (response.status === 404) throw new Error("not_found");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const payload = await response.json() as { record?: GameRecord };
        if (cancelled) return;
        if (!payload.record) throw new Error("empty");
        setState({ data: payload.record, isLoading: false, error: "" });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "unknown";
        console.error(`[game-records] 讀取紀錄失敗（${recordId}）:`, error);
        setState({ data: null, isLoading: false, error: message });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [recordId, reloadToken]);

  return { ...state, reload };
}
