import { access, appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * [LOCAL DEV PATCH] 把前端 AI 呼叫紀錄追加到本機日誌檔（JSON Lines，一行一筆）。
 *
 * 前端 localStorage 的紀錄每次頁面載入都會被清空，跨重整就沒了；這個端點讓
 * 紀錄落地成檔案，方便事後追查整局的 prompt / 回應 / 耗時。
 *
 * 一局一個檔案（檔名 wolfcha-<YYYYMMDD-HHmmss>-<session 前 6 碼>.log），
 * 只保留最新 WOLFCHA_AI_LOG_KEEP 局，其餘依檔名順序（即時間順序）刪除。
 *
 * 目錄由 WOLFCHA_AI_LOG_DIR 指定，未設定時直接忽略（不做任何事）。
 * 僅在非 production 生效。
 */

const LOG_FILE_PATTERN = /^wolfcha-\d{8}-\d{6}-[a-zA-Z0-9]{1,6}\.log$/;
const DEFAULT_KEEP = 7;

function resolveLogDir(): string | null {
  const configured = (process.env.WOLFCHA_AI_LOG_DIR ?? "").trim();
  return configured === "" ? null : path.resolve(configured);
}

function resolveKeep(): number {
  const parsed = Number.parseInt(process.env.WOLFCHA_AI_LOG_KEEP ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_KEEP;
}

/** 依檔名（等同時間順序）保留最新 keep 個檔案，其餘刪除。 */
async function pruneOldLogs(dir: string, keep: number): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => LOG_FILE_PATTERN.test(name)).sort();
  } catch (error) {
    console.error(`[dev-ai-logs] 讀取日誌目錄失敗（${dir}）:`, error);
    return;
  }

  const excess = names.slice(0, Math.max(0, names.length - keep));
  for (const name of excess) {
    try {
      await unlink(path.join(dir, name));
      console.info(`[dev-ai-logs] 已輪替刪除舊紀錄: ${name}`);
    } catch (error) {
      console.error(`[dev-ai-logs] 刪除舊紀錄失敗（${name}）:`, error);
    }
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const dir = resolveLogDir();
  if (!dir) {
    console.warn("[dev-ai-logs] WOLFCHA_AI_LOG_DIR 未設定，已忽略本次紀錄");
    return NextResponse.json({ ok: false, reason: "WOLFCHA_AI_LOG_DIR is not set" });
  }

  let payload: { file?: unknown; entry?: unknown };
  try {
    payload = (await request.json()) as { file?: unknown; entry?: unknown };
  } catch (error) {
    console.error("[dev-ai-logs] 無法解析 payload:", error);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const fileName = typeof payload.file === "string" ? payload.file : "";
  if (!LOG_FILE_PATTERN.test(fileName)) {
    console.error(`[dev-ai-logs] 檔名不合法，已拒絕: ${fileName}`);
    return NextResponse.json({ error: "Invalid log file name" }, { status: 400 });
  }
  if (payload.entry === undefined || payload.entry === null) {
    return NextResponse.json({ error: "Missing entry" }, { status: 400 });
  }

  const filePath = path.join(dir, fileName);
  try {
    await mkdir(dir, { recursive: true });
    const isNewFile = await access(filePath).then(() => false, () => true);
    await appendFile(filePath, `${JSON.stringify(payload.entry)}\n`, "utf8");
    if (isNewFile) {
      await pruneOldLogs(dir, resolveKeep());
    }
  } catch (error) {
    console.error(`[dev-ai-logs] 寫入日誌檔失敗（${filePath}）:`, error);
    return NextResponse.json({ error: "Failed to append AI log" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
