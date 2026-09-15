import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * [LOCAL DEV PATCH] 把前端 AI 呼叫紀錄追加到本機日誌檔（JSON Lines，一行一筆）。
 *
 * 前端 localStorage 的紀錄每次頁面載入都會被清空，跨重整就沒了；這個端點讓
 * 紀錄落地成檔案，方便事後追查整局的 prompt / 回應 / 耗時。
 *
 * 檔案路徑由 WOLFCHA_AI_LOG_FILE 指定，未設定時直接忽略（不做任何事）。
 * 僅在非 production 生效。
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const configured = (process.env.WOLFCHA_AI_LOG_FILE ?? "").trim();
  if (configured === "") {
    console.warn("[dev-ai-logs] WOLFCHA_AI_LOG_FILE 未設定，已忽略本次紀錄");
    return NextResponse.json({ ok: false, reason: "WOLFCHA_AI_LOG_FILE is not set" });
  }

  let entry: unknown;
  try {
    entry = await request.json();
  } catch (error) {
    console.error("[dev-ai-logs] 無法解析 payload:", error);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const file = path.resolve(configured);
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error(`[dev-ai-logs] 寫入日誌檔失敗（${file}）:`, error);
    return NextResponse.json({ error: "Failed to append AI log" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
