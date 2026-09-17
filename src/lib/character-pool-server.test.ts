import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { GameScenario } from "@/types/game";
import type { GeneratedCharacter } from "./character-generator";
import {
  appendServerPool,
  clearServerPool,
  deleteServerCustomScenario,
  listServerCustomScenarios,
  readServerPool,
  saveServerCustomScenario,
  setServerPoolLock,
  setServerPoolScenario,
  takeServerPool,
} from "./character-pool-server";

// 資料目錄指向暫存目錄；character-pool-server 的 resolveDataDir 在每次操作時才讀環境變數，
// 因此只要在任何操作前設定即可生效。
const tempDataDir = mkdtempSync(path.join(os.tmpdir(), "wolfcha-pool-test-"));
process.env.WOLFCHA_POOL_DATA_DIR = tempDataDir;

const scenario = (id: string): GameScenario => ({
  id,
  title: `場景-${id}`,
  description: `描述-${id}`,
  rolesHint: `角色建議-${id}`,
});

const character = (name: string): GeneratedCharacter => ({
  displayName: name,
  persona: {
    voiceRules: ["说话直接"],
    mbti: "INTJ",
    gender: "male",
    age: 30,
    basicInfo: `${name}的職業`,
  },
  playerMind: {
    courage: "敢冲票",
    memoryBias: "记票型",
    suspicionThreshold: "偏高",
    selfProtection: "会自保",
    logicDepth: "愿意展开",
    tablePresence: "中等",
  },
});

const batch = (prefix: string, count: number): GeneratedCharacter[] =>
  Array.from({ length: count }, (_, index) => character(`${prefix}${index + 1}`));

test.after(() => {
  rmSync(tempDataDir, { recursive: true, force: true });
});

test("伺服器池：綁定情境建立空池，補充後抽用沿用同一情境", async () => {
  await clearServerPool();
  assert.equal(readServerPool(), null);

  const ok = await setServerPoolScenario(scenario("jinyong"));
  assert.equal(ok, true);
  const bound = readServerPool();
  assert.equal(bound?.scenario.id, "jinyong");
  assert.equal(bound?.characters.length, 0);

  const appended = await appendServerPool(scenario("jinyong"), batch("俠", 3));
  assert.equal(appended?.characters.length, 3);

  // 情境不符的補充會被擋下
  const mismatched = await appendServerPool(scenario("other"), batch("俠", 3));
  assert.equal(mismatched?.scenario.id, "jinyong");
  assert.equal(mismatched?.characters.length, 3);

  const taken = await takeServerPool(2);
  assert.equal(taken?.scenario.id, "jinyong");
  assert.equal(taken?.characters.length, 2);
  assert.equal(readServerPool()?.usedIndexes.length, 2);

  // 剩餘不足時抽用回 null
  assert.equal(await takeServerPool(2), null);
});

test("補池協調（伺服器）：append 以名字去重，不重複寫入", async () => {
  await clearServerPool();
  await setServerPoolScenario(scenario("jinyong"));
  await appendServerPool(scenario("jinyong"), batch("俠", 2));
  await appendServerPool(scenario("jinyong"), batch("俠", 2));
  assert.equal(readServerPool()?.characters.length, 2);
});

test("伺服器池：清空後讀回 null", async () => {
  await setServerPoolScenario(scenario("jinyong"));
  await appendServerPool(scenario("jinyong"), batch("俠", 1));
  assert.notEqual(readServerPool(), null);
  await clearServerPool();
  assert.equal(readServerPool(), null);
});

test("伺服器池：資料確實落在 .data 檔案裡", async () => {
  await clearServerPool();
  await setServerPoolScenario(scenario("persist"));
  const poolFile = path.join(tempDataDir, "character-pool.json");
  assert.ok(existsSync(poolFile));
  const raw = JSON.parse(readFileSync(poolFile, "utf-8")) as { scenario?: { id?: string } };
  assert.equal(raw.scenario?.id, "persist");
});

test("伺服器自訂情境：新增、列出、刪除，並寫入檔案", async () => {
  const first = await saveServerCustomScenario({ title: "金庸群俠", description: "華山論劍", rolesHint: "掌門、俠女" });
  await saveServerCustomScenario({ title: "星際會議", description: "太空站談判", rolesHint: "艦長、科學官" });
  assert.ok(first?.id.startsWith("custom_"));
  assert.equal(listServerCustomScenarios().length, 2);

  await deleteServerCustomScenario(first!.id);
  const rest = listServerCustomScenarios();
  assert.equal(rest.length, 1);
  assert.equal(rest[0]?.title, "星際會議");

  const customFile = path.join(tempDataDir, "custom-scenarios.json");
  assert.ok(existsSync(customFile));
  assert.equal((JSON.parse(readFileSync(customFile, "utf-8")) as unknown[]).length, 1);
});

test("伺服器自訂情境：缺少名稱或描述時拒絕儲存", async () => {
  const before = listServerCustomScenarios().length;
  const invalid = await saveServerCustomScenario({ title: "  ", description: "描述", rolesHint: "角色" });
  assert.equal(invalid, null);
  assert.equal(listServerCustomScenarios().length, before);
});
test("伺服器池：固定班底寫入檔案，並擋下自動補充", async () => {
  await clearServerPool();
  await setServerPoolScenario(scenario("locked_roster"));
  await appendServerPool(scenario("locked_roster"), batch("俠", 3));

  assert.equal(await setServerPoolLock(true), true);
  const pool = readServerPool();
  assert.equal(pool?.locked, true);
  assert.equal(pool?.characters.length, 3);

  // 檔案內容也要帶 locked，重啟伺服器後仍生效
  const raw = JSON.parse(readFileSync(path.join(tempDataDir, "character-pool.json"), "utf-8")) as {
    locked?: boolean;
    characters?: unknown[];
  };
  assert.equal(raw.locked, true);

  // 鎖定中：自動補充被擋下（回傳原池，不新增角色）
  const blocked = await appendServerPool(scenario("locked_roster"), batch("新", 2));
  assert.equal(blocked?.characters.length, 3);
  assert.equal(readServerPool()?.characters.length, 3);

  // 解鎖後可以再補
  assert.equal(await setServerPoolLock(false), true);
  const after = await appendServerPool(scenario("locked_roster"), batch("新", 2));
  assert.equal(after?.characters.length, 5);
});

test("伺服器池：重新綁定情境會解除固定班底", async () => {
  await setServerPoolLock(true);
  assert.equal(readServerPool()?.locked, true);
  await setServerPoolScenario(scenario("rebind_after_lock"));
  assert.equal(readServerPool()?.locked, false);
});
