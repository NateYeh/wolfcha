import assert from "node:assert/strict";
import test from "node:test";
import en from "@/i18n/messages/en.json";
import zhCN from "@/i18n/messages/zh-CN.json";
import zhTW from "@/i18n/messages/zh-TW.json";
import { ALL_ROLE_KEYS } from "@/lib/rules/boards";

/**
 * 角色教學卡（`tutorialOverlay.roles.<Role>`）的守門測試。
 *
 * 這一條是被實機測試逼出來的：魔術師的角色層做完、`tsc` 全綠、單元測試全過，
 * 一開局點掉身份牌就 **client-side exception**——`tutorialOverlay.roles` 少了新角色，
 * `roleData` 是 undefined，讀 `.desc` 直接炸。typo 與缺 key 都不會被型別檢查抓到，
 * 因為那是 `t.raw(...)` 的動態查表；三語系一致性測試也抓不到（三個檔案一起缺就通過）。
 *
 * 所以這裡反過來用 `ALL_ROLE_KEYS`（角色權威表）掃三個語系檔：**新增角色就必須補教學卡**。
 */

const LOCALES: Array<[string, unknown]> = [
  ["zh-TW", zhTW],
  ["zh-CN", zhCN],
  ["en", en],
];

/** 教學卡的四個欄位：少了任何一個，教學面板就會缺一區或直接炸。 */
const REQUIRED_FIELDS = ["desc", "action"] as const;

test("每個角色在三語系都有教學卡，且必填欄位齊全（缺 key 開局會 client-side exception）", () => {
  const problems: string[] = [];
  for (const [locale, messages] of LOCALES) {
    const roles = (messages as { tutorialOverlay?: { roles?: Record<string, unknown> } }).tutorialOverlay?.roles ?? {};
    for (const role of ALL_ROLE_KEYS) {
      const card = roles[role] as Record<string, unknown> | undefined;
      if (!card) {
        problems.push(`${locale}：缺 tutorialOverlay.roles.${role}`);
        continue;
      }
      for (const field of REQUIRED_FIELDS) {
        const value = card[field];
        if (typeof value !== "string" || value.trim() === "") {
          problems.push(`${locale}：tutorialOverlay.roles.${role}.${field} 必須是非空字串`);
        }
      }
      for (const field of ["points", "tips"] as const) {
        const value = card[field];
        if (!Array.isArray(value)) {
          problems.push(`${locale}：tutorialOverlay.roles.${role}.${field} 必須是陣列`);
          continue;
        }
        if (value.some((item) => typeof item !== "string" || item.trim() === "")) {
          problems.push(`${locale}：tutorialOverlay.roles.${role}.${field} 不得有空字串`);
        }
      }
    }
  }
  assert.deepEqual(problems, [], `角色教學卡有缺口：\n${problems.join("\n")}`);
});
