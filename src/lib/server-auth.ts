import { isDemoModeActiveServer } from "@/lib/demo-config-server";
import { isGuestUser } from "@/lib/demo-mode";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * 伺服器端的身分解析（單一真相）。
 *
 * 原本只在 `api/game-sessions` 內部；遊玩紀錄也要用同一套規則，因此抽出來共用——
 * 兩邊各抄一份遲早會漂移（先前的「同一事實不可手抄」就是這個意思）。
 */

/** 本機／自架模式：不驗 Supabase 帳號，直接用瀏覽器上的 guest id 當身分。 */
export function isLocalNoAuthMode(): boolean {
  return (process.env.WOLFCHA_LOCAL_NO_AUTH ?? "").trim() === "1";
}

/** 本機 Demo Mode：不連 Supabase（會話 ID 由本機產生）。 */
export function isLocalDemoMode(): boolean {
  return process.env.WOLFCHA_LOCAL_DEMO_MODE === "1";
}

/** 用 Authorization 標頭（或 body 內的 token）換 Supabase 使用者；沒有 token 或驗不過回 null。 */
export async function authenticateUser(
  request: Request,
  bodyToken?: string,
): Promise<{ id: string } | null> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader ? authHeader.replace("Bearer ", "") : bodyToken;
  if (!token) return null;

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return { id: user.id };
}

/**
 * 解析這個請求代表的身分：Supabase 帳號優先，其次（本機／自架或 Demo Mode）的合法 guest id。
 *
 * 兩者都沒有回 `null`，呼叫端必須回 401——不可靜默當成某個預設使用者。
 */
export async function resolveRequestOwnerId(
  request: Request,
  options: { bodyToken?: string; allowGuest?: boolean } = {},
): Promise<string | null> {
  const user = await authenticateUser(request, options.bodyToken);
  if (user) return user.id;
  if (options.allowGuest === false) return null;

  const guestId = request.headers.get("x-guest-id");
  if (!guestId || !isGuestUser(guestId)) return null;

  const guestAllowed = isLocalNoAuthMode() || isLocalDemoMode() || await isDemoModeActiveServer();
  return guestAllowed ? guestId : null;
}
