import { LLMJSONParser } from "ai-json-fixer";

const llmJsonParser = new LLMJSONParser();

const REASONING_TAG_NAMES = ["think", "thinking", "analysis", "reasoning", "thought"];
const REASONING_TAG_PATTERN = REASONING_TAG_NAMES.join("|");

function stripMarkdownCodeFences(text: string): string {
  let cleaned = text.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\s*/m, "");
    cleaned = cleaned.replace(/\s*```\s*$/m, "");
  }

  return cleaned.trim();
}

function stripReasoningArtifacts(text: string): string {
  if (!text) return text;

  return text
    .replace(
      new RegExp(
        `<\\s*(${REASONING_TAG_PATTERN})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>\\s*`,
        "gi"
      ),
      ""
    )
    .replace(new RegExp(`<\\s*\\/?\\s*(${REASONING_TAG_PATTERN})\\b[^>]*>`, "gi"), "")
    .trim();
}

function sanitizeLLMJsonText(raw: string): string {
  return stripReasoningArtifacts(stripMarkdownCodeFences(String(raw ?? ""))).trim();
}

function extractFirstJsonCandidate(text: string): string | null {
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const start =
    objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
  if (start === -1) return null;

  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  const end = text.lastIndexOf(closing);
  if (end <= start) return null;
  return text.slice(start, end + 1).trim();
}

function normalizeLooseJson(text: string): string {
  return text.replace(/,\s*([}\]])/g, "$1").trim();
}

/** 計算未被反斜線跳脫的 ASCII 雙引號數量。 */
function countUnescapedQuotes(line: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== '"') continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === "\\"; j -= 1) backslashes += 1;
    if (backslashes % 2 === 0) count += 1;
  }
  return count;
}

/**
 * 修復模型常見的 JSON 瑕疵：字串漏掉結尾的 ASCII 雙引號。
 *
 * 模型被中文引號（“”「」）誤導，常以為字串已經收尾，例如：
 *   "偶尔重复“我真的不是”      ← 少了結尾的 "
 *         ],
 * 這種殘缺會讓整個 JSON 解析失敗，使整批內容作廢。
 *
 * 逐行檢查：該行以 " 開頭且未跳脫的雙引號為奇數（字串沒收尾），
 * 下一行又以 ] } 或另一個字串開頭時，補上缺少的引號（必要時再加逗號）。
 * 沒有把握修的行一律不動，只作為原有解析失敗後的備援候選。
 */
function repairUnterminatedJsonStrings(text: string): string {
  const lines = text.split("\n");
  let repaired = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('"') || countUnescapedQuotes(trimmed) % 2 === 0) continue;

    const nextLine = lines.slice(i + 1).find((line) => line.trim().length > 0)?.trim();
    if (!nextLine) continue;

    if (nextLine.startsWith("]") || nextLine.startsWith("}")) {
      lines[i] = `${lines[i]}"`;
      repaired += 1;
    } else if (nextLine.startsWith('"')) {
      lines[i] = `${lines[i]}",`;
      repaired += 1;
    }
  }

  return repaired === 0 ? text : lines.join("\n");
}

export function parseLLMJson<T>(raw: string): T | null {
  const cleaned = sanitizeLLMJsonText(raw);
  const extracted = extractFirstJsonCandidate(cleaned);
  const repaired = repairUnterminatedJsonStrings(cleaned);
  const candidates = Array.from(
    new Set([cleaned, repaired, extracted].filter((v): v is string => !!v)),
  );

  for (const candidate of candidates) {
    const variants = Array.from(new Set([candidate, normalizeLooseJson(candidate)]));
    for (const variant of variants) {
      const parsed = llmJsonParser.parse<T | string>(variant, {
        mode: "aggressive",
        stripMarkdown: true,
        trimTrailing: true,
        fixQuotes: true,
        addMissingCommas: true,
        completeStructure: true,
      });

      if (parsed == null) continue;
      if (typeof parsed === "string") {
        try {
          return JSON.parse(parsed) as T;
        } catch {
          continue;
        }
      }
      return parsed;
    }
  }

  return null;
}
