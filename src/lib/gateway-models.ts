/**
 * 解析 OpenAI 相容 `GET /models` 的回應，取出模型 id 清單。
 * 抽成獨立模組（不放在 route.ts）以便單元測試，也讓 route 只能匯出 handler。
 */
export function extractGatewayModelIds(payload: unknown): string[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
        return (item as { id: string }).id;
      }
      return "";
    })
    .map((id) => id.trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}
