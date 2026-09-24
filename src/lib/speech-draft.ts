/**
 * 真人玩家的「AI 幫我擬台詞」。
 *
 * 人類玩家在發言輪要自己打字，這件事對不熟狼人殺語境的玩家是門檻：不知道這個階段該說什麼、
 * 該不該跳身分、要不要報帳。這個模組讓 AI 用**該玩家合法知道的資訊**（身分、私有記錄、
 * 本日逐字討論）草擬一段可以直接發出去的台詞，人類再自己改。
 *
 * 設計要點：
 * - 提示詞重用遊戲既有的 prompt 架構（公開知識進 system 共用前綴、私有資訊與任務放最後），
 *   所以草稿看到的局勢與 AI 玩家完全相同，不會出現「AI 助理講出這個玩家不該知道的事」。
 * - 輸出是**純文字台詞**，不是遊戲內部用的 JSON 氣泡格式：這是給人看、給人改的，
 *   格式限制只會讓模型把 JSON 念出來。`sanitizeSpeechDraft` 仍然會把模型偶爾吐出的
 *   JSON／code fence／整段引號清掉。
 * - 空回覆一律拋錯，由呼叫端提示使用者（禁止靜默失敗）。
 */

import { GAME_TEMPERATURE } from "@/lib/ai-config";
import { getGeneratorModel } from "@/lib/api-keys";
import { buildMessagesForPrompt } from "@/lib/game-master";
import { generateCompletion, stripMarkdownCodeFences, stripReasoningArtifacts } from "@/lib/llm";
import {
  bindIdentityAndRoleSetting,
  buildDecisionContext,
  buildPastDaysTranscript,
  buildSharedSystemParts,
  buildSystemTextFromParts,
  getRoleText,
} from "@/lib/prompt-utils";
import type { PromptResult } from "@/game/core/types";
import type { AppLocale } from "@/i18n/config";
import { getLocale } from "@/i18n/locale-store";
import { getI18n } from "@/i18n/translator";
import type { GameState, Player } from "@/types/game";

/**
 * 長度上限要跟語言走：遊戲自己的發言規則中文是「總長 120 字以內」、
 * 英文是「around 60 words」——用同一個字元數管英文會把草稿砍成一句。
 */
export const SPEECH_DRAFT_TARGET_CHARS: Record<AppLocale, number> = {
  "zh-CN": 160,
  "zh-TW": 160,
  en: 400,
};

/** 清稿時的硬上限：模型講不聽時就在句尾截斷，不讓草稿灌爆輸入框。 */
export const SPEECH_DRAFT_MAX_CHARS: Record<AppLocale, number> = {
  "zh-CN": 200,
  "zh-TW": 200,
  en: 500,
};

export function speechDraftTargetChars(locale: AppLocale = getLocale()): number {
  return SPEECH_DRAFT_TARGET_CHARS[locale] ?? SPEECH_DRAFT_TARGET_CHARS["zh-CN"];
}

export function speechDraftMaxChars(locale: AppLocale = getLocale()): number {
  return SPEECH_DRAFT_MAX_CHARS[locale] ?? SPEECH_DRAFT_MAX_CHARS["zh-CN"];
}

/**
 * 擬台詞是短文本任務，不需要思考。實測推理模型（glm-5.3:cloud）會在 thinking 階段
 * 把 max_tokens 全用完，22 秒後回一個空字串；把 reasoning 關掉就直接出稿。
 * （與角色生成同一做法，見 character-generator 的 CHARACTER_GENERATOR_REASONING。）
 */
const SPEECH_DRAFT_REASONING = { enabled: false } as const;

/** 給模型留一點餘裕：正常輸出只有一兩百字，但推理模型仍可能先想一段。 */
const SPEECH_DRAFT_MAX_TOKENS = 1024;

/** 擬稿只適用於「輪到真人自己講話」的階段；其餘階段呼叫是程式錯誤。 */
const DRAFT_PHASES = ["DAY_SPEECH", "DAY_BADGE_SPEECH", "DAY_PK_SPEECH", "DAY_LAST_WORDS"] as const;

/**
 * 把新文字接到既有發言後面（語音聽寫、速插模板與 AI 擬稿共用同一條規則）。
 * 單一真相：以前 DialogArea 自己有一份，AI 擬稿再抄一份就會漂移。
 */
