"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCharacterPoolStatus,
  isCharacterPoolRefillInFlight,
  refillCharacterPoolOnce,
  resetCharacterPoolScenario,
  type CharacterPoolStatus,
} from "@/lib/character-pool-refill";

/** 背景補池的間隔；只在歡迎畫面閒置時運作。 */
const REFILL_TICK_MS = 20000;

export interface UseCharacterPoolResult {
  status: CharacterPoolStatus;
  /** 上一次補充失敗的訊息（成功後清空）。 */
  error: string | null;
  /** 立即補一批（一局份）；已達標或正在補充時不會重複生成。 */
  refillNow: () => Promise<void>;
  /** 換一個情境重建整池。 */
  rebuild: () => void;
}

/**
 * 角色池的背景維護：
 * - 掛載後（歡迎畫面）自動把池補到「三局份」，一次補一局份，不阻塞開局；
 * - 離開歡迎畫面就停止，避免與遊戲中的 AI 呼叫搶資源。
 */
export function useCharacterPool(charactersPerGame: number, enabled: boolean): UseCharacterPoolResult {
  const [status, setStatus] = useState<CharacterPoolStatus>(() =>
    getCharacterPoolStatus(charactersPerGame),
  );
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const refresh = useCallback(() => {
    setStatus(getCharacterPoolStatus(charactersPerGame));
  }, [charactersPerGame]);

  const refillNow = useCallback(async () => {
    if (runningRef.current || isCharacterPoolRefillInFlight()) {
      refresh();
      return;
    }
    runningRef.current = true;
    refresh();
    try {
      const result = await refillCharacterPoolOnce(charactersPerGame);
      setError(result === "failed" ? "refillFailed" : null);
    } catch (refillError) {
      // refillCharacterPoolOnce 內部已捕捉生成錯誤，這裡只防非預期例外。
      console.warn("[character-pool] 補充角色池時發生非預期錯誤：", refillError);
      setError(String(refillError));
    } finally {
      runningRef.current = false;
      refresh();
    }
  }, [charactersPerGame, refresh]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || isCharacterPoolRefillInFlight()) return;
      const current = getCharacterPoolStatus(charactersPerGame);
      if (current.unused >= current.target) {
        refresh();
        return;
      }
      await refillNow();
    };

    void tick();
    const timer = setInterval(() => void tick(), REFILL_TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, charactersPerGame, refillNow, refresh]);

  const rebuild = useCallback(() => {
    resetCharacterPoolScenario();
    setError(null);
    refresh();
  }, [refresh]);

  return { status, error, refillNow, rebuild };
}
