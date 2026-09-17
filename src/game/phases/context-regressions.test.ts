import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import { buildGameContext, buildPastDaysTranscript } from "@/lib/prompt-utils";
import { recordVoteRound } from "@/lib/vote-rounds";
import type { GameState, Phase } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "context-regression-key";
setLocale("zh");

function fresh(phase: Phase = "DAY_SPEECH"): GameState {
  const state = createSinglePlayerContextAuditState();
  return { ...state, phase, day: 1, messages: [], currentSpeakerSeat: 0,
    nightHistory: {}, dayHistory: {}, nightActions: {}, voteHistory: {},
    dailySummaries: {}, dailySummaryFacts: {}, dailySummaryVoteData: {},
    badge: { ...state.badge, candidates: [], holderSeat: null, history: {}, votes: {}, revoteCount: 0 },
    roleAbilities: { ...state.roleAbilities, witchHealUsed: false, witchPoisonUsed: false, idiotRevealed: false },
  };
}

const message = (state: GameState, content: string, phase: Phase, seat = 0, round?: number) => ({
  id: content, playerId: state.players[seat].playerId, playerName: state.players[seat].displayName,
  content, phase, day: state.day, timestamp: 1, speechRound: round,
});

test("狼人夜晚出刀提示必须包含守卫博弈推断（守卫可能守谁、连刀逻辑）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("NIGHT_WOLF_ACTION");
  const actor = state.players.find((p) => p.role === "Werewolf")!;
  state.currentSpeakerSeat = actor.seat;
  const prompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state }, actor)!;
  assert.match(prompt.user, /【守卫博弈】出刀前先推断守卫今晚会守谁/);
  // 刀口优先级：修正「只算命中率」——收益优先，跳预言家持警徽者是资讯核心，且排在守卫博弈之后作修正。
  assert.match(prompt.user, /【刀口优先级】刀口看收益，不只看好杀/);
  assert.match(prompt.user, /命中率最高不等于赚/);
  assert.match(prompt.user, /自保式刀口.*不如胜利式刀口/);
  assert.ok(
    prompt.user.indexOf("刀口优先级") > prompt.user.indexOf("守卫博弈"),
    "刀口优先级应排在守卫博弈之后（修正顺序）"
  );
  // 守卫倾向目标：公开跳神、警长、金水、昨晚刀口未死的目标。
  assert.match(prompt.user, /昨晚刀口没死的目标/);
  // 连刀逻辑：被刀却平安夜的目标，今晚守卫不能连守、女巫解药已用完。
  assert.match(prompt.user, /今晚连刀 X 命中率通常最高/);
  assert.match(prompt.user, /避开第 1 条里守卫今晚最可能守的座位/);
});

test("夜間行動帶 reason：四職業 prompt 要求一句話理由，jsonFormat 範例含 reason 字段", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");

  const seerState = fresh("NIGHT_SEER_ACTION");
  const seer = seerState.players.find((p) => p.role === "Seer")!;
  seerState.currentSpeakerSeat = seer.seat;
  const seerPrompt = new PhaseManager().getPrompt("NIGHT_SEER_ACTION", { state: seerState }, seer)!;
  assert.match(seerPrompt.user, /reason 字段用一句话说明你为什么查验他（30字内）/);
  assert.match(seerPrompt.user, /"reason":"一句话说明你为什么查验他"/);

  const wolfState = fresh("NIGHT_WOLF_ACTION");
  const wolf = wolfState.players.find((p) => p.role === "Werewolf")!;
  wolfState.currentSpeakerSeat = wolf.seat;
  const wolfPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: wolfState }, wolf)!;
  assert.match(wolfPrompt.user, /reason 字段用一句话说明你们为什么刀他（30字内）/);
  assert.match(wolfPrompt.user, /"reason":"一句话说明你们为什么刀他"/);

  const guardState = fresh("NIGHT_GUARD_ACTION");
  const guard = guardState.players.find((p) => p.role === "Guard")!;
  guardState.currentSpeakerSeat = guard.seat;
  const guardPrompt = new PhaseManager().getPrompt("NIGHT_GUARD_ACTION", { state: guardState }, guard)!;
  assert.match(guardPrompt.user, /reason 字段用一句话说明你为什么守他（30字内）/);
  assert.match(guardPrompt.user, /"reason":"一句话说明你为什么守他"/);

  const witchState = fresh("NIGHT_WITCH_ACTION");
  const witch = witchState.players.find((p) => p.role === "Witch")!;
  witchState.currentSpeakerSeat = witch.seat;
  const witchPrompt = new PhaseManager().getPrompt("NIGHT_WITCH_ACTION", { state: witchState }, witch)!;
  // 女巫的技能段與格式範例都在 system（task 模板）
  assert.match(witchPrompt.system, /reason 字段用一句话说明你的判断（30字内）/);
  assert.match(witchPrompt.system, /"action":"save","reason"/);
  assert.match(witchPrompt.system, /"action":"poison","seat":\d+,"reason"/);
});

test("猎人开枪提示必须包含开枪守则，且排在遗言之后（可推翻遗言目标）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("HUNTER_SHOOT");
  const actor = state.players.find((p) => p.role === "Hunter")!;
  state.currentSpeakerSeat = actor.seat;
  // 模拟遗言里预告开枪目标的锚点
  state.messages = [message(state, "我这一枪就打3号", "DAY_LAST_WORDS", actor.seat)];
  const prompt = new PhaseManager().getPrompt("HUNTER_SHOOT", { state }, actor)!;
  // 硬认证目标：先看认证（知識型，不下禁令）
  assert.match(prompt.system, /【开枪的思路】/);
  assert.match(prompt.system, /打掉等于替狼队清场/);
  // 被预言家阵营放逐时：先核实查验链，射金水等于打光自己的信息源
  assert.match(prompt.system, /打他的金水等于自己把好人的信息源打光/);
  // 遗言目标可推翻：以投票时写下的最新判断为准
  assert.match(prompt.system, /两者冲突时，按最新的来/);
  const lastWordsIdx = prompt.system.indexOf("【已经发生的公开记录：你的遗言】");
  const rulesIdx = prompt.system.indexOf("【开枪的思路】");
  assert.ok(lastWordsIdx >= 0 && rulesIdx > lastWordsIdx, "开枪守则应排在遗言之后");
});

