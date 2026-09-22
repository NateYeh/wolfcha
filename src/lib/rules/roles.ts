import type { Role } from "@/types/game";

/** 角色陣營：狼人／神職／平民 */
export type RoleCamp = "wolf" | "god" | "villager";

/** 夜間行動型別（none＝夜間無行動） */
export type NightActionKind = "none" | "kill" | "protect" | "inspect" | "potion";

/**
 * 角色能力表（單一真相）。
 *
 * 目的：把散落各處的 `role === "..."` 判斷收斂成查表，未來加角色只需在此補一筆
 * （加上該角色的 prompt／private block），不必掃全專案。
 *
 * 目前寫的是**目標規則**；Phase 1（守衛空守、女巫不可自救）與 Phase 2（自爆泛化）
 * 會由引擎實際讀取，Phase 0 只建立資料表。
 */
export interface RoleCapabilities {
  role: Role;
  camp: RoleCamp;
  nightAction: NightActionKind;
  /** 夜間行動可否選擇不動作（空守／空藥） */
  canAbstain: boolean;
  /** 夜間行動可否指向自己（女巫解藥自救） */
  canSelfTarget: boolean;
  /** 是否可在自己的發言輪自爆 */
  canBoom: boolean;
  /** 自爆時可否帶走一名玩家 */
  boomTakesPlayer: boolean;
  /** 競選發言自爆時是否直接吞警徽（白狼王專屬；普通狼靠雙爆） */
  boomSwallowsBadgeOnElection: boolean;
  /** 白天發言階段可否翻牌決鬥（騎士；一場一次） */
  canDuel: boolean;
}

/** 角色能力表（與 ALL_ROLE_KEYS 同步） */
export const ROLE_CAPABILITIES: Record<Role, RoleCapabilities> = {
  Werewolf: {
    role: "Werewolf",
    camp: "wolf",
    nightAction: "kill",
    canAbstain: false,
    canSelfTarget: false,
    canBoom: true,
    boomTakesPlayer: false,
    boomSwallowsBadgeOnElection: false,
    canDuel: false,
  },
  WhiteWolfKing: {
    role: "WhiteWolfKing",
    camp: "wolf",
    nightAction: "kill",
    canAbstain: false,
    canSelfTarget: false,
    canBoom: true,
    boomTakesPlayer: true,
    boomSwallowsBadgeOnElection: true,
    canDuel: false,
  },
  Seer: {
    role: "Seer",
    camp: "god",
    nightAction: "inspect",
    canAbstain: false,
    canSelfTarget: false,
    canBoom: false,
    boomTakesPlayer: false,
    boomSwallowsBadgeOnElection: false,
    canDuel: false,
  },
  Witch: {
    role: "Witch",
    camp: "god",
    nightAction: "potion",
    canAbstain: true,
    canSelfTarget: false,
    canBoom: false,
    boomTakesPlayer: false,
    boomSwallowsBadgeOnElection: false,
    canDuel: false,
  },
  Hunter: {
    role: "Hunter",
    camp: "god",
    nightAction: "none",
    canAbstain: true,
    canSelfTarget: false,
    canBoom: false,
    boomTakesPlayer: false,
    boomSwallowsBadgeOnElection: false,
    canDuel: false,
  },
  Guard: {
    role: "Guard",
    camp: "god",
    nightAction: "protect",
    canAbstain: true,
    canSelfTarget: false,
    canBoom: false,
    boomTakesPlayer: false,
    boomSwallowsBadgeOnElection: false,
    canDuel: false,
  },
  Idiot: {
    role: "Idiot",
    camp: "god",
    nightAction: "none",
    canAbstain: true,
    canSelfTarget: false,
    canBoom: false,
    boomTakesPlayer: false,
    boomSwallowsBadgeOnElection: false,
    canDuel: false,
  },
  Knight: {
    role: "Knight",
    camp: "god",
    nightAction: "none",
    canAbstain: true,
    canSelfTarget: false,
    canBoom: false,
    boomTakesPlayer: false,
    boomSwallowsBadgeOnElection: false,
    canDuel: true,
  },
  Villager: {
    role: "Villager",
    camp: "villager",
    nightAction: "none",
    canAbstain: true,
    canSelfTarget: false,
    canBoom: false,
    boomTakesPlayer: false,
    boomSwallowsBadgeOnElection: false,
    canDuel: false,
  },
};

/** 取得角色能力（未知角色視為平民，避免舊資料或缺漏角色直接崩潰） */
export function getRoleCapabilities(role: string): RoleCapabilities {
  return ROLE_CAPABILITIES[role as Role] ?? ROLE_CAPABILITIES.Villager;
}

/** 是否為狼陣營角色 */
export function isWolfRole(role: string): boolean {
  return getRoleCapabilities(role).camp === "wolf";
}
