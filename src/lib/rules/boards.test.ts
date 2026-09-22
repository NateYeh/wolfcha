import assert from "node:assert/strict";
import test from "node:test";
import { getRoleConfiguration } from "@/lib/role-configuration";
import {
  ALL_ROLE_KEYS,
  OFFICIAL_BOARDS,
  countBoardRoles,
  getBoardById,
  getBoardRoleKinds,
  getBoardRoles,
  getBoardRuleFlags,
  getBoardsByPlayerCount,
  getDefaultBoard,
  validateBoardPreset,
  type BoardPreset,
} from "@/lib/rules/boards";
import { DEFAULT_RULE_FLAGS, mergeRuleFlags } from "@/lib/rules/flags";
import { ROLE_CAPABILITIES, getRoleCapabilities, isWolfRole } from "@/lib/rules/roles";
import type { Role } from "@/types/game";

// ─────────────────────────────────────────────────────────────
// 版型註冊表
// ─────────────────────────────────────────────────────────────

test("版型註冊表：8–12 人版型與改造前逐字相同（0 行為差異）", () => {
  const legacy: Record<number, Role[]> = {
    8: ["Werewolf", "Werewolf", "Werewolf", "Seer", "Witch", "Hunter", "Villager", "Villager"],
    9: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "Seer",
      "Witch",
      "Hunter",
      "Villager",
      "Villager",
      "Villager",
    ],
    10: [
      "Werewolf",
      "Werewolf",
      "WhiteWolfKing",
      "Seer",
      "Witch",
      "Hunter",
      "Guard",
      "Villager",
      "Villager",
      "Villager",
    ],
    11: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "WhiteWolfKing",
      "Seer",
      "Witch",
      "Hunter",
      "Guard",
      "Idiot",
      "Villager",
      "Villager",
    ],
    12: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "WhiteWolfKing",
      "Seer",
      "Witch",
      "Hunter",
      "Guard",
      "Idiot",
      "Villager",
      "Villager",
      "Villager",
    ],
  };

  for (const [count, roles] of Object.entries(legacy)) {
    assert.deepEqual(getBoardRoles(Number(count)), roles, `${count} 人版型應與舊配置相同`);
    assert.deepEqual(getRoleConfiguration(Number(count)), roles, `相容層應回傳相同配置`);
  }
});

test("版型註冊表：每個官方版型角色數＝人數，且全員都是已實作角色", () => {
  for (const board of OFFICIAL_BOARDS) {
    assert.equal(
      board.roles.length,
      board.playerCount,
      `${board.id} 的角色數應等於人數`,
    );
    for (const role of board.roles) {
      assert.ok(ALL_ROLE_KEYS.includes(role), `${board.id} 含未實作角色 ${role}`);
    }
  }
});

test("版型註冊表：官方版型全部通過驗證", () => {
  for (const board of OFFICIAL_BOARDS) {
    const { errors } = validateBoardPreset(board);
    assert.deepEqual(errors, [], `${board.id} 不應有硬性錯誤`);
  }
});

test("版型註冊表：無對應人數時退回 10 人版型（沿用舊行為）", () => {
  assert.equal(getDefaultBoard(7).id, "official-10-classic");
  assert.deepEqual(getBoardRoles(7), getBoardRoles(10));
  assert.deepEqual(getBoardRoles(99), getBoardRoles(10));
});

test("版型註冊表：角色種類去重且保留首次出現順序（供 UI 選單）", () => {
  for (const [count, kinds] of [
    [8, ["Werewolf", "Seer", "Witch", "Hunter", "Villager"]],
    [10, ["Werewolf", "WhiteWolfKing", "Seer", "Witch", "Hunter", "Guard", "Villager"]],
    [12, ["Werewolf", "WhiteWolfKing", "Seer", "Witch", "Hunter", "Guard", "Idiot", "Villager"]],
  ] as const) {
    assert.deepEqual(getBoardRoleKinds(count), kinds);
  }
});

function countBoardRolesOf(board: { roles: Role[] }): {
  byCamp: Record<string, number>;
  byRole: Record<string, number>;
  total: number;
} {
  const byCamp: Record<string, number> = { wolf: 0, god: 0, villager: 0 };
  const byRole: Record<string, number> = {};
  for (const role of board.roles) {
    byCamp[getRoleCapabilities(role).camp] += 1;
    byRole[role] = (byRole[role] ?? 0) + 1;
  }
  return { byCamp, byRole, total: board.roles.length };
}

