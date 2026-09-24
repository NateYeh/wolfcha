"use client";

/**
 * 「AI 幫我擬台詞」的 React 包裝。
 *
 * 真正的提示詞與清稿規則在 `@/lib/speech-draft`（純函式、可單獨測）；
 * 這裡只負責載入狀態、把草稿接進輸入框，以及失敗時讓使用者知道發生什麼事
 * （禁止靜默失敗：console 留完整上下文，畫面用 toast 說明）。
 */

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { applySpeechDraft, generateSpeechDraft } from "@/lib/speech-draft";
import type { GameState, Player } from "@/types/game";

export interface UseSpeechDrafterOptions {
  state: GameState;
  player: Player | null | undefined;
  setInputText: (updater: (prev: string) => string) => void;
}

export function useSpeechDrafter({ state, player, setInputText }: UseSpeechDrafterOptions) {
  const t = useTranslations();
  const [isDrafting, setIsDrafting] = useState(false);
  // 上一張草稿：玩家沒改就直接換掉（等於「換一個」），改過就接在後面。
  const lastDraftRef = useRef("");

  const draftSpeech = useCallback(async () => {
    if (!player || isDrafting) return;
    setIsDrafting(true);
    try {
      const draft = await generateSpeechDraft(state, player);
      // 先把「上一張草稿」取到區域變數：setInputText 的 updater 是延後執行的，
      // 而下面那行會直接改掉 ref，updater 真的跑起來時就只會看到新草稿（永遠接續而不取代）。
      const previousDraft = lastDraftRef.current;
      setInputText((prev) => applySpeechDraft(prev, draft, previousDraft));
      lastDraftRef.current = draft;
    } catch (error) {
      console.error("[wolfcha] AI 擬台詞失敗", {
        phase: state.phase,
        day: state.day,
        seat: player.seat,
        role: player.role,
        error,
      });
      toast.error(t("dialog.input.aiDraftError"), {
        description:
          error instanceof Error && error.message.trim()
            ? error.message
            : t("dialog.input.aiDraftErrorHint"),
      });
    } finally {
      setIsDrafting(false);
    }
  }, [state, player, isDrafting, setInputText, t]);

  return { draftSpeech, isDrafting };
}
