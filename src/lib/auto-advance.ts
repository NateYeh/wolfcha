/**
 * 自動播放對話（設定 → 音訊 → 自動播放對話）的去重簽章。
 *
 * 自動推進的 effect 會在多個依賴變動時重跑（`gameState`、`isWaitingForAI`…），
 * 所以需要一組簽章避免同一段台詞重複排 timer。
 *
 * 簽章一定要帶 **日 + 階段**：主持人每天都會講同一句話（「天亮了」「天黑請閉眼」…），
 * 只比對講者與文字的話，第二天同一句話會被當成「已經排過」而**不再自動推进**，
 * 遊戲就停在那裡等玩家按 Enter——這正是「自動播放對話失效」的成因。
 */
export interface AutoAdvanceDialogue {
  speaker: string;
  text: string;
  isStreaming: boolean;
}

/**
 * 產生自動推進用的簽章。
 *
 * - 同一日、同一階段、同一段台詞 → 相同簽章（不重複排 timer）
 * - 換日或換階段 → 不同簽章（即使台詞一字不差也要重新自動推進）
 */
export function getAutoAdvanceSignature(
  dialogue: AutoAdvanceDialogue,
  completedText: string | null,
  day: number,
  phase: string
): string {
  const prefix = dialogue.isStreaming ? "DIALOGUE_DONE" : "DIALOGUE";
  const body = dialogue.isStreaming ? `${dialogue.speaker}::${completedText ?? ""}` : `${dialogue.speaker}::${dialogue.text}`;
  return `${prefix}::${day}::${phase}::${body}`;
}

/** 等待下一輪（沒有台詞時）的自動推進簽章 */
export function getAutoAdvanceRoundSignature(phase: string, day: number, currentSpeakerSeat: number | null): string {
  return `NEXT::${day}::${phase}::${String(currentSpeakerSeat ?? "")}`;
}
