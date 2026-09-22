import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import { getRoleName } from "@/lib/game-constants";
import { ALL_ROLE_KEYS } from "@/lib/rules/boards";
import { getRoleCapabilities } from "@/lib/rules/roles";
import type { Role } from "@/types/game";
import { isWolfRole } from "@/types/game";

/**
 * 角色列舉守衛。
 *
 * 新角色（騎士／禁言長老／狼王）上線時最常見的漏接是「角色 → 名稱」對照表：
 * 對照表若寫成 `Record<string, string>`（不受型別檢查保護）＋ `?? t("roles.villager")`，
 * 新角色就會**安靜地顯示成村民**——玩家看到的是錯的身份，不是壞掉，所以極難發現。
 *
 * 兩道防線：
 * 1. 顯示名稱一律走 `getRoleName()`（單一真相，內部 switch 有 default 也會被這支測試抓到）。
 * 2. 原始碼掃描：任何出現角色列舉（`Idiot:` 這種角色鍵）的檔案，必須列出所有角色。
 */

setLocale("zh-CN");

test("每個角色的顯示名稱都不同，不得悄悄退回村民", () => {
  const labels = new Map<string, Role[]>();
  for (const role of ALL_ROLE_KEYS) {
    const name = getRoleName(role);
    assert.ok(name && name.trim().length > 0, `${role} 取不到名稱`);
    labels.set(name, [...(labels.get(name) ?? []), role]);
  }
  const duplicated = [...labels.entries()].filter(([, roles]) => roles.length > 1);
  assert.deepEqual(duplicated, [], `以下角色名稱重複（有人掉進 default）：${JSON.stringify(duplicated)}`);
});

test("isWolfRole 必須涵蓋 camp=wolf 的所有角色，反向也不得多認（狼王曾漏接＝勝負誤判）", () => {
  const wolfCamp = ALL_ROLE_KEYS.filter((role) => getRoleCapabilities(role).camp === "wolf");
  const nonWolf = ALL_ROLE_KEYS.filter((role) => getRoleCapabilities(role).camp !== "wolf");
  // 狼王曾因清單漏列被當成好人：勝負判定把活著的狼王算成村民，直接判好人勝。
  for (const role of wolfCamp) {
    assert.ok(isWolfRole(role), `${role} 是狼營角色，isWolfRole 卻回 false`);
  }
  for (const role of nonWolf) {
    assert.ok(!isWolfRole(role), `${role} 不是狼營角色，isWolfRole 卻回 true`);
  }
});

test("原始碼中的角色列舉必須涵蓋所有角色", () => {
  const root = path.join(process.cwd(), "src");
  const offenders: string[] = [];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".next", "temp"].includes(entry.name)) continue;
        out.push(...walk(full));
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  };

  for (const file of walk(root)) {
    const source = fs.readFileSync(file, "utf8");
    // 只檢查「角色鍵」出現的檔案（對照表／switch），避免誤判一般字串
    if (!/Idiot:/.test(source)) continue;
    const missing = ALL_ROLE_KEYS.filter((role) => !source.includes(role));
    if (missing.length > 0) {
      offenders.push(`${path.relative(process.cwd(), file)} 缺 ${missing.join(", ")}`);
    }
  }

  assert.deepEqual(offenders, [], `以下檔案的角色列舉不完整：\n${offenders.join("\n")}`);
});
