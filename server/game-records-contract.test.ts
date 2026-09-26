import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { GameAnalysisData } from "@/types/analysis";

// supabase-admin 在 module scope 就建立 client，測試只需要能載入（本檔不會真的呼叫它）。
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

/**
 * 遊玩紀錄的 API 契約：寫入 → 清單 → 詳情，以及身分隔離。
 *
 * 用暫存目錄當 `WOLFCHA_GAME_RECORD_DIR`，不碰真實資料；身分走 guest id
 * （`WOLFCHA_LOCAL_NO_AUTH=1`，與自架部署一致，也避免測試去連 Supabase）。
 */

function buildAnalysis(gameId: string): GameAnalysisData {
  return {
    gameId,
    timestamp: 1_700_000_000_000,
    duration: 600,
    playerCount: 9,
    result: "village_win",
    awards: { mvp: [], svp: [] },
    timeline: [{ day: 1, summary: "", nightEvents: [], dayEvents: [] }],
    players: [
      {
        playerId: "p1",
        seat: 2,
        name: "我",
        avatar: "",
        role: "Seer",
        alignment: "village",
        isAlive: true,
        isHumanPlayer: true,
      },
    ],
    roundStates: [{ day: 1, phase: "night", aliveCount: { village: 5, wolf: 3 }, players: [] }],
    personalStats: {
      role: "Seer",
      userName: "我",
      avatar: "",
      alignment: "village",
      tags: [],
      radarStats: { logic: 1, speech: 1, survival: 1, skillOrHide: 1, voteOrTicket: 1 },
      highlightQuote: "",
      totalScore: 0,
    },
    reviews: [],
  };
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/game-records", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function getRequest(headers: Record<string, string> = {}, url = "http://localhost/api/game-records"): Request {
  return new Request(url, { method: "GET", headers });
}

async function withTempRecordDir(run: (dir: string) => Promise<void>): Promise<void> {
  const previous = {
    dir: process.env.WOLFCHA_GAME_RECORD_DIR,
    keep: process.env.WOLFCHA_GAME_RECORD_KEEP,
    noAuth: process.env.WOLFCHA_LOCAL_NO_AUTH,
  };
  const dir = await mkdtemp(path.join(tmpdir(), "wolfcha-records-"));
  process.env.WOLFCHA_GAME_RECORD_DIR = dir;
  process.env.WOLFCHA_LOCAL_NO_AUTH = "1";
  delete process.env.WOLFCHA_GAME_RECORD_KEEP;

  try {
    await run(dir);
  } finally {
    if (previous.dir === undefined) delete process.env.WOLFCHA_GAME_RECORD_DIR;
    else process.env.WOLFCHA_GAME_RECORD_DIR = previous.dir;
    if (previous.keep === undefined) delete process.env.WOLFCHA_GAME_RECORD_KEEP;
    else process.env.WOLFCHA_GAME_RECORD_KEEP = previous.keep;
    if (previous.noAuth === undefined) delete process.env.WOLFCHA_LOCAL_NO_AUTH;
    else process.env.WOLFCHA_LOCAL_NO_AUTH = previous.noAuth;
    await rm(dir, { recursive: true, force: true });
  }
}

const OWNER = { "x-guest-id": "guest_owner" };
const OTHER = { "x-guest-id": "guest_other" };

test("寫入後清單看得到，詳情能取回完整分析", async () => {
  await withTempRecordDir(async (dir) => {
    const { POST, GET } = await import("@/app/api/game-records/route");
    const detailRoute = await import("@/app/api/game-records/[id]/route");

    const saved = await POST(jsonRequest({ analysis: buildAnalysis("game-a"), difficulty: "normal" }, OWNER));
    assert.equal(saved.status, 200);

    const listResponse = await GET(getRequest(OWNER));
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json() as { records: Array<{ id: string; difficulty: string; humanRole: string }> };
    assert.equal(list.records.length, 1);
    assert.equal(list.records[0].id, "game-a");
    assert.equal(list.records[0].difficulty, "normal");
    assert.equal(list.records[0].humanRole, "Seer");

    const detailResponse = await detailRoute.GET(getRequest(OWNER), { params: Promise.resolve({ id: "game-a" }) });
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as { record: { analysis: GameAnalysisData } };
    assert.equal(detail.record.analysis.gameId, "game-a");
    assert.equal(detail.record.analysis.players[0].role, "Seer");

    // 一個身分一個目錄，且目錄名不是原始 id（不把使用者輸入當路徑）。
    const dirs = await readdir(dir);
    assert.equal(dirs.length, 1);
    assert.notEqual(dirs[0], "guest_owner");
  });
});

