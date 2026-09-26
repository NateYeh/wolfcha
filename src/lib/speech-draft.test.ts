process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "speech-draft-test-key";

import assert from "node:assert/strict";
import test from "node:test";
import type { GameState, Player } from "@/types/game";

/**
 * 「AI 幫我擬台詞」的守衛。
 *
 * 這裡只測純邏輯：接字規則、提示詞內容、清稿、以及成功／失敗路徑。
 * 模型本身的行為無法在單元測試裡驗證，所以測的是「我們送出去的提示詞有沒有帶對資訊」
 * 與「模型亂回時我們有沒有清乾淨或老實報錯」。
 */

async function speechState(options: {
  phase?: GameState["phase"];
  day?: number;
  humanSeat?: number;
} = {}): Promise<{ state: GameState; human: Player }> {
  const { createSinglePlayerContextAuditState } = await import("../../scripts/single-player-context-audit");
  const base = createSinglePlayerContextAuditState() as unknown as GameState;
  const humanSeat = options.humanSeat ?? 3;
  const state = {
    ...base,
    phase: options.phase ?? "DAY_SPEECH",
    day: options.day ?? 2,
    players: base.players.map((player, index) => ({ ...player, isHuman: index === humanSeat })),
  } as GameState;
  return { state, human: state.players[humanSeat] };
}

/**
 * 需要看中文文案的測試用這個跑：跑完把語系還原。
 * （其他測試的斷言依賴預設語系，把語系留在別處會讓它們莫名其妙地紅。）
 */
async function withLocale<T>(locale: "zh-CN" | "zh-TW" | "en", run: () => Promise<T>): Promise<T> {
  const { getLocale, setLocale } = await import("@/i18n/locale-store");
  const before = getLocale();
  setLocale(locale);
  try {
    return await run();
  } finally {
    setLocale(before);
  }
}

