import type { Role } from "@/types/game";

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
