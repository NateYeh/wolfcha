import type { GameScenario } from "@/types/game";
import { getI18n } from "@/i18n/translator";

/**
 * 內定情境清單。
 * 原本的 20 個日常／職場／懸疑情境已清空，只保留「金庸群俠」。
 * 角色名單固定由開發者維護（見 character-roster.ts），開局不再 AI 生成。
 */
export const SCENARIOS: GameScenario[] = [
  {
    id: "jin_yong",
    title: "金庸群侠",
    description: "金庸武侠群侠同坐一桌——丐帮帮主、魔教圣姑、峨眉掌门、蒙古郡主齐聚，江湖恩怨带进牌局，各怀心思互不相让。",
    rolesHint: "角色都是金庸笔下的江湖人物（名单固定在角色班底里），语气带武侠味但不喊打喊杀，就当一群会武功的现代人在打牌。",
  },
];

const localizeScenario = (scenario: GameScenario): GameScenario => {
  const { t } = getI18n();
  const baseKey = `scenarios.${scenario.id}`;
  return {
    ...scenario,
    title: t(`${baseKey}.title` as Parameters<typeof t>[0]),
    description: t(`${baseKey}.description` as Parameters<typeof t>[0]),
    rolesHint: t(`${baseKey}.rolesHint` as Parameters<typeof t>[0]),
  };
};

export const getScenarios = (): GameScenario[] => {
  return SCENARIOS.map(localizeScenario);
};

export const getRandomScenario = (): GameScenario => {
  const scenarios = getScenarios();
  const index = Math.floor(Math.random() * scenarios.length);
  return scenarios[index];
};