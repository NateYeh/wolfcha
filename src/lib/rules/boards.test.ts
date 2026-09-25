import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "boards-test-key";
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
  countSelectedBoardRoles,
  getBoardsByPlayerCount,
  getDefaultBoard,
  getSelectedBoardRoleKinds,
  getSelectedBoardRoles,
  resolveBoardPreset,
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

test("版型註冊表：八獵四狼＝獵人×8＋狼人×4（來源站特殊機制 · 全員槍口）", () => {
  const board = getBoardById("official-12-eight-hunters");
  assert.ok(board, "應收錄八獵四狼版型");
  assert.equal(board.official, true);
  assert.equal(board.playerCount, 12);
  assert.deepEqual(countBoardRolesOf(board), {
    byCamp: { wolf: 4, god: 8, villager: 0 },
    byRole: { Werewolf: 4, Hunter: 8 },
    total: 12,
  });
});

test("版型註冊表：狼美騎士＝狼人×3＋狼美人＋預女守騎＋4 平民（B 級首個新版型）", () => {
  const board = getBoardById("official-12-wolf-beauty-knight");
  assert.ok(board, "應收錄狼美騎士版型");
  assert.equal(board.official, true);
  assert.equal(board.playerCount, 12);
  assert.deepEqual(countBoardRolesOf(board), {
    byCamp: { wolf: 4, god: 4, villager: 4 },
    byRole: {
      Werewolf: 3,
      WolfBeauty: 1,
      Seer: 1,
      Witch: 1,
      Guard: 1,
      Knight: 1,
      Villager: 4,
    },
    total: 12,
  });
  // 狼美人算狼隊（屠邊與查驗都看 isWolfRole）
  assert.equal(isWolfRole("WolfBeauty"), true);
  const { errors, warnings } = validateBoardPreset(board);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("版型註冊表：魔鬼騎士＝狼人×3＋狼美人＋預女獵騎＋4 平民（與狼美騎士只差守衛換獵人）", () => {
  const board = getBoardById("official-12-wolf-beauty-hunter-knight");
  assert.ok(board, "應收錄魔鬼騎士版型");
  assert.equal(board.official, true);
  assert.equal(board.playerCount, 12);
  assert.deepEqual(countBoardRolesOf(board), {
    byCamp: { wolf: 4, god: 4, villager: 4 },
    byRole: {
      Werewolf: 3,
      WolfBeauty: 1,
      Seer: 1,
      Witch: 1,
      Hunter: 1,
      Knight: 1,
      Villager: 4,
    },
    total: 12,
  });
  const { errors, warnings } = validateBoardPreset(board);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);

  // 來源站把兩版定位成「衍生版型」，差別在神職：狼美騎士是守衛、魔鬼騎士是獵人。
  // 目錄與程式碼一度把它寫成「同一組角色、只是玩家約定不同」，這條把它釘住：
  // 兩張版型的角色集合必須「只差 Guard ↔ Hunter」這一格。
  const beautyKnight = getBoardById("official-12-wolf-beauty-knight");
  assert.ok(beautyKnight);
  assert.deepEqual(
    board.roles.filter((role) => role !== "Hunter"),
    beautyKnight.roles.filter((role) => role !== "Guard"),
    "兩張狼美人版型除了守衛／獵人之外不得有其他差異"
  );
  assert.equal(beautyKnight.roles.includes("Guard"), true, "狼美騎士帶守衛");
  assert.equal(board.roles.includes("Guard"), false, "魔鬼騎士沒有守衛（是獵人）");
});

test("版型註冊表：預女守白＝預言家/女巫/守衛/白痴＋4 平民＋4 小狼（首個沒有獵人的 12 人版）", () => {
  const board = getBoardById("official-12-seer-witch-guard-idiot");
  assert.ok(board, "應收錄預女守白版型");
  assert.equal(board.official, true);
  assert.equal(board.playerCount, 12);
  assert.deepEqual(countBoardRolesOf(board), {
    byCamp: { wolf: 4, god: 4, villager: 4 },
    byRole: { Werewolf: 4, Seer: 1, Witch: 1, Guard: 1, Idiot: 1, Villager: 4 },
    total: 12,
  });
  // 4 小狼：沒有白狼王；也沒有獵人與騎士、禁言長老
  for (const role of ["WhiteWolfKing", "Hunter", "Knight", "MuteElder"]) {
    assert.equal(board.roles.includes(role as never), false, `不該有 ${role}`);
  }
  const { errors, warnings } = validateBoardPreset(board);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("版型註冊表：十個 12 人版型的陣營統計與預設版型", () => {
  const twelve = getBoardsByPlayerCount(12).map((board) => board.id);
  // 不鎖 UI 排列順序，只確認這幾個版型都在（順序由選單自己決定）
  assert.deepEqual([...twelve].sort(), [
    "official-12-classic",
    "official-12-eight-hunters",
    "official-12-wolf-beauty-hunter-knight",
    "official-12-wolf-beauty-knight",
    "official-12-seer-witch-guard-idiot",
    "official-12-seer-witch-hunter-idiot",
    "official-12-seer-witch-hunter-mute",
    "official-12-white-wolf-knight",
    "official-12-wolf-king-dreamweaver",
    "official-12-wolf-king-guard",
  ].sort());
  // 預設 12 人版型仍是經典（既有行為不變）
  assert.equal(getDefaultBoard(12).id, "official-12-classic");
  // 所有 12 人版型都是 12 人、4 狼，且通過驗證
  for (const board of getBoardsByPlayerCount(12)) {
    assert.equal(board.roles.length, 12, `${board.id} 應為 12 人`);
    assert.equal(board.roles.filter((role) => isWolfRole(role)).length, 4, `${board.id} 應為 4 狼`);
    assert.deepEqual(validateBoardPreset(board).errors, [], `${board.id} 不應有錯誤`);
  }
});

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

test("版型選擇：身份偏好清單＝選定版型的角色種類（每個官方版型的角色都必須在清單內）", () => {
  for (const board of OFFICIAL_BOARDS) {
    const kinds = getSelectedBoardRoleKinds(board.playerCount, board.id);
    for (const role of board.roles) {
      assert.ok(kinds.includes(role), `${board.id} 的 ${role} 必須出現在身份偏好清單（${kinds.join("、")}）`);
    }
    assert.deepEqual(getSelectedBoardRoles(board.playerCount, board.id), [...board.roles]);
    assert.deepEqual(
      countSelectedBoardRoles(board.playerCount, board.id).total,
      board.roles.length,
      `${board.id} 的陣營統計總數應等於人數`
    );
  }
  // 具體案例：白狼騎士要能選到騎士、預女守白不該出現獵人
  assert.ok(getSelectedBoardRoleKinds(12, "official-12-white-wolf-knight").includes("Knight"));
  assert.ok(getSelectedBoardRoleKinds(12, "official-12-seer-witch-hunter-mute").includes("MuteElder"));
  assert.equal(getSelectedBoardRoleKinds(12, "official-12-seer-witch-guard-idiot").includes("Hunter"), false);
  // 不選版型＝該人數的預設版型
  assert.deepEqual(getSelectedBoardRoleKinds(12, ""), getBoardRoleKinds(12));
});

test("版型解析：人數不符或 id 不存在時退回該人數的預設版型", () => {
  // 10 人版型 id 用在 12 人 → 退回 12 人預設（經典）
  assert.equal(resolveBoardPreset(12, "official-10-classic").id, "official-12-classic");
  assert.equal(resolveBoardPreset(12, "not-exist").id, "official-12-classic");
  assert.equal(resolveBoardPreset(12, "").id, "official-12-classic");
  assert.equal(resolveBoardPreset(7, "").id, "official-10-classic");
  // 相符時照用
  assert.equal(resolveBoardPreset(12, "official-12-seer-witch-guard-idiot").id, "official-12-seer-witch-guard-idiot");
  // 12 人選了非預設版型 → 預設解析仍是經典（用來判斷「是否自訂版型」）
  assert.notEqual(
    resolveBoardPreset(12, "official-12-white-wolf-knight").id,
    resolveBoardPreset(12, "").id
  );
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
  assert.deepEqual(boomRoles, ["Werewolf", "WhiteWolfKing", "WolfKing"]);
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
  // 這裡刻意用**還沒實作**的角色（狼美人、魔術師都已實作，改用它們會測不到 fallback）
  const fallback = getRoleCapabilities("Gargoyle");
  assert.equal(fallback.role, "Villager");
  assert.equal(fallback.camp, "villager");
  assert.equal(fallback.canBoom, false);
});

test("身份偏好：即使帶入自訂版型組成，只要偏好角色在名單內就換給真人", async () => {
  const { setupPlayers } = await import("@/lib/game-master");
  const knightBoard = getSelectedBoardRoles(12, "official-12-white-wolf-knight");
  const characters = Array.from({ length: 11 }, (_, index) => ({
    displayName: `AI角色${index + 1}`,
    persona: { voiceRules: [], mbti: "INTJ", gender: "male" as const, age: 30 },
  }));

  // 騎士在版型內 → 真人拿到騎士
  const withKnight = setupPlayers(characters, 0, "我", 12, knightBoard, undefined, undefined, undefined, "Knight");
  assert.equal(withKnight.find((p) => p.isHuman)?.role, "Knight");
  assert.equal(withKnight.filter((p) => p.role === "Knight").length, 1, "角色數量不能因此多一個");

  // 偏好角色不在版型內（預女守白沒有獵人）→ 維持原樣、不憑空生出獵人
  const guardBoard = getSelectedBoardRoles(12, "official-12-seer-witch-guard-idiot");
  const withHunter = setupPlayers(characters, 0, "我", 12, guardBoard, undefined, undefined, undefined, "Hunter");
  assert.equal(withHunter.some((p) => p.role === "Hunter"), false, "版型裡沒有的角色不該被換進來");
  assert.equal(withHunter.length, 12);
});

test("版型只決定組成：座位一律打亂，狼不會固定坐在 1~4 號", async () => {
  const { setupPlayers } = await import("@/lib/game-master");
  const board = getBoardById("official-12-classic")!;
  const canonical = board.roles;
  const characters = Array.from({ length: 11 }, (_, index) => ({
    displayName: `AI角色${index + 1}`,
    persona: { voiceRules: [], mbti: "INTJ", gender: "male" as const, age: 30 },
  }));

  const orderSeen = new Set<string>();
  const wolfSeatsSeen = new Set<string>();
  // 版型原順序下狼的座位，用來偵測「完全沒洗牌」（舊版寫死 0,1,2,3）
  const canonicalWolfSeats = canonical
    .map((role, seat) => ({ role, seat }))
    .filter((entry) => isWolfRole(entry.role))
    .map((entry) => entry.seat)
    .sort((a, b) => a - b)
    .join(",");
  let canonicalSeatRounds = 0;
  for (let round = 0; round < 25; round++) {
    const players = setupPlayers(characters, 0, "我", 12, [...canonical]);
    // 組成必須與版型相同（只是座位換了）
    assert.deepEqual(
      players.map((p) => p.role).slice().sort(),
      canonical.slice().sort(),
      "洗牌後角色組成必須與版型相同"
    );
    orderSeen.add(players.map((p) => p.role).join(","));
    // 座位一律用數值排序：兩側必須同一個比較器，否則字串比較會讓下面的比對永遠不相等
    const wolfSeats = players
      .filter((p) => isWolfRole(p.role))
      .map((p) => p.seat)
      .sort((a, b) => a - b)
      .join(",");
    wolfSeatsSeen.add(wolfSeats);
    if (wolfSeats === canonicalWolfSeats) canonicalSeatRounds += 1;
  }
  assert.ok(orderSeen.size > 1, "多次開局拿到同一個座位排列 → 版型路徑沒有洗牌");
  assert.ok(wolfSeatsSeen.size > 1, "狼的座位每局都一樣 → 版型路徑沒有洗牌");
  // 「狼不固定坐在版型的前四席」不能用「那個組合一次都不許出現」來斷言：
  // 12 人 4 狼的組合數是 C(12,4)=495，25 局裡至少出現一次的機率約 5%
  // （實測 40 次會紅 2 次），把巧合當成錯誤等於讓 CI 隨機變紅。
  // 真正要證明的是「洗牌有作用」：若沒有洗牌，25 局全都會是版型順序。
  assert.ok(
    canonicalSeatRounds <= 2,
    `狼多局都坐在版型原座位（${canonicalWolfSeats}）→ 版型路徑沒有洗牌`
  );

  // 逐座位指定（開發者自選角色）不受影響：照傳入順序、不洗牌
  const anchored = setupPlayers(
    characters,
    0,
    "我",
    12,
    [...canonical],
    undefined,
    undefined,
    undefined,
    undefined,
    true
  );
  assert.deepEqual(anchored.map((p) => p.role), canonical, "逐座位指定時必須照傳入順序");
});
