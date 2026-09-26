import { NextResponse } from "next/server";
import type { GameAnalysisData } from "@/types/analysis";
import { resolveRequestOwnerId } from "@/lib/server-auth";
import { listGameRecords, saveGameRecord } from "@/lib/server-game-records";

export const dynamic = "force-dynamic";

/**
 * 遊玩紀錄：清單與寫入。
 *
 * `POST` 由客戶端在**完賽且賽後分析完成後**呼叫，因此列表裡的每一筆都必然已完賽
 * （不是從日誌推論出來的；詳見 `docs/game-records-plan.md`）。
 * `GET` 只回自己的中繼資料，供首頁的清單使用。
 */

interface SaveRecordPayload {
  analysis?: GameAnalysisData;
  difficulty?: string;
}

/** 只擋明顯不是分析結果的東西；完整形狀由客戶端型別與賽後分析負責。 */
function isPlausibleAnalysis(value: unknown): value is GameAnalysisData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameAnalysisData>;
  return (
    typeof candidate.gameId === "string"
    && candidate.gameId.length > 0
    && typeof candidate.result === "string"
    && (candidate.result === "village_win" || candidate.result === "wolf_win")
    && Array.isArray(candidate.players)
    && Array.isArray(candidate.timeline)
    && typeof candidate.playerCount === "number"
  );
}

export async function POST(request: Request) {
  const ownerId = await resolveRequestOwnerId(request);
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: SaveRecordPayload;
  try {
    payload = (await request.json()) as SaveRecordPayload;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!isPlausibleAnalysis(payload.analysis)) {
    return NextResponse.json({ error: "Invalid analysis" }, { status: 400 });
  }

  try {
    const record = await saveGameRecord(ownerId, payload.analysis, {
      difficulty: typeof payload.difficulty === "string" ? payload.difficulty : undefined,
    });
    return NextResponse.json({ success: true, record });
  } catch (error) {
    // 存檔失敗不可靜默：回 500 讓客戶端記 log，紀錄仍在瀏覽器端可重送。
    console.error("[game-records] 寫入紀錄失敗:", error);
    return NextResponse.json({ error: "Failed to save record" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const ownerId = await resolveRequestOwnerId(request);
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const records = await listGameRecords(ownerId);
    return NextResponse.json({ success: true, records });
  } catch (error) {
    console.error("[game-records] 讀取清單失敗:", error);
    return NextResponse.json({ error: "Failed to load records" }, { status: 500 });
  }
}
