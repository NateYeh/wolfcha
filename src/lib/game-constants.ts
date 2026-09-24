/**
 * 游戏常量配置
 * 遵循 DRY 原则，统一管理所有魔法数字和配置项
 */

import {
  PHASE_KIND,
  PHASE_SEQUENCE,
  SPEECH_PHASES as AUTHORITATIVE_SPEECH_PHASES,
  isDayPhase,
  isNightPhase,
} from "@/lib/rules/phases";

/** 游戏基础配置 */
export const GAME_CONFIG = {
  /** 总玩家数 */
  TOTAL_PLAYERS: 10,
  /** 狼人数量 */
  WOLF_COUNT: 3,
  /** 最大重投次数（投票/狼人出刀） */
  MAX_REVOTE_COUNT: 3,
  /** 警长竞选最大重投次数 */
  MAX_BADGE_REVOTE_COUNT: 2,
} as const;

/** 延迟时间配置（毫秒） */
export const DELAY_CONFIG = {
  /** 短延迟 - 状态切换 */
  SHORT: 300,
  /** 中等延迟 - 阶段过渡 */
  MEDIUM: 800,
  /** 长延迟 - 重要事件 */
  LONG: 1200,
  /** 对话显示延迟 */
  DIALOGUE: 900,
  /** 夜晚结算延迟 */
  NIGHT_RESOLVE: 1000,
  NIGHT_PHASE_GAP: 2000,
  NIGHT_ROLE_ANIMATION_MIN: 2000,
  NIGHT_ROLE_ANIMATION_MAX: 4000,
  /** 开局显示桌面延迟 */
  SHOW_TABLE: 2400,
  /** AI 随机延迟范围 */
  AI_MIN: 500,
  AI_MAX: 1200,
} as const;

/**
 * 阶段分类（由 `@/lib/rules/phases` 衍生，不再手写清单）。
 *
 * 原本四份手写阵列各自会漂移：NIGHT_PHASES 漏 NIGHT_MUTE_ACTION／NIGHT_DREAM_ACTION，
 * SPECIAL_PHASES 把 GAME_END 当特殊阶段。目前唯一消费端是 SPEECH_PHASES
 * （useDayPhase 判断「这一阶段要不要发 AI 发言」），其余三份保留给 UI／分析使用。
 */
export const PHASE_CATEGORIES = {
  NIGHT_PHASES: PHASE_SEQUENCE.filter(isNightPhase),
  DAY_PHASES: PHASE_SEQUENCE.filter(isDayPhase),
  SPEECH_PHASES: [...AUTHORITATIVE_SPEECH_PHASES],
  SPECIAL_PHASES: PHASE_SEQUENCE.filter((phase) => PHASE_KIND[phase] === "special"),
};

import { getI18n } from "@/i18n/translator";

/** 获取角色名称（国际化） */
export function getRoleName(role: string): string {
  const { t } = getI18n();
  switch (role) {
    case "Werewolf":
      return t("roles.werewolf");
    case "WhiteWolfKing":
      return t("roles.whiteWolfKing");
    case "Seer":
      return t("roles.seer");
    case "Witch":
      return t("roles.witch");
    case "Hunter":
      return t("roles.hunter");
    case "Guard":
      return t("roles.guard");
    case "Idiot":
      return t("roles.idiot");
    case "Knight":
      return t("roles.knight");
    case "MuteElder":
      return t("roles.muteElder");
    case "Dreamweaver":
      return t("roles.dreamweaver");
    case "WolfKing":
      return t("roles.wolfKing");
    default:
      return t("roles.villager");
  }
}
