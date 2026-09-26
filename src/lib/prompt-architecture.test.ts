process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "prompt-architecture-key";
import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import { withOutputLanguageRuleText } from "@/lib/prompt-language";
import type { GameState, Player } from "@/types/game";
import type { LLMMessage } from "@/lib/llm";

setLocale("zh-CN");

/**
 * 三個家族（玩家階段／記錄員／賽後感言）的提示詞架構必須同構：
 *
 *   system 1  <public_role_configuration>              ← 公開知識，逐字相同（可快取）
 *   system 2  【狼人杀攻略】＋心態                      ← 逐字相同（抄錄型任務不吃這一條）
 *   user 1    資料（【第N天 白天记录】／全場記錄）
 *   user 2    角色與任務                                ← 唯一差異處，一律排最後
 *
 * 這條契約一破，跨家族的共用前綴快取就沒了，任務指令也會回到 system 裡
 * （賽後感言原本就是這樣：逐人的座位／身份／勝負塞在 system，12 次呼叫 12 份不同前綴）。
 */

function makeFetchMock(handler: (body: string) => Response) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (String(input) === "/api/demo-config") return Response.json({ active: false, enabled: false });
    return handler(String(init?.body));
  };
}

const systemText = (messages: LLMMessage[]): string => {
  const system = messages.find((m) => m.role === "system");
  if (!system) return "";
  const content = system.content;
  return typeof content === "string"
    ? content
    : content.map((p) => (p.type === "text" ? p.text : "")).join("\n\n");
};

const userTexts = (messages: LLMMessage[]): string[] =>
  messages
    .filter((m) => m.role === "user")
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : m.content.map((p) => (p.type === "text" ? p.text : "")).join("\n\n")
    );

test("提示詞架構：記錄員的 system 只放公開知識，角色與任務排最後一個 user", async () => {
  const { generateDailySummary } = await import("@/lib/game-master");
  const { buildPublicRoleConfiguration } = await import("@/lib/prompt-utils");
  const { createSinglePlayerContextAuditState } = await import("../../scripts/single-player-context-audit");
  const state = createSinglePlayerContextAuditState() as unknown as GameState;

  let body: { messages: LLMMessage[] } | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock((raw) => {
    body = JSON.parse(raw) as { messages: LLMMessage[] };
    return Response.json({
      id: "t",
      choices: [{ message: { role: "assistant", content: JSON.stringify({ bullets: ["第1天：无异常"], passiveSeats: [] }) }, finish_reason: "stop" }],
    });
  });
  try {
    await generateDailySummary(state);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(body, "必須送過一次請求");
  const messages = (body as unknown as { messages: LLMMessage[] }).messages;
  assert.deepEqual(messages.map((m) => m.role), ["system", "user", "user"]);
  // system＝與玩家階段逐字相同的公開知識（第一段）＋全場共用的輸出語言規則，
  // 且不含攻略、不含任務指令。語言規則由 `withOutputLanguageRuleText` 接在組裝層，
  // 所以這裡直接用它組期望值——規則改了測試跟著改，逐字比對仍然有效。
  assert.equal(systemText(messages), withOutputLanguageRuleText(buildPublicRoleConfiguration(state)));
  assert.doesNotMatch(systemText(messages), /【狼人杀攻略】/);
  assert.doesNotMatch(systemText(messages), /你是狼人杀客观记录员/);

  const users = userTexts(messages);
  assert.match(users[0], new RegExp(`^【第${state.day}天 白天记录】`), "第一個 user 必須是當天記錄");
  assert.match(users[1], /你是狼人杀客观记录员/, "角色與任務必須是最後一個 user");
  assert.match(users[1], /passiveSeats/, "輸出規格跟著任務走");
  assert.doesNotMatch(users[0], /你是狼人杀客观记录员/);
});

test("提示詞架構：賽後感言的 system 與玩家同構（公開知識＋攻略），逐人資訊只在最後一個 user", async () => {
  const { generateGameEndRemark } = await import("@/lib/game-master");
  const { buildSharedSystemParts, buildSystemTextFromParts } = await import("@/lib/prompt-utils");
  const { createSinglePlayerContextAuditState } = await import("../../scripts/single-player-context-audit");
  const state = createSinglePlayerContextAuditState() as unknown as GameState;
  state.winner = "wolf";
  const speaker = state.players.find((p: Player) => !p.isHuman)!;

  let body: { messages: LLMMessage[] } | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock((raw) => {
    body = JSON.parse(raw) as { messages: LLMMessage[] };
    return Response.json({
      id: "t",
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({ remark: "打得不错。", mvpSeat: 1, mvpReason: "票中狼", svpSeat: 2, svpReason: "扛住压力" }),
          },
          finish_reason: "stop",
        },
      ],
    });
  });
  try {
    await generateGameEndRemark(state, speaker, "wolf");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const messages = (body as unknown as { messages: LLMMessage[] }).messages;
  assert.deepEqual(messages.map((m) => m.role), ["system", "user", "user"]);
  // system＝公開知識＋攻略（與玩家階段逐字相同），逐人的座位／身份／勝負不得留在 system
  assert.equal(
    systemText(messages),
    buildSystemTextFromParts(buildSharedSystemParts(state)),
    "賽後感言的 system 必須與玩家階段的共用段落逐字相同"
  );
  assert.match(systemText(messages), /【狼人杀攻略】/);
  assert.doesNotMatch(systemText(messages), /【赛后感言】/);
  // 逐人的座位／身份行不得進 system（熟人局名單那種全桌共用素材不算）
  assert.doesNotMatch(systemText(messages), new RegExp(`你是 ${speaker.seat + 1}号`), "逐人角色行不得進 system");
  assert.doesNotMatch(systemText(messages), /本局你的阵营/);

  const users = userTexts(messages);
  assert.match(users[0], /【全员身份】/, "第一個 user 是資料（全員身份／公開事實／逐字記錄）");
  assert.match(users[1], /【赛后感言】/);
  assert.match(users[1], new RegExp(`你是 ${speaker.seat + 1}号`), "逐人的角色與任務放最後");
  assert.match(users[1], /本局你的阵营获胜/);
});

test("提示詞架構：公開知識段落本身就是玩家階段的第一段（跨家族共用前綴）", async () => {
  const { buildPublicRoleConfiguration, buildSharedSystemParts } = await import("@/lib/prompt-utils");
  const { createSinglePlayerContextAuditState } = await import("../../scripts/single-player-context-audit");
  const state = createSinglePlayerContextAuditState() as unknown as GameState;

  const publicKnowledge = buildPublicRoleConfiguration(state);
  for (const options of [{ includeGuide: false }, undefined, { includeGuide: true }]) {
    const parts = buildSharedSystemParts(state, options);
    assert.equal(parts[0]!.text, publicKnowledge, "第一段永遠是同一份公開知識");
    assert.equal(parts[0]!.cacheable, true);
    assert.equal(parts[0]!.ttl, "1h");
  }
  // 抄錄型任務不帶攻略：只有公開知識那一段
  assert.equal(buildSharedSystemParts(state, { includeGuide: false }).length, 1);
  assert.equal(buildSharedSystemParts(state).length >= 2, true, "預設要吃攻略");
});