/** 假的上游：攔下 fetch，只回傳指定的 completion 內容，並記錄所有請求。 */
async function withStubbedChat(
  content: string | null,
  run: (calls: Array<{ url: string; body: Record<string, unknown> | undefined }>) => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> | undefined }> = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    let body: Record<string, unknown> | undefined;
    try {
      body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    } catch {
      body = undefined;
    }
    calls.push({ url, body });
    const payload = url.includes("/api/chat")
      ? {
          choices: [{ message: { role: "assistant", content: content ?? "" } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }
      : { active: false };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("接字規則：AI 草稿接在既有發言後面，不會蓋掉玩家已打的字", async () => {
  const { appendSpeechText } = await import("@/lib/speech-draft");
  assert.equal(appendSpeechText("", "台詞"), "台詞");
  assert.equal(appendSpeechText(undefined, "台詞"), "台詞");
  assert.equal(appendSpeechText("我懷疑三號", "先報票型"), "我懷疑三號 先報票型");
  assert.equal(appendSpeechText("我懷疑三號  ", "  "), "我懷疑三號");
});

test("連按兩次＝換一個：沒改過就取代，改過或自己打過字就接在後面", async () => {
  const { applySpeechDraft } = await import("@/lib/speech-draft");
  assert.equal(applySpeechDraft("", "第一版草稿", ""), "第一版草稿");
  // 玩家沒動上一張草稿 → 取代（不然會變成兩張草稿串在一起）
  assert.equal(applySpeechDraft("第一版草稿", "第二版草稿", "第一版草稿"), "第二版草稿");
  assert.equal(applySpeechDraft("  第一版草稿  ", "第二版草稿", "第一版草稿"), "第二版草稿");
  // 玩家自己打了字（或改過草稿）→ 接在後面，絕不動他的字
  assert.equal(applySpeechDraft("我自己的話", "草稿", "第一版草稿"), "我自己的話 草稿");
  assert.equal(applySpeechDraft("第一版草稿 我補一句", "第二版草稿", "第一版草稿"), "第一版草稿 我補一句 第二版草稿");
});

test("只有發言階段能擬稿，其他階段直接拒絕且不打上游", async () => {
  const { isSpeechDraftPhase, generateSpeechDraft } = await import("@/lib/speech-draft");
  for (const phase of ["DAY_SPEECH", "DAY_BADGE_SPEECH", "DAY_PK_SPEECH", "DAY_LAST_WORDS"] as const) {
    assert.equal(isSpeechDraftPhase(phase), true, `${phase} 應該可以擬稿`);
  }
  assert.equal(isSpeechDraftPhase("DAY_VOTE"), false);

  const { state, human } = await speechState({ phase: "DAY_VOTE" });
  await withStubbedChat("台詞", async (calls) => {
    await assert.rejects(() => generateSpeechDraft(state, human), /發言階段/);
    assert.equal(calls.length, 0, "不是發言階段就不該打上游");
  });
});

test("提示詞要帶上這個玩家合法知道的身分與私有資訊，而且要的是純文字台詞", async () => {
  const { buildSpeechDraftPrompt, speechDraftTargetChars } = await import("@/lib/speech-draft");
  const { state, human } = await speechState();
  const prompt = buildSpeechDraftPrompt(state, human);

  // 共用前綴（公開知識）走 system，且可快取
  assert.ok(prompt.system.length > 1000, "system 應該有公開知識");
  assert.ok((prompt.systemParts ?? []).some((part) => part.cacheable));

  // user：本人身分＋私有資訊（這個座位上的人合法知道的）
  assert.ok(prompt.user.includes(human.displayName), "user 要帶玩家名稱");
  assert.ok(prompt.user.includes(String(human.seat + 1)), "user 要帶座位號");
  assert.ok(prompt.user.includes("<your_wolf_team>"), "狼人玩家要看到自己的隊友（合法私有資訊）");
  assert.ok(prompt.user.includes("DAY_SPEECH"), "user 要帶當前階段");

  // finalUser：任務在最後，且要求純文字（不能沿用遊戲內部的 JSON 氣泡格式）
  const task = prompt.finalUser ?? "";
  assert.ok(task.includes(String(speechDraftTargetChars())), "任務要交代長度上限");
  assert.equal(task.includes('["'), false, "任務不可以出現 JSON 陣列範例（會被模型照念）");
});

test("警徽競選發言要明說「你自己就是候選人」，不能讓模型寫出「我這次不上警」", async () => {
  await withLocale("zh-TW", async () => {
    const { buildSpeechDraftPrompt } = await import("@/lib/speech-draft");
    // 夾具的競選名單是 1、5、6 號（座標 0、4、5）
    const asCandidate = await speechState({ phase: "DAY_BADGE_SPEECH", humanSeat: 4 });
    const candidatePrompt = buildSpeechDraftPrompt(asCandidate.state, asCandidate.human);
    assert.ok((candidatePrompt.finalUser ?? "").includes("你自己就是本輪警徽競選的候選人之一"), "候選人要拿到處境說明");
    assert.ok((candidatePrompt.finalUser ?? "").includes("1號"), "處境說明要列出候選人");

    const asVoter = await speechState({ phase: "DAY_BADGE_SPEECH", humanSeat: 3 });
    const voterPrompt = buildSpeechDraftPrompt(asVoter.state, asVoter.human);
    assert.equal(
      (voterPrompt.finalUser ?? "").includes("你自己就是本輪警徽競選的候選人之一"),
      false,
      "非候選人不該被說成候選人"
    );
  });
});

test("放逐平票 PK 要明說「你自己就是當事人」，一般發言不該多這段", async () => {
  await withLocale("zh-TW", async () => {
    const { buildSpeechDraftPrompt } = await import("@/lib/speech-draft");
    const inPk = await speechState({ phase: "DAY_PK_SPEECH", humanSeat: 3 });
    inPk.state.pkSource = "vote";
    inPk.state.pkTargets = [3, 7];
    const pkPrompt = buildSpeechDraftPrompt(inPk.state, inPk.human);
    assert.ok((pkPrompt.finalUser ?? "").includes("你自己就是這次平票 PK 的當事人之一"), "PK 當事人要拿到處境說明");

    const outsidePk = await speechState({ phase: "DAY_PK_SPEECH", humanSeat: 4 });
    outsidePk.state.pkSource = "vote";
    outsidePk.state.pkTargets = [3, 7];
    assert.equal(
      (buildSpeechDraftPrompt(outsidePk.state, outsidePk.human).finalUser ?? "").includes("你自己就是這次平票 PK 的當事人之一"),
      false,
      "不在 PK 名單裡就不該說他是當事人"
    );

    const normalDay = await speechState({ phase: "DAY_SPEECH", humanSeat: 4 });
    assert.equal(
      (buildSpeechDraftPrompt(normalDay.state, normalDay.human).finalUser ?? "").includes("當事人"),
      false,
      "一般白天發言沒有這段處境說明"
    );
  });
});

test("草稿提示詞要包含本日已公開的發言，否則會寫出無視討論的台詞", async () => {
  const { buildSpeechDraftPrompt } = await import("@/lib/speech-draft");
  const { state, human } = await speechState();
  // 本日逐字記錄是「現在場上大家在講什麼」的唯一來源，漏了它草稿就只會空談。
  state.messages = [
    ...(state.messages ?? []),
    {
      id: "speech-draft-evidence",
      playerId: state.players[0].playerId,
      playerName: state.players[0].displayName,
      content: "唯一證據：我昨天沒有查驗結果",
      phase: "DAY_SPEECH",
      day: state.day,
      timestamp: 1,
    },
  ];
  const prompt = buildSpeechDraftPrompt(state, human);
  assert.ok(prompt.user.includes("唯一證據：我昨天沒有查驗結果"), "本日的公開發言要進 user 內容");
});

test("遺言階段的擬稿要拿到遺言語境，不是一般發言", async () => {
  const { buildSpeechDraftPrompt } = await import("@/lib/speech-draft");
  const { state, human } = await speechState({ phase: "DAY_LAST_WORDS" });
  const lastWords = buildSpeechDraftPrompt(state, human).finalUser ?? "";
  const { state: normalState, human: normalHuman } = await speechState({ phase: "DAY_SPEECH" });
  const normal = buildSpeechDraftPrompt(normalState, normalHuman).finalUser ?? "";
  assert.notEqual(lastWords, normal, "遺言與一般發言的任務提示不該一樣");
  assert.ok(lastWords.length > normal.length, "遺言要多一段階段說明");
});

test("清稿：JSON 陣列、code fence、整段引號、『台詞：』標籤都要清掉", async () => {
  const { sanitizeSpeechDraft } = await import("@/lib/speech-draft");
  assert.equal(sanitizeSpeechDraft("  我懷疑三號，先報票型。  "), "我懷疑三號，先報票型。");
  assert.equal(sanitizeSpeechDraft('["第一段。","第二段。"]'), "第一段。\n第二段。");
  assert.equal(sanitizeSpeechDraft('{"speech":["只有一段。"]}'), "只有一段。");
  assert.equal(sanitizeSpeechDraft('```json\n["包在 fence 裡。"]\n```'), "包在 fence 裡。");
  assert.equal(sanitizeSpeechDraft("「整段被引號包住。」"), "整段被引號包住。");
  assert.equal(sanitizeSpeechDraft('台词：我怀疑三号。'), "我怀疑三号。");
  assert.equal(sanitizeSpeechDraft("第一段。\n\n\n\n第二段。"), "第一段。\n\n第二段。");
});

test("清稿：超長草稿在句尾截斷，並標示被截掉了", async () => {
  const { sanitizeSpeechDraft, speechDraftMaxChars } = await import("@/lib/speech-draft");
  const sentence = "這是一句用來把長度撐上去的示範台詞，內容本身沒有意義。";
  const long = sentence.repeat(20);
  // 上限跟語言走（中文 200、英文 500），這裡用明確值測「截斷行為」本身
  const maxChars = 200;
  const cleaned = sanitizeSpeechDraft(long, { maxChars });
  assert.ok(cleaned.length <= maxChars + 1, `截斷後長度 ${cleaned.length} 應在上限附近`);
  assert.equal(speechDraftMaxChars("zh-TW"), 200, "中文上限 200");
  assert.ok(speechDraftMaxChars("en") > speechDraftMaxChars("zh-TW"), "英文上限要比中文寬（遊戲規則用 60 words）");
  assert.ok(cleaned.endsWith("。") || cleaned.endsWith("…"), "截斷要落在句尾或標示省略");
});

test("清稿：清不出東西就回空字串，不假裝有內容", async () => {
  const { sanitizeSpeechDraft } = await import("@/lib/speech-draft");
  for (const raw of ["", "   ", "\n\n", "```\n```", "[]", "{}"]) {
    assert.equal(sanitizeSpeechDraft(raw), "", `raw=${JSON.stringify(raw)} 應該清成空字串`);
  }
});

test("生成成功：草稿清乾淨後回傳，且只用一次 /api/chat", async () => {
  const { generateSpeechDraft } = await import("@/lib/speech-draft");
  const { state, human } = await speechState();
  await withStubbedChat('```\n["我先報票型，我懷疑三號。"]\n```', async (calls) => {
    const draft = await generateSpeechDraft(state, human);
    assert.equal(draft, "我先報票型，我懷疑三號。");
    const chatCalls = calls.filter((call) => call.url.includes("/api/chat"));
    assert.equal(chatCalls.length, 1, "擬稿只該打一次上游");
    // 送出的 messages 要符合遊戲既有結構：system 在最前、任務在最後
    const messages = chatCalls[0].body?.messages as Array<{ role: string; content: unknown }>;
    assert.equal(messages[0].role, "system");
    // system 的 content 是快取用的 parts 陣列，長度要算序列化後的量
    assert.ok(JSON.stringify(messages[0].content).length > 1000, "system 要帶完整公開知識");
    assert.equal(messages[messages.length - 1].role, "user");
    const taskContent = String(messages[messages.length - 1].content);
    assert.ok(
      taskContent.includes("【Task】") || taskContent.includes("【本輪任務】") || taskContent.includes("【本轮任务】"),
      `任務提示要排在最後一個 user 訊息，實際開頭：${taskContent.slice(0, 40)}`
    );
  });
});

test("生成失敗：模型回空內容要拋錯，不靜默回空字串", async () => {
  const { generateSpeechDraft } = await import("@/lib/speech-draft");
  const { state, human } = await speechState();
  await withStubbedChat("", async () => {
    await assert.rejects(() => generateSpeechDraft(state, human), /沒有回傳|没有返回|returned no speech/);
  });
});

/**
 * 2026-09-26 個案：真人玩家的台詞是 AI 代寫的，草稿把他寫成「我警上投阿紫是我看走眼了」——
 * 但他那一票投的是**真預言家**、放逐票投的是後來自爆坐實的狼，兩票都沒投錯。而且那筆代寫
 * **完全沒有紀錄**（`aiLogger.log` 原本只被 game-master／character-generator／game-analysis 呼叫），
 * 賽後查不出「這句話是誰寫的」，第一時間還被誤判成玩家自己打的。
 * 兩條守衛各擋一半：提示詞要求先對帳，呼叫要落 `speech_draft` 紀錄。
 */
test("擬稿提示詞要求『先對帳再認錯』（不得無故認『看走眼』）", async () => {
  const { state, human } = await speechState();
  const { generateSpeechDraft } = await import("@/lib/speech-draft");
  await withLocale("zh-CN", async () => {
    await withStubbedChat("我這一票投 3 號。", async (calls) => {
      await generateSpeechDraft(state, human);
      const chat = calls.find((call) => call.url.includes("/api/chat"));
      const text = JSON.stringify(chat?.body?.messages ?? []);
      assert.ok(text.includes("认错前先对账"), `擬稿提示詞必須帶對帳規則，實際送出：${text.slice(0, 300)}`);
      assert.ok(text.includes("不准说自己"), "必須明講「票投對了就不准認錯」");
    });
  });
});

test("代寫要落 AI 紀錄（type=speech_draft、記到該玩家座位）", async () => {
  const { state, human } = await speechState();
  const { aiLogger } = await import("@/lib/ai-logger");
  const { generateSpeechDraft } = await import("@/lib/speech-draft");
  const logged: Array<Record<string, unknown>> = [];
  const original = aiLogger.log;
  aiLogger.log = (async (entry: unknown) => {
    logged.push(entry as Record<string, unknown>);
    return entry as never;
  }) as typeof aiLogger.log;
  try {
    await withStubbedChat("我這一票投 3 號。", async () => {
      const draft = await generateSpeechDraft(state, human);
      assert.equal(draft, "我這一票投 3 號。");
    });
  } finally {
    aiLogger.log = original;
  }
  assert.equal(logged.length, 1, "代寫是一次真的 AI 呼叫，必須留下恰好一筆紀錄");
  assert.equal(logged[0]?.type, "speech_draft");
  const request = logged[0]?.request as { player?: { seat?: number }; model?: string } | undefined;
  assert.equal(request?.player?.seat, human.seat, "紀錄要認得出是哪個座位的代寫");
  assert.ok(request?.model, "紀錄要帶模型");
});
