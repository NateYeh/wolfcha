/**
 * 頭像的伺服器端繪製。
 *
 * 原本頭像是向 DiceBear 的公開 API（api.dicebear.com）抓圖：外部依賴、
 * 會被限流，而且種子（有時就是角色名）會傳給第三方。這裡改用同一個
 * DiceBear 核心與 Notionists 風格在自家伺服器產生 SVG，圖形完全一致
 * （已逐一比對 7.0.1 套件與 7.x API 的輸出）。
 *
 * 只依賴純函式（型別用 import type，不會連帶載入 AI/資料庫模組）。
 */

import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";
import type { Options as NotionistsOptions } from "@dicebear/notionists";
import { getAvatarBgColor, getDayEyesForSeed, getHairForSeed } from "./avatar-config";
import type { Gender } from "./character-generator";

/** 各零件的 variant 型別（值域由 DiceBear 定義，這裡統一處理外部字串來源）。 */
type HairVariant = NonNullable<NotionistsOptions["hair"]>[number];
type LipsVariant = NonNullable<NotionistsOptions["lips"]>[number];
type EyesVariant = NonNullable<NotionistsOptions["eyes"]>[number];

export interface AvatarRenderOptions {
  seed: string;
  gender?: Gender;
  /** 指定髮型 variant；未指定時依性別選池再由 seed 決定。 */
  hair?: string;
  lips?: string;
  eyes?: string;
  scale?: number;
  translateY?: number;
  /** 十六進位色碼（不含 #）或 transparent。 */
  backgroundColor?: string;
  /** true = 一定留鬍子（老者、漢子）。 */
  beard?: boolean;
  /** true/false = 一定要／一定不要眼鏡；未指定時依 seed。 */
  glasses?: boolean;
}

const MAX_SCALE = 200;
const MIN_SCALE = 0;

const clampScale = (value: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.floor(value)));

/**
 * 產生頭像 SVG 字串。
 * 同一個 seed＋同一組參數永遠得到同一張圖（DiceBear 以 seed 決定細節）。
 */
export function renderAvatarSvg(options: AvatarRenderOptions): string {
  const {
    seed,
    gender,
    hair,
    lips,
    eyes,
    scale = 100,
    translateY = 0,
    backgroundColor,
    beard = false,
    glasses,
  } = options;

  const resolvedHair = hair ?? (gender ? getHairForSeed(seed, gender) : undefined);
  const resolvedEyes = eyes ?? getDayEyesForSeed(seed);
  const resolvedBackground =
    backgroundColor === "transparent" ? [] : [backgroundColor ?? getAvatarBgColor(seed)];

  return createAvatar(notionists, {
    seed,
    backgroundColor: resolvedBackground,
    scale: clampScale(scale),
    translateY: Math.floor(translateY),
    // 女性角色不長鬍子（未指定 beard 時一律 0，與原本線上 API 設定相同）
    beardProbability: beard ? 100 : 0,
    ...(typeof glasses === "boolean" ? { glassesProbability: glasses ? 100 : 0 } : {}),
    ...(resolvedHair ? { hair: [resolvedHair as HairVariant] } : {}),
    eyes: [resolvedEyes as EyesVariant],
    ...(lips ? { lips: [lips as LipsVariant] } : {}),
  }).toString();
}