test("警徽评选：狼人可见警徽票纪律，好人不可见", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_BADGE_ELECTION");
  state.badge.candidates = [0, 1];
  const wolf = state.players.find((p) => p.role === "Werewolf")!;
  state.currentSpeakerSeat = wolf.seat;
  const wolfPrompt = new PhaseManager().getPrompt("DAY_BADGE_ELECTION", { state }, wolf)!;
  assert.match(wolfPrompt.system, /【警徽票纪律（仅狼人可见）】/);
  // 无对跳时：唯一跳预言家的人大概率真，默认投他是标准操作
  assert.match(wolfPrompt.system, /唯一跳预言家的人大概率是真预言家/);
  // 不投需充足理由，否则复盘时暴露
  assert.match(wolfPrompt.system, /警徽票没投预言家」是好人点狼的常用证据/);
  // 队友已对跳则优先投队友
  assert.match(wolfPrompt.system, /优先把警徽票投给对跳的队友/);
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = villager.seat;
  const villagerPrompt = new PhaseManager().getPrompt("DAY_BADGE_ELECTION", { state }, villager)!;
  assert.doesNotMatch(villagerPrompt.system, /警徽票纪律/);
});

const decisions: Phase[] = ["DAY_BADGE_SIGNUP", "DAY_BADGE_ELECTION", "BADGE_TRANSFER", "DAY_VOTE", "HUNTER_SHOOT", "WHITE_WOLF_KING_BOOM", "DAY_SPEECH", "DAY_LAST_WORDS", "DAY_PK_SPEECH"];
for (const phase of decisions) {
  test(`阶段矩阵：${phase} 必须包含已公开的当天证据`, async () => {
    await import("@/lib/game-master");
    const { PhaseManager } = await import("../core/PhaseManager");
    const state = fresh(phase);
    state.pkSource = "badge";
    state.badge.candidates = [0, 1];
    state.messages = [message(state, "唯一公开证据：3号曾承认没有查验结果", "DAY_BADGE_SPEECH", 2)];
    const role = phase === "HUNTER_SHOOT" ? "Hunter" : phase === "WHITE_WOLF_KING_BOOM" ? "WhiteWolfKing" : "Villager";
    const actor = state.players.find((p) => p.role === role)!;
    state.currentSpeakerSeat = actor.seat;
    const prompt = new PhaseManager().getPrompt(phase, { state }, actor)!;
    assert.match(prompt.user, /唯一公开证据：3号曾承认没有查验结果/);
  });
}

test("警徽 PK 临时切换为自爆提示词，仍不能提前得知刀口结果；公布后才可知", async () => {
  const { generateWhiteWolfKingBoomDecision } = await import("@/lib/game-master");
  const state = fresh("DAY_PK_SPEECH");
  state.pkSource = "badge";
  state.badge.candidates = [0, 1];
  state.nightHistory = { 1: { wolfTarget: 7, deaths: [{ seat: 7, reason: "wolf" }] } };
  const actor = state.players.find((p) => p.role === "WhiteWolfKing")!;
  let prompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/demo-config") return Response.json({ active: false, enabled: false });
    prompt = String(init?.body);
    return Response.json({ id: "test", choices: [{ message: { role: "assistant", content: '{"action":"pass"}' }, finish_reason: "stop" }] });
  };
  try {
    await generateWhiteWolfKingBoomDecision(state, actor);
    assert.match(prompt, /结果待天亮公布/);
    assert.doesNotMatch(prompt, /目标当晚出局/);
    assert.equal(state.nightHistory[1].resultsAnnounced, undefined);
    state.nightHistory[1].resultsAnnounced = true;
    await generateWhiteWolfKingBoomDecision(state, actor);
    assert.match(prompt, /目标当晚出局/);
  } finally { globalThis.fetch = originalFetch; }
});

test("守卫保留每夜路线，结果按当夜公开结算判断，普通村民看不到守护记录", () => {
  const state = fresh(); state.day = 3;
  const guard = state.players.find((p) => p.role === "Guard")!;
  state.nightHistory = { 1: { guardTarget: 0, deaths: [] }, 2: { guardTarget: 1, deaths: [] }, 3: { guardTarget: 2, deaths: [{ seat: 2, reason: "poison" }], resultsAnnounced: false } };
  state.nightActions.lastGuardTarget = 2;
  state.players[0].alive = false;
  const privateInfo = buildGameContext(state, guard).split("</your_guard_info>")[0];
  assert.match(privateInfo, /第1夜 → 1号.*守护目标当夜未出局/);
  assert.match(privateInfo, /第2夜 → 2号.*守护目标当夜未出局/);
  assert.match(privateInfo, /第3夜 → 3号.*待天亮公布/);
  assert.match(privateInfo, /不能连续守护 3号/);
  assert.doesNotMatch(buildGameContext(state, state.players.find((p) => p.role === "Villager")!), /<your_guard_info>/);
});

test("实战回归：守护目标存活，但其他人死亡，不能把目标生存写成全场平安夜", () => {
  const state = fresh(); state.day = 2;
  const guard = state.players.find((p) => p.role === "Guard")!;
  state.nightHistory = { 1: { guardTarget: guard.seat, deaths: [], resultsAnnounced: true },
    2: { guardTarget: 0, deaths: [{ seat: 2, reason: "wolf" }], resultsAnnounced: true } };
  const context = buildGameContext(state, guard).split("</your_guard_info>")[0];
  assert.match(context, /全场第1夜：无人出局（平安夜）/);
  assert.match(context, /第2夜 → 1号.*守护目标当夜未出局；全场第2夜：3号出局，并非平安夜/);
  assert.doesNotMatch(context, /当晚平安无事|守护成功/);
  assert.match(context, /不能证明守护生效/);
  state.nightHistory[2].resultsAnnounced = false;
  const hidden = buildGameContext(state, guard).split("</your_guard_info>")[0];
  assert.match(hidden, /第2夜 → 1号.*待天亮公布/);
  assert.doesNotMatch(hidden, /全场第2夜|3号出局/);
  state.nightHistory[2] = { guardTarget: 0, resultsAnnounced: true };
  assert.match(buildGameContext(state, guard), /当夜结算记录缺失，不能判断目标生死或是否平安夜/);
});

