import type { Role } from "@/types/game";
import { mergeRuleFlags, type RuleFlags, type RuleFlagsOverride } from "./flags";
import { getRoleCapabilities, type RoleCamp } from "./roles";

/**
 * 版型（板子）註冊表：**唯一的版型真相**。
 *
 * 過去版型定義散在四處（`lib/role-configuration.ts`、`GameSetupModal.getAvailableRoles`、
 * `game-constants.ROLE_CONFIG`、`WelcomeScreen.buildDefaultRoles`），互相抄寫、加版型必漏改；
 * 現在一律從這裡讀。
 */
export interface BoardPreset {
  /** 唯一識別碼（官方版型用 `official-<人數>-<代號>`） */
  id: string;
  /** 遊玩人數（必須等於 roles.length） */
  playerCount: number;
  /** 角色組成，長度＝playerCount，允許重複 */
  roles: Role[];
  /** 是否為官方版型（false＝玩家自定義） */
  official: boolean;
  /** 分類標籤，供 UI 分組（例：["經典", "12人"]） */
  tags: string[];
  /** 版型級規則覆寫，未給的欄位繼承 DEFAULT_RULE_FLAGS */
  rules?: RuleFlagsOverride;
  /** 顯示名稱的 i18n key（UI 需要時才補） */
  nameKey?: string;
}

/** 目前支援的角色完整清單（須與 ROLE_CAPABILITIES 同步） */
export const ALL_ROLE_KEYS: Role[] = [
  "Werewolf",
  "WhiteWolfKing",
  "WolfBeauty",
  "WolfKing",
  "Seer",
  "Witch",
  "Hunter",
  "Guard",
  "Idiot",
  "Knight",
  "MuteElder",
  "Dreamweaver",
  "Magician",
  "Villager",
];

/** 神職類角色（用於「重複神職」提醒） */
const GOD_ROLES: Role[] = [
  "Seer",
  "Witch",
  "Hunter",
  "Guard",
  "Idiot",
  "Knight",
  "MuteElder",
  "Dreamweaver",
  "WhiteWolfKing",
];

/** 找不到對應人數版型時的後備版型（沿用舊行為：一律退回 10 人版型） */
const FALLBACK_PLAYER_COUNT = 10;

/**
 * 官方版型。8–11 人為既有經典版型（行為與改造前逐字相同）。
 *
 * **12 人版的排列順序照 `https://werewolves.games/variants/` 的目錄順序**：該站按學習難度／
 * 機制密度排（預女獵白 → 預女獵禁 → 狼王守衛 → 狼王攝夢 → 狼王魔術師 → 白狼王騎士 →
 * 狼美騎士 → 魔鬼騎士 → 四狼八獵），我們有的照它排、沒有的略過。兩個它沒收錄的版型插在
 * 性質相近處：`official-12-classic` 固定第一個（`getDefaultBoard` 取 `boards[0]`，12 人局的
 * 預設版型就是它，`boards.test.ts` 也綁了這個 id），`official-12-seer-witch-guard-idiot`
 * （預女守白）跟在預女獵白／預女獵禁之後。
 *
 * 這個順序就是 UI 下拉、開發者分頁與教學頁看到的順序（`getBoardsByPlayerCount` 只依人數 filter），
 * 動它就會同時動到預設版型。其餘官方版型與自定義版型待功能完成後再添加。
 */
