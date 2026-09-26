import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import { hasOutputLanguageRule, withOutputLanguageRule } from "@/lib/prompt-language";
import type { LLMMessage } from "@/lib/llm";

// llm.ts 會經過 auth-headers → supabase，所以環境變數要在**動態 import 之前**補上
// （靜態 import 會在模組主體之前求值，補不上）。
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "llm-output-language-key";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "llm-output-language-key";



/**
 * 「AI 輸出語言」的守門測試。
 *
 * 使用者回報：AI 角色有時繁體、有時簡體。查證後的原因是**只有「AI 幫我擬台詞」那條提示詞
 * 有寫語言規定**，AI 玩家自己的發言／投票／競選／狼隊計畫／角色設定／賽後總結全都沒有——
 * 模型各憑習慣（中文模型多半預設簡體），同一桌就會混。
 *
 * 修法是在 `llm.ts` 這一層統一接規則（每個 AI 呼叫都會經過），所以這裡守兩件事：
 * ①規則真的接進系統訊息（字串與 content parts 兩種形態、沒有系統訊息時也要生一個）；
 * ②`llm.ts` 不能再出現「直接把 messages 原封不動送出去」的地方。
 */

const llmSource = fs.readFileSync(path.join(process.cwd(), "src/lib/llm.ts"), "utf8");

test("系統訊息是字串時：語言規則接在最後（不改動既有內容）", () => {
  setLocale("zh-TW");
  const messages: LLMMessage[] = [
    { role: "system", content: "你是主持人。" },
    { role: "user", content: "開始。" },
  ];
  const result = withOutputLanguageRule(messages);
  assert.equal(result.length, 2);
  const system = result[0];
  assert.equal(typeof system.content, "string");
  assert.ok((system.content as string).startsWith("你是主持人。"));
  assert.match(system.content as string, /繁體中文/);
  assert.equal(result[1], messages[1], "非系統訊息不應被改動");
});

test("沒有系統訊息時：補一個系統訊息，且排在第一位", () => {
  setLocale("en");
  const result = withOutputLanguageRule([{ role: "user", content: "hi" }]);
  assert.equal(result.length, 2);
  assert.equal(result[0].role, "system");
  assert.match(String(result[0].content), /English/);
  assert.equal(result[1].role, "user");
});

test("系統訊息是 content parts 時：多推一個文字零件，且不動既有快取斷點", () => {
  setLocale("zh-CN");
  const cacheControl = { type: "ephemeral" as const, ttl: "1h" as const };
  const result = withOutputLanguageRule([
    { role: "system", content: [{ type: "text", text: "公開知識", cache_control: cacheControl }] },
    { role: "user", content: "開始。" },
  ]);
  const parts = result[0].content;
  assert.ok(Array.isArray(parts));
  assert.equal(parts.length, 2, "應追加一個零件");
  assert.deepEqual(parts[0], { type: "text", text: "公開知識", cache_control: cacheControl });
  assert.equal("cache_control" in parts[1], false, "新零件不帶 cache_control，才不會搬動既有快取邊界");
  assert.match(parts[1].type === "text" ? parts[1].text : "", /简体中文/);
});

test("三語系的規則文字都不一樣（不會漏翻）", () => {
  const seen = new Map<string, string>();
  for (const locale of ["zh-TW", "zh-CN", "en"] as const) {
    setLocale(locale);
    const [system] = withOutputLanguageRule([{ role: "user", content: "x" }]);
    seen.set(locale, String(system.content));
  }
  assert.match(seen.get("zh-TW") ?? "", /繁體中文/);
  assert.match(seen.get("zh-CN") ?? "", /简体中文/);
  assert.match(seen.get("en") ?? "", /English/);
  assert.equal(new Set(seen.values()).size, 3, "三語系不可共用同一段文字");
  setLocale("zh-CN");
});

test("傳送層（llm.ts）不得引入 i18n／React 依賴（server 測試在 Node 載入 next-intl 會爆）", () => {
  const imported = [...llmSource.matchAll(/from "(@\/i18n\/[^"]+|next-intl)"/g)].map((m) => m[1]);
  assert.deepEqual(
    imported,
    [],
    `llm.ts 不可依賴 i18n／next-intl（語言規則請接在組裝層）：${imported.join(", ")}`
  );
  assert.equal(
    /withOutputLanguageRule\(/.test(llmSource),
    false,
    "語言規則不該在傳送層套用：AI 日誌記的必須與實際送出逐字相同"
  );
});

test("組裝層：階段提示詞的 system 一定含語言規則（字串與 content parts 兩種形態）", async () => {
  setLocale("zh-TW");
  const { buildSystemTextFromParts, buildCachedSystemMessageFromParts } = await import("@/lib/prompt-utils");
  const text = buildSystemTextFromParts([{ text: "公開知識" }]);
  assert.ok(hasOutputLanguageRule(text), "字串形態的 system 必須含語言規則");
  const message = buildCachedSystemMessageFromParts([{ text: "公開知識", cacheable: true }], "fallback");
  const parts = message.content;
  assert.ok(Array.isArray(parts));
  const rulepart = parts.find((part) => part.type === "text" && hasOutputLanguageRule(part.text));
  assert.ok(rulepart, "content parts 形態的 system 必須含語言規則");
  assert.equal(
    "cache_control" in rulepart && Boolean(rulepart.cache_control),
    false,
    "語言規則的零件不可帶 cache_control，否則會搬動既有快取斷點"
  );
});

test("組裝層：角色生成（非階段路徑）也接上語言規則", () => {
  const generator = fs.readFileSync(path.join(process.cwd(), "src/lib/character-generator.ts"), "utf8");
  const uses = [...generator.matchAll(/messages: (BASE_PROMPT_MESSAGES|FULL_PROMPT_MESSAGES)/g)].length;
  assert.ok(uses >= 2, "角色生成的基本檔案與 persona 兩條路徑都要用接過規則的 messages");
  assert.match(generator, /withOutputLanguageRule\(\[{ role: "user", content: basePrompt }\]\)/);
  assert.match(generator, /withOutputLanguageRule\(\[{ role: "user", content: fullPrompt }\]\)/);
});