test("跨日记录保留警上、PK轮次、警下和遗言标签，不把现在的死亡状态套入过往发言", () => {
  const state = fresh();
  state.messages = [
    message(state, "警上承诺", "DAY_BADGE_SPEECH", 0, 0),
    { ...message(state, "第一次PK", "DAY_PK_SPEECH", 0, 1), pkSource: "badge" as const },
    message(state, "警下改口", "DAY_SPEECH", 0, 2),
    { ...message(state, "第二次PK", "DAY_PK_SPEECH", 0, 3), pkSource: "vote" as const },
    message(state, "遗言证据", "DAY_LAST_WORDS", 0, 4),
  ];
  state.day = 2; state.players[0].alive = false;
  const transcript = buildPastDaysTranscript(state);
  assert.match(transcript, /警徽竞选发言/);
  assert.match(transcript, /PK.*警徽.*第1轮/);
  assert.match(transcript, /PK.*放逐.*第2轮/);
  assert.match(transcript, /遗言/);
  assert.doesNotMatch(transcript, /已出局/);
  assert.ok(transcript.indexOf("警上承诺") < transcript.indexOf("警下改口"));
});

test("结算免死白痴：中间态与最终态都不记录处决，公开票型标为免死", async () => {
  await import("@/lib/game-master");
  const { VotePhase } = await import("./VotePhase");
  const state = fresh("DAY_VOTE");
  const idiot = state.players.find((p) => p.role === "Idiot")!;
  state.votes = Object.fromEntries(state.players.filter((p) => p !== idiot).map((p) => [p.playerId, idiot.seat]));
  const snapshots: GameState[] = [];
  await new VotePhase().handleAction({ state, extras: {
    token: { value: 1, isValid: () => true }, humanPlayer: null,
    setGameState: (next: GameState) => snapshots.push(next), setDialogue: () => {}, setIsWaitingForAI: () => {},
    waitForUnpause: async () => {}, isTokenValid: () => true,
    onVoteComplete: async (next: GameState) => snapshots.push(next), onGameEnd: async () => {}, runAISpeech: async () => {},
  } }, { type: "RESOLVE_VOTES" });
  const end = snapshots.at(-1)!;
  assert.ok(snapshots.every((s) => !s.dayHistory?.[1]?.executed));
  assert.equal(end.players[idiot.seat].alive, true);
  assert.equal(end.roleAbilities.idiotRevealed, true);
  assert.equal(end.voteRounds?.[0].outcome, "idiot-revealed");
  assert.match(buildGameContext(end, end.players[0]), /白痴翻牌免死/);
  const legacy = { ...end, voteRounds: undefined, dayHistory: { 1: { executed: { seat: idiot.seat, votes: 9 }, idiotRevealed: { seat: idiot.seat } } } };
  assert.match(buildGameContext(legacy, legacy.players[0]), /白痴翻牌免死/);
  assert.doesNotMatch(buildGameContext(legacy, legacy.players[0]), /<today_deaths>/);
});

test("投票快照独立保留警徽与放逐各轮、候选人和当时警长，不能被后续修改覆盖", () => {
  let state = fresh();
  const voters = { [state.players[0].playerId]: 1, [state.players[2].playerId]: -1 };
  for (const kind of ["badge", "execution"] as const) {
    state = recordVoteRound(state, { kind, round: 1, candidates: [1, 2], votes: voters, sheriffSeat: kind === "execution" ? 0 : null, winnerSeat: null, outcome: "tie" });
    state = recordVoteRound(state, { kind, round: 2, candidates: [1], votes: { [state.players[0].playerId]: 1 }, sheriffSeat: null, winnerSeat: 1, outcome: kind === "badge" ? "elected" : "executed" });
  }
  voters[state.players[0].playerId] = 9;
  state.badge.holderSeat = 5;
  assert.equal(state.voteRounds?.length, 4);
  assert.equal(state.voteRounds![0].votes[state.players[0].playerId], 1);
  const duplicate = recordVoteRound(state, { ...state.voteRounds![0], votes: {} });
  assert.equal(duplicate.voteRounds!.length, 4);
  const context = buildGameContext(state, state.players[0]);
  assert.match(context, /警徽选举 第1轮/); assert.match(context, /警徽选举 第2轮/);
  assert.match(context, /放逐投票 第1轮/); assert.match(context, /放逐投票 第2轮/);
  assert.match(context, /1.5/); assert.doesNotMatch(context, /(?<!\d)0号/);
});

test("历史提交以段落 ID 幂等，不能吞掉同文的不同段落或下一轮的发言", async () => {
  const { addPlayerMessage } = await import("@/lib/game-master");
  let state = fresh(); const player = state.players[0];
  state = addPlayerMessage(state, player.playerId, "不对。", { id: "request-a:0" });
  state = addPlayerMessage(state, player.playerId, "不对。", { id: "request-a:0" });
  state = addPlayerMessage(state, player.playerId, "不对。", { id: "request-a:1" });
  state = addPlayerMessage(state, player.playerId, "不对。", { id: "request-b:0" });
  assert.equal(state.messages.length, 3);
});

test("真实放逐结算经过平票 PK 后仍保留第一轮和第二轮票型", async () => {
  await import("@/lib/game-master");
  const { VotePhase } = await import("./VotePhase");
  const state = fresh("DAY_VOTE");
  // 四人参与有效票，其余弃票：第一轮 2:2。
  state.votes = Object.fromEntries(state.players.map((p, index) => [p.playerId, index < 2 ? 4 : index < 4 ? 5 : -1]));
  let current = state;
  const runtime = {
    token: { value: 1, isValid: () => true }, humanPlayer: null,
    setGameState: (next: GameState) => { current = next; }, setDialogue: () => {}, setIsWaitingForAI: () => {},
    waitForUnpause: async () => {}, isTokenValid: () => true,
    onVoteComplete: async (next: GameState) => { current = next; }, onGameEnd: async () => {}, runAISpeech: async () => {},
  };
  const phase = new VotePhase();
  await phase.handleAction({ state, extras: runtime }, { type: "RESOLVE_VOTES" });
  assert.equal(current.phase, "DAY_PK_SPEECH");
  assert.equal(current.voteRounds?.[0].outcome, "tie");
  const firstVotes = { ...current.voteRounds![0].votes };
  current = { ...current, phase: "DAY_VOTE", votes: Object.fromEntries(state.players.map((p, index) => [p.playerId, index < 3 ? 4 : index === 3 ? 5 : -1])) };
  await phase.handleAction({ state: current, extras: runtime }, { type: "RESOLVE_VOTES" });
  assert.equal(current.voteRounds?.length, 2);
  assert.deepEqual(current.voteRounds![0].votes, firstVotes);
  assert.equal(current.voteRounds![1].round, 2);
  assert.equal(current.voteRounds![1].winnerSeat, 4);
});

