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
  "WolfKing",
  "Seer",
  "Witch",
  "Hunter",
  "Guard",
  "Idiot",
  "Knight",
  "MuteElder",
  "Dreamweaver",
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
 * 官方版型。8–11 人為既有經典版型（行為與改造前逐字相同）；
 * 12 人局目前收錄經典、預女獵白、預女守白、預女獵禁、白狼騎士、狼王守衛與狼王攝夢，
 * 其餘官方版型與自定義版型待功能完成後再添加。
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
    id: "official-12-white-wolf-knight",
    playerCount: 12,
    roles: [
      "Werewolf",
      "Werewolf",
      "Werewolf",
      "WhiteWolfKing",
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
    tags: ["白狼騎士", "12人"],
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
