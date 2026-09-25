import assert from "node:assert/strict";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ALL_ROLE_KEYS } from "@/lib/rules/boards";
import { ROLES_REUSING_PORTRAIT, ROLE_ICONS, ROLE_PORTRAIT_MAP } from "@/lib/rules/role-art";

/**
 * 角色立繪的守門測試。
 *
 * 以前 `Villager` 指向不存在的 `villager.png`：圖 404 不會有任何錯誤訊息，只是那個角色
 * 安靜地沒有立繪；另外這份對應同時手抄在對話框與賽後分析兩處，漏改只會讓兩邊顯示不同的圖。
 * 這裡用檔案系統與清單做結構檢查，取代「靠人記得改」。
 */

const PUBLIC_DIR = path.join(process.cwd(), "public");

test("每個角色都有立繪，而且檔案真的存在（圖 404 不會有任何提示）", () => {
  const missing: string[] = [];
  for (const role of ALL_ROLE_KEYS) {
    const src = ROLE_PORTRAIT_MAP[role];
    assert.ok(src, `${role} 沒有對應立繪`);
    const file = path.join(PUBLIC_DIR, src.replace(/^\//, ""));
    if (!fs.existsSync(file)) missing.push(`${role} → ${src}`);
  }
  assert.deepEqual(missing, [], `以下立繪檔案不存在：${missing.join(", ")}`);
});

test("對話框與賽後分析共用同一份對應（以前是手抄兩份）", () => {
  assert.equal(ROLE_ICONS, ROLE_PORTRAIT_MAP, "ROLE_ICONS 必須就是 ROLE_PORTRAIT_MAP");
});

test("沿用他人立繪的角色必須逐一列出（新增角色忘記附圖會被點出來）", () => {
  const byFile = new Map<string, string[]>();
  for (const role of ALL_ROLE_KEYS) {
    const list = byFile.get(ROLE_PORTRAIT_MAP[role]) ?? [];
    list.push(role);
    byFile.set(ROLE_PORTRAIT_MAP[role], list);
  }
  const reusing = [...byFile.values()]
    .filter((roles) => roles.length > 1)
    .flatMap((roles) => roles.slice(1))
    .sort();
  assert.deepEqual(
    reusing,
    [...ROLES_REUSING_PORTRAIT].sort(),
    "有角色在沿用別人的立繪，但不在 ROLES_REUSING_PORTRAIT 清單裡（或反過來：清單已過期）"
  );
});

/**
 * 立繪的**像素**檢查。
 *
 * 這條是補上真正漏掉的洞：先前只檢查「檔案存在」，所以一張**墨色是黑**的立繪可以完全通過——
 * 而遊戲 UI 是暗色底，黑墨等於看不到（實測：禁言長老與騎士兩張就是這樣，看起來像「圖沒載入」）。
 * 這裡自己解 PNG（不新增相依套件）：支援 8-bit 索引色（type 3）與 8-bit RGBA（type 6），
 * 兩者都是本目錄實際在用的格式；遇到其他格式一律列為問題，不靜默跳過。
 */
interface InkStats {
  inkRatio: number;
  /** 不透明像素中「亮墨」（亮度 ≥200）的佔比——這是真正能分辨壞圖的指標。 */
  brightInkRatio: number;
  inkHeightRatio: number;
  cornerAlphaMax: number;
}

function decodePngInk(file: string): InkStats {
  const buf = fs.readFileSync(file);
  let pos = 8; // 跳過 PNG 簽章
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = 0;
  let interlace = 0;
  let palette: number[][] | null = null;
  let trns: number[] = [];
  const idat: Buffer[] = [];

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = [];
      for (let i = 0; i + 2 < data.length; i += 3) palette.push([data[i], data[i + 1], data[i + 2]]);
    } else if (type === "tRNS") {
      trns = [...data];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }

  const fail = (reason: string): never => {
    throw new Error(`${path.basename(file)}：${reason}`);
  };
  if (bitDepth !== 8 || interlace !== 0) fail(`只支援 8-bit 非交錯 PNG（實際 depth=${bitDepth} interlace=${interlace}）`);
  if (colorType !== 6 && colorType !== 3) fail(`只支援 colorType 6（RGBA）或 3（索引色），實際 ${colorType}`);
  if (colorType === 3 && !palette) fail("索引色 PNG 缺少 PLTE");

  const bpp = colorType === 6 ? 4 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? out[y * stride + x - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
      const value = line[x];
      const restored =
        filter === 0 ? value
        : filter === 1 ? value + left
        : filter === 2 ? value + up
        : filter === 3 ? value + Math.floor((left + up) / 2)
        : filter === 4 ? value + paeth(left, up, upLeft)
        : fail(`未知的 PNG 濾鏡 ${filter}`);
      out[y * stride + x] = restored & 0xff;
    }
  }

  const pixels: { r: number; g: number; b: number; a: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * stride + x * bpp;
      if (colorType === 6) {
        pixels.push({ r: out[o], g: out[o + 1], b: out[o + 2], a: out[o + 3] });
      } else {
        const idx = out[o];
        const [r, g, b] = palette![idx] ?? fail(`調色盤索引 ${idx} 超出範圍`);
        pixels.push({ r, g, b, a: trns[idx] ?? 255 });
      }
    }
  }

  const ink = pixels.filter((px) => px.a > 128);
  if (ink.length === 0) fail("整張圖沒有任何不透明像素（墨跡）");
  const brightInk = ink.filter((px) => (px.r + px.g + px.b) / 3 >= 200);
  const inkRows = new Set<number>();
  let cornerAlphaMax = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = pixels[y * width + x];
      if (px.a > 128) inkRows.add(y);
      const nearCorner = (x < 8 || x >= width - 8) && (y < 8 || y >= height - 8);
      if (nearCorner) cornerAlphaMax = Math.max(cornerAlphaMax, px.a);
    }
  }
  return {
    inkRatio: ink.length / pixels.length,
    brightInkRatio: brightInk.length / ink.length,
    inkHeightRatio: inkRows.size / height,
    cornerAlphaMax,
  };
}

test("每張立繪都是「亮色墨線 × 透明底」（黑墨在暗色 UI 上等於看不到）", () => {
  const files = [...new Set(ALL_ROLE_KEYS.map((role) => ROLE_PORTRAIT_MAP[role]))].sort();
  const problems: string[] = [];
  for (const src of files) {
    const file = path.join(PUBLIC_DIR, src.replace(/^\//, ""));
    let stats: InkStats;
    try {
      stats = decodePngInk(file);
    } catch (error) {
      problems.push(`${src}：無法解析（${String(error)}）`);
      continue;
    }
    const notes: string[] = [];
    if (stats.inkRatio < 0.05) notes.push(`墨跡太少（${(stats.inkRatio * 100).toFixed(1)}% < 5%）`);
    if (stats.brightInkRatio < 0.2) notes.push(`幾乎沒有亮墨（亮墨佔比 ${(stats.brightInkRatio * 100).toFixed(1)}% < 20%）：遊戲是暗色底，整張黑墨等於看不到`);
    if (stats.inkHeightRatio < 0.5) notes.push(`墨跡高度只佔 ${(stats.inkHeightRatio * 100).toFixed(0)}%，疑似裁切錯誤`);
    if (stats.cornerAlphaMax > 64) notes.push(`四角不是透明的（最大 alpha ${stats.cornerAlphaMax}），疑似整張不透明底`);
    if (notes.length) problems.push(`${src}：${notes.join("；")}`);
  }
  assert.deepEqual(problems, [], `立繪像素檢查未通過：\n${problems.join("\n")}`);
});

