import type { Role } from "@/types/game";
import { getBoardRoles } from "./rules/boards";

/**
 * 角色配置查詢（相容層）。
 *
 * 版型真相已統一搬到 `lib/rules/boards.ts`，此處僅保留舊介面避免大規模改動；
 * 新程式碼請直接使用 `@/lib/rules/boards`。
 */

/** 取得指定人數的角色組成（回傳複本） */
export function getRoleConfiguration(playerCount: number): Role[] {
  return getBoardRoles(playerCount);
}