test("开发回滚清掉未来轮次和夜间公开标记，避免未来信息留在提示词", async () => {
  await import("@/lib/game-master");
  const { applyBackwardJump } = await import("@/lib/SmartJumpManager");
  let state = fresh("DAY_RESOLVE");
  state.nightHistory = { 1: { resultsAnnounced: true, deaths: [] } };
  state = recordVoteRound(state, { kind: "badge", round: 1, candidates: [0], votes: {}, sheriffSeat: null, winnerSeat: 0, outcome: "elected" });
  state = recordVoteRound(state, { kind: "execution", round: 1, candidates: [0], votes: {}, sheriffSeat: 0, winnerSeat: null, outcome: "tie" });
  const result = applyBackwardJump(state, { day: 1, phase: "DAY_BADGE_SIGNUP" }, {
    direction: "backward", crossDay: false, missingTasks: [], playersToRevive: [], abilitiesToRestore: [], daysToClean: [],
  });
  assert.deepEqual(result.voteRounds, []);
  assert.equal(result.nightHistory?.[1].resultsAnnounced, false);
});

test("实战事实账本区分累计平安夜和连续平安夜，个人票型不能混淆警徽与放逐", async () => {
  const { buildDecisionGrounding } = await import("@/lib/prompt-utils");
  const state = fresh(); state.day = 5;
  const actor = state.players[0];
  state.nightHistory = { 1: { deaths: [] }, 2: { deaths: [] }, 3: { deaths: [{ seat: 0, reason: "wolf" }] }, 4: { deaths: [{ seat: 7, reason: "wolf" }] }, 5: { deaths: [], resultsAnnounced: false } };
  state.voteRounds = [
    { id: "badge-1", kind: "badge", day: 1, round: 1, candidates: [0, 7, 9], votes: {}, sheriffSeat: null, winnerSeat: 7, outcome: "elected" },
    { id: "execution-1", kind: "execution", day: 1, round: 1, candidates: [8], votes: { [actor.playerId]: 8 }, sheriffSeat: 7, winnerSeat: 8, outcome: "executed" },
  ];
  const context = buildDecisionGrounding(state, actor);
  assert.match(context, /第3夜：1号出局，不是平安夜/);
  assert.match(context, /第4夜：8号出局，不是平安夜/);
  assert.match(context, /第5夜：结果尚未公布/);
  assert.match(context, /本人第1天警徽选举第1轮：作为候选人没有投票资格/);
  assert.match(context, /本人第1天放逐第1轮：投给9号/);
  state.nightHistory[5].resultsAnnounced = true;
  assert.match(buildDecisionGrounding(state, actor), /第5夜：无人出局（平安夜）/);
});

test("最后发言者得到明确收尾约束，投票输入末尾保留本人的完整公开结论", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh(); state.badge.holderSeat = 0; state.daySpeechStartSeat = 1;
  const actor = state.players[0];
  state.messages = [message(state, "我今天不投6号，我的最终选择是10号。", "DAY_SPEECH")];
  const manager = new PhaseManager();
  assert.match(manager.getPrompt("DAY_SPEECH", { state }, actor)!.user, /你是本轮最后发言者/);
  state.phase = "DAY_VOTE";
  const vote = manager.getPrompt("DAY_VOTE", { state }, actor)!.user;
  assert.match(vote.split("<my_public_position>")[1], /我今天不投6号，我的最终选择是10号/);
  // 新判断（本人本轮已公开的分析）优先于旧立场，但仍保留「无新证据就别翻供」的默认。
  assert.match(vote, /改口是你的自由/);
  assert.match(vote, /沿用自己公开的结论/);
  // 不得无核实地复述「账算不平」类结论：可验证事实必须先自己核对。
  assert.match(vote, /必须自己先核对原始记录（票型、发言、死亡）/);
  assert.match(vote, /核对后发现对方讲的是事实，就不能再用这个理由投票/);
});

test("读票型／读刀口知识区块：白天拼入、夜间不拼入", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_VOTE");
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = villager.seat;
  const dayPrompt = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  // 票型：值錢的是集中灌票；死人的票參考價值低
  assert.match(dayPrompt.user, /【票型怎么读】/);
  assert.match(dayPrompt.user, /同一批人反复把票集中到同一个人身上/);
  assert.match(dayPrompt.user, /死人的票参考价值很低/);
  // 刀口：滅口／嫁禍兩種讀法、自刀洗白不成立
  assert.match(dayPrompt.user, /【读刀口】/);
  assert.match(dayPrompt.user, /也可以是嫁祸/);
  assert.match(dayPrompt.user, /自刀洗白/);
  assert.match(dayPrompt.user, /按当时的公开信息算/);
  // 夜间 prompt（狼出刀）不受污染
  const nightState = fresh("NIGHT_WOLF_ACTION");
  const nightWolf = nightState.players.find((p) => p.role === "Werewolf")!;
  nightState.currentSpeakerSeat = nightWolf.seat;
  const nightPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: nightState }, nightWolf)!;
  assert.doesNotMatch(nightPrompt.user, /【票型怎么读】/);
  assert.doesNotMatch(nightPrompt.user, /【读刀口】/);
});