export const OFFICIAL_BOARDS: readonly BoardPreset[] = [
  {
    id: "official-8-classic",
    playerCount: 8,
    roles: ["Werewolf", "Werewolf", "Werewolf", "Seer", "Witch", "Hunter", "Villager", "Villager"],
    official: true,
    tags: ["經典", "8人"],
  },
  {
    id: "official-9-classic",
    playerCount: 9,
    roles: [
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
    official: true,
    tags: ["經典", "9人"],
  },
  {
    id: "official-10-classic",
    playerCount: 10,
    roles: [
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
    official: true,
    tags: ["經典", "10人"],
  },
  {
    id: "official-11-classic",
    playerCount: 11,
    roles: [
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
    official: true,
    tags: ["經典", "11人"],
  },
  {
    // **本站自訂，網站目錄沒有這個版型**（12 人局預設；`getDefaultBoard` 取 boards[0]，勿隨意搬動）：
    // 狼人×3＋白狼王／預言家、女巫、獵人、守衛、白痴、平民×3。
    id: "official-12-classic",
    playerCount: 12,
    roles: [
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
    official: true,
    tags: ["經典", "12人"],
  },
  {
    // 來源：werewolves.games 的「預女獵白」（12 人標準競技版型）：
    // 狼人×4／預言家、女巫、獵人、白痴、平民×4。
    id: "official-12-seer-witch-hunter-idiot",
    playerCount: 12,
    roles: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "Seer",
      "Witch",
      "Hunter",
      "Idiot",
      "Villager",
      "Villager",
      "Villager",
      "Villager",
    ],
    official: true,
    tags: ["預女獵白", "12人"],
  },
  {
    // 來源：werewolves.games 的「預女獵禁」：
    // 狼人×4／預言家、女巫、獵人、禁言長老、平民×4。
    id: "official-12-seer-witch-hunter-mute",
    playerCount: 12,
    roles: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "Seer",
      "Witch",
      "Hunter",
      "MuteElder",
      "Villager",
      "Villager",
      "Villager",
      "Villager",
    ],
    official: true,
    tags: ["預女獵禁", "12人"],
  },
  {
    // **本站自訂，網站目錄沒有這個版型**：
    // 狼人×4／預言家、女巫、守衛、白痴、平民×4。
    id: "official-12-seer-witch-guard-idiot",
    playerCount: 12,
    roles: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "Seer",
      "Witch",
      "Guard",
      "Idiot",
      "Villager",
      "Villager",
      "Villager",
      "Villager",
    ],
    official: true,
    tags: ["預女守白", "12人"],
  },
  {
    // 來源：werewolves.games 的「狼王守衛」：
    // 狼人×3＋狼王／預言家、女巫、獵人、守衛、平民×4。
    id: "official-12-wolf-king-guard",
    playerCount: 12,
    roles: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "WolfKing",
      "Seer",
      "Witch",
      "Guard",
      "Hunter",
      "Villager",
      "Villager",
      "Villager",
      "Villager",
    ],
    official: true,
    tags: ["狼王守衛", "12人"],
  },
  {
    // 來源：werewolves.games 的「狼王攝夢人」：
    // 狼人×3＋狼王／預言家、女巫、獵人、攝夢人、平民×4。
    id: "official-12-wolf-king-dreamweaver",
    playerCount: 12,
    roles: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "WolfKing",
      "Seer",
      "Witch",
      "Dreamweaver",
      "Hunter",
      "Villager",
      "Villager",
      "Villager",
      "Villager",
    ],
    official: true,
    tags: ["狼王攝夢", "12人"],
  },
  {
    // 狼王魔術師：狼人×3＋狼王／預女獵魔＋4 民（來源 https://werewolves.games/lang-wang-mo-shu-shi/）
    id: "official-12-wolf-king-magician",
    playerCount: 12,
    roles: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "WolfKing",
      "Seer",
      "Witch",
      "Hunter",
      "Magician",
      "Villager",
      "Villager",
      "Villager",
      "Villager",
    ],
    official: true,
    tags: ["狼王魔術師", "12人"],
  },
  {
    // 來源：werewolves.games 的「白狼王騎士」：
    // 狼人×3＋白狼王／預言家、女巫、**獵人**、騎士、平民×4。
    // （原本寫成守衛，與來源網站的組成不符；版型以網站為準，這裡改成獵人。）
    id: "official-12-white-wolf-knight",
    playerCount: 12,
    roles: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "WhiteWolfKing",
      "Seer",
      "Witch",
      "Hunter",
      "Knight",
      "Villager",
      "Villager",
      "Villager",
      "Villager",
    ],
    official: true,
    tags: ["白狼騎士", "12人"],
  },
  {
    // 來源：werewolves.games 的「狼美騎士」（12 人經典進階版型）：
    // 狼人×3＋狼美人／預言家、女巫、**守衛**、騎士、平民×4。
    id: "official-12-wolf-beauty-knight",
    playerCount: 12,
    roles: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "WolfBeauty",
      "Seer",
      "Witch",
      "Guard",
      "Knight",
      "Villager",
      "Villager",
      "Villager",
      "Villager",
    ],
    official: true,
    tags: ["狼美騎士", "12人"],
  },
  {
    // 來源：werewolves.games 的「魔鬼騎士」——狼美騎士的衍生版型，
    // 差別只有神職的**守衛換成獵人**（不是玩家約定差異）：
    // 狼人×3＋狼美人／預言家、女巫、**獵人**、騎士、平民×4。
    // 兩版共用同一個狼美人；「被騎士決鬥出局不發動魅惑」由 charm.ts 統一處理（cause !== "duel"）。
    id: "official-12-wolf-beauty-hunter-knight",
    playerCount: 12,
    roles: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "WolfBeauty",
      "Seer",
      "Witch",
      "Hunter",
      "Knight",
      "Villager",
      "Villager",
      "Villager",
      "Villager",
    ],
    official: true,
    tags: ["魔鬼騎士", "12人"],
  },
  {
    // 來源：werewolves.games 的「四狼八獵」（特殊機制 · 全員槍口）。
    // 八個獵人＝八把槍，槍打槍會互相觸發（見 death-skills 的 getChainedShooter）。
    id: "official-12-eight-hunters",
    playerCount: 12,
    roles: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "Hunter",
      "Hunter",
      "Hunter",
      "Hunter",
      "Hunter",
      "Hunter",
      "Hunter",
      "Hunter",
    ],
    official: true,
    tags: ["八獵四狼", "12人"],
  },
] as const;

