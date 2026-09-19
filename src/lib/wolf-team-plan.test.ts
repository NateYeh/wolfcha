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
    whiteWolfKingBoomUsed: false,
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