import { NextRequest, NextResponse } from "next/server";
import { normalizeGatewayBaseUrl } from "@/lib/gateway-url";
import { extractGatewayModelIds } from "@/lib/gateway-models";

/**
 * 抓取自帶 gateway 的模型清單（OpenAI 相容 GET /models）。
 *
 * 用途有二：
 * 1. 連線測試：比用某個模型發 chat 更準 —— 不會因為「探針模型剛好不在該閘道器上」而誤判失敗。
 * 2. 取得閘道器實際提供的模型清單，前端可據此更新模型池（標示哪些模型這台閘道器沒有）。
 *
 * 由伺服器代打（瀏覽器直接打會遇到 CORS，且不該把 Key 送到第三方網域的瀏覽器請求）。
 */

const LIST_TIMEOUT_MS = 15000;

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-tokendance-api-key")?.trim() || "";
  const rawBaseUrl = request.headers.get("x-tokendance-base-url")?.trim() || "";

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "未提供 API Key", errorCode: "missing_key" }, { status: 400 });
  }

  const check = normalizeGatewayBaseUrl(rawBaseUrl);
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, error: "无效的服务器地址", errorCode: "invalid_base_url" },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  try {
    const response = await fetch(`${check.url}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        return NextResponse.json(
          { ok: false, error: "API Key 无效或已过期", errorCode: "invalid_key" },
          { status: 200 },
        );
      }
      if (response.status === 404) {
        return NextResponse.json(
          { ok: false, error: "该网关没有 /models 接口，无法读取模型清单", errorCode: "no_models_endpoint" },
          { status: 200 },
        );
      }
      return NextResponse.json(
        { ok: false, error: `读取模型清单失败: ${response.status}${text ? ` - ${text.slice(0, 160)}` : ""}`, errorCode: "upstream_error" },
        { status: 200 },
      );
    }

    const payload = await response.json().catch(() => null);
    const models = extractGatewayModelIds(payload);
    if (models.length === 0) {
      return NextResponse.json(
        { ok: false, error: "网关回传的模型清单是空的", errorCode: "empty_model_list" },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, models, count: models.length });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ ok: false, error: "读取模型清单超时", errorCode: "timeout" }, { status: 200 });
    }
    console.error("[gateway-models] 读取模型清单失败", error);
    return NextResponse.json(
      { ok: false, error: `网络错误: ${String(error)}`, errorCode: "network_error" },
      { status: 200 },
    );
  }
}
