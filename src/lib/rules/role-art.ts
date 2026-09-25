import type { Phase, Role } from "@/types/game";

/**
 * 「哪個角色用哪張立繪」的單一真相（檔案在 `public/roles/*.png`）。
 *
 * 這份對應以前**手抄兩份**：遊戲對話框（`DialogArea`）與賽後分析（`analysis/constants`）。
 * 兩邊都得記得改，而漏改不會有任何錯誤訊息——只是同一個角色在對話框與賽後顯示不同的圖。
 * 現在只留這一份，兩邊都 import 它。
 *
 * 還沒有專屬立繪的角色是**明確沿用**最接近的一張，不是缺圖：
 * 狼王／狼美人沿用白狼王，魔術師／攝夢人／村民沿用守衛。
 * `role-art.test.ts` 會逐一檢查這裡的檔案真的存在（先前 `Villager` 指向不存在的
 * `villager.png`，圖 404 沒有任何提示），也會要求「沿用的角色」與下面這份清單一致——
 * 新增角色若忘了附圖，測試會直接點出來。
 */

/** 目前沒有專屬立繪、明確沿用他人立繪的角色（新增角色時請一併更新）。 */
export const ROLES_REUSING_PORTRAIT: Role[] = ["WolfKing", "WolfBeauty", "Magician", "Dreamweaver", "Villager"];

export const ROLE_PORTRAIT_MAP: Record<Role, string> = {
  Werewolf: "/roles/werewolf.png",
  WhiteWolfKing: "/roles/white-wolf-king.png",
  WolfKing: "/roles/white-wolf-king.png",
  WolfBeauty: "/roles/white-wolf-king.png",
  Magician: "/roles/guard.png",
  Seer: "/roles/seer.png",
  Witch: "/roles/witch.png",
  Hunter: "/roles/hunter.png",
  Guard: "/roles/guard.png",
  Knight: "/roles/knight.png",
  MuteElder: "/roles/mute-elder.png",
  Dreamweaver: "/roles/guard.png",
  Idiot: "/roles/idiot.png",
  Villager: "/roles/guard.png",
};

/** 賽後分析沿用的名稱（同一個真相，保留舊名以免動到既有 import）。 */
export const ROLE_ICONS: Record<Role, string> = ROLE_PORTRAIT_MAP;

/**
 * 立繪背後的夜間光暈配色（`partial`：只給真的會出現在夜間舞台上的角色）。
 *
 * 這裡原本是 `DialogArea` 裡一串 `phaseRole === 'X' && "…"`，只認 6 個角色——
 * 後補的魔術師／狼美人有立繪卻沒有光暈，而且新增角色時沒有任何東西會提醒你。
 * 改成這份對應後，`role-art.test.ts` 會檢查「每個會出現在夜間舞台的角色都有配色」。
 */
export const ROLE_PORTRAIT_GLOW: Partial<Record<Role, string>> = {
  Werewolf: "bg-gradient-radial from-red-500/30 via-transparent to-transparent",
  WhiteWolfKing: "bg-gradient-radial from-red-400/30 via-transparent to-transparent",
  WolfBeauty: "bg-gradient-radial from-pink-500/30 via-transparent to-transparent",
  Seer: "bg-gradient-radial from-blue-500/30 via-transparent to-transparent",
  Witch: "bg-gradient-radial from-purple-500/30 via-transparent to-transparent",
  Guard: "bg-gradient-radial from-emerald-500/30 via-transparent to-transparent",
  Hunter: "bg-gradient-radial from-orange-500/30 via-transparent to-transparent",
  Knight: "bg-gradient-radial from-amber-500/30 via-transparent to-transparent",
  Magician: "bg-gradient-radial from-violet-500/30 via-transparent to-transparent",
  MuteElder: "bg-gradient-radial from-teal-500/30 via-transparent to-transparent",
  Dreamweaver: "bg-gradient-radial from-indigo-500/30 via-transparent to-transparent",
};

/**
 * 階段 → 夜間舞台上的角色立繪（`null`＝這階段不顯示立繪，改顯示玩家頭像）。
 *
 * `Record<Phase, …>` 強制補齊：新增階段時 tsc 會逼你決定這裡要顯示什麼。
 *
 * 禁言長老與攝夢人長期是 `null`：這是重構前那支 `switch` 的 `default: return null` 的原始行為
 * （兩個角色從來沒被列進去），不是刻意設計——它們的夜間面板其實跟守衛／魔術師一樣會出現。
 * 另外注意 `NIGHT_WOLF_ACTION`／`SELF_DESTRUCT` 要看**行動者**角色（一般狼顯示狼人立繪）。
 */
export const PHASE_ROLE_PORTRAIT: Record<Phase, (humanRole?: string) => Role | null> = {
  LOBBY: () => null,
  SETUP: () => null,
  NIGHT_START: () => null,
  NIGHT_GUARD_ACTION: () => "Guard",
  NIGHT_MUTE_ACTION: () => "MuteElder",
  NIGHT_DREAM_ACTION: () => "Dreamweaver",
  NIGHT_MAGICIAN_ACTION: () => "Magician",
  NIGHT_WOLF_BEAUTY_ACTION: () => "WolfBeauty",
  NIGHT_WOLF_ACTION: (humanRole) => (humanRole === "WhiteWolfKing" ? "WhiteWolfKing" : "Werewolf"),
  NIGHT_WITCH_ACTION: () => "Witch",
  NIGHT_SEER_ACTION: () => "Seer",
  NIGHT_RESOLVE: () => null,
  DAY_START: () => null,
  DAY_BADGE_SIGNUP: () => null,
  DAY_BADGE_SPEECH: () => null,
  DAY_BADGE_ELECTION: () => null,
  DAY_PK_SPEECH: () => null,
  DAY_SPEECH: () => null,
  DAY_LAST_WORDS: () => null,
  DAY_VOTE: () => null,
  DAY_RESOLVE: () => null,
  BADGE_TRANSFER: () => null,
  HUNTER_SHOOT: () => "Hunter",
  SELF_DESTRUCT: (humanRole) => (humanRole === "WhiteWolfKing" ? "WhiteWolfKing" : "Werewolf"),
  KNIGHT_DUEL: () => "Knight",
  GAME_END: () => null,
};

/** 這個階段（搭配行動者角色）該顯示哪張立繪；沒有就回 `null`。 */
export function phasePortraitRole(phase: Phase, humanRole?: string): Role | null {
  return PHASE_ROLE_PORTRAIT[phase](humanRole);
}
