import assert from "node:assert/strict";
import test from "node:test";
import en from "@/i18n/messages/en.json";
import zhCN from "@/i18n/messages/zh-CN.json";
import zhTW from "@/i18n/messages/zh-TW.json";

/**
 * 三語系檔案一致性守門。
 *
 * 這三個檔案是提示詞與 UI 的文案來源：任一個漏 key、少佔位符或留空字串，
 * 執行期就會變成缺字或壞掉的模板，而這類缺陷型別檢查抓不到。
 * 產線約定：zh-CN 是唯一手寫源頭；zh-TW 是 zh-CN 用 OpenCC 轉換後重生成的產物，
 * 永不手改（唯一例外是 locale.zhCN 標籤要在生成後改回「简体中文」）。
 */

/** 攤平成「a.b.0」形式的點號路徑；陣列依索引展開，物件遞迴。 */
const flatten = (node: unknown, prefix = ""): Record<string, string> => {
  const out: Record<string, string> = {};
  if (Array.isArray(node)) {
    node.forEach((item, index) => Object.assign(out, flatten(item, `${prefix}.${index}`)));
    return out;
  }
  if (typeof node === "object" && node !== null) {
    Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
      Object.assign(out, flatten(value, prefix ? `${prefix}.${key}` : key));
    });
    return out;
  }
  out[prefix] = String(node);
  return out;
};

const LOCALES: Record<string, Record<string, string>> = {
  "zh-CN": flatten(zhCN),
  "zh-TW": flatten(zhTW),
  en: flatten(en),
};

/** 抽出模板佔位符（例：{seat}）後排序，用於跨語系比對。 */
const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

/** 只列出前幾筆差異，避免整份清單灌進測試輸出。 */
const preview = (items: string[]): string => items.slice(0, 10).join("、");

test("三語系 key 集合必須完全一致", () => {
  const reference = LOCALES["zh-CN"];
  Object.entries(LOCALES).forEach(([name, keys]) => {
    const missing = Object.keys(reference).filter((key) => !(key in keys));
    const extra = Object.keys(keys).filter((key) => !(key in reference));
    assert.equal(
      missing.length,
      0,
      `${name} 缺少 zh-CN 有的 key（共 ${missing.length} 個）：${preview(missing)}`
    );
    assert.equal(
      extra.length,
      0,
      `${name} 多了 zh-CN 沒有的 key（共 ${extra.length} 個）：${preview(extra)}`
    );
  });
});

test("同一 key 的三語佔位符必須一致（少一個 {x} 模板就壞了）", () => {
  const mismatched: string[] = [];
  Object.keys(LOCALES["zh-CN"]).forEach((key) => {
    const perLocale = Object.entries(LOCALES).map(
      ([name, map]) => `${name}=[${placeholders(map[key] ?? "").join(",")}]`
    );
    const distinct = new Set(
      Object.values(LOCALES).map((map) => placeholders(map[key] ?? "").join(","))
    );
    if (distinct.size > 1) mismatched.push(`${key} → ${perLocale.join(" ")}`);
  });
  assert.equal(
    mismatched.length,
    0,
    `以下 key 的佔位符跨語系不一致（共 ${mismatched.length} 個）：${preview(mismatched)}`
  );
});

test("不得有空字串值（會在提示詞與畫面留下斷口）", () => {
  const empties = Object.entries(LOCALES).flatMap(([name, map]) =>
    Object.entries(map)
      .filter(([, value]) => value.trim() === "")
      .map(([key]) => `${name}:${key}`)
  );
  assert.equal(
    empties.length,
    0,
    `空字串 key（共 ${empties.length} 個）：${preview(empties)}`
  );
});

test("zh-TW 必須是 zh-CN 的轉換產物，且 locale.zhCN 標籤保持简体中文", () => {
  assert.notDeepEqual(
    LOCALES["zh-TW"],
    LOCALES["zh-CN"],
    "zh-TW 與 zh-CN 完全相同＝zh-TW 未重新生成（zh-TW 是產物，不可手改）"
  );
  assert.equal(
    LOCALES["zh-TW"]["locale.zhCN"],
    "简体中文",
    "zh-TW 重生成後須把「簡體中文」改回「简体中文」（自行標示語系的慣例）"
  );
});