export function appendSpeechText(prev: string | undefined, text: string): string {
  const base = String(prev ?? "").trim();
  const incoming = text.trim();
  if (!incoming) return base;
  return base.length > 0 ? `${base} ${incoming}` : incoming;
}

/** 這個階段是不是「真人在發言」。 */
export function isSpeechDraftPhase(phase: GameState["phase"]): boolean {
  return (DRAFT_PHASES as readonly string[]).includes(phase);
}

/**
 * 把新草稿放進輸入框：
 * - 輸入框裡的內容跟上一張草稿一模一樣（玩家沒改）→ 取代＝「換一個」；
 * - 其他情況（玩家自己打了字、或改過草稿）→ 接在後面。
 *
 * 沒有這條規則的話，連按兩次就會得到兩張草稿串在一起。
 */
export function applySpeechDraft(
  prev: string | undefined,
  draft: string,
  lastDraft: string | undefined
): string {
  const base = String(prev ?? "").trim();
  const previous = String(lastDraft ?? "").trim();
  if (previous && base === previous) return draft.trim();
  return appendSpeechText(base, draft);
}

/**
 * 逐階段的補充說明。
 * 直接沿用遊戲既有的階段提示／任務文案，不另寫一份——否則 AI 玩家的語境與
 * 真人草稿的語境會各自漂移。
 */
function buildPhaseHint(state: GameState, player: Player, t: ReturnType<typeof getI18n>["t"]): string {
  const seatVars = { seat: player.seat + 1, name: player.displayName };
  switch (state.phase) {
    case "DAY_BADGE_SPEECH":
      return t("prompts.daySpeech.phaseHint.badge");
    case "DAY_PK_SPEECH":
      return state.pkSource === "badge"
        ? t("prompts.daySpeech.phaseHint.badgePk")
        : t("prompts.daySpeech.phaseHint.votePk");
    case "DAY_LAST_WORDS": {
      // 與 DaySpeechPhase 同一條判斷：被票出去的遺言、獵人被票出去（還有一槍）都不是同一件事。
      const wasVotedOut = state.dayHistory?.[state.day]?.executed?.seat === player.seat;
      return t(
        player.role === "Hunter" && wasVotedOut
          ? "prompts.daySpeech.task.lastWordsVotedOutHunter"
          : wasVotedOut
            ? "prompts.daySpeech.task.lastWordsVotedOut"
            : "prompts.daySpeech.task.lastWords",
        seatVars
      );
    }
    default:
      return "";
  }
}

/**
 * 組出擬稿用的 prompt。
 *
 * 結構沿用遊戲既有慣例：system＝全桌逐字相同的公開知識（快取前綴）；
 * 過往日報當獨立 user content；user＝個人身分＋私有資訊＋今日逐字討論；
 * finalUser＝本次任務（唯一逐任務不同的部分，放最後吃注意力）。
 */
export function buildSpeechDraftPrompt(state: GameState, player: Player): PromptResult {
  const { t } = getI18n();
  const systemParts = buildSharedSystemParts(state);
  const identity = bindIdentityAndRoleSetting(
    t("prompts.daySpeech.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
      coreRules: "",
    }).trim(),
    player,
    !!state.isGenshinMode
  );
  const context = buildDecisionContext(state, player);
  const phaseHint = buildPhaseHint(state, player, t);

  return {
    system: buildSystemTextFromParts(systemParts),
    systemParts,
    historyUser: buildPastDaysTranscript(state),
    user: [identity, context].filter(Boolean).join("\n\n"),
    finalUser: [phaseHint, t("prompts.speechDraft.task", {
      seat: player.seat + 1,
      name: player.displayName,
      maxChars: speechDraftTargetChars(),
    })].filter(Boolean).join("\n\n"),
  };
}

/**
 * 模型若把台詞包成 `["第一段。","第二段。"]` 或 `{"speech": [...]}`，把正文取出來。
 * 回傳 null＝不是 JSON 封裝，當一般文字往下走；回空字串＝是 JSON 封裝但裡面沒有可用台詞
 * （例如 `[]`、`{}`），這種要當成「沒內容」而不是把 JSON 原字唸給玩家。
 */
