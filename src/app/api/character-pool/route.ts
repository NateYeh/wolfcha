/**
 * 角色池 API：所有瀏覽器共用伺服器端（.data/）的同一份池。
 *
 * - GET：讀取整個池（客户端自行計算狀態與顯示）。
 * - POST：依 `action` 執行抽用／補充寫入／綁定情境重建／切換固定班／清空。
 */

import { NextResponse } from "next/server";
import type { GeneratedCharacter } from "@/lib/character-generator";
import {
  appendServerPool,
  clearServerPool,
  isServerPoolLocked,
  isValidGameScenario,
  readServerPool,
  setServerPoolLock,
  setServerPoolScenario,
  takeServerPool,
} from "@/lib/character-pool-server";
import type { GameScenario } from "@/types/game";

export const dynamic = "force-dynamic";

type PoolActionPayload =
  | { action: "take"; count: number }
  | { action: "append"; scenario: GameScenario; characters: GeneratedCharacter[] }
  | { action: "set-scenario"; scenario: GameScenario }
  | { action: "set-lock"; locked: boolean }
  | { action: "clear" };

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ pool: readServerPool() });
  } catch (error) {
    console.warn("[api/character-pool] 讀取角色池失敗：", error);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: PoolActionPayload;
  try {
    payload = (await request.json()) as PoolActionPayload;
  } catch (error) {
    console.warn("[api/character-pool] 無法解析請求內容：", error);
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    switch (payload.action) {
      case "take": {
        const count = Number(payload.count);
        if (!Number.isInteger(count) || count <= 0) {
          return NextResponse.json({ error: "invalid_count" }, { status: 400 });
        }
        const pooled = await takeServerPool(count);
        return NextResponse.json({ pooled });
      }
      case "append": {
        if (!isValidGameScenario(payload.scenario) || !Array.isArray(payload.characters)) {
          return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
        }
        // 固定班底：由伺服器守門，老舊客戶端也不得寫入生成的角色。
        if (isServerPoolLocked()) {
          return NextResponse.json({ error: "pool_locked" }, { status: 409 });
        }
        const pool = await appendServerPool(payload.scenario, payload.characters);
        return NextResponse.json({ pool });
      }
      case "set-scenario": {
        if (!isValidGameScenario(payload.scenario)) {
          return NextResponse.json({ error: "invalid_scenario" }, { status: 400 });
        }
        const pool = await setServerPoolScenario(payload.scenario);
        return NextResponse.json({ pool });
      }
      case "set-lock": {
        if (typeof payload.locked !== "boolean") {
          return NextResponse.json({ error: "invalid_locked" }, { status: 400 });
        }
        const ok = await setServerPoolLock(payload.locked);
        if (!ok) return NextResponse.json({ error: "no_pool" }, { status: 409 });
        return NextResponse.json({ pool: readServerPool() });
      }
      case "clear": {
        await clearServerPool();
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "unknown_action" }, { status: 400 });
    }
  } catch (error) {
    console.warn("[api/character-pool] 寫入角色池失敗：", error);
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }
}