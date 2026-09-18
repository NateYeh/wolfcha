process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "game-end-remark-key";
import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import type { GameState, Player } from "@/types/game";

setLocale("zh-CN");

function makeFetchMock(handler: (body: string) => Response): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    if (String(input) === "/api/demo-config") return Response.json({ active: false, enabled: false });
    return handler(String(init?.body));
  };
}

test("赛后感言：prompt 含全员身份公开、胜负立场与输出限制，返回纯文本", async () => {
  const { generateGameEndRemark } = await import("@/lib/game-master");
  const { createSinglePlayerContextAuditState } = await import(
    "../../scripts/single-player-context-audit"
  );
  const state = createSinglePlayerContextAuditState() as unknown as GameState;
  state.winner = "wolf";
  state.dailySummaries = { 1: ["第1天：8号被放逐"] };
  const speaker = state.players.find((p: Player) => !p.isHuman)!;
  (speaker.agentProfile!.persona as { voiceRules: string[] }).voiceRules = ["说话直接"];

  let requestBody = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock((body) => {
    requestBody = body;
    return Response.json({
      id: "test",
      choices: [{ message: { role: "assistant", content: "这局多亏对面把好人投光了，我就是纯民。" }, finish_reason: "stop" }],
    });
  });

  try {
    const remark = await generateGameEndRemark(state, speaker, "wolf");
    // system：身份、胜负立场、感言规则
    assert.match(requestBody, /【赛后感言】/);
    assert.match(requestBody, /全员身份公开/);
    assert.match(requestBody, /本局你的阵营获胜。/);
    assert.match(requestBody, /其实是我方卧底/);
    assert.match(requestBody, /吐槽猪队友/);
    // user：全员身份公开、关键事件、语言风格
    assert.match(requestBody, /【全员身份】/);
    assert.match(requestBody, /【关键事件】/);
    assert.match(requestBody, /8号被放逐/);
    assert.match(requestBody, /你的语言风格：说话直接/);
    // 返回值即模型正文（已清理换行与代码围栏，保留完整内容）
    assert.equal(remark, "这局多亏对面把好人投光了，我就是纯民。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("赛后感言：输家立场用落败文案；生成失败返回空串且不抛出", async () => {
  const { generateGameEndRemark } = await import("@/lib/game-master");
  const { createSinglePlayerContextAuditState } = await import(
    "../../scripts/single-player-context-audit"
  );
  const state = createSinglePlayerContextAuditState() as unknown as GameState;
  const villagerSpeaker = state.players.find(
    (p: Player) => !p.isHuman && p.alignment === "village"
  )!;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock((body) => {
    if (body.includes("本局你的阵营落败。")) {
      return Response.json({ id: "test", choices: [{ message: { role: "assistant", content: "自责查人查歪了" }, finish_reason: "stop" }] });
    }
    throw new Error("boom");
  });

  try {
    // 狼胜局 + 好人发言者 → 落败立场
    const remark = await generateGameEndRemark(state, villagerSpeaker, "wolf");
    assert.match(remark, /自责查人查歪了/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 失败路径：请求抛错被捕获，返回空串
  const failureState = createSinglePlayerContextAuditState() as unknown as GameState;
  const failingSpeaker = failureState.players.find((p: Player) => !p.isHuman)!;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const empty = await generateGameEndRemark(failureState, failingSpeaker, "village");
    assert.equal(empty, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("赛后感言：本人自爆/开枪的私下理由注入自己的感言 prompt，别人的不注入", async () => {
  const { generateGameEndRemark } = await import("@/lib/game-master");
  const { createSinglePlayerContextAuditState } = await import(
    "../../scripts/single-player-context-audit"
  );
  const state = createSinglePlayerContextAuditState() as unknown as GameState;
  state.winner = "wolf";
  state.dailySummaries = { 2: ["第2天：白狼王自爆"] };
  const boomSeat = 0;
  const shotSeat = 1;
  state.dayHistory = {
    2: {
      whiteWolfKingBoom: { boomSeat, targetSeat: 6, reason: "票台必出局，自爆带走最贵的女巫身份止损" },
      hunterShot: { hunterSeat: shotSeat, targetSeat: 3, reason: "他刀口最像狼" },
    },
  };

  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/demo-config") return Response.json({ active: false, enabled: false });
    bodies.push(String(init?.body));
    return Response.json({ id: "t", choices: [{ message: { role: "assistant", content: "自爆那一手我算好了。" }, finish_reason: "stop" }] });
  };

  try {
    // 白狼王本人的感言：看得到自己写下的自爆理由
    const boomer = state.players.find((p: Player) => p.seat === boomSeat && !p.isHuman)!;
    await generateGameEndRemark(state, boomer, "wolf");
    assert.match(bodies[0], /你当时的私下决策理由/);
    assert.match(bodies[0], /第2天自爆——你自己写的理由：票台必出局/);
    assert.doesNotMatch(bodies[0], /第2天开枪——你自己写的理由/);

    // 没有私人决策记录的玩家：不拼私有区块
    const plain = state.players.find((p: Player) => p.seat === 2 && !p.isHuman)!;
    await generateGameEndRemark(state, plain, "wolf");
    assert.doesNotMatch(bodies[1], /你当时的私下决策理由/);

    // 猎人本人的感言：看得到自己写下的开枪理由
    const hunterSpeaker = state.players.find((p: Player) => p.seat === shotSeat && !p.isHuman)!;
    await generateGameEndRemark(state, hunterSpeaker, "wolf");
    assert.match(bodies[2], /第2天开枪——你自己写的理由：他刀口最像狼/);
    assert.doesNotMatch(bodies[2], /第2天自爆——你自己写的理由/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
