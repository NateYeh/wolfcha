import { NextResponse } from "next/server";
import { isValidRecordId } from "@/lib/game-records";
import { resolveRequestOwnerId } from "@/lib/server-auth";
import { loadGameRecord } from "@/lib/server-game-records";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** 單局完整紀錄（供詳情頁直接餵給 `PostGameAnalysisPage`）。 */
export async function GET(request: Request, context: RouteContext) {
  const ownerId = await resolveRequestOwnerId(request);
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isValidRecordId(id)) {
    return NextResponse.json({ error: "Invalid record id" }, { status: 400 });
  }

  try {
    const record = await loadGameRecord(ownerId, id);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, record });
  } catch (error) {
    console.error(`[game-records] 讀取紀錄失敗（${id}）:`, error);
    return NextResponse.json({ error: "Failed to load record" }, { status: 500 });
  }
}
