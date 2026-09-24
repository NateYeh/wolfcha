process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "dev-console-phases-key";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PHASE_SEQUENCE } from "@/lib/rules/phases";

/**
 * DevConsole 階段名稱的 i18n 覆蓋守衛。
 *
 * 開發者工具的階段清單與名稱過去是**手寫**的，漏了後加的 `NIGHT_MUTE_ACTION`／
 * `NIGHT_DREAM_ACTION`／`SELF_DESTRUCT`／`KNIGHT_DUEL`，還用 `as Record<Phase, string>`
 * 把 tsc 騙過去，於是那幾個階段的下拉選單選不到、名稱顯示 undefined。
 *
 * 現在清單與名稱都由 `PHASE_SEQUENCE` 推導（與角色名稱同一個修法），
 * 所以「權威表有的階段，三語系都要有名字」就是唯一需要守的事。
 */

const LOCALES = ["zh-CN", "zh-TW", "en"] as const;

test("權威表的每個階段在三語系都有 devConsole.phases 名稱", () => {
  for (const locale of LOCALES) {
    const raw = readFileSync(`src/i18n/messages/${locale}.json`, "utf8");
    const messages = JSON.parse(raw) as { devConsole?: { phases?: Record<string, string> } };
    const phases = messages.devConsole?.phases ?? {};
    const missing = PHASE_SEQUENCE.filter((phase) => !phases[phase]?.trim());
    assert.deepEqual(missing, [], `${locale} 缺少以下階段名稱：${missing.join(", ")}`);
  }
});

test("不得有權威表以外的多餘階段名稱（避免改名後留下孤兒鍵）", () => {
  const raw = readFileSync("src/i18n/messages/zh-CN.json", "utf8");
  const messages = JSON.parse(raw) as { devConsole?: { phases?: Record<string, string> } };
  const extra = Object.keys(messages.devConsole?.phases ?? {}).filter(
    (phase) => !PHASE_SEQUENCE.includes(phase as (typeof PHASE_SEQUENCE)[number])
  );
  assert.deepEqual(extra, [], `devConsole.phases 有不在權威表的鍵：${extra.join(", ")}`);
});