test("警徽知识区块：交徽＝最后表态、接徽不等于免疫；夜间不拼入", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_VOTE");
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = villager.seat;
  const dayPrompt = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  assert.match(dayPrompt.user, /【警徽的作用与陷阱】/);
  assert.match(dayPrompt.user, /不是矛盾，是查验后的更新/);
  assert.match(dayPrompt.user, /接徽不等于免疫/);
  assert.match(dayPrompt.user, /这套解读作废/);
  // 排序：線索獨立性之後、金水之前
  assert.ok(
    dayPrompt.user.lastIndexOf("【警徽的作用与陷阱】") > dayPrompt.user.lastIndexOf("【线索独立性】") &&
      dayPrompt.user.lastIndexOf("【警徽的作用与陷阱】") < dayPrompt.user.lastIndexOf("【金水的用法与陷阱】"),
    "警徽區塊應排在線索獨立性與金水之間"
  );
  const nightState = fresh("NIGHT_WOLF_ACTION");
  const nightWolf = nightState.players.find((p) => p.role === "Werewolf")!;
  nightState.currentSpeakerSeat = nightWolf.seat;
  const nightPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: nightState }, nightWolf)!;
  assert.doesNotMatch(nightPrompt.user, /【警徽的作用与陷阱】/);
});

test("金水知识区块：说明用法与陷阱，但不禁止投票（允许自由选择）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_VOTE");
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = villager.seat;
  const dayPrompt = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  assert.match(dayPrompt.user, /【金水的用法与陷阱】/);
  // 陷阱說明：狼最想先刀預言家再騙全場投金水
  assert.match(dayPrompt.user, /狼队最想干的事/);
  // 兩邊的陷阱都講（金水也可能是狼遞的）
  assert.match(dayPrompt.user, /金水也可能是狼递的/);
  // 自由選擇：明說可以投，但要知道代價
  assert.match(dayPrompt.user, /你可以投金水/);
  // 不得再出現硬性禁止
  assert.doesNotMatch(dayPrompt.user, /不得投金水/);
  assert.doesNotMatch(dayPrompt.user, /放逐投票不得/);
  // 排序：緊接警徽之後
  assert.ok(
    dayPrompt.user.lastIndexOf("【金水的用法与陷阱】") > dayPrompt.user.lastIndexOf("【警徽的作用与陷阱】"),
    "金水區塊應在警徽區塊之後"
  );
  const nightState = fresh("NIGHT_WOLF_ACTION");
  const nightWolf = nightState.players.find((p) => p.role === "Werewolf")!;
  nightState.currentSpeakerSeat = nightWolf.seat;
  const nightPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: nightState }, nightWolf)!;
  assert.doesNotMatch(nightPrompt.user, /【金水的用法与陷阱】/);
});

test("场上现状：只陈述谁自称预言家、有无对跳，不附任何行动禁令", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_VOTE");
  const seer = state.players.find((p) => p.role === "Seer")!;
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = villager.seat;
  // 無人自稱：不顯示現況行
  const silent = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  assert.doesNotMatch(silent.user, /【场上现状】/);
  // 唯一自稱：陳述事實
  state.messages = [message(state, "我是预言家，昨晚查了5号是好人。", "DAY_SPEECH", seer.seat)];
  const lone = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  assert.match(lone.user, /【场上现状】/);
  assert.match(lone.user, /自称预言家，无人对跳/);
  assert.match(lone.user, new RegExp(`${seer.seat + 1}号`));
  // 不對跳時也不得下「不得把票投给」這種硬性禁令
  assert.doesNotMatch(lone.user, /不得把票投给/);
  assert.doesNotMatch(lone.user, /最终约束/);
  // 對跳：列出雙方
  const other = state.players.find((p) => p.role === "Witch")!;
  state.messages.push(message(state, "我才是预言家，他报的是假查验。", "DAY_SPEECH", other.seat));
  const two = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  assert.match(two.user, /对跳中/);
  assert.match(two.user, /对跳中）：|对跳中\)：/);
  // 夜間不拼入
  const nightState = fresh("NIGHT_WOLF_ACTION");
  const nightWolf = nightState.players.find((p) => p.role === "Werewolf")!;
  nightState.currentSpeakerSeat = nightWolf.seat;
  nightState.messages = [message(nightState, "我是预言家，昨晚查了5号是好人。", "DAY_SPEECH", nightState.players.find((p) => p.role === "Seer")!.seat)];
  const nightPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: nightState }, nightWolf)!;
  assert.doesNotMatch(nightPrompt.user, /【场上现状】/);
});

test("发言底线规则：未发言者不得被描述发言风格（禁止凭空「说话实」）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = villager.seat;
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, villager)!;
  assert.match(prompt.system, /严禁编造不存在的发言/);
  assert.match(prompt.system, /不得描述他的发言风格或内容/);
  assert.match(prompt.system, /明说没有依据的直觉/);
});

