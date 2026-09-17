"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCharacterPoolStatus,
  isCharacterPoolRefillInFlight,
  refillCharacterPoolOnce,
  type CharacterPoolStatus,
} from "@/lib/character-pool-refill";
import { fetchServerPool, setServerPoolScenarioRemote, setServerPoolLockRemote, clearServerPoolRemote } from "@/lib/character-pool-api";
import { CHARACTER_POOL_ROUNDS } from "@/lib/character-pool";
import type { GameScenario } from "@/types/game";

/** 背景補池的間隔；只在歡迎畫面閒置時運作。 */
const REFILL_TICK_MS = 20000;

const INITIAL_STATUS = (charactersPerGame: number): CharacterPoolStatus => ({
  unused: 0,
  total: 0,
  scenarioId: null,
  scenarioTitle: null,
  target: Math.max(1, charactersPerGame) * CHARACTER_POOL_ROUNDS,
  locked: false,
  refilling: false,
});

export interface UseCharacterPoolResult {
  status: CharacterPoolStatus;
  /** 上一次補充失敗的訊息（成功後清空）。 */
  error: string | null;
  /** 立即補一批（一局份）；已達標或正在補充時不會重複生成。 */
  refillNow: () => Promise<void>;
  /** 換一個情境重建整池（隨機抽新情境）。 */
  rebuild: () => void;
  /** 綁定指定情境並重建整池（自訂情境或內建情境）。 */
  rebuildWithScenario: (scenario: GameScenario) => void;
  /** 切換「固定班底」：開啟後不再自動生成新角色。 */
  setLocked: (locked: boolean) => void;
}

/**
 * 角色池的背景維護（伺服器共用池）：
 * - 池本體存在伺服器，所有瀏覽器共用；本 hook 負責在歡迎畫面閒置時補池；
 * - 掛載後自動把池補到「三局份」，一次補一局份，不阻塞開局；
 * - 離開歡迎畫面就停止，避免與遊戲中的 AI 呼叫搶資源。
 */
export function useCharacterPool(charactersPerGame: number, enabled: boolean): UseCharacterPoolResult {
  const [status, setStatus] = useState<CharacterPoolStatus>(() => INITIAL_STATUS(charactersPerGame));
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const refresh = useCallback(async () => {
    const pool = await fetchServerPool();
    setStatus(getCharacterPoolStatus(charactersPerGame, pool));
  }, [charactersPerGame]);

  const refillNow = useCallback(async () => {
    if (runningRef.current || isCharacterPoolRefillInFlight()) {
      void refresh();
      return;
    }
    runningRef.current = true;
    try {
      const result = await refillCharacterPoolOnce(charactersPerGame);
      setError(result === "failed" ? "refillFailed" : null);
    } catch (refillError) {
      // refillCharacterPoolOnce 內部已捕捉生成錯誤，這裡只防非預期例外。
      console.warn("[character-pool] 補充角色池時發生非預期錯誤：", refillError);
      setError(String(refillError));
    } finally {
      runningRef.current = false;
      await refresh();
    }
  }, [charactersPerGame, refresh]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || isCharacterPoolRefillInFlight()) return;
      const pool = await fetchServerPool();
      if (cancelled) return;
      const current = getCharacterPoolStatus(charactersPerGame, pool);
      setStatus({ ...current, refilling: runningRef.current });
      if (current.locked) return;
      if (current.unused >= current.target) return;
      await refillNow();
    };

    void tick();
    const timer = setInterval(() => void tick(), REFILL_TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, charactersPerGame, refillNow]);

  const rebuild = useCallback(() => {
    void (async () => {
      const ok = await clearServerPoolRemote();
      if (!ok) setError("rebindFailed");
      else setError(null);
      await refresh();
    })();
  }, [refresh]);

  /** 綁定指定情境並重建整池：先建立「綁定情境的空池」，背景補充會以該情境生成。 */
  const rebuildWithScenario = useCallback(
    (scenario: GameScenario) => {
      void (async () => {
        const ok = await setServerPoolScenarioRemote(scenario);
        if (!ok) setError("rebindFailed");
        else setError(null);
        await refresh();
      })();
    },
    [refresh],
  );

  /** 切換固定班底：寫回伺服器後同步狀態（成功才顯示為開啟）。 */
  const setLocked = useCallback(
    (locked: boolean) => {
      void (async () => {
        const ok = await setServerPoolLockRemote(locked);
        if (!ok) setError("lockFailed");
        else setError(null);
        await refresh();
      })();
    },
    [refresh],
  );

  return { status, error, refillNow, rebuild, rebuildWithScenario, setLocked };
}