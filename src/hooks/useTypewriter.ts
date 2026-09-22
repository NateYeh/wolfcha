"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const CHUNK_SIZE = 3; // characters per tick (faster for both Chinese and English)
const SPEED_MULTIPLIER = 0.7; // ~1.43x faster overall

/** 一個 chunk 要停多久（依 chunk 結尾標點調整，維持原本的節奏感） */
function chunkDelayMs(text: string, index: number, speed: number, advance: number): number {
  let delay = speed * advance * SPEED_MULTIPLIER;
  const lastChar = text[index - 1];
  if (lastChar === "。" || lastChar === ".") delay *= 1.8;
  else if (lastChar === "，" || lastChar === ",") delay *= 1.2;
  else if (lastChar === "！" || lastChar === "!" || lastChar === "？" || lastChar === "?") delay *= 1.3;
  else if (lastChar === " ") delay *= 0.9;
  return Math.round(delay);
}

export interface TypewriterCatchUp {
  /** 推進後應該顯示的字數 */
  index: number;
  /** 下一個 chunk 的預定時間 */
  dueAt: number;
  /** 是否已顯示完整段文字 */
  done: boolean;
}

/**
 * 依「預定時間表」把打字動畫推進到 `now` 為止應該顯示的字數。
 *
 * 為什麼要有 catch-up：發言流程會等打字動畫跑完（`completedText` → `markCurrentSegmentCompleted`
 * → 語句佇列才前進）。而瀏覽器對**背景分頁**的 setTimeout 有節流（最小 1 秒，長時間隱藏後
 * 更久），若一次 timer 只推進一個 chunk，動畫會慢到像當掉，整個遊戲就跟著停住。
 * 這裡改成「每次觸發都把落後的進度補上」：節流只影響畫面更新頻率，不再拖慢流程。
 */
export function computeTypewriterCatchUp(
  text: string,
  index: number,
  dueAt: number,
  now: number,
  speed: number = 30
): TypewriterCatchUp {
  let nextIndex = index;
  let nextDueAt = dueAt;
  while (nextIndex < text.length && nextDueAt <= now) {
    const advance = Math.min(CHUNK_SIZE, text.length - nextIndex);
    nextIndex += advance;
    nextDueAt += chunkDelayMs(text, nextIndex, speed, advance);
  }
  return { index: nextIndex, dueAt: nextDueAt, done: nextIndex >= text.length };
}

interface UseTypewriterOptions {
  text: string;
  speed?: number; // ms per character (used to compute delay per chunk)
  enabled?: boolean;
  onComplete?: () => void;
}

export function useTypewriter({
  text,
  speed = 30,
  enabled = true,
  onComplete,
}: UseTypewriterOptions) {
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [completedText, setCompletedText] = useState<string | null>(null);
  const indexRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const reset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    indexRef.current = 0;
    setDisplayedText("");
    setIsTyping(false);
  }, []);

  useEffect(() => {
    if (!enabled || !text) {
      const next = text || "";
      queueMicrotask(() => {
        setDisplayedText(next);
        setIsTyping(false);
        setCompletedText(next);
      });
      return;
    }

    // 分頁在背景時直接跳過動畫：沒人看，而且節流會讓動畫慢到像當掉（流程就卡住）
    if (typeof document !== "undefined" && document.hidden) {
      indexRef.current = text.length;
      queueMicrotask(() => {
        setDisplayedText(text);
        setIsTyping(false);
        setCompletedText(text);
        onComplete?.();
      });
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    indexRef.current = 0;
    queueMicrotask(() => {
      setDisplayedText("");
      setIsTyping(true);
      setCompletedText(null);
    });

    // 第一個 chunk 的等待時間（與原本節奏一致），之後以「預定時間表」為準
    let dueAt = Date.now() + Math.round(speed * SPEED_MULTIPLIER);

    const typeNextChunk = () => {
      const catchUp = computeTypewriterCatchUp(text, indexRef.current, dueAt, Date.now(), speed);
      indexRef.current = catchUp.index;
      dueAt = catchUp.dueAt;
      setDisplayedText(text.slice(0, catchUp.index));

      if (catchUp.done) {
        setIsTyping(false);
        setCompletedText(text);
        onComplete?.();
        return;
      }
      timeoutRef.current = setTimeout(typeNextChunk, Math.max(16, dueAt - Date.now()));
    };

    timeoutRef.current = setTimeout(typeNextChunk, Math.max(16, dueAt - Date.now()));

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [text, speed, enabled, onComplete]);

  return { displayedText, isTyping, completedText, reset };
}
