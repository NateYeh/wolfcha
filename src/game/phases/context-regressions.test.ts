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
  // 守卫倾向目标：公开跳神、警长、金水、昨晚刀口未死的目标。
  assert.match(prompt.user, /昨晚刀口没死的目标/);
  // 连刀逻辑：被刀却平安夜的目标，今晚守卫不能连守、女巫解药已用完。
  assert.match(prompt.user, /今晚连刀 X 命中率通常最高/);
  assert.match(prompt.user, /避开第 1 条里守卫今晚最可能守的座位/);
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
  // 硬认证目标禁射
  assert.match(prompt.system, /【开枪守则】/);
  assert.match(prompt.system, /这些目标绝不能射/);
  // 被预言家阵营放逐时：先核实查验链，禁止射金水/认证对象
  assert.match(prompt.system, /绝不能射他的金水或认证对象/);
  // 遗言目标可推翻，且守则必须排在遗言之后（recency 压过锚点）
  assert.match(prompt.system, /必须推翻遗言，重新按守则决定/);
  const lastWordsIdx = prompt.system.indexOf("【已经发生的公开记录：你的遗言】");
  const rulesIdx = prompt.system.indexOf("【开枪守则】");
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
  assert.match(vote, /投票必须跟这个新判断走/);
  assert.match(vote, /确实没有任何新发言或新事件时，才延续自己的公开结论/);
  // 不得无核实地复述「账算不平」类结论：可验证事实必须先自己核对。
  assert.match(vote, /必须自己先核对原始记录（票型、发言、死亡）/);
  assert.match(vote, /核对后发现对方讲的是事实，就不能再用这个理由投票/);
});

test("白天规则：死者票无效力＋无对跳保护唯一预言家；夜间不可见", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_VOTE");
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = villager.seat;
  const dayPrompt = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  // 死者票不能当狼队协作证据（本局好人曾把死亡玩家的警徽票读成悍跳证据）
  assert.match(dayPrompt.user, /死者票提示/);
  assert.match(dayPrompt.user, /只适用于存活玩家之间/);
  // 无对跳时唯一跳预言家大概率真，放逐他＝销毁信息源
  assert.match(dayPrompt.user, /无对跳守则/);
  assert.match(dayPrompt.user, /几乎必然是好人自杀/);
  // 查杀未证伪：女巫毒杀同目标＝相互印证；报查验时机／发挥失误非否定理由（本局真预言家被「毒杀解释死亡」反打投出）
  assert.match(dayPrompt.user, /查杀未证伪守则/);
  assert.match(dayPrompt.user, /属于相互印证/);
  assert.match(dayPrompt.user, /是水平问题不是身份证据/);
  // 夜间 prompt（狼出刀）不受这两条污染
  const nightState = fresh("NIGHT_WOLF_ACTION");
  const nightWolf = nightState.players.find((p) => p.role === "Werewolf")!;
  nightState.currentSpeakerSeat = nightWolf.seat;
  const nightPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: nightState }, nightWolf)!;
  assert.doesNotMatch(nightPrompt.user, /死者票提示/);
  assert.doesNotMatch(nightPrompt.user, /无对跳守则/);
  assert.doesNotMatch(nightPrompt.user, /查杀未证伪守则/);
});

test("警徽流守则：唯一无对跳预言家夜死交徽＝最后遗言，优先于生前口头怀疑；夜间不拼入", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_VOTE");
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = villager.seat;
  const dayPrompt = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  // 交徽＝死者最後、最可靠的表態（優先於生前口頭懷疑）
  assert.match(dayPrompt.user, /警徽流守则/);
  assert.match(dayPrompt.user, /优先于他生前任何口头怀疑/);
  // 「生前说从某两人里找狼、警徽却给了其中一人」不是矛盾，是查验后的更新
  assert.match(dayPrompt.user, /不是矛盾，而是查验后的更新/);
  // 逃生口：接徽者不因此免疫，質疑者要舉可核实的反证
  assert.match(dayPrompt.user, /必须给出可核实的反证/);
  // 防狼利用：已有硬反证證明跳預言家者是悍跳時本条不适用
  assert.match(dayPrompt.user, /本条不适用/);
  // 警徽流排在 rules 最末（recency 壓過死者生前發言锚点）
  assert.ok(
    dayPrompt.user.lastIndexOf("警徽流守则") > dayPrompt.user.lastIndexOf("查杀未证伪守则"),
    "警徽流守则应在查杀未证伪守则之后"
  );
  // 夜间（狼出刀）不拼入
  const nightState = fresh("NIGHT_WOLF_ACTION");
  const nightWolf = nightState.players.find((p) => p.role === "Werewolf")!;
  nightState.currentSpeakerSeat = nightWolf.seat;
  const nightPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: nightState }, nightWolf)!;
  assert.doesNotMatch(nightPrompt.user, /警徽流守则/);
});

test("投票最终约束：唯一跳预言家者无硬反证不得放逐；对跳/狼侧/本人不受约束", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_VOTE");
  const seer = state.players.find((p) => p.role === "Seer")!;
  const villager = state.players.find((p) => p.role === "Villager")!;
  const wolf = state.players.find((p) => p.role === "Werewolf")!;
  // 预言家在警徽竞选发言中自称预言家（20260916-003216 局同款：真预言家被 5:1 投出）
  state.messages = [
    message(state, "我得站出来拿个警徽，我是预言家！昨晚我查了10号，就是头狼！", "DAY_BADGE_SPEECH", seer.seat),
    message(state, "暂认2号预言家，查杀对得上。", "DAY_SPEECH", villager.seat),
  ];
  state.currentSpeakerSeat = villager.seat;
  const votePrompt = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  // 门在 prompt 最末尾（recency），点名座位并禁止无硬反证放逐
  assert.match(votePrompt.user, /最终约束：\d+号.+是场上唯一跳预言家/);
  assert.match(votePrompt.user, /不得把票投给/);
  assert.match(votePrompt.user, /几乎必然是好人自杀/);
  assert.ok(votePrompt.user.trimEnd().endsWith("好人自杀。"), "最终约束必须是 prompt 最后一段");

  // 出现第二位自称预言家（对跳）→ 约束解除
  const another = state.players.find((p) => p.role !== "Seer" && p.role !== "Villager" && p.role !== "Werewolf" && p.alive)!;
  state.messages.push(message(state, "我才是预言家，他查杀的是我队友的刀口目标。", "DAY_SPEECH", another.seat));
  const withCounter = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  assert.doesNotMatch(withCounter.user, /最终约束：/);

  // 狼人投票 prompt 不受约束（保留正常投预言家的自由）
  state.messages = [message(state, "我得站出来拿个警徽，我是预言家！昨晚我查了10号，就是头狼！", "DAY_BADGE_SPEECH", seer.seat)];
  const wolfVote = new PhaseManager().getPrompt("DAY_VOTE", { state }, wolf)!;
  assert.doesNotMatch(wolfVote.user, /最终约束：/);

  // 「不是预言家」等反例不算自称
  state.messages = [message(state, "我不是预言家，但如果预言家乱归票我第一个不服。", "DAY_SPEECH", villager.seat)];
  const noClaim = new PhaseManager().getPrompt("DAY_VOTE", { state }, villager)!;
  assert.doesNotMatch(noClaim.user, /最终约束：/);
});
