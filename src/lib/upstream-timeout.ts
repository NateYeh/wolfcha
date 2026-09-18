/**
 * 上游模型逾時的通訊協定（route 與前端共用）。
 *
 * 背景：/api/chat 每次嘗試最多等 API_TIMEOUT_MS，逾時就中止上游請求。
 * 過去這種情況只回一句 Chrome 的 "This operation was aborted"，前端把它當成
 * 可重試的 500，於是同一筆呼叫連等 4 輪（約 4 分鐘）才失敗，整桌卡住。
 * 現在 route 明確標示逾時（504 + 標頭），前端據此不再重試。
 */

/** route 逾時回應帶的標頭；存在即代表「已等滿上游逾時」，重試沒有意義。 */
export const UPSTREAM_TIMEOUT_HEADER = "x-upstream-timeout-ms";

/** route 逾時回應 body 的錯誤碼。 */
export const UPSTREAM_TIMEOUT_CODE = "upstream_timeout";
