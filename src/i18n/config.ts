export const STORAGE_KEY = "wolfcha.locale";

export const supportedLocales = ["zh-CN", "zh-TW", "en"] as const;
export type AppLocale = (typeof supportedLocales)[number];

export const defaultLocale: AppLocale = "en";

export const localeLabels: Record<AppLocale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
};

export const localeToHtmlLang: Record<AppLocale, string> = {
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  en: "en",
};

// 舊版語系值相容：早期只有單一 "zh"（簡中內容），升級後一律映射為 "zh-CN"。
export const normalizeLocale = (value?: string | null): AppLocale | null => {
  if (value === "zh") return "zh-CN";
  return isSupportedLocale(value) ? value : null;
};

export const isSupportedLocale = (value?: string | null): value is AppLocale => {
  return supportedLocales.includes(value as AppLocale);
};

// 兩個中文語系共用中文行為分支（語音、硬編碼中文文案等），英文以外皆視為中文。
export const isChineseLocale = (locale: AppLocale): locale is "zh-CN" | "zh-TW" => {
  return locale !== "en";
};