function unwrapStructuredSpeech(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const asSegments = (value: unknown): string[] | null => {
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        return value as string[];
      }
      if (
        value !== null &&
        typeof value === "object" &&
        "speech" in value &&
        Array.isArray((value as { speech?: unknown }).speech)
      ) {
        const speech = (value as { speech: unknown[] }).speech;
        if (speech.every((item) => typeof item === "string")) return speech as string[];
      }
      return null;
    };
    const segments = asSegments(parsed);
    // 合法 JSON 但取不到台詞段落：回空字串（呼叫端會當成「沒有內容」處理）。
    if (!segments) return "";
    return segments.map((segment) => segment.trim()).filter(Boolean).join("\n");
  } catch {
    // 不是合法 JSON：當成一般文字往下走（例如模型開了頭卻沒收尾）。
    return null;
  }
}

/** 去掉整段被包起來的引號（模型很常把整段台詞包成「…」或 "…"）。 */
function stripWrappingQuotes(text: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["「", "」"],
    ["『", "』"],
    ["“", "”"],
  ];
  let result = text.trim();
  for (const [open, close] of pairs) {
    if (result.startsWith(open) && result.endsWith(close) && result.length > open.length + close.length) {
      // 只在整段確實被同一對引號夾住時才拆：句子中間的正常引號不動。
      const inner = result.slice(open.length, result.length - close.length);
      if (!inner.includes(open) && !inner.includes(close)) {
        result = inner.trim();
      }
    }
  }
  return result;
}

/** 依句尾標點截斷到上限內，避免草稿斷在半句話中間。 */
function truncateAtSentence(text: string, maxChars: number): string {
  const clipped = text.slice(0, maxChars);
  const lastStop = Math.max(
    clipped.lastIndexOf("。"),
    clipped.lastIndexOf("！"),
    clipped.lastIndexOf("？"),
    clipped.lastIndexOf("."),
    clipped.lastIndexOf("!"),
    clipped.lastIndexOf("?"),
    clipped.lastIndexOf("\n")
  );
  // 找不到句尾就直接截，並留一個省略號說明「被截掉了」，不假裝是完整的句子。
  return lastStop > maxChars * 0.5 ? clipped.slice(0, lastStop + 1).trim() : `${clipped.trim()}…`;
}

/**
 * 把模型回覆清成「可以直接貼進輸入框的台詞」。
 * 清不出東西就回空字串，由呼叫端決定怎麼提示（不假裝成功）。
 */
export function sanitizeSpeechDraft(raw: string, options: { maxChars?: number } = {}): string {
  const maxChars = options.maxChars ?? speechDraftMaxChars();
  let text = stripMarkdownCodeFences(stripReasoningArtifacts(String(raw ?? "")));
  const unwrapped = unwrapStructuredSpeech(text);
  if (unwrapped !== null) text = unwrapped;

  text = text
    // 「台词：」「发言：」「Speech:」這類標籤
    .replace(/^\s*(?:台词|台詞|发言|發言|台詞正文|草稿|Speech|Line)\s*[:：]\s*/i, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "");

  text = stripWrappingQuotes(text.trim());
  if (text.length > maxChars) {
    text = truncateAtSentence(text, maxChars);
  }
  return text.trim();
}

export interface SpeechDraftOptions {
  signal?: AbortSignal;
}

/**
 * 產生一段草稿台詞。輸出保證非空，空回覆會拋錯（禁止靜默失敗）。
 */
export async function generateSpeechDraft(
  state: GameState,
  player: Player,
  options: SpeechDraftOptions = {}
): Promise<string> {
  if (!isSpeechDraftPhase(state.phase)) {
    throw new Error(`[wolfcha] AI 擬台詞只能在發言階段使用，目前階段是 ${state.phase}`);
  }

  const { t } = getI18n();
  const model = getGeneratorModel();
  const prompt = buildSpeechDraftPrompt(state, player);
  const { messages } = buildMessagesForPrompt(prompt);

  const result = await generateCompletion({
    model,
    messages,
    temperature: GAME_TEMPERATURE.SPEECH,
    max_tokens: SPEECH_DRAFT_MAX_TOKENS,
    reasoning: SPEECH_DRAFT_REASONING,
    signal: options.signal,
  });

  const draft = sanitizeSpeechDraft(result.content);
  if (!draft) {
    throw new Error(t("prompts.speechDraft.emptyResponse"));
  }
  return draft;
}