/** 該版型出現過的**角色種類**（去重、保留首次出現順序），供 UI 下拉選單使用 */
export function getBoardRoleKindsOf(board: BoardPreset): Role[] {
  return [...new Set(board.roles)];
}

/**
 * 解析「這一局要用哪個版型」：指定的 boardId 必須存在、且人數與目前設定相符，
 * 否則退回該人數的預設版型（找不到該人數時再退回 10 人版型）。
 */
export function resolveBoardPreset(playerCount: number, boardId?: string | null): BoardPreset {
  const board = boardId ? getBoardById(boardId) : undefined;
  if (board && board.playerCount === playerCount) return board;
  return getDefaultBoard(playerCount);
}

/** 選定版型的角色組成（回傳複本） */
export function getSelectedBoardRoles(playerCount: number, boardId?: string | null): Role[] {
  return [...resolveBoardPreset(playerCount, boardId).roles];
}

/** 選定版型出現過的角色種類（身份偏好清單的來源） */
export function getSelectedBoardRoleKinds(playerCount: number, boardId?: string | null): Role[] {
  return getBoardRoleKindsOf(resolveBoardPreset(playerCount, boardId));
}

/** 選定版型的陣營／角色統計（大廳摘要與自選驗證的來源） */
export function countSelectedBoardRoles(playerCount: number, boardId?: string | null): {
  byCamp: Record<RoleCamp, number>;
  byRole: Record<Role, number>;
  total: number;
} {
  const byCamp: Record<RoleCamp, number> = { wolf: 0, god: 0, villager: 0 };
  const byRole = Object.fromEntries(ALL_ROLE_KEYS.map((role) => [role, 0])) as Record<Role, number>;
  const roles = resolveBoardPreset(playerCount, boardId).roles;
  for (const role of roles) {
    byCamp[getRoleCapabilities(role).camp] += 1;
    byRole[role] += 1;
  }
  return { byCamp, byRole, total: roles.length };
}

/** 依 id 取得版型 */
export function getBoardById(id: string): BoardPreset | undefined {
  return OFFICIAL_BOARDS.find((board) => board.id === id);
}

