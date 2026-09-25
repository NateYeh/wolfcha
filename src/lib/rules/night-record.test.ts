import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  NIGHT_RECORD_ACTION_KEYS,
  NIGHT_RECORD_EXCLUDED_KEYS,
  NIGHT_RECORD_KEYS,
  NIGHT_RECORD_REASON_KEYS,
  pickNightRecordActions,
} from "@/lib/rules/night-record";

/**
 * 夜史欄位清單的守門測試。
 *
 * 背景：魔術師的換位一路做完（角色、階段、結算、AI 決策、真人面板、跳轉補全），
 * 單元測試全綠，但**實機玩到夜間結算時 `nightHistory[1].magicianSwap` 是 `null`**——
 * 真正的結算（`useSpecialEvents`）自己手寫了一份欄位清單，沒跟著更新。
 * 狼美人先前也是同一個病灶（夜史「魅惑: 無」）。所以改成共用清單之後，
 * 這裡加兩道守門：清單本身要對，而且**每一個寫入端都要被涵蓋**。
 */

test("pickNightRecordActions：每個欄位都會被帶上（未決定的是 undefined，不是缺 key）", () => {
  const picked = pickNightRecordActions({
    guardTarget: 1,
    wolfTarget: 2,
    witchSave: true,
    seerTarget: 3,
    magicianSwap: [4, 5],
  });
  assert.equal(picked.guardTarget, 1);
  assert.equal(picked.wolfTarget, 2);
  assert.equal(picked.witchSave, true);
  assert.equal(picked.seerTarget, 3);
  assert.deepEqual(picked.magicianSwap, [4, 5]);
  // 沒決定的欄位仍然是「有這個 key、值是 undefined」：讀取端不必判斷 key 在不在
  for (const key of [...NIGHT_RECORD_ACTION_KEYS, ...NIGHT_RECORD_REASON_KEYS]) {
    assert.ok(key in picked, `${key} 應該出現在夜史物件裡（即使是 undefined）`);
  }
  assert.equal(picked.witchPoison, undefined);
  assert.equal(picked.dreamReason, undefined);
});

test("每個 nightActions 欄位的寫入端，都必須在夜史清單或被明確排除（附理由）", () => {
  const roots = ["src/hooks", "src/game", "src/store", "src/lib"];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (entry.name.includes(".test.")) continue;
      files.push(full);
    }
  };
  roots.forEach(walk);

  const written = new Map<string, string>();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/nightActions\.([A-Za-z][\w]*)\s*=/g)) {
      const key = match[1]!;
      if (!written.has(key)) written.set(key, file);
    }
  }
  assert.ok(written.size > 5, `掃到的欄位太少，掃描規則可能壞了（${written.size}）`);

  const uncovered = [...written.entries()]
    .filter(([key]) => !NIGHT_RECORD_KEYS.includes(key) && !(key in NIGHT_RECORD_EXCLUDED_KEYS))
    .map(([key, file]) => `${key}（${file}）`);

  assert.deepEqual(
    uncovered,
    [],
    `以下 nightActions 欄位既不在夜史清單也沒被排除——新增夜間行動時請補 rules/night-record.ts：\n${uncovered.join("\n")}`
  );
});
