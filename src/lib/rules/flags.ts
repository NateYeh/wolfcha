import type { Role } from "@/types/game";

/**
 * 自爆相關規則旗標。
 *
 * 時機（不由旗標控制，寫在階段機）：只有在「當前發言者＝自己」且階段為
 * 競選發言／白天發言／PK 發言時才可自爆。
 */
export interface BoomRuleFlags {
  /** 所有狼陣營角色皆可自爆（true＝普通狼也能自爆，不再限白狼王） */
  anyWolf: boolean;
  /** 自爆時可以帶走一名玩家的角色 */
  takesPlayerRoles: Role[];
  /** 競選階段累計幾次自爆即吞警徽（普通狼需兩次＝雙爆吞警徽） */
  electionBoomSwallowCount: number;
}

/**
 * 全域規則旗標（單一真相）。
 *
 * 版型可用 `Partial<RuleFlags>` 覆寫，未指定者繼承此處預設。
 * 實測對應的目標規則：
 * - 守衛：不能連守、可空守，且空守不寫入 `lastGuardTarget`（可連續多晚空守）。
 * - 女巫：全程不可自救（含首夜）。
 * - 自爆：全狼可自爆；只有白狼王自爆能帶人；白狼王競選自爆直接吞警徽，
 *   普通狼競選自爆需兩次（雙爆）才吞警徽。
 */
export interface RuleFlags {
  /** 守衛可以選擇空守（不守護任何人） */
  guardCanAbstain: boolean;
  /** 守衛不能連續兩晚守護同一名玩家 */
  guardCannotRepeat: boolean;
  /** 女巫可以使用解藥救自己（false＝全程不可自救） */
  witchCanSelfSave: boolean;
  boom: BoomRuleFlags;
}

/** 預設規則旗標 */
export const DEFAULT_RULE_FLAGS: RuleFlags = {
  guardCanAbstain: true,
  guardCannotRepeat: true,
  witchCanSelfSave: false,
  boom: {
    anyWolf: true,
    takesPlayerRoles: ["WhiteWolfKing"],
    electionBoomSwallowCount: 2,
  },
};

/** 版型級覆寫型別：boom 只給要改的欄位即可，其餘繼承 DEFAULT_RULE_FLAGS */
export type RuleFlagsOverride = Omit<Partial<RuleFlags>, "boom"> & {
  boom?: Partial<BoomRuleFlags>;
};

/** 合併版型覆寫與預設旗標（boom 為淺層合併，未給的欄位繼承預設） */
export function mergeRuleFlags(override?: RuleFlagsOverride): RuleFlags {
  if (!override) {
    return { ...DEFAULT_RULE_FLAGS, boom: { ...DEFAULT_RULE_FLAGS.boom } };
  }
  return {
    ...DEFAULT_RULE_FLAGS,
    ...override,
    boom: { ...DEFAULT_RULE_FLAGS.boom, ...(override.boom ?? {}) },
  };
}