/** 列出所有官方版型 */
export function listOfficialBoards(): readonly BoardPreset[] {
  return OFFICIAL_BOARDS;
}

/** 依人數列出官方版型（同一人數未來可能有多個版型） */
export function getBoardsByPlayerCount(playerCount: number): BoardPreset[] {
  return OFFICIAL_BOARDS.filter((board) => board.playerCount === playerCount);
}

/** 取得該人數的預設版型（無對應版型時退回 10 人版型） */
export function getDefaultBoard(playerCount: number): BoardPreset {
  const boards = getBoardsByPlayerCount(playerCount);
  if (boards.length > 0) return boards[0];
  const fallback = getBoardsByPlayerCount(FALLBACK_PLAYER_COUNT);
  if (fallback.length > 0) return fallback[0];
  throw new Error(`找不到 ${playerCount} 人版型，且後備版型（${FALLBACK_PLAYER_COUNT} 人）不存在`);
}

/** 取得該人數預設版型的角色組成（回傳複本，呼叫端可安全修改） */
export function getBoardRoles(playerCount: number): Role[] {
  return [...getDefaultBoard(playerCount).roles];
}

/** 取得該人數預設版型出現過的**角色種類**（去重、保留首次出現順序），供 UI 下拉選單使用 */
export function getBoardRoleKinds(playerCount: number): Role[] {
  return [...new Set(getDefaultBoard(playerCount).roles)];
}

/** 取得該人數預設版型合併後的規則旗標 */
export function getBoardRuleFlags(playerCount: number): RuleFlags {
  return mergeRuleFlags(getDefaultBoard(playerCount).rules);
}

/** 統計該人數預設版型的各陣營／各角色數量（供 UI 提示與自選角色驗證） */
export function countBoardRoles(playerCount: number): {
  byCamp: Record<RoleCamp, number>;
  byRole: Record<Role, number>;
  total: number;
} {
  const byCamp: Record<RoleCamp, number> = { wolf: 0, god: 0, villager: 0 };
  const byRole = Object.fromEntries(ALL_ROLE_KEYS.map((role) => [role, 0])) as Record<Role, number>;
  const roles = getDefaultBoard(playerCount).roles;
  for (const role of roles) {
    byCamp[getRoleCapabilities(role).camp] += 1;
    byRole[role] += 1;
  }
  return { byCamp, byRole, total: roles.length };
}

/** 版型驗證結果 */
export interface BoardValidation {
  /** 硬性錯誤（版型不可用） */
  errors: string[];
  /** 提醒（可用，但可能不平衡或非慣例） */
  warnings: string[];
}

/** 驗證版型資料是否合理（自定義版型存檔前、載入後都要跑） */
export function validateBoardPreset(board: BoardPreset): BoardValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (board.roles.length !== board.playerCount) {
    errors.push(`版型人數 ${board.playerCount} 與角色數 ${board.roles.length} 不一致`);
  }

  const unknown = board.roles.filter((role) => !ALL_ROLE_KEYS.includes(role));
  if (unknown.length > 0) {
    errors.push(`含未實作角色：${[...new Set(unknown)].join("、")}`);
  }

  const wolfCount = board.roles.filter((role) => getRoleCapabilities(role).camp === "wolf").length;
  const goodCount = board.roles.length - wolfCount;
  if (wolfCount === 0) {
    errors.push("版型至少要有一名狼陣營角色");
  }
  if (wolfCount >= goodCount) {
    errors.push(`狼陣營 ${wolfCount} 人不少於好人 ${goodCount} 人，此版型無法成立`);
  }

  const duplicatedGods = GOD_ROLES.filter(
    (role) => board.roles.filter((item) => item === role).length > 1,
  );
  if (duplicatedGods.length > 0) {
    warnings.push(`重複神職：${duplicatedGods.join("、")}`);
  }
  if (!board.roles.includes("Seer")) {
    warnings.push("版型沒有預言家");
  }

  return { errors, warnings };
}