test("沒有身分一律 401，不靜默當成預設使用者", async () => {
  await withTempRecordDir(async () => {
    const { POST, GET } = await import("@/app/api/game-records/route");
    const detailRoute = await import("@/app/api/game-records/[id]/route");

    assert.equal((await POST(jsonRequest({ analysis: buildAnalysis("game-a") }))).status, 401);
    assert.equal((await GET(getRequest())).status, 401);
    assert.equal(
      (await detailRoute.GET(getRequest(), { params: Promise.resolve({ id: "game-a" }) })).status,
      401,
    );
  });
});

test("別的身分看不到、也讀不到別人的局", async () => {
  await withTempRecordDir(async () => {
    const { POST, GET } = await import("@/app/api/game-records/route");
    const detailRoute = await import("@/app/api/game-records/[id]/route");

    await POST(jsonRequest({ analysis: buildAnalysis("game-a") }, OWNER));

    const otherList = await (await GET(getRequest(OTHER))).json() as { records: unknown[] };
    assert.equal(otherList.records.length, 0);

    const otherDetail = await detailRoute.GET(getRequest(OTHER), { params: Promise.resolve({ id: "game-a" }) });
    assert.equal(otherDetail.status, 404);
  });
});

test("壞 id 回 400、讀不到的 id 回 404", async () => {
  await withTempRecordDir(async () => {
    const detailRoute = await import("@/app/api/game-records/[id]/route");

    const bad = await detailRoute.GET(getRequest(OWNER), { params: Promise.resolve({ id: "not%20valid" }) });
    assert.equal(bad.status, 400);

    const missing = await detailRoute.GET(getRequest(OWNER), { params: Promise.resolve({ id: "game-none" }) });
    assert.equal(missing.status, 404);
  });
});

test("形狀不合的分析回 400（不是把垃圾寫進紀錄）", async () => {
  await withTempRecordDir(async (dir) => {
    const { POST } = await import("@/app/api/game-records/route");

    assert.equal((await POST(jsonRequest({ analysis: { gameId: "x" } }, OWNER))).status, 400);
    assert.equal((await POST(jsonRequest({ analysis: null }, OWNER))).status, 400);
    assert.equal((await POST(jsonRequest({}, OWNER))).status, 400);

    const dirs = await readdir(dir).catch(() => [] as string[]);
    assert.deepEqual(dirs, []);
  });
});

test("重複寫同一局不會產生兩筆（同一 gameId 覆蓋）", async () => {
  await withTempRecordDir(async () => {
    const { POST, GET } = await import("@/app/api/game-records/route");

    await POST(jsonRequest({ analysis: buildAnalysis("game-a") }, OWNER));
    await POST(jsonRequest({ analysis: buildAnalysis("game-a") }, OWNER));

    const list = await (await GET(getRequest(OWNER))).json() as { records: Array<{ id: string }> };
    assert.equal(list.records.length, 1);
  });
});

test("超過保留數量時刪掉最舊的（預設保留最新 N 局）", async () => {
  await withTempRecordDir(async () => {
    process.env.WOLFCHA_GAME_RECORD_KEEP = "2";
    const { POST, GET } = await import("@/app/api/game-records/route");

    for (const id of ["game-1", "game-2", "game-3"]) {
      const response = await POST(jsonRequest({ analysis: buildAnalysis(id) }, OWNER));
      assert.equal(response.status, 200);
    }

    const list = await (await GET(getRequest(OWNER))).json() as { records: Array<{ id: string }> };
    assert.equal(list.records.length, 2);
    assert.ok(list.records.every((record) => record.id !== "game-1"), "最舊的一局應該被輪替刪除");
  });
});
