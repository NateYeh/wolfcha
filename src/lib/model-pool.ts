import { ALL_MODELS, PROJECT_MODELS, type ModelRef } from "@/types/game";

/**
 * 模型池的來源解析。
 *
 * 內建清單（MODEL_IDS / PLAYER_MODELS）只在「還沒有自帶閘道器清單」時使用；
 * 一旦抓過閘道器的 `GET /models`，那份清單就是唯一真相——閘道器之後新增模型
 * 不需要再改程式碼。
 *
 * 內建清單仍然重要：它提供每個模型的 provider、temperature、reasoning 等參數；
 * 閘道器上「未內建」的模型走自帶閘道器通道（provider = tokendance）並使用預設參數。
 */

/** 自帶 gateway（OpenAI 相容）一律走 route.ts 的 tokendance 通道。 */
export const GATEWAY_PROVIDER = "tokendance" as const;

const KNOWN_REFS: ModelRef[] = [...ALL_MODELS, ...PROJECT_MODELS];

const keyOf = (ref: ModelRef): string => `${ref.provider}:${ref.model}`;

function dedupe(refs: ModelRef[]): ModelRef[] {
  const seen = new Set<string>();
  const out: ModelRef[] = [];
  for (const ref of refs) {
    const key = keyOf(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/** 把模型 id 轉成 ModelRef：內建的帶參數，未內建但在自帶閘道器清單裡的走閘道器通道。 */
export function toModelRef(model: string, gatewayModels: string[] = []): ModelRef {
  const known = KNOWN_REFS.find((ref) => ref.model === model);
  if (known) return known;
  if (gatewayModels.includes(model)) return { provider: GATEWAY_PROVIDER, model };
  // 既非內建、也不在閘道器清單：維持舊行為（zenmux），由呼叫方決定要不要擋。
  return { provider: "zenmux", model };
}

/** 這個模型是否有內建參數（temperature / reasoning 等）。 */
export function hasBuiltInParams(model: string): boolean {
  return KNOWN_REFS.some((ref) => ref.model === model);
}

/**
 * 決定「這一輪可用的模型池」。
 * - 有閘道器清單 → 用它（清單裡沒有的模型就不該再被抽到）
 * - 沒有 → 用內建池
 */
export function resolveAvailableModelRefs(gatewayModels: string[], builtinPool: ModelRef[]): ModelRef[] {
  if (gatewayModels.length === 0) return builtinPool;
  return dedupe(gatewayModels.map((model) => toModelRef(model, gatewayModels)));
}

/** 在既有池子上併入閘道器清單（自訂 key 模式用：內建模型 + 閘道器模型）。 */
export function withGatewayModels(base: ModelRef[], gatewayModels: string[]): ModelRef[] {
  if (gatewayModels.length === 0) return base;
  return dedupe([...base, ...gatewayModels.map((model) => toModelRef(model, gatewayModels))]);
}
