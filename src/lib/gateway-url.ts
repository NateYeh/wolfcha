/**
 * 自帶 gateway（OpenAI 相容 /chat/completions）的位址規則。
 *
 * 前後端共用：前端拿來即時提示，伺服器拿來擋掉不該打的位址。
 * 允許：
 * - https 任意主機（自架也可以用 https + 自簽憑證網域）
 * - http 但僅限 localhost / 127.0.0.1 / ::1（本機 Ollama、自架閘道）
 * - http 私有網段（10.x、172.16-31.x、192.168.x、169.254.x）供內網自架使用
 * 其他 http（例如對外 http 站台）一律拒絕，避免把金鑰送到明文通道或
 * 讓伺服器變成任意位址的代理。
 */

// 出廠預設走 Ollama Cloud 的 OpenAI 相容端點（https://ollama.com/v1）：
// 使用者只要填自己的 Ollama API Key 就能開局；要改用自架閘道器或本機 Ollama
// （http://127.0.0.1:11434/v1）再自行覆寫即可。
export const DEFAULT_GATEWAY_BASE_URL = "https://ollama.com/v1";

export type GatewayUrlCheck =
  | { ok: true; url: string }
  | { ok: false; reason: "empty" | "invalid" | "protocol" | "insecure" };

const PRIVATE_IPV4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$/;

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

/** 檢查並正規化 gateway 位址（去尾斜線）。 */
export function normalizeGatewayBaseUrl(raw: string): GatewayUrlCheck {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "protocol" };
  }

  if (parsed.protocol === "http:") {
    const host = parsed.hostname.toLowerCase();
    if (!isLocalHostname(host) && !PRIVATE_IPV4.test(host)) {
      return { ok: false, reason: "insecure" };
    }
  }

  const normalized = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  return { ok: true, url: normalized };
}

/** 取得實際要用的 gateway 位址字串（含路徑）。 */
export function toChatCompletionsUrl(baseUrl: string): string {
  const check = normalizeGatewayBaseUrl(baseUrl);
  if (!check.ok) return "";
  return `${check.url}/chat/completions`;
}
