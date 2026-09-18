import { STORAGE_KEY, defaultLocale, normalizeLocale, type AppLocale } from "./config";

let currentLocale: AppLocale = defaultLocale;
const listeners = new Set<(locale: AppLocale) => void>();

// 中文語系各帶 URL 前綴；英文不帶前綴。舊的 "/zh" 保留相容，讀取時視為 zh-CN。
const LOCALE_PREFIXES: Record<Exclude<AppLocale, "en">, string> = {
  "zh-CN": "/zh-CN",
  "zh-TW": "/zh-TW",
};

const readLocaleFromStorage = (): AppLocale | null => {
  if (typeof window === "undefined") return null;
  try {
    return normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Ignore storage errors
  }
  return null;
};

const readLocaleFromCookie = (): AppLocale | null => {
  if (typeof document === "undefined") return null;
  try {
    const parts = document.cookie.split(";");
    for (const part of parts) {
      const [keyRaw, valueRaw] = part.split("=");
      const key = keyRaw?.trim();
      if (key !== STORAGE_KEY) continue;
      return normalizeLocale(valueRaw?.trim());
    }
  } catch {
    // Ignore cookie errors
  }
  return null;
};

const stripLocalePrefix = (pathname: string) => {
  return pathname.replace(/^\/zh(?:-CN|-TW)?(\/|$)/, "/");
};

const applyLocaleToPathname = (pathname: string, locale: AppLocale) => {
  const normalized = stripLocalePrefix(pathname) || "/";
  if (locale === "en") return normalized;
  const prefix = LOCALE_PREFIXES[locale];
  return normalized === "/" ? prefix : `${prefix}${normalized}`;
};

const getLocaleFromPathname = (pathname: string): AppLocale | null => {
  if (/^\/zh-TW(\/|$)/.test(pathname)) return "zh-TW";
  if (/^\/zh(?:-CN)?(\/|$)/.test(pathname)) return "zh-CN";
  return null;
};

const resolvePreferredLocale = (fallback: AppLocale = currentLocale): AppLocale => {
  if (typeof window !== "undefined") {
    try {
      const urlLocale = getLocaleFromPathname(window.location.pathname);
      if (urlLocale) return urlLocale;
    } catch {
      // Ignore URL errors
    }
  }

  const stored = readLocaleFromStorage();
  if (stored) return stored;

  const cookie = readLocaleFromCookie();
  if (cookie) return cookie;

  return fallback;
};

export const getLocale = (): AppLocale => {
  if (typeof window !== "undefined") {
    try {
      const preferred = resolvePreferredLocale();
      if (preferred !== currentLocale) currentLocale = preferred;
    } catch {
      // Ignore URL errors
    }
  }
  return currentLocale;
};

export const setLocale = (locale: AppLocale): void => {
  if (locale === currentLocale) return;
  currentLocale = locale;
  listeners.forEach((listener) => listener(locale));
  if (typeof window !== "undefined") {
    try {
      const url = new URL(window.location.href);
      const nextPath = applyLocaleToPathname(url.pathname, locale);
      if (nextPath !== url.pathname) {
        url.pathname = nextPath;
        window.history.pushState({}, "", url.toString());
      }
    } catch {
      // Ignore URL errors
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Ignore storage errors
    }
    // Set cookie for middleware to read on next request
    try {
      document.cookie = `${STORAGE_KEY}=${locale};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      // Ignore cookie errors
    }
  }
};

export const subscribeLocale = (listener: (locale: AppLocale) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const loadLocaleFromStorage = (fallback: AppLocale = currentLocale): AppLocale => {
  if (typeof window === "undefined") {
    currentLocale = fallback;
    return currentLocale;
  }
  try {
    const preferred = resolvePreferredLocale(fallback);
    currentLocale = preferred;
  } catch {
    // Ignore storage errors
  }
  return currentLocale;
};