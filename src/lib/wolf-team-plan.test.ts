import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import type { GameState, Player } from "@/types/game";
import type { WolfTeamPlan } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "wolf-team-plan-test-key";

setLocale("zh-CN");

// 9 席局：狼在 seat 1、3、7；seat 7 是真人狼（不可被指定悍跳）。
const rolesBySeat: Player["role"][] = [
  "Seer",
  "Werewolf",
  "Villager",
  "Werewolf",
  "Witch",
  "Hunter",
  "Villager",
  "Werewolf",
  "Villager",
];

const makePlayers = (): Player[] =>
  rolesBySeat.map((role, seat) => ({
    playerId: `p${seat}`,
    seat,
    displayName: `玩家${seat + 1}`,
    alive: true,
    role,
    alignment: role === "Werewolf" || role === "WhiteWolfKing" ? "wolf" : "village",
    isHuman: seat === 7,
    agentProfile: {
      modelRef: { provider: "tokendance", model: "gemma4:31b-cloud" },
      persona: { voiceRules: [], mbti: "INTJ", gender: "male", age: 30 },
    },
  }));

const makeState = (players: Player[], wolfTeamPlan?: WolfTeamPlan): GameState => ({
  gameId: "wolf-team-plan-test",
  phase: "DAY_BADGE_SIGNUP",
  day: 1,
  difficulty: "normal",
  players,
  events: [],
  messages: [],
  currentSpeakerSeat: null,
  daySpeechStartSeat: null,
  badge: {
    holderSeat: null,
    candidates: [],
    signup: {},
    votes: {},
    allVotes: {},
    history: {},
    revoteCount: 0,
  },
  votes: {},
  voteHistory: {},
  dailySummaries: {},
  dailySummaryFacts: {},
  dailySummaryVoteData: {},
  nightActions: {},
  roleAbilities: {
    witchHealUsed: false,
    witchPoisonUsed: false,
    hunterCanShoot: true,
    idiotRevealed: false,
    boomedSeats: [],
  duelUsedSeats: [],
  },
  winner: null,
  ...(wolfTeamPlan ? { wolfTeamPlan } : {}),
});

test("normalizeWolfTeamPlan: 合法計畫——座位轉 0 基、悍跳者必上警", async () => {
  const { normalizeWolfTeamPlan } = await import("./game-master");
  const plan = normalizeWolfTeamPlan(
    {
      jumpSeat: 2,
      signupSeats: [2, 4],
      postures: { "2": "jump", "4": "charge", "8": "hook" },
      reason: "先跳一條線散票",
    },
    { wolfSeats: [1, 3, 7], humanSeats: [7], captainSeat: 3, day: 1 }
  );
  assert.ok(plan);
  assert.equal(plan.jumpSeat, 1);
  assert.deepEqual(plan.signupSeats, [1, 3]);
  assert.equal(plan.postures["1"], "jump");
  assert.equal(plan.postures["3"], "charge");
  assert.equal(plan.postures["7"], "hook");
  assert.equal(plan.captainSeat, 3);
  assert.equal(plan.day, 1);
});

test("normalizeWolfTeamPlan: jumpSeat=0 代表不跳，jump 代碼重映射為 deep", async () => {
  const { normalizeWolfTeamPlan } = await import("./game-master");
  const plan = normalizeWolfTeamPlan(
    {
      jumpSeat: 0,
      signupSeats: [4],
      postures: { "2": "jump", "4": "hook", "8": "deep" },
      reason: "全队倒勾",
    },
    { wolfSeats: [1, 3, 7], humanSeats: [], captainSeat: 1, day: 1 }
  );
  assert.ok(plan);
  assert.equal(plan.jumpSeat, null);
  assert.equal(plan.postures["1"], "deep");
  assert.equal(plan.postures["3"], "hook");
});