test("職業白天指引：預言家/女巫/守衛各得報帳守則，村民無；對跳守則緊貼無對跳守則且夜間不拼入", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  // 讓預言家私有段出現（seerHistory 空會提早 return）
  state.nightActions = { seerHistory: [{ day: 1, targetSeat: 8, isWolf: false }] };
  const seer = state.players.find((p) => p.role === "Seer")!;
  const witch = state.players.find((p) => p.role === "Witch")!;
  const guard = state.players.find((p) => p.role === "Guard")!;
  const villager = state.players.find((p) => p.role === "Villager")!;

  state.currentSpeakerSeat = seer.seat;
  const seerPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, seer)!;
  assert.match(seerPrompt.user, /<your_seer_checks>[\s\S]*查验公布指引/);
  assert.match(seerPrompt.user, /报完整帐目/);
  assert.match(seerPrompt.user, /不得编造听感、发言风格或发言内容/);
  assert.match(seerPrompt.user, /该跳的时机/);

  state.currentSpeakerSeat = witch.seat;
  const witchPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, witch)!;
  assert.match(witchPrompt.user, /<your_potions>[\s\S]*用药公布指引/);
  assert.match(witchPrompt.user, /报帐要完整/);
  assert.match(witchPrompt.user, /别把旧刀口当作今晚的信息/);

  state.currentSpeakerSeat = guard.seat;
  const guardPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, guard)!;
  assert.match(guardPrompt.user, /<your_guard_info>[\s\S]*守护公布指引/);
  assert.match(guardPrompt.user, /不得为圆先前的发言而改写或补造/);
  assert.match(guardPrompt.user, /「那晚我守了X」和「我守住了X」是两回事/);

  // 村民/狼不拿到三職業指引
  state.currentSpeakerSeat = villager.seat;
  const villagerPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, villager)!;
  assert.doesNotMatch(villagerPrompt.user, /公布指引/);

  // 夜間查验行動不帶白天指引（夜間提示另有一套）
  const nightState = fresh("NIGHT_SEER_ACTION");
  nightState.nightActions = { seerHistory: [{ day: 1, targetSeat: 8, isWolf: false }] };
  const nightSeer = nightState.players.find((p) => p.role === "Seer")!;
  nightState.currentSpeakerSeat = nightSeer.seat;
  const nightSeerPrompt = new PhaseManager().getPrompt("NIGHT_SEER_ACTION", { state: nightState }, nightSeer)!;
  assert.doesNotMatch(nightSeerPrompt.user, /查验公布指引/);

  // 預言家線讀法：進 rules；無對跳／對跳兩種情境都寫在同一塊知識裡
  const voteState = fresh("DAY_VOTE");
  const voteVillager = voteState.players.find((p) => p.role === "Villager")!;
  voteState.currentSpeakerSeat = voteVillager.seat;
  const votePrompt = new PhaseManager().getPrompt("DAY_VOTE", { state: voteState }, voteVillager)!;
  assert.match(votePrompt.user, /【预言家线的读法】/);
  assert.match(votePrompt.user, /有人对跳：别急着当天定输赢/);
  assert.match(votePrompt.user, /只排除与公开事实硬矛盾的那个/);
  assert.match(votePrompt.user, /报查验的节奏不算证据/);
  const nightWolfState = fresh("NIGHT_WOLF_ACTION");
  const nightWolf = nightWolfState.players.find((p) => p.role === "Werewolf")!;
  nightWolfState.currentSpeakerSeat = nightWolf.seat;
  const nightWolfPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: nightWolfState }, nightWolf)!;
  assert.doesNotMatch(nightWolfPrompt.user, /【预言家线的读法】/);
});

test("悍跳守则／警长职责／线索独立守则：分眾拼装与排序", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");

  // 悍跳守则：只拼入狼队私有段（白天）
  const wolf = state.players.find((p) => p.role === "Werewolf")!;
  state.currentSpeakerSeat = wolf.seat;
  const wolfPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, wolf)!;
  assert.match(wolfPrompt.user, /【悍跳的时机与收益（要不要跳，你自己决定）】/);
  assert.match(wolfPrompt.user, /报出来的查验必须跟公开事实对得上/);
  assert.match(wolfPrompt.user, /递金水给队友能绑票/);
  // 狼隊怎麼配合：知識型（不再是硬編碼條文）
  assert.match(wolfPrompt.user, /【狼队怎么配合】/);
  assert.match(wolfPrompt.user, /判断标准是狼队整体收益/);

  const villager = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = villager.seat;
  const villagerPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, villager)!;
  assert.doesNotMatch(villagerPrompt.user, /【悍跳的时机与收益/);
  assert.doesNotMatch(villagerPrompt.user, /【狼队怎么配合】/);

  // 警长职责：只有拿徽者收到；非拿徽者看不到（避免狼警長免費收割權威）
  state.phase = "DAY_VOTE";
  state.badge = { ...state.badge, holderSeat: villager.seat };
  const holderPrompt = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  assert.match(holderPrompt.user, /【你现在是警长】/);
  assert.match(holderPrompt.user, /把票集中起来/);
  assert.ok(
    holderPrompt.user.lastIndexOf("【你现在是警长】") > holderPrompt.user.lastIndexOf("【金水的用法与陷阱】"),
    "警长区块应排在 rules 最末"
  );
  state.badge = { ...state.badge, holderSeat: null };
  const noBadgePrompt = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  assert.doesNotMatch(noBadgePrompt.user, /【你现在是警长】/);

  // 线索独立守则：白天 rules 内、夾在查杀未证伪守则与警徽流守则之间
  assert.match(holderPrompt.user, /【线索独立性】/);
  assert.match(holderPrompt.user, /把关联当独立证据/);
  assert.ok(
    holderPrompt.user.indexOf("【线索独立性】") > holderPrompt.user.indexOf("【预言家线的读法】") &&
      holderPrompt.user.indexOf("【线索独立性】") < holderPrompt.user.indexOf("【警徽的作用与陷阱】"),
    "線索獨立性應夾在預言家線與警徽之間"
  );

  // 夜间三者均不拼入
  const nightState = fresh("NIGHT_WOLF_ACTION");
  const nightWolf = nightState.players.find((p) => p.role === "Werewolf")!;
  nightState.currentSpeakerSeat = nightWolf.seat;
  const nightPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: nightState }, nightWolf)!;
  assert.doesNotMatch(nightPrompt.user, /【悍跳的时机与收益/);
  assert.doesNotMatch(nightPrompt.user, /【你现在是警长】/);
  assert.doesNotMatch(nightPrompt.user, /【线索独立性】/);
});

test("投票不再硬性禁止投谁：保留知识提示，选择权交给玩家", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_VOTE");
  const seer = state.players.find((p) => p.role === "Seer")!;
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.messages = [
    message(state, "我得站出来拿个警徽，我是预言家！昨晚我查了10号，就是头狼！", "DAY_BADGE_SPEECH", seer.seat),
  ];
  state.currentSpeakerSeat = villager.seat;
  const votePrompt = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  // 舊的最終硬攔（不得把票投給唯一預言家）已移除
  assert.doesNotMatch(votePrompt.user, /最终约束/);
  assert.doesNotMatch(votePrompt.user, /不得把票投给/);
  assert.doesNotMatch(votePrompt.user, /几乎必然是好人自杀/);
  // 但仍保留知識：投掉唯一預言家是好人最常見的自殺方式
  assert.match(votePrompt.user, /好人最常见的自杀方式/);
  // 改口自由（真人會反悔），只要寫出理由
  assert.match(votePrompt.user, /改口是你的自由/);
  // 狼人同樣不受限
  const wolf = state.players.find((p) => p.role === "Werewolf")!;
  const wolfVote = new PhaseManager().getPrompt("DAY_VOTE", { state }, wolf)!;
  assert.doesNotMatch(wolfVote.user, /不得把票投给/);
});