test("版型註冊表：預女獵白＝預言家/女巫/獵人/白痴＋4 平民＋4 狼人（純資料新增）", () => {
  const board = getBoardById("official-12-seer-witch-hunter-idiot");
  assert.ok(board, "應收錄預女獵白版型");
  assert.equal(board.official, true);
  assert.equal(board.playerCount, 12);
  assert.equal(board.roles.length, 12);
  assert.deepEqual(countBoardRolesOf(board), {
    byCamp: { wolf: 4, god: 4, villager: 4 },
    byRole: { Werewolf: 4, Seer: 1, Witch: 1, Hunter: 1, Idiot: 1, Villager: 4 },
    total: 12,
  });
  // 沒有白狼王、沒有守衛、沒有騎士
  assert.equal(board.roles.includes("WhiteWolfKing"), false);
  assert.equal(board.roles.includes("Guard"), false);
  assert.equal(board.roles.includes("Knight"), false);
  const { errors, warnings } = validateBoardPreset(board);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [], "標準 12 人配置不應有提醒");
  // 預設版型不受影響：12 人仍以經典為預設（行為不變）
  assert.equal(getDefaultBoard(12).id, "official-12-classic");
});

test("版型註冊表：回傳的是複本，修改不會污染註冊表", () => {
  const roles = getBoardRoles(12);
  roles[0] = "Villager";
  assert.equal(getBoardRoles(12)[0], "Werewolf");
});

test("版型註冊表：getBoardById 與 getBoardsByPlayerCount 一致", () => {
  for (const board of OFFICIAL_BOARDS) {
    assert.equal(getBoardById(board.id)?.id, board.id);
    assert.ok(getBoardsByPlayerCount(board.playerCount).some((item) => item.id === board.id));
  }
  assert.equal(getBoardById("not-exist"), undefined);
});

test("版型註冊表：統計各陣營與角色數量（供 UI 提示與自選驗證）", () => {
  const twelve = countBoardRoles(12);
  assert.equal(twelve.total, 12);
  assert.deepEqual(twelve.byCamp, { wolf: 4, god: 5, villager: 3 });
  assert.equal(twelve.byRole.Werewolf, 3);
  assert.equal(twelve.byRole.WhiteWolfKing, 1);
  assert.equal(twelve.byRole.Villager, 3);

  const ten = countBoardRoles(10);
  assert.deepEqual(ten.byCamp, { wolf: 3, god: 4, villager: 3 });
  assert.equal(ten.byRole.Guard, 1);
  assert.equal(ten.byRole.Idiot, 0);
});

test("版型驗證：人數不符、未實作角色、無狼、狼不少於好人皆為硬性錯誤", () => {
  const base: BoardPreset = {
    id: "test",
    playerCount: 4,
    roles: ["Werewolf", "Seer", "Witch", "Villager"],
    official: false,
    tags: [],
  };
  assert.deepEqual(validateBoardPreset(base).errors, []);

  assert.match(
    validateBoardPreset({ ...base, playerCount: 5 }).errors.join("|"),
    /人數 5 與角色數 4 不一致/,
  );
  assert.match(
    validateBoardPreset({ ...base, roles: ["Werewolf", "Seer", "Witch", "NotARole" as Role] }).errors.join("|"),
    /含未實作角色：NotARole/,
  );
  assert.match(
    validateBoardPreset({ ...base, roles: ["Seer", "Witch", "Hunter", "Villager"] }).errors.join("|"),
    /至少要有一名狼陣營角色/,
  );
  assert.match(
    validateBoardPreset({ ...base, roles: ["Werewolf", "Werewolf", "Seer", "Witch"] }).errors.join("|"),
    /狼陣營 2 人不少於好人 2 人/,
  );
});

test("版型驗證：重複神職與沒有預言家只是提醒，不是錯誤", () => {
  const board: BoardPreset = {
    id: "test-warn",
    playerCount: 6,
    roles: ["Werewolf", "Werewolf", "Seer", "Seer", "Witch", "Hunter"],
    official: false,
    tags: [],
  };
  const { errors, warnings } = validateBoardPreset(board);
  assert.deepEqual(errors, []);
  assert.match(warnings.join("|"), /重複神職：Seer/);

  const noSeer: BoardPreset = {
    id: "test-no-seer",
    playerCount: 4,
    roles: ["Werewolf", "Witch", "Hunter", "Villager"],
    official: false,
    tags: [],
  };
  assert.deepEqual(validateBoardPreset(noSeer).errors, []);
  assert.match(validateBoardPreset(noSeer).warnings.join("|"), /沒有預言家/);
});

