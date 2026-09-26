import type { LLMMessage } from "@/lib/llm";
import { getI18n } from "@/i18n/translator";

/**
 * 「AI 輸出語言」規則（單一真相）。
 *
 * 起因：AI 玩家的發言、投票理由、警長競選、狼隊計畫、角色設定與賽後總結，過去**沒有任何
 * 語言指示**——只有「AI 幫我擬台詞」那條提示詞自己寫了一句。結果同一個模型一下繁體一下簡體
 * （中文模型多半預設簡體），同一桌的玩家字體就會混。
 *
 * 這條規則有**兩個**套用點，兩者都冪等（已含規則就不再重複加）：
 * 1. 訊息組裝層（`prompt-utils` 的 `buildSystemTextFromParts`／`buildCachedSystemMessageFromParts`）：
 *    階段類提示詞在這裡成形，AI 日誌記的與實際送出的才會是同一份——稽核測試
 *    「每條 AI 日誌都可回溯到真實傳輸訊息」正是靠這一點。
 * 2. LLM 傳送層（`llm.ts`）的保險：角色生成、賽後總結這類不走上面兩個函式的路徑也涵蓋得到。
 */

/** 目前語系的輸出語言規則文字。 */
export function outputLanguageRule(): string {
  const { t } = getI18n();
  return t("promptUtils.outputLanguageRule");
}

/** 這段文字是否已經含語言規則（冪等判斷用）。 */
export function hasOutputLanguageRule(text: string): boolean {
  const rule = outputLanguageRule();
  return Boolean(rule) && text.includes(rule);
}

/** 把語言規則接到系統訊息的最後；已含規則則原樣回傳。 */
export function withOutputLanguageRule(messages: LLMMessage[]): LLMMessage[] {
  const rule = outputLanguageRule();
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex === -1) {
    return [{ role: "system", content: rule }, ...messages];
  }
  return messages.map((message, index) => {
    if (index !== systemIndex) return message;
    if (typeof message.content === "string") {
      if (hasOutputLanguageRule(message.content)) return message;
      return { ...message, content: `${message.content}\n\n${rule}` };
    }
    const parts = message.content;
    const already = parts.some((part) => part.type === "text" && hasOutputLanguageRule(part.text));
    if (already) return message;
    // 追加一個不帶 `cache_control` 的零件：既有快取斷點不會被搬動。
    return { ...message, content: [...parts, { type: "text" as const, text: rule }] };
  });
}

/** 純文字版本（給組裝層用）：已含規則則原樣回傳。 */
export function withOutputLanguageRuleText(systemText: string): string {
  if (hasOutputLanguageRule(systemText)) return systemText;
  const rule = outputLanguageRule();
  return systemText.trim() ? `${systemText.trim()}\n\n${rule}` : rule;
}
