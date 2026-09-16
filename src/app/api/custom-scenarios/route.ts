/**
 * 自訂情境 API：自訂情境存在伺服器（.data/），所有瀏覽器共用同一份備選清單。
 */

import { NextResponse } from "next/server";
import {
  deleteServerCustomScenario,
  listServerCustomScenarios,
  saveServerCustomScenario,
} from "@/lib/character-pool-server";

export const dynamic = "force-dynamic";

interface SaveCustomScenarioPayload {
  title: string;
  description: string;
  rolesHint: string;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ scenarios: listServerCustomScenarios() });
  } catch (error) {
    console.warn("[api/custom-scenarios] 讀取自訂情境失敗：", error);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: SaveCustomScenarioPayload;
  try {
    payload = (await request.json()) as SaveCustomScenarioPayload;
  } catch (error) {
    console.warn("[api/custom-scenarios] 無法解析請求內容：", error);
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  if (!isNonEmptyString(payload.title) || !isNonEmptyString(payload.description) || !isNonEmptyString(payload.rolesHint)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const scenario = await saveServerCustomScenario(payload);
    if (!scenario) {
      return NextResponse.json({ error: "save_failed" }, { status: 500 });
    }
    return NextResponse.json({ scenario });
  } catch (error) {
    console.warn("[api/custom-scenarios] 儲存自訂情境失敗：", error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  try {
    await deleteServerCustomScenario(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.warn("[api/custom-scenarios] 刪除自訂情境失敗：", error);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
}