// ─────────────────────────────────────────────────────────────
// 規則旗標
// ─────────────────────────────────────────────────────────────

test("規則旗標：預設值符合拍板規則（守衛可空守、女巫不可自救、雙爆吞警徽）", () => {
  assert.equal(DEFAULT_RULE_FLAGS.guardCanAbstain, true);
  assert.equal(DEFAULT_RULE_FLAGS.guardCannotRepeat, true);
  assert.equal(DEFAULT_RULE_FLAGS.witchCanSelfSave, false);
  assert.equal(DEFAULT_RULE_FLAGS.boom.anyWolf, true);
  assert.deepEqual(DEFAULT_RULE_FLAGS.boom.takesPlayerRoles, ["WhiteWolfKing"]);
  assert.equal(DEFAULT_RULE_FLAGS.boom.electionBoomSwallowCount, 2);
});

test("規則旗標：版型覆寫可局部生效且不污染預設值", () => {
  const merged = mergeRuleFlags({ witchCanSelfSave: true, boom: { anyWolf: false } });
  assert.equal(merged.witchCanSelfSave, true);
  assert.equal(merged.boom.anyWolf, false);
  // 未覆寫的欄位繼承預設
  assert.equal(merged.guardCanAbstain, true);
  assert.deepEqual(merged.boom.takesPlayerRoles, ["WhiteWolfKing"]);
  assert.equal(merged.boom.electionBoomSwallowCount, 2);
  // 預設物件未被修改
  assert.equal(DEFAULT_RULE_FLAGS.boom.anyWolf, true);
  assert.equal(DEFAULT_RULE_FLAGS.witchCanSelfSave, false);
});

test("規則旗標：目前官方版型皆沿用預設（尚未有版型級覆寫）", () => {
  for (const count of [8, 9, 10, 11, 12]) {
    assert.deepEqual(getBoardRuleFlags(count), mergeRuleFlags(undefined));
  }
});

// ─────────────────────────────────────────────────────────────
// 角色能力表
// ─────────────────────────────────────────────────────────────

test("角色能力表：涵蓋全部已實作角色", () => {
  assert.deepEqual(Object.keys(ROLE_CAPABILITIES).sort(), [...ALL_ROLE_KEYS].sort());
});

test("角色能力表：陣營與夜間行動符合現行規則", () => {
  assert.equal(getRoleCapabilities("Werewolf").camp, "wolf");
  assert.equal(getRoleCapabilities("WhiteWolfKing").camp, "wolf");
  assert.equal(isWolfRole("Werewolf"), true);
  assert.equal(isWolfRole("WhiteWolfKing"), true);
  assert.equal(isWolfRole("Seer"), false);

  assert.equal(getRoleCapabilities("Seer").nightAction, "inspect");
  assert.equal(getRoleCapabilities("Witch").nightAction, "potion");
  assert.equal(getRoleCapabilities("Guard").nightAction, "protect");
  assert.equal(getRoleCapabilities("Hunter").nightAction, "none");
  assert.equal(getRoleCapabilities("Villager").nightAction, "none");
});

test("角色能力表：只有狼陣營可自爆，只有白狼王能帶人與競選吞徽", () => {
  const boomRoles = ALL_ROLE_KEYS.filter((role) => getRoleCapabilities(role).canBoom);
  assert.deepEqual(boomRoles, ["Werewolf", "WhiteWolfKing"]);
  assert.equal(getRoleCapabilities("Werewolf").boomTakesPlayer, false);
  assert.equal(getRoleCapabilities("WhiteWolfKing").boomTakesPlayer, true);
  assert.equal(getRoleCapabilities("WhiteWolfKing").boomSwallowsBadgeOnElection, true);
  assert.equal(getRoleCapabilities("Werewolf").boomSwallowsBadgeOnElection, false);
});

test("角色能力表：守衛可空守、女巫不可自救（目標規則）", () => {
  assert.equal(getRoleCapabilities("Guard").canAbstain, true);
  assert.equal(getRoleCapabilities("Witch").canAbstain, true);
  assert.equal(getRoleCapabilities("Witch").canSelfTarget, false);
  assert.equal(getRoleCapabilities("Seer").canAbstain, false);
});

test("角色能力表：未知角色退回平民能力，不拋錯", () => {
  const fallback = getRoleCapabilities("WolfBeauty");
  assert.equal(fallback.role, "Villager");
  assert.equal(fallback.camp, "villager");
  assert.equal(fallback.canBoom, false);
});
