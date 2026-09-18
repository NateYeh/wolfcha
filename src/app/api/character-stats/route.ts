import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  aggregateCharacterStats,
  parseStatLine,
  serializeStatRecord,
  type CharacterStatRecord,
} from "@/lib/character-stats";

export const dynamic = "force-dynamic";

/**
 * 角色交手统计（熟人局素材）：POST 在游戏结束时逐人追加一行 JSONL；
 * GET 返回按显示名聚合的 {games, wins, mvps}。纯本地文件，不依赖 Supabase。
 */

function statsFilePath(): string {
  const custom = process.env.WOLFCHA_CHARACTER_STATS_FILE;
  return custom && custom.trim()
    ? custom.trim()
    : path.join(process.cwd(), "data", "character-stats.jsonl");
}

async function readRecords(): Promise<CharacterStatRecord[]> {
  try {
    const raw = await fs.readFile(statsFilePath(), "utf-8");
    return raw
      .split("\n")
      .map((line) => parseStatLine(line))
      .filter((rec): rec is CharacterStatRecord => rec !== null);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return []; // 首次使用：文件尚不存在
    console.warn("[wolfcha] character-stats read failed:", error);
    return [];
  }
}

export async function GET() {
  const records = await readRecords();
  return NextResponse.json({ stats: aggregateCharacterStats(records) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    console.warn("[wolfcha] character-stats POST invalid json:", error);
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const payload = body as { gameId?: unknown; records?: unknown };
  if (!Array.isArray(payload.records) || payload.records.length === 0) {
    return NextResponse.json({ error: "records required" }, { status: 400 });
  }

  const gameId = typeof payload.gameId === "string" && payload.gameId.trim()
    ? payload.gameId.trim()
    : undefined;

  // 同一 gameId 只落一次：分析重放/重触发不会重复计入场次。
  const existing = await readRecords();
  if (gameId && existing.some((rec) => rec.gameId === gameId)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const records: CharacterStatRecord[] = [];
  for (const raw of payload.records) {
    const rec = raw as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    if (rec.alignment !== "wolf" && rec.alignment !== "village") continue;
    if (typeof rec.won !== "boolean" || typeof rec.mvp !== "boolean") continue;
    records.push({ gameId, name, alignment: rec.alignment, won: rec.won, mvp: rec.mvp, svp: rec.svp === true });
  }
  if (records.length === 0) {
    return NextResponse.json({ error: "no valid records" }, { status: 400 });
  }

  const file = statsFilePath();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${records.map(serializeStatRecord).join("\n")}\n`, "utf-8");
  } catch (error) {
    console.error("[wolfcha] character-stats write failed:", error);
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, recorded: records.length });
}