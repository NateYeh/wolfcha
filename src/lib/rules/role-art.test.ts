import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ALL_ROLE_KEYS } from "@/lib/rules/boards";
import { ROLES_REUSING_PORTRAIT, ROLE_ICONS, ROLE_PORTRAIT_MAP } from "@/lib/rules/role-art";

/**
 * 角色立繪的守門測試。
 *
 * 以前 `Villager` 指向不存在的 `villager.png`：圖 404 不會有任何錯誤訊息，只是那個角色
 * 安靜地沒有立繪；另外這份對應同時手抄在對話框與賽後分析兩處，漏改只會讓兩邊顯示不同的圖。
 * 這裡用檔案系統與清單做結構檢查，取代「靠人記得改」。
 */

const PUBLIC_DIR = path.join(process.cwd(), "public");

test("每個角色都有立繪，而且檔案真的存在（圖 404 不會有任何提示）", () => {
  const missing: string[] = [];
  for (const role of ALL_ROLE_KEYS) {
    const src = ROLE_PORTRAIT_MAP[role];
    assert.ok(src, `${role} 沒有對應立繪`);
    const file = path.join(PUBLIC_DIR, src.replace(/^\//, ""));
    if (!fs.existsSync(file)) missing.push(`${role} → ${src}`);
  }
  assert.deepEqual(missing, [], `以下立繪檔案不存在：${missing.join(", ")}`);
});

test("對話框與賽後分析共用同一份對應（以前是手抄兩份）", () => {
  assert.equal(ROLE_ICONS, ROLE_PORTRAIT_MAP, "ROLE_ICONS 必須就是 ROLE_PORTRAIT_MAP");
});

test("沿用他人立繪的角色必須逐一列出（新增角色忘記附圖會被點出來）", () => {
  const byFile = new Map<string, string[]>();
  for (const role of ALL_ROLE_KEYS) {
    const list = byFile.get(ROLE_PORTRAIT_MAP[role]) ?? [];
    list.push(role);
    byFile.set(ROLE_PORTRAIT_MAP[role], list);
  }
  const reusing = [...byFile.values()]
    .filter((roles) => roles.length > 1)
    .flatMap((roles) => roles.slice(1))
    .sort();
  assert.deepEqual(
    reusing,
    [...ROLES_REUSING_PORTRAIT].sort(),
    "有角色在沿用別人的立繪，但不在 ROLES_REUSING_PORTRAIT 清單裡（或反過來：清單已過期）"
  );
});
