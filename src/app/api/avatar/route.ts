/**
 * 頭像 API：在自家伺服器產生 DiceBear Notionists 的 SVG。
 *
 * 由 src/lib/avatar-config.ts 的 buildAvatarUrl() 產生網址，用法與原本的
 * https://api.dicebear.com/7.x/notionists/svg 相同；回傳內容已設定長快取，
 * 瀏覽器同一張圖只抓一次，之後不再打伺服器。
 */

import { NextResponse } from "next/server";
import { renderAvatarSvg } from "@/lib/avatar-render";
import type { Gender } from "@/lib/character-generator";

/** 一年；圖由 seed 決定且不會變，可安全長快取。 */
const CACHE_HEADER = "public, max-age=31536000, immutable";

const SVG_HEADERS = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  "Cache-Control": CACHE_HEADER,
} as const;

const normalizeGender = (value: string | null): Gender | undefined => {
  if (value === "male" || value === "female" || value === "nonbinary") return value;
  return undefined;
};

const normalizeNumber = (value: string | null, fallback: number): number => {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeText = (value: string | null): string | undefined => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
};

/** 機率參數（0~100）：未帶參數回 undefined，0 為明確關閉，>0 為開啟。 */
const normalizeProbability = (value: string | null): boolean | undefined => {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed > 0;
};

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const seed = normalizeText(params.get("seed")) ?? "wolfcha";
  const hair = normalizeText(params.get("hair"));
  const lips = normalizeText(params.get("lips"));
  const eyes = normalizeText(params.get("eyes"));
  const backgroundColorParam = params.get("backgroundColor");
  const backgroundColor =
    backgroundColorParam === "transparent"
      ? "transparent"
      : normalizeText(backgroundColorParam);

  try {
    const svg = renderAvatarSvg({
      seed,
      gender: normalizeGender(params.get("gender")),
      hair,
      lips,
      eyes,
      beard: normalizeProbability(params.get("beardProbability")) === true,
      glasses: normalizeProbability(params.get("glassesProbability")),
      scale: normalizeNumber(params.get("scale"), 100),
      translateY: normalizeNumber(params.get("translateY"), 0),
      backgroundColor,
    });
    return new NextResponse(svg, { status: 200, headers: SVG_HEADERS });
  } catch (error) {
    // 產生失敗不得靜默：記 log 並回傳中性佔位圖，且不快取（下次重試）。
    console.warn("[api/avatar] 產生頭像失敗：", error);
    const placeholder = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect width="100" height="100" fill="#e8e4d4"/><circle cx="50" cy="40" r="18" fill="#b9b2a0"/><ellipse cx="50" cy="82" rx="26" ry="20" fill="#b9b2a0"/></svg>`;
    return new NextResponse(placeholder, {
      status: 500,
      headers: { ...SVG_HEADERS, "Cache-Control": "no-store" },
    });
  }
}
