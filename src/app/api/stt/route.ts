import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 本機語音轉文字服務（apps/stt：sherpa-onnx Paraformer + 狼人殺術語校正）。
 * 前端契約維持不變：POST {audio:<base64 wav>, format:"wav"} → {text}。
 */
const DEFAULT_STT_URL = "http://127.0.0.1:31091";

function sttBaseUrl(): string {
  return (process.env.WOLFCHA_STT_URL ?? DEFAULT_STT_URL).replace(/\/+$/, "");
}

/** 探測本機服務；前端據此決定麥克風按鈕要不要開（沒開時行為與修改前一致）。 */
export async function GET() {
  try {
    const resp = await fetch(`${sttBaseUrl()}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) {
      return NextResponse.json({ available: false });
    }
    const health = (await resp.json()) as { model_ready?: boolean };
    return NextResponse.json({ available: health.model_ready !== false });
  } catch (error) {
    console.warn("[stt] 本機 STT 服務探測失敗（尚未啟動？）", error);
    return NextResponse.json({ available: false });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  try {
    const resp = await fetch(`${sttBaseUrl()}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      console.warn(`[stt] 本機 STT 服務回應 ${resp.status}：${detail.slice(0, 200)}`);
      return NextResponse.json(
        { error: detail || `语音识别服务回应 ${resp.status}` },
        { status: resp.status === 503 ? 503 : 502 }
      );
    }
    const data = (await resp.json()) as { text?: string };
    return NextResponse.json({ text: typeof data.text === "string" ? data.text : "" });
  } catch (error) {
    console.warn("[stt] 本機 STT 服務不可用，請確認 apps/stt 是否已啟動", error);
    return NextResponse.json({ error: "语音识别暂时不可用" }, { status: 410 });
  }
}