test("全域动机与人味：每个玩家阶段都收到（想赢、允许不完美）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const dayState = fresh("DAY_SPEECH");
  const villager = dayState.players.find((p) => p.role === "Villager")!;
  dayState.currentSpeakerSeat = villager.seat;
  const dayPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state: dayState }, villager)!;
  assert.match(dayPrompt.system, /【你在玩什么】/);
  assert.match(dayPrompt.system, /你是来赢的/);
  assert.match(dayPrompt.system, /不会故意把自己阵营玩死/);
  assert.match(dayPrompt.system, /【允许不完美】/);
  assert.match(dayPrompt.system, /说漏嘴|说错/);

  const nightState = fresh("NIGHT_WOLF_ACTION");
  const wolf = nightState.players.find((p) => p.role === "Werewolf")!;
  nightState.currentSpeakerSeat = wolf.seat;
  const nightPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: nightState }, wolf)!;
  assert.match(nightPrompt.system, /【你在玩什么】/);
  assert.match(nightPrompt.system, /【允许不完美】/);

  // 發言底線：不再要求「立場必須連貫」，改成允許改口
  assert.match(dayPrompt.system, /立场可以改/);
  assert.doesNotMatch(dayPrompt.system, /保持立场连贯/);
  // 防幻覺底線仍在（不限制玩法，但不准編造事實）
  assert.match(dayPrompt.system, /严禁编造不存在的发言/);
});

test("新補提示（不限制）：女巫用藥記錄讀法、死人遺言兩種讀法、跟大流不構成狼證", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");

  // 女巫：白天與夜間都拿得到「用藥記錄的讀法」
  for (const phase of ["DAY_SPEECH", "NIGHT_WITCH_ACTION"] as const) {
    const state = fresh(phase);
    const witch = state.players.find((p) => p.role === "Witch")!;
    state.currentSpeakerSeat = witch.seat;
    const prompt = new PhaseManager().getPrompt(phase, { state }, witch)!;
    assert.match(prompt.user, /<your_potions>[\s\S]*【用药记录的读法】/);
    assert.match(prompt.user, /你救过的人＝那晚狼最想杀的人/);
    // 只是提示，明說由模型自己決定
    assert.match(prompt.user, /要不要照着走由你自己决定/);
  }
  // 非女巫看不到
  const vState = fresh("DAY_SPEECH");
  const villager = vState.players.find((p) => p.role === "Villager")!;
  vState.currentSpeakerSeat = villager.seat;
  const vPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state: vState }, villager)!;
  assert.doesNotMatch(vPrompt.user, /用药记录的读法/);

  // 死人遺言兩種讀法（讀刀口區塊）
  const dayState = fresh("DAY_VOTE");
  const voter = dayState.players.find((p) => p.role === "Villager")!;
  dayState.currentSpeakerSeat = voter.seat;
  const dayPrompt = new PhaseManager().getPrompt("DAY_VOTE", { state: dayState }, voter)!;
  assert.match(dayPrompt.user, /死人的话分两种/);
  assert.match(dayPrompt.user, /也可能是拉一个好人下水/);

  // 跟大流不構成狼證（票型區塊）
  assert.match(dayPrompt.user, /「随大流」本身不构成狼证/);
  assert.match(dayPrompt.user, /票跟自己的公开判断对不上/);

  // 夜間不拼入讀票型／讀刀口
  const nightState = fresh("NIGHT_WOLF_ACTION");
  const wolf = nightState.players.find((p) => p.role === "Werewolf")!;
  nightState.currentSpeakerSeat = wolf.seat;
  const nightPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: nightState }, wolf)!;
  assert.doesNotMatch(nightPrompt.user, /死人的话分两种/);
  assert.doesNotMatch(nightPrompt.user, /随大流/);
});

test("悍跳引導改為收益／時機（提示不限制）＋狼隊原則補『搶線』", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  const wolf = state.players.find((p) => p.role === "Werewolf")!;
  state.currentSpeakerSeat = wolf.seat;
  const wolfPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, wolf)!;

  // 時機與收益：獨跳沒對跳的那一輪最值錢、越早跳越像真的
  assert.match(wolfPrompt.user, /最值钱的时机是「真预言家独跳、没人对跳」的那一轮/);
  assert.match(wolfPrompt.user, /你等于每轮白送一票/);
  assert.match(wolfPrompt.user, /越早跳越像真的/);
  // 仍是提示：明說由狼自己決定
  assert.match(wolfPrompt.user, /要不要跳，你自己决定/);
  // 風險仍在（沒被拿掉）
  assert.match(wolfPrompt.user, /被证伪一次，你整条线就废了/);

  // 狼隊原則：切割與搶線並列
  assert.match(wolfPrompt.user, /切割和抢线是两条路/);
  // 好人拿不到狼隊私有段落
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = villager.seat;
  const vPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, villager)!;
  assert.doesNotMatch(vPrompt.user, /切割和抢线是两条路/);
});

test("自称预言家的辨识：自然跳法要认、第三人称支持不能误判（【场上现状】的事實來源）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const { findSeerClaimants } = await import("@/lib/prompt-utils");

  const state = fresh("DAY_SPEECH");
  const [n1, n2, n3] = state.players;
  state.messages = [
    // 自然跳法（實際對局出現過的句型）
    message(state, "得嘞，轮到我了。那我摊牌了，" + `${n1.seat + 1}号${n1.displayName}` + "，预言家。第一夜验的X号，查杀。", "DAY_BADGE_SPEECH", n1.seat),
    // 第三人稱：支持別人的線、別人的查殺，都不能算自稱
    message(state, "我跟着1号线走，这预言家我先信了。", "DAY_SPEECH", n2.seat),
    message(state, "我说句实在的，平安夜还没人跳预言家，这局狼藏得够深。", "DAY_SPEECH", n2.seat),
    message(state, "1号今天才报我的查杀，这预言家当得可真会挑时候。", "DAY_SPEECH", n2.seat),
  ];
  const claimants = findSeerClaimants(state);
  assert.deepEqual(claimants.map((p) => p.seat), [n1.seat]);

  // 白天 prompt 要拿到這條事實
  state.currentSpeakerSeat = n3.seat;
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, n3)!;
  assert.match(prompt.user, /【场上现状】目前只有/);
  assert.match(prompt.user, /自称预言家，无人对跳/);

  // 第二個人跳 → 對跳中
  state.messages = [
    ...state.messages,
    message(state, `我是${n3.seat + 1}号，我才是预言家，第一夜我查验了X号。`, "DAY_SPEECH", n3.seat),
  ];
  assert.equal(findSeerClaimants(state).length, 2);
  const prompt2 = new PhaseManager().getPrompt("DAY_SPEECH", { state }, state.players[1])!;
  assert.match(prompt2.user, /【场上现状】目前有 2 人自称预言家（对跳中）/);
});