test("normalizeWolfTeamPlan: 真人狼不可被指定悍跳——退回不跳", async () => {
  const { normalizeWolfTeamPlan } = await import("./game-master");
  const plan = normalizeWolfTeamPlan(
    {
      jumpSeat: 8,
      signupSeats: [8],
      postures: { "2": "charge", "4": "hook", "8": "jump" },
      reason: "让真人跳",
    },
    { wolfSeats: [1, 3, 7], humanSeats: [7], captainSeat: 3, day: 1 }
  );
  assert.ok(plan);
  assert.equal(plan.jumpSeat, null);
  assert.equal(plan.postures["7"], "deep");
  assert.deepEqual(plan.signupSeats, [7]);
});

test("normalizeWolfTeamPlan: 非狼座位與非法代碼一律清洗", async () => {
  const { normalizeWolfTeamPlan } = await import("./game-master");
  const plan = normalizeWolfTeamPlan(
    {
      jumpSeat: 4,
      signupSeats: [4, 5, 99],
      postures: { "2": "fly", "4": "charge", "8": "jump" },
      reason: 123,
    },
    { wolfSeats: [1, 3, 7], humanSeats: [], captainSeat: 1, day: 1 }
  );
  assert.ok(plan);
  assert.equal(plan.jumpSeat, 3);
  assert.deepEqual(plan.signupSeats, [3]);
  assert.equal(plan.postures["1"], "deep");
  assert.equal(plan.postures["3"], "charge");
  // 未被指定為悍跳者卻領 jump 代碼 → 重映射為 charge
  assert.equal(plan.postures["7"], "charge");
  assert.equal(plan.reason, "");
});

test("normalizeWolfTeamPlan: 無存活狼回傳 null", async () => {
  const { normalizeWolfTeamPlan } = await import("./game-master");
  const plan = normalizeWolfTeamPlan(
    { jumpSeat: 2, signupSeats: [2], postures: {}, reason: "x" },
    { wolfSeats: [], humanSeats: [], captainSeat: 0, day: 1 }
  );
  assert.equal(plan, null);
});

test("buildGameContext: 狼視角含商定分工區塊，自己帶（你）標記；好人看不到", async () => {
  const { normalizeWolfTeamPlan } = await import("./game-master");
  const { buildGameContext } = await import("./prompt-utils");
  const players = makePlayers();
  const plan = normalizeWolfTeamPlan(
    {
      jumpSeat: 2,
      signupSeats: [2],
      postures: { "2": "jump", "4": "charge", "8": "hook" },
      reason: "先跳一條線散票",
    },
    { wolfSeats: [1, 3, 7], humanSeats: [7], captainSeat: 3, day: 1 }
  );
  assert.ok(plan);
  const state = makeState(players, plan);

  const wolfContext = buildGameContext(state, players[1]);
  assert.match(wolfContext, /【狼队夜里商定的分工】/);
  assert.match(wolfContext, /主导狼 4号玩家4商定/);
  assert.match(wolfContext, /- 2号玩家2（你）：悍跳预言家，上警/);
  assert.match(wolfContext, /- 4号玩家4：冲锋（站边悍跳狼），不上警/);
  assert.match(wolfContext, /- 8号玩家8：倒勾（站进好人堆），不上警/);
  assert.match(wolfContext, /主导狼的话：先跳一條線散票/);
  assert.match(wolfContext, /计划是底线参考/);

  const villagerContext = buildGameContext(state, players[2]);
  assert.doesNotMatch(villagerContext, /【狼队夜里商定的分工】/);
});

test("buildGameContext: 無計畫時不注入（舊行為不變）", async () => {
  const { buildGameContext } = await import("./prompt-utils");
  const state = makeState(makePlayers());
  const wolfContext = buildGameContext(state, state.players[1]);
  assert.doesNotMatch(wolfContext, /【狼队夜里商定的分工】/);
});

test("主導狼刀口提示的時間錨點：死訊在「同一天天亮」公佈，不得寫成明天", async () => {
  // 這局的「天」是「第N天夜晚 → 第N天白天」：夜裡的刀在同一天天亮公布，
  // 所以刀口提示不能寫「明天」（多算一天），而且計畫會被後續回合重新讀到，
  // 相對時間詞必須穩定——只允許以「天亮」為錨點。
  const { getI18n } = await import("@/i18n/translator");
  for (const locale of ["zh-CN", "zh-TW"] as const) {
    setLocale(locale);
    const line = getI18n().t("prompts.night.wolfTeamPlan.knifeLine", { seat: 4, name: "滅絕師太" });
    assert.doesNotMatch(line, /明天|次日|明早/, `${locale} 刀口提示不得用「明天」描述同一天天亮的死訊`);
    assert.match(line, /天亮/, `${locale} 刀口提示要以「天亮」為時間錨點`);
    assert.match(line, /平安夜/, `${locale} 刀口提示要說明被守護／救下時的結果`);
  }
  setLocale("zh-CN");
  assert.match(getI18n().t("prompts.night.wolfTeamPlan.knifeLineNone"), /空刀/);
});
test("狼隊夜間商議（wolf_chat）的 system 必須跟其他階段一樣帶共用開場並走前綴快取", async () => {
  // 回歸：generateWolfTeamPlan 自己拼 system，曾經只帶【身份】＋商議說明，
  // 沒有 <public_role_configuration>／規則／攻略，也沒有 cache_control，
  // 於是同一個夜晚的 wolf_action 與 wolf_chat 兩張提示詞長得完全不一樣。
  const { generateWolfTeamPlan } = await import("./game-master");
  const state = makeState(makePlayers());
  const bodies: Array<{ messages: Array<{ role: string; content: string | Array<{ text: string; cache_control?: unknown }> }> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({
      id: "wolf-team-plan",
      choices: [{
        message: {
          role: "assistant",
          content: JSON.stringify({ jumpSeat: 2, signupSeats: [2, 4], postures: { "2": "jump", "4": "hook" }, reason: "2號悍跳，4號衝鋒" }),
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const plan = await generateWolfTeamPlan(state);
    assert.ok(plan, "應該產生狼隊計畫");
    const systemMessage = bodies[0].messages.find((message) => message.role === "system")!;
    assert.ok(Array.isArray(systemMessage.content), "system 應該是可快取的分段陣列");
    const parts = systemMessage.content as Array<{ text: string; cache_control?: unknown }>;
    const joined = parts.map((part) => part.text).join("\n");
    assert.match(joined, /<public_role_configuration>/);
    assert.match(joined, /【狼人杀攻略】/);
    assert.match(joined, /【狼队】/);
    assert.match(joined, /【夜间出刀】/);
    // 共用開場兩段必須帶 cache_control（1h 前綴快取）：公開知識（含配置與規則）＋攻略
    const cached = parts.filter((part) => part.cache_control);
    assert.ok(cached.length >= 2, `共用開場應可快取，實際只有 ${cached.length} 段`);
    // system 只剩共用開場（逐人內容不得混進來，否則前綴無法共用）
    assert.doesNotMatch(joined, /【身份】/);
    assert.doesNotMatch(joined, /商定狼隊白天的分工/);
    // 身分／商議任務在 user
    const userMessage = bodies[0].messages.find((message) => message.role === "user")!;
    const userText = String(userMessage.content);
    assert.match(userText, /【身份】/);
    assert.match(userText, /商定狼隊白天的分工|今晚刀口/);
  } finally {
    globalThis.fetch = original;
  }
});

test("buildHumanWolfTeamPlan: 真人狼可以指派自己悍跳（不再排除真人座位）", async () => {
  const { buildHumanWolfTeamPlan } = await import("./game-master");
  const state = makeState(makePlayers());
  const plan = buildHumanWolfTeamPlan(state, {
    jumpSeat: 8, // seat 7＝真人狼
    signupSeats: [2, 8],
    postures: { "2": "charge", "4": "hook", "8": "jump" },
    reason: "我來悍跳，你們跟著我的線走",
  });
  assert.ok(plan, "有存活真人狼時必須產出計畫");
  assert.equal(plan.jumpSeat, 7, "真人狼可以自己被指派為悍跳者");
  assert.equal(plan.captainSeat, 7, "真人指派時主導狼就是真人自己");
  assert.deepEqual(plan.signupSeats, [1, 7], "上警座位轉 0 基");
  assert.equal(plan.postures["7"], "jump");
  assert.equal(plan.postures["1"], "charge");
  assert.equal(plan.postures["3"], "hook");
});

test("buildHumanWolfTeamPlan: 非狼座位與非法分工代碼一律清洗", async () => {
  const { buildHumanWolfTeamPlan } = await import("./game-master");
  const state = makeState(makePlayers());
  const plan = buildHumanWolfTeamPlan(state, {
    jumpSeat: 2, // seat 1＝狼，合法
    signupSeats: [2, 5, 99], // seat 4＝女巫、99 不存在，都要清掉
    postures: { "2": "jump", "4": "boss", "8": "jump" }, // 非法碼降 deep；多出來的 jump 轉 charge
    reason: "  一句話  ",
  });
  assert.ok(plan);
  assert.equal(plan.jumpSeat, 1);
  assert.deepEqual(plan.signupSeats, [1], "悍跳者自動補上，其餘非狼座位清掉");
  assert.equal(plan.postures["1"], "jump");
  assert.equal(plan.postures["3"], "deep");
  assert.equal(plan.postures["7"], "charge");
  assert.equal(plan.reason, "一句話");
});

test("buildHumanWolfTeamPlan: 沒有存活真人狼時回傳 null（走 AI 主導狼）", async () => {
  const { buildHumanWolfTeamPlan } = await import("./game-master");
  const allAi = makePlayers().map((player) => ({ ...player, isHuman: false }));
  assert.equal(buildHumanWolfTeamPlan(makeState(allAi), { jumpSeat: 2 }), null);

  const deadHuman = makePlayers().map((player) =>
    player.isHuman ? { ...player, alive: false } : player
  );
  assert.equal(buildHumanWolfTeamPlan(makeState(deadHuman), { jumpSeat: 2 }), null);
});

test("humanWolfNeedsNightInput: 真人狼未選刀口或第一夜未指派分工前都要擋", async () => {
  const { humanWolfNeedsNightInput } = await import("./game-master");
  const players = makePlayers();

  // 什麼都還沒做
  assert.equal(humanWolfNeedsNightInput(makeState(players)), true);

  // 選了刀口但第一夜還沒指派分工
  const knifed = makeState(players);
  knifed.nightActions = { wolfTarget: 2 };
  assert.equal(humanWolfNeedsNightInput(knifed), true);

  // 指派完分工就放行
  const planned = { ...knifed, wolfTeamPlan: { captainSeat: 7, jumpSeat: null, signupSeats: [], postures: {}, reason: "", day: 1 } };
  assert.equal(humanWolfNeedsNightInput(planned), false);

  // 交還 AI 主導狼（即使生成失敗沒計畫）也要放行，否則夜間流程會卡死
  assert.equal(humanWolfNeedsNightInput({ ...knifed, wolfTeamPlanDelegated: true }), false);

  // 第二夜起不再要求分工
  assert.equal(humanWolfNeedsNightInput({ ...knifed, day: 2 }), false);

  // 沒有存活真人狼（全 AI 或真人狼已死）
  const allAi = makePlayers().map((player) => ({ ...player, isHuman: false }));
  assert.equal(humanWolfNeedsNightInput(makeState(allAi)), false);
  const deadHuman = makePlayers().map((player) => (player.isHuman ? { ...player, alive: false } : player));
  assert.equal(humanWolfNeedsNightInput(makeState(deadHuman)), false);
});
