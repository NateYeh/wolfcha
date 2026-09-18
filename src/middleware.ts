import { NextRequest, NextResponse } from "next/server";

const LOCALE_COOKIE = "wolfcha.locale";

// 舊版只存 "zh"；升級後映射為 "zh-CN"，其餘值原樣使用。
const normalizeCookieLocale = (value?: string): string | undefined => {
  if (value === "zh") return "zh-CN";
  return value;
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-wolfcha-pathname", pathname);
  const continueWithPathname = () => NextResponse.next({ request: { headers: requestHeaders } });

  // Skip static files, API routes, and paths that already have locale
  if (
    pathname.startsWith("/zh") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return continueWithPathname();
  }

  // Check if user has a saved locale preference (cookie)
  const savedLocale = normalizeCookieLocale(request.cookies.get(LOCALE_COOKIE)?.value);
  if (savedLocale === "zh-CN" || savedLocale === "zh-TW") {
    const url = new URL(pathname === "/" ? `/${savedLocale}` : `/${savedLocale}${pathname}`, request.url);
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url);
  }
  if (savedLocale === "en") {
    // User explicitly chose English, stay on current path
    return continueWithPathname();
  }

  // No saved preference: detect browser language from Accept-Language header
  const acceptLanguage = request.headers.get("accept-language") || "";
  const prefersTraditional = acceptLanguage
    .split(",")
    .some((lang) => lang.trim().toLowerCase().startsWith("zh-tw") || lang.trim().toLowerCase().startsWith("zh-hant"));
  const prefersChinese = prefersTraditional
    || acceptLanguage
      .split(",")
      .some((lang) => lang.trim().toLowerCase().startsWith("zh"));

  if (prefersChinese) {
    const target = prefersTraditional ? "zh-TW" : "zh-CN";
    const url = new URL(pathname === "/" ? `/${target}` : `/${target}${pathname}`, request.url);
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url);
  }

  return continueWithPathname();
}

export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};