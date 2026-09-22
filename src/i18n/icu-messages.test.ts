import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTranslator } from "next-intl";

/**
 * ICU 訊息守衛測試。
 *
 * 背景：i18n 訊息若含**未轉義**的 JSON 大括號（例如輸出格式範例
 * `{"speech": [...], "skill": {...}}`），next-intl 的 ICU 解析器會把它當成
 * 參數而丟出 MALFORMED_ARGUMENT；`translated.ts` 的 t() 會吞掉錯誤並回傳 key，
 * 症狀是 AI 收到 `prompts.daySpeech.skillContract.selfDestruct` 這串 key 而不是契約
 * → 模型永遠不會輸出 skill → 靜默退回獨立請求（看不出壞掉，只是白燒一輪 context）。
 * 同理 `<one sentence>` 這種角括號會被當成 HTML tag 丟 INVALID_TAG。
 *
 * 規則：i18n 裡的字面大括號必須用單引號包成 ICU 字面量（`'{"action": "none"}'`），
 * 角括號標記請避免使用 ASCII tag 名稱。
 */

const LOCALES = ["zh-CN", "zh-TW", "en"] as const;
const MESSAGES_DIR = path.join(process.cwd(), "src/i18n/messages");

type Json = { [key: string]: string | Json };

/** 把巢狀訊息攤平成 key → 字串（不含陣列，`t.raw` 用的陣列不經 ICU） */
function flatten(node: Json, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.push([full, value]);
    else if (value && typeof value === "object") out.push(...flatten(value as Json, full));
  }
  return out;
}

function loadMessages(locale: string): Json {
  return JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8")) as Json;
}

/**
 * 任何參數都回傳「原樣串接子節點」的函式：
 * - 一般參數會被當成值塞進字串（內容不重要，重點是**不要丟錯**）
 * - rich text tag（如 <highlight>）需要 handler，這個函式剛好可以勝任
 */
const anyValue = new Proxy(
  {},
  {
    get: () => (chunks: unknown) => (Array.isArray(chunks) ? chunks.join("") : ""),
    has: () => true,
  }
);

test("所有語系的 i18n 訊息都能被 ICU 解析（不得有未轉義的大括號／角括號標記）", () => {
  const failures: string[] = [];
  for (const locale of LOCALES) {
    const messages = loadMessages(locale);
    const t = createTranslator({ locale, messages });
    for (const [key] of flatten(messages)) {
      try {
        t(key as never, anyValue as never);
      } catch (err) {
        failures.push(`${locale} ${key}: ${(err as Error).message}`);
      }
    }
  }
  assert.deepEqual(failures, [], `以下訊息無法解析：\n${failures.join("\n")}`);
});

test("ICU 轉義不得在輸出留下殘餘單引號", () => {
  for (const locale of LOCALES) {
    const messages = loadMessages(locale);
    const t = createTranslator({ locale, messages });
    for (const [key, raw] of flatten(messages)) {
      if (!raw.includes("{") && !raw.includes("}")) continue;
      const out = t(key as never, anyValue as never) as string;
      for (const residue of ["'{", "'}", "}'", "{'"]) {
        assert.equal(out.includes(residue), false, `${locale} ${key} 輸出殘留轉義符號 ${residue}：${out.slice(0, 80)}`);
      }
    }
  }
});

test("發言階段的技能契約／空守說明必須輸出真正的 JSON 範例", () => {
  const cases: Array<[string, string[]]> = [
    ["prompts.daySpeech.formatReminderWithSkill", ['{"speech": [', '{"action": "none"}']],
    ["prompts.daySpeech.skillContract.selfDestruct", ['{"speech": [', '{"action": "none"}', '{"action": "boom"']],
    ["prompts.daySpeech.skillContract.knightDuel", ['{"speech": [', '{"action": "duel"']],
    ["prompts.night.guard.abstainLine", ['{"seat":0']],
  ];
  for (const locale of LOCALES) {
    const messages = loadMessages(locale);
    const t = createTranslator({ locale, messages });
    for (const [key, expected] of cases) {
      const out = t(key as never, anyValue as never) as string;
      assert.notEqual(out, key, `${locale} ${key} 取不到訊息`);
      for (const snippet of expected) {
        assert.ok(out.includes(snippet), `${locale} ${key} 缺少 ${snippet}：${out.slice(0, 120)}`);
      }
    }
  }
});