test("白狼王自爆：拿得到【场上现状】與自爆算帳知識（純提示、不下命令）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");

  const state = fresh("WHITE_WOLF_KING_BOOM");
  const wwk = state.players.find((p) => p.role === "WhiteWolfKing")!;
  const seer = state.players.find((p) => p.role === "Seer")!;
  state.currentSpeakerSeat = wwk.seat;
  state.messages = [
    message(state, `那我摊牌了，${seer.seat + 1}号${seer.displayName}，预言家。第一夜验的X号，查杀。`, "DAY_BADGE_SPEECH", seer.seat),
  ];

  const prompt = new PhaseManager().getPrompt("WHITE_WOLF_KING_BOOM", { state }, wwk)!;
  // 事實：場上幾條預言家線（自爆划不划算的關鍵輸入）
  assert.match(prompt.user, /【场上现状】目前只有/);
  // 知識：算帳方式（跳過投票的收益、目標價值、有對跳時炸掉一個＝告訴全場被炸的是真的）
  // 自爆算帳屬於技能說明，與任務同在 system
  assert.match(prompt.system, /【自爆这笔账怎么算（要不要炸，你自己决定）】/);
  assert.match(prompt.system, /跳过投票本身就是收益/);
  assert.match(prompt.system, /等于亲手告诉全场「被炸的那个才是真的」/);
  assert.match(prompt.system, /这一刀是救线还是卖线/);
  // 沒有禁令字眼
  assert.doesNotMatch(prompt.system, /不得|禁止|必须/);

  // 好人拿不到自爆算帳內容
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.phase = "DAY_SPEECH";
  state.currentSpeakerSeat = villager.seat;
  const vPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, villager)!;
  assert.doesNotMatch(vPrompt.user, /自爆这笔账怎么算/);
});

test("第 2 天起也要知道「第 1 天警徽競選先於死訊公布」（女巫毒錯時間軸的修正）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  state.day = 2;
  state.currentSpeakerSeat = 0;
  const speaker = state.players[0];
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, speaker)!;
  // 泛用階段順序注也要講第 1 天的例外：競選在前、死訊在警長選出後才公布。
  assert.match(prompt.user, /第一天的警徽竞选先进行/);
  assert.match(prompt.user, /死讯在警长选出后才公布/);
  assert.match(prompt.user, /都发生在死讯公布之前/);
});

test("已死未公布的玩家：警徽報名／發言／投票名單要剔除（夜死者在公布前不參與）", async () => {
  const { excludePendingDeathPlayers, getPendingDeathSeats } = await import("@/lib/game-master");
  const state = fresh("DAY_BADGE_SPEECH");
  // 夜 1：狼刀 5號（raw 4）、女巫毒 10號（raw 9）→ 兩人都已死未公布。
  state.nightActions = { ...state.nightActions, pendingWolfVictim: 4, pendingPoisonVictim: 9 };
  assert.deepEqual(getPendingDeathSeats(state).sort(), [4, 9]);

  const candidates = state.players.filter((p) => [0, 1, 4, 9].includes(p.seat));
  const eligible = excludePendingDeathPlayers(state, candidates);
  assert.deepEqual(eligible.map((p) => p.seat).sort(), [0, 1]);

  // 沒有 pending 死亡時名單原樣返回
  const cleanState = { ...state, nightActions: {} };
  assert.equal(excludePendingDeathPlayers(cleanState, candidates), candidates);
});

test("警徽報名 prompt：上警收益/成本知識進 system，教判斷不下命令", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_BADGE_SIGNUP");
  const seer = state.players.find((p) => p.role === "Seer")!;
  state.currentSpeakerSeat = seer.seat;
  const prompt = new PhaseManager().getPrompt("DAY_BADGE_SIGNUP", { state }, seer)!;
  // 知識在 system（與 task 同層），不在 user
  assert.match(prompt.system, /【上警这笔账怎么算（报不报名，你自己决定）】/);
  assert.match(prompt.system, /有查验要第一时间报/);
  assert.match(prompt.system, /往往是免费暴露/);
  assert.match(prompt.system, /警徽流是预言家的信息线/);
  // 教知識不下命令：明說由自己判斷，且無禁令字眼
  assert.match(prompt.system, /由你结合自己的身份/);
  assert.doesNotMatch(prompt.system, /不得|禁止|必须报|不要报名/);
  // task 的 {tactics} 佔位符已渲染，格式說明仍完整
  assert.doesNotMatch(prompt.system, /\{tactics\}/);
  assert.match(prompt.system, /【输出格式】/);
  assert.match(prompt.system, /"signup":true/);
  assert.doesNotMatch(prompt.user, /上警这笔账/);
});

test("發言底線規則：要求大白話，禁成語/書面黑話（騎牆教訓）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  const speaker = state.players[0];
  state.currentSpeakerSeat = speaker.seat;
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, speaker)!;
  assert.match(prompt.system, /用大白话说，像平时聊天/);
  assert.match(prompt.system, /「骑墙」/);
  assert.doesNotMatch(prompt.system, /\{tactics\}/);
});

test("發言底線規則：公開翻牌推翻舊判斷時要認錯票（殷离嘴硬教訓）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  const speaker = state.players[0];
  state.currentSpeakerSeat = speaker.seat;
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, speaker)!;
  assert.match(prompt.system, /公开翻牌推翻你旧判断时/);
  assert.match(prompt.system, /这票就是投错了/);
});
