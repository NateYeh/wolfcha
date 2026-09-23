import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePlayerContextAuditState } from "../../../scripts/single-player-context-audit";
import { setLocale } from "@/i18n/locale-store";
import { buildGameContext, buildPastDaysTranscript, buildTodayTranscript } from "@/lib/prompt-utils";
import { recordVoteRound } from "@/lib/vote-rounds";
import type { GameState, Phase, Role } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "context-regression-key";
setLocale("zh-CN");

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

test("夜間行動帶 reason：四職業 prompt 要求一句話理由，jsonFormat 範例含 reason 字段", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");

  // 模型曾照抄範例裡的座位號（範例是「第一個可選玩家」，這局恰好是自己隊友），
  // 導致狼隊自刀——所以每個帶座位範例的模板都要明說「示例數字只是示意」。
  const antiCopyRule = /seat 必须是你真正要选的目标[\s\S]*不要照抄/;

  const seerState = fresh("NIGHT_SEER_ACTION");
  const seer = seerState.players.find((p) => p.role === "Seer")!;
  seerState.currentSpeakerSeat = seer.seat;
  const seerPrompt = new PhaseManager().getPrompt("NIGHT_SEER_ACTION", { state: seerState }, seer)!;
  assert.match(seerPrompt.user, /reason 字段用一句话说明你为什么查验他（30字内）/);
  assert.match(seerPrompt.user, /"reason":"一句话说明你为什么查验他"/);
  assert.match(seerPrompt.user, antiCopyRule);

  const wolfState = fresh("NIGHT_WOLF_ACTION");
  const wolf = wolfState.players.find((p) => p.role === "Werewolf")!;
  wolfState.currentSpeakerSeat = wolf.seat;
  const wolfPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: wolfState }, wolf)!;
  assert.match(wolfPrompt.user, /reason 字段用一句话说明你们为什么刀他（30字内）/);
  assert.match(wolfPrompt.user, /"reason":"一句话说明你们为什么刀他"/);
  assert.match(wolfPrompt.user, antiCopyRule);

  const guardState = fresh("NIGHT_GUARD_ACTION");
  const guard = guardState.players.find((p) => p.role === "Guard")!;
  guardState.currentSpeakerSeat = guard.seat;
  const guardPrompt = new PhaseManager().getPrompt("NIGHT_GUARD_ACTION", { state: guardState }, guard)!;
  assert.match(guardPrompt.user, /reason 字段用一句话说明你为什么守他（30字内）/);
  assert.match(guardPrompt.user, /"reason":"一句话说明你为什么守他"/);
  assert.match(guardPrompt.user, antiCopyRule);

  const witchState = fresh("NIGHT_WITCH_ACTION");
  const witch = witchState.players.find((p) => p.role === "Witch")!;
  witchState.currentSpeakerSeat = witch.seat;
  const witchPrompt = new PhaseManager().getPrompt("NIGHT_WITCH_ACTION", { state: witchState }, witch)!;
  // 女巫的技能段與格式範例（本輪任務）已移到 user
  assert.match(witchPrompt.user, /reason 字段用一句话说明你的判断（30字内）/);
  assert.match(witchPrompt.user, /"action":"save","reason"/);
  assert.match(witchPrompt.user, /"action":"poison","seat":\d+,"reason"/);
  assert.match(witchPrompt.user, antiCopyRule);
});

const decisions: Phase[] = ["DAY_BADGE_SIGNUP", "DAY_BADGE_ELECTION", "BADGE_TRANSFER", "DAY_VOTE", "HUNTER_SHOOT", "SELF_DESTRUCT", "DAY_SPEECH", "DAY_LAST_WORDS", "DAY_PK_SPEECH"];
for (const phase of decisions) {
  test(`阶段矩阵：${phase} 必须包含已公开的当天证据`, async () => {
    await import("@/lib/game-master");
    const { PhaseManager } = await import("../core/PhaseManager");
    const state = fresh(phase);
    state.pkSource = "badge";
    state.badge.candidates = [0, 1];
    state.messages = [message(state, "唯一公开证据：3号曾承认没有查验结果", "DAY_BADGE_SPEECH", 2)];
    const role = phase === "HUNTER_SHOOT" ? "Hunter" : phase === "SELF_DESTRUCT" ? "WhiteWolfKing" : "Villager";
    const actor = state.players.find((p) => p.role === role)!;
    state.currentSpeakerSeat = actor.seat;
    const prompt = new PhaseManager().getPrompt(phase, { state }, actor)!;
    assert.match(prompt.user, /唯一公开证据：3号曾承认没有查验结果/);
  });
}

test("警徽 PK 临时切换为自爆提示词，仍不能提前得知刀口结果；公布后才可知", async () => {
  const { generateSelfDestructDecision } = await import("@/lib/game-master");
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
    await generateSelfDestructDecision(state, actor);
    assert.match(prompt, /结果待天亮公布/);
    assert.doesNotMatch(prompt, /目标当晚出局/);
    assert.equal(state.nightHistory[1].resultsAnnounced, undefined);
    state.nightHistory[1].resultsAnnounced = true;
    await generateSelfDestructDecision(state, actor);
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
  // 票型與輪次結果現在寫進白天記錄（逐字稿），不再另立 <vote_rounds> 區塊；
  // 這裡驗「模型實際收到的輸入」裡仍看得到免死結果。
  const modelText = (s2: GameState): string =>
    `${buildGameContext(s2, s2.players[0])}\n${buildTodayTranscript(s2)}\n${buildPastDaysTranscript(s2)}`;
  assert.match(modelText(end), /白痴翻牌免死/);
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
  // 輪次資訊（含候選、當時警長票權、輪次編號）現在由白天記錄輸出：
  // 這裡的 state 沒有訊息可當錨點，驗的是「缺錨點也要補寫」這條路。
  const context = `${
    buildTodayTranscript(state)
  }`;
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

test("发言底线规则：未发言者不得被描述发言风格（禁止凭空「说话实」）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  const villager = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = villager.seat;
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, villager)!;
  // 說話要求（本輪任務）在 user；共用開場在 system。
  const full = `${prompt.system}\n${prompt.user}`;
  assert.match(full, /【底线规则】/);
  assert.match(full, /不得描述他的发言风格或内容/);
  assert.match(full, /明说没有依据的直觉/);
});

test("獵人開槍思路：被推出去時要看「誰在推你」，帶頭又給不出理由的最該打（已整併進統一攻略）", async () => {
  const { getI18n } = await import("@/i18n/translator");
  const guide = getI18n().t("promptUtils.strategyGuide.hunter");
  assert.match(guide, /看谁在推你/);
  assert.match(guide, /带头的那个如果拿不出可核对的理由/);
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

  // 發言底線：不再要求「立場必須連貫」，改成允許改口（說話要求在 user）
  const dayFull = `${dayPrompt.system}\n${dayPrompt.user}`;
  assert.match(dayFull, /立场可以改/);
  assert.doesNotMatch(dayFull, /保持立场连贯/);
  // 防幻覺底線仍在（不限制玩法，但不准編造事實）
  assert.match(dayFull, /【底线规则】/);
});

test("游戏基本盘：每个玩家阶段都收到（这是什么游戏、通用规则、角色技能一览）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const manager = new PhaseManager();

  // 玩家要拿主意的阶段都要帶著基本盤：不知道自己在玩什麼、規則有哪些，後面的推理都會歪。
  const playerPhases: Array<[Phase, string]> = [
    ["DAY_SPEECH", "Villager"],
    ["DAY_VOTE", "Villager"],
    ["DAY_BADGE_SPEECH", "Villager"],
    ["NIGHT_WOLF_ACTION", "Werewolf"],
    ["NIGHT_SEER_ACTION", "Seer"],
    ["NIGHT_WITCH_ACTION", "Witch"],
    ["NIGHT_GUARD_ACTION", "Guard"],
    ["HUNTER_SHOOT", "Hunter"],
  ];

  for (const [phase, role] of playerPhases) {
    const state = fresh(phase);
    const actor = state.players.find((p) => p.role === role)!;
    state.currentSpeakerSeat = actor.seat;
    const prompt = manager.getPrompt(phase, { state }, actor)!;
    assert.match(prompt.system, /【这是一局什么游戏】/, `${phase} 缺少遊戲基本盤`);
    assert.match(prompt.system, /【通用规则/, `${phase} 缺少通用規則`);
    assert.match(prompt.system, /【角色与技能/, `${phase} 缺少角色技能一覽`);
    assert.match(prompt.system, /警长（拿警徽的人）的票算 1\.5 票/, `${phase} 基本盤內容不完整`);
    assert.match(prompt.system, /遗言：被投票放逐的人有遗言/, `${phase} 基本盤缺少遺言規則`);
    // 基本盤是公開規則，不能沾到任何人的私有資訊
    assert.doesNotMatch(prompt.system, /【你的查验记录】|【你的药水状态】|【守护记录】/, `${phase} 基本盤混進了私有資訊`);
  }
});

test("第 2 天起也要知道「第 1 天警徽競選先於死訊公布」（女巫毒錯時間軸的修正）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  state.day = 2;
  state.currentSpeakerSeat = 0;
  const speaker = state.players[0];
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, speaker)!;
  // 時序知識（含第 1 天例外：競選在前、死訊在警長選出後才公布）已搬進共用攻略 →
  // 內容型斷言看 system＋user 全文（攻略在 system、逐人資訊在 user）。
  const full = `${prompt.system}\n\n${prompt.user}`;
  assert.match(full, /第一天例外：警徽竞选先进行/);
  assert.match(full, /死讯在警长选出后才公布/);
  assert.match(full, /都发生在死讯公布之前/);
  // 攻略是全桌同文的前綴，不能在逐人的 user 裡重貼一次
  assert.doesNotMatch(prompt.user, /第一天的警徽竞选先进行/);
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

test("發言底線規則：要求大白話，禁成語/書面黑話（騎牆教訓）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  const speaker = state.players[0];
  state.currentSpeakerSeat = speaker.seat;
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, speaker)!;
  const full = `${prompt.system}\n${prompt.user}`;
  assert.match(full, /用大白话说，像平时聊天/);
  assert.match(full, /「骑墙」/);
});

test("發言底線規則：公開翻牌推翻舊判斷時要認錯票（殷离嘴硬教訓）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  const speaker = state.players[0];
  state.currentSpeakerSeat = speaker.seat;
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, speaker)!;
  const full = `${prompt.system}\n${prompt.user}`;
  assert.match(full, /这票就是投错了/);
  // 「僅供參考、採不採納由你決定」的框架統一在【狼人殺攻略】的開頭說明
  assert.match(full, /所有条目都只是经验参考：怎么权衡、采不采纳，由你自己决定/);
});

test("發言經驗參考：不含警徽 meta 知識（模型本身已知；判讀原則走 buildDecisionGrounding）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  const speaker = state.players[0];
  state.currentSpeakerSeat = speaker.seat;
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, speaker)!;
  const full = `${prompt.system}\n${prompt.user}`;
  // 警徽 meta 知識已依指示移出經驗參考
  assert.doesNotMatch(full, /警徽移交值得核对/);
  assert.doesNotMatch(full, /徽链是线索不是铁证/);
  // 行為紀律（認錯票、對帳）保留
  assert.match(full, /这票就是投错了/);
  assert.match(full, /发言前对一遍账/);
});

test("發言底線規則：發言前先對帳，抓公開事實矛盾＋要關鍵線索", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  const speaker = state.players[0];
  state.currentSpeakerSeat = speaker.seat;
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, speaker)!;
  const full = `${prompt.system}\n${prompt.user}`;
  assert.match(full, /发言前对一遍账/);
  assert.match(full, /跳女巫却不报救了谁/);
  assert.match(full, /由你自己决定/);
});

test("白狼王自爆决策：farewell 翻桌宣言进 prompt 与解析结果（供带风向发挥）", async () => {
  const { generateSelfDestructDecision } = await import("@/lib/game-master");
  const state = fresh("DAY_SPEECH");
  const actor = state.players.find((p) => p.role === "WhiteWolfKing")!;
  const target = state.players.find((p) => p.alive && p.seat !== actor.seat)!;
  let prompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/demo-config") return Response.json({ active: false, enabled: false });
    prompt = String(init?.body);
    return Response.json({
      id: "test",
      choices: [{
        message: {
          role: "assistant",
          content: JSON.stringify({
            action: "boom",
            seat: target.seat + 1,
            farewell: "我是狼，刚才是演给你们看的。",
            reason: "队友快顶不住了，炸一个换信息",
          }),
        },
        finish_reason: "stop",
      }],
    });
  };
  try {
    const result = await generateSelfDestructDecision(state, actor);
    assert.equal(result.boom, true);
    assert.equal(result.targetSeat, target.seat);
    // 自爆沒有宣言也沒有遺言：prompt 不得再要求 farewell，也不再教翻桌台詞
    assert.match(prompt, /【自爆（白天专用技能）】/);
    assert.match(prompt, /没有遗言、没有自爆宣言/);
    assert.doesNotMatch(prompt, /farewell/);
    assert.match(prompt, /reason/);
  } finally { globalThis.fetch = originalFetch; }
});

// ============================================================================
// 統一攻略（strategyGuide）：2026-09 改版後的新契約
// 舊的「逐角色／逐階段分眾拼裝」測試已作廢——策略全部整併進 promptUtils.strategyGuide，
// 放在 system 共用前綴，全桌每個座位、每個階段看到的逐字相同。
// 這裡改成驗證三件事：攻略內容齊備、確實進共用前綴、私有區只留帳目。
// ============================================================================

test("統一攻略：進 system 共用前綴，且跨座位、跨階段逐字相同", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const { buildSharedSystemParts } = await import("@/lib/prompt-utils");

  const sharedTexts = (role: Role, phase: Phase) => {
    const state = fresh(phase);
    const player = state.players.find((p) => p.role === role)!;
    state.currentSpeakerSeat = player.seat;
    return buildSharedSystemParts(state).map((part) => part.text);
  };

  // 1) 開場區塊依序：公開知識（這是什麼遊戲＋通用規則＋角色技能＋本局配置＋勝負＋口徑）→ 攻略（含心態）
  const parts = sharedTexts("Villager", "DAY_SPEECH");
  assert.equal(parts.length, 2);
  // 公開知識全部收在同一段 <public_role_configuration>，順序：越通用的越前面
  assert.match(parts[0], /<public_role_configuration>/);
  const publicBlock = parts[0];
  const order = [
    "【这是一局什么游戏】",
    "【通用规则",
    "【角色与技能",
    "【本局公开角色配置】",
    "【获胜条件】",
    "【范围与口径】",
  ].map((heading) => publicBlock.indexOf(heading));
  assert.ok(order.every((i) => i >= 0), `公開知識缺少段落：${JSON.stringify(order)}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "公開知識段落順序不對");
  assert.match(parts[1], /【狼人杀攻略】/);
  assert.match(parts[1], /【你在玩什么】/);

  // 2) 全桌逐字相同：不同角色、不同階段拿到的共用前綴必須一致（前綴快取的前提）
  const baseline = sharedTexts("Villager", "DAY_SPEECH");
  for (const [role, phase] of [
    ["Werewolf", "NIGHT_WOLF_ACTION"],
    ["Seer", "NIGHT_SEER_ACTION"],
    ["Guard", "NIGHT_GUARD_ACTION"],
    ["Witch", "NIGHT_WITCH_ACTION"],
    ["Hunter", "HUNTER_SHOOT"],
    ["WhiteWolfKing", "SELF_DESTRUCT"],
    ["Villager", "DAY_VOTE"],
  ] as Array<[Role, Phase]>) {
    assert.deepEqual(sharedTexts(role, phase), baseline, `${role}/${phase} 的共用前綴必須與全桌一致`);
  }

  // 3) 階段 prompt 的 system 也確實帶著攻略（含夜間與放逐投票）
  for (const [role, phase] of [["Werewolf", "NIGHT_WOLF_ACTION"], ["Villager", "DAY_VOTE"]] as Array<[Role, Phase]>) {
    const state = fresh(phase);
    const player = state.players.find((p) => p.role === role)!;
    state.currentSpeakerSeat = player.seat;
    const system = new PhaseManager().getPrompt(phase, { state }, player)!.system;
    assert.match(system, /【狼人杀攻略】/);
    assert.match(system, /【警徽】/);
  }
});

test("統一攻略：通用判讀與好人陣營段落齊備", async () => {
  const { getI18n } = await import("@/i18n/translator");
  const g = getI18n();
  const basics = g.t("promptUtils.strategyGuide.basics");
  assert.match(basics, /【通用判读】/);
  assert.match(basics, /票型是最容易被骗的证据/);
  assert.match(basics, /同一批人反复把票集中到同一个人身上/);
  assert.match(basics, /死人的票价值很低/);
  assert.match(basics, /「随大流」本身不构成狼证/);
  assert.match(basics, /跟自己的公开判断对不上/);
  assert.match(basics, /刀口落在谁身上，通常说明狼觉得谁麻烦/);
  assert.match(basics, /「自刀洗白」基本不成立/);
  assert.match(basics, /把关联当独立证据/);
  assert.match(basics, /每次发言都要交出看法/);
  assert.match(basics, /直觉要配上账面/);
  assert.match(basics, /最后一步是拍身份/);

  const good = g.t("promptUtils.strategyGuide.goodCamp");
  assert.match(good, /神职跳身份的时机/);
  assert.match(good, /狼一定藏在没跳的平民里/);
  assert.match(good, /警推在先/);
  assert.match(good, /狼刀在先/);

  // 金水獨立成節（需場上有預言家才拼入）
  const gold = g.t("promptUtils.strategyGuide.goldWater");
  assert.match(gold, /金水的用法与陷阱/);
  assert.match(gold, /狼队最想干的事是先刀预言家/);
  assert.match(gold, /金水也可能是狼递的/);
  assert.match(gold, /你可以投金水/);
  assert.doesNotMatch(gold, /不得投金水/);
});

test("統一攻略：神職篇（預言家／女巫／守衛／獵人／白痴／騎士／禁言）齊備", async () => {
  const { getI18n } = await import("@/i18n/translator");
  const g = getI18n();

  const seer = g.t("promptUtils.strategyGuide.seer");
  assert.match(seer, /报完整帐目/);
  assert.match(seer, /不得编造听感、发言风格或发言内容当依据/);
  assert.match(seer, /该跳的时机/);
  assert.match(seer, /别拿角色名字、气质、气场当依据/);
  assert.match(seer, /能接棒带队的人/);
  assert.match(seer, /没有对跳时全场都该保他/);
  assert.match(seer, /对跳的先后以「公开可核对」为准/);
  assert.match(seer, /白狼王白天能自爆带人、跳过投票/);
  assert.match(seer, /别预先定罪对跳/);
  assert.match(seer, /等于把查验方向提前交给狼/);

  const witch = g.t("promptUtils.strategyGuide.witch");
  assert.match(witch, /解药全局只有一瓶，而且不能自救/);
  assert.match(witch, /你自己被刀就只能死/);
  assert.match(witch, /看不到之后的刀口/);
  assert.match(witch, /留到死的毒药等于没有毒药/);
  assert.match(witch, /盲毒算的是期望值/);
  assert.match(witch, /悍跳女巫的狼最优先/);
  assert.match(witch, /毒到猎人等于白废一把枪/);
  assert.match(witch, /药在你身上，你活着才有药/);
  assert.match(witch, /别急着亮身份/);
  assert.match(witch, /我今晚就毒谁/);
  assert.match(witch, /悍跳狼多半是临时起意/);

  const guard = g.t("promptUtils.strategyGuide.guard");
  assert.match(guard, /第一晚怎么守（避免奶穿）/);
  assert.match(guard, /首晚最稳的选择是空守/);
  assert.match(guard, /连守限制是你自己交出去的线索/);
  assert.match(guard, /收网阶段先算刀数/);
  assert.match(guard, /「那晚我守了X」和「我守住了X」是两回事/);

  const hunter = g.t("promptUtils.strategyGuide.hunter");
  assert.match(hunter, /先想好出局时要带走谁/);
  assert.match(hunter, /发言好坏参半就行/);
  assert.match(hunter, /回头把带头推你的那个带走/);
  assert.match(hunter, /我今晚要是被刀，枪口对准X号/);
  assert.match(hunter, /有人跳猎人：先自己算轮次/);
  assert.match(hunter, /警推在先就直接跳/);
  assert.match(hunter, /狼刀在先就别跳/);
  assert.match(g.t("promptUtils.strategyGuide.goodCamp"), /「警推在先」指好人只要白天都放逐到狼/);
  assert.match(g.t("promptUtils.strategyGuide.goodCamp"), /「狼刀在先」指狼队在刀上已经领先/);
  assert.match(hunter, /这个只有你有的视角去找他的队友/);
  assert.match(hunter, /被女巫毒死会闷枪/);
  assert.match(hunter, /看谁在推你/);
  assert.match(hunter, /带头的那个如果拿不出可核对的理由/);

  const idiot = g.t("promptUtils.strategyGuide.idiot");
  assert.match(idiot, /白痴是弱神/);
  assert.match(idiot, /被悍跳狼发查杀/);

  const villager = g.t("promptUtils.strategyGuide.villager");
  assert.match(villager, /你的技能就是那一票/);
  assert.match(villager, /表水是你唯一的自证手段/);
  assert.match(villager, /被假预言家发了查杀别慌/);

  const knight = g.t("promptUtils.strategyGuide.knight");
  assert.match(knight, /翻牌决斗是把自己的命押在判断上/);

  const mute = g.t("promptUtils.strategyGuide.mute");
  assert.match(mute, /禁言不是杀人/);
  assert.match(mute, /明天说话最有用的人/);
  // 回歸：禁言長老永遠是好人陣營，攻略必須先教她掂量陣營。
  // 舊版只教「壓影響力最大的人（強勢好人…）」，實測 AI 長老就照字面把警長＋預言家禁掉，
  // 理由寫「權力太大，得壓一壓看看」——好人陣營自己封住自己的嘴。
  assert.match(mute, /挑人之前先掂量阵营/);
  assert.match(mute, /等于替狼队封住好人自己的嘴/);
  // 也不能再留狼隊視角的禁言理由（好人陣營沒有隊友要保）
  assert.doesNotMatch(mute, /禁言自己人/);
  assert.doesNotMatch(mute, /让队友少说少错/);
  assert.match(mute, /好人阵营没有队友要保/);
});

test("統一攻略：狼隊篇（配合／悍跳／衝鋒倒勾／讀神民／落後局／票型紀律／自爆／遺言／狼王槍／夜刀）齊備", async () => {
  const { getI18n } = await import("@/i18n/translator");
  const g = getI18n();

  const team = g.t("promptUtils.strategyGuide.wolfTeam");
  assert.match(team, /狼队是一个整体/);
  assert.match(team, /切割和抢线是两条路/);
  assert.match(team, /最值钱的时机是「真预言家独跳、没人对跳」的那一轮/);
  assert.match(team, /越早跳越像真的/);
  assert.match(team, /递金水给队友能绑票/);
  assert.match(team, /冲锋/);
  assert.match(team, /倒勾/);
  assert.match(team, /多半是民；自信、敢四处给压力/);
  assert.match(team, /认账归队/);
  assert.match(team, /别跟队友把票压在同一个目标上/);
  assert.match(team, /跳过今天的投票加直接进夜/);
  assert.match(team, /第一次自爆只是把竞选拖到明天/);
  assert.match(team, /遗言纪律/);
  assert.match(team, /别在遗言里点队友、给队友递话/);

  // 白狼王自爆：獨立成節（有白狼王才拼入）
  const boomWwk = g.t("promptUtils.strategyGuide.wolfBoomWhiteWolfKing");
  assert.match(boomWwk, /还会带走一名存活玩家/);
  assert.match(boomWwk, /警徽直接流失/);

  const gun = g.t("promptUtils.strategyGuide.wolfGun");
  assert.match(gun, /优先打好人阵营的关键信息位/);
  assert.match(gun, /别打队友/);
  assert.match(gun, /看谁在推你/);

  const knife = g.t("promptUtils.strategyGuide.wolfKnife");
  assert.match(knife, /刀口看收益，不只看好杀/);
  assert.match(knife, /别因为「守卫可能守他」就放弃/);
  assert.match(knife, /坐实账/);
  assert.doesNotMatch(knife, /守卫最可能守护公开跳神的玩家/);
  // 守衛博弈（有守衛才拼入）
  const knifeGuard = g.t("promptUtils.strategyGuide.wolfKnifeGuard");
  assert.match(knifeGuard, /守卫最可能守护公开跳神的玩家/);
  assert.match(knifeGuard, /今晚连刀X命中率通常最高/);
  assert.match(knifeGuard, /避开第一条里守卫今晚最可能守的座位/);
  // 獵人槍口（有獵人才拼入）
  const knifeHunter = g.t("promptUtils.strategyGuide.wolfKnifeHunter");
  assert.match(knifeHunter, /猎人是全场唯一「杀了会反弹」的牌/);
  assert.match(knifeHunter, /被女巫毒死的猎人开不了枪/);
});

test("統一攻略：警徽篇（競選／紀律／徽流編解／聽徽流／移交／警長職責）齊備", async () => {
  const { getI18n } = await import("@/i18n/translator");
  const badge = getI18n().t("promptUtils.strategyGuide.badge");
  assert.match(badge, /警长有1.5票/);
  assert.match(badge, /上警买到的是警长的1.5票/);
  assert.match(badge, /往往是免费暴露/);
  assert.match(badge, /唯一跳预言家的人大概率是真预言家/);
  assert.match(badge, /接徽不等于免疫/);

  // 警徽流：預言家的東西，獨立成節（有預言家才拼入）
  const flow = getI18n().t("promptUtils.strategyGuide.badgeFlow");
  assert.match(flow, /徽流是预言家的信息线/);
  assert.match(flow, /单验式/);
  assert.match(flow, /顺验式/);
  assert.match(flow, /金水接徽/);
  assert.match(flow, /永远进不了徽流/);
  assert.match(flow, /先查落点逻辑再记账/);
  assert.match(badge, /你是警长时/);
});

test("角色私有區只留帳目與本輪資訊：策略已移出，村民/白痴/獵人不再有私有策略段", async () => {
  const { buildGameContext } = await import("@/lib/prompt-utils");
  const state = fresh("DAY_SPEECH");

  // 有帳目的角色：私有段仍在，但只剩帳目與紀錄（不得再夾帶指引）
  const seerCtx = buildGameContext(state, state.players.find((p) => p.role === "Seer")!);
  assert.match(seerCtx, /<your_seer_checks>/);
  assert.match(seerCtx, /【你的查验记录】/);
  assert.doesNotMatch(seerCtx, /查验公布指引/);
  assert.doesNotMatch(seerCtx, /警上怎么讲/);
  assert.doesNotMatch(seerCtx, /查验对象怎么选/);

  const witchCtx = buildGameContext(state, state.players.find((p) => p.role === "Witch")!);
  assert.match(witchCtx, /<your_potions>/);
  assert.doesNotMatch(witchCtx, /用药记录的读法/);
  assert.doesNotMatch(witchCtx, /解药什么时候该用/);
  assert.doesNotMatch(witchCtx, /毒药什么时候该用/);
  assert.doesNotMatch(witchCtx, /用药公布指引/);
  assert.doesNotMatch(witchCtx, /药在你身上/);

  const guardCtx = buildGameContext(state, state.players.find((p) => p.role === "Guard")!);
  assert.match(guardCtx, /<your_guard_info>/);
  assert.doesNotMatch(guardCtx, /守护公布指引/);
  assert.doesNotMatch(guardCtx, /【守人的取舍】/);

  const wolfCtx = buildGameContext(state, state.players.find((p) => p.role === "Werewolf")!);
  assert.match(wolfCtx, /<your_wolf_team>/);
  assert.match(wolfCtx, /【存活狼队】/);
  assert.doesNotMatch(wolfCtx, /【悍跳的时机与收益/);
  assert.doesNotMatch(wolfCtx, /【冲锋与倒勾/);
  assert.doesNotMatch(wolfCtx, /【落后局的站位/);
  assert.doesNotMatch(wolfCtx, /【狼人的遗言纪律/);
  assert.doesNotMatch(wolfCtx, /【猎人在场时的刀口风险】/);
  assert.doesNotMatch(wolfCtx, /【守卫在场时的刀口账】/);

  // 沒有帳目的角色：私有段整段移除（策略已在共用攻略）
  const villagerCtx = buildGameContext(state, state.players.find((p) => p.role === "Villager")!);
  assert.doesNotMatch(villagerCtx, /<your_villager_notes>/);
  const idiotCtx = buildGameContext(state, state.players.find((p) => p.role === "Idiot")!);
  assert.doesNotMatch(idiotCtx, /<your_idiot_notes>/);
  const hunterCtx = buildGameContext(state, state.players.find((p) => p.role === "Hunter")!);
  assert.doesNotMatch(hunterCtx, /<your_gun>/);
});

test("動態 rules 區只留逐日狀態相依的提示：時序與刀口常識已搬進共用攻略", async () => {
  const { buildGameContext, buildSharedSystemParts } = await import("@/lib/prompt-utils");
  const state = fresh("DAY_VOTE");
  const villager = state.players.find((p) => p.role === "Villager")!;
  const ctx = buildGameContext(state, villager);

  // 時序與刀口常識是整局固定的常識 → 進共用攻略（system 前綴），不再逐日重貼
  assert.doesNotMatch(ctx, /【刀口常识】/);
  assert.doesNotMatch(ctx, /阶段顺序/);
  const parts = buildSharedSystemParts(state);
  const guideText = parts.find((part) => part.text.includes("【狼人杀攻略】"))!.text;
  assert.match(guideText, /【刀口常识】狼可以刀队友，也可以自刀/);
  // 階段順序屬規則 → 在公開知識區塊（【通用规则】）裡，攻略只留時間線讀法
  assert.match(parts[0].text, /每天流程：夜晚（狼人刀人）→ 第一天先进行警徽竞选 → 天亮公布死亡/);
  // 讀盤策略移出
  assert.doesNotMatch(ctx, /【票型怎么读】/);
  assert.doesNotMatch(ctx, /【读刀口】/);
  assert.doesNotMatch(ctx, /【线索独立性】/);
  assert.doesNotMatch(ctx, /【警徽的作用与陷阱】/);
  assert.doesNotMatch(ctx, /【金水的用法与陷阱】/);
  assert.doesNotMatch(ctx, /【预言家线的读法】/);
  assert.doesNotMatch(ctx, /【有人跳猎人时怎么读】/);
  assert.doesNotMatch(ctx, /【守卫的规则与自报怎么读】/);
  assert.doesNotMatch(ctx, /【你现在是警长】/);
  // 陣容改由 system 共用前綴承載，user context 不再重複（重複會稀釋前綴快取）
  assert.doesNotMatch(ctx, /<public_role_configuration>/);
});

test("階段 prompt 不再夾帶階段戰術：狼人夜刀與自爆只剩任務與格式", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");

  const nightState = fresh("NIGHT_WOLF_ACTION");
  const wolf = nightState.players.find((p) => p.role === "Werewolf")!;
  nightState.currentSpeakerSeat = wolf.seat;
  const nightPrompt = new PhaseManager().getPrompt("NIGHT_WOLF_ACTION", { state: nightState }, wolf)!;
  assert.doesNotMatch(nightPrompt.user, /【守卫博弈】/);
  assert.doesNotMatch(nightPrompt.user, /【刀口优先级】/);
  // 但同一段內容仍在全桌共用的 system 攻略裡（狼人照樣讀得到）
  assert.match(nightPrompt.system, /守卫博弈/);
  assert.match(nightPrompt.system, /刀口看收益，不只看好杀/);

  const boomState = fresh("SELF_DESTRUCT");
  const wwk = boomState.players.find((p) => p.role === "WhiteWolfKing")!;
  boomState.currentSpeakerSeat = wwk.seat;
  const boomPrompt = new PhaseManager().getPrompt("SELF_DESTRUCT", { state: boomState }, wwk)!;
  assert.doesNotMatch(boomPrompt.system, /【自爆这笔账怎么算/);
  assert.match(boomPrompt.system, /跳过今天的投票加直接进夜/);
  assert.doesNotMatch(boomPrompt.system, /\{tactics\}/);
});

test("【身份】與【角色設定】綁成一塊：每個角色操作都帶同一份人設，且緊接身份之後", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const phases: Phase[] = [
    "NIGHT_GUARD_ACTION", "NIGHT_MUTE_ACTION", "NIGHT_WOLF_ACTION", "NIGHT_WITCH_ACTION", "NIGHT_SEER_ACTION",
    "DAY_BADGE_SIGNUP", "DAY_BADGE_ELECTION", "BADGE_TRANSFER", "DAY_SPEECH", "DAY_VOTE",
    "HUNTER_SHOOT", "SELF_DESTRUCT", "KNIGHT_DUEL",
  ];
  const checked: string[] = [];
  for (const phase of phases) {
    const state = fresh(phase);
    const player = state.players.find((p) => p.agentProfile?.persona) ?? state.players[0];
    state.currentSpeakerSeat = player.seat;
    const prompt = new PhaseManager().getPrompt(phase, { state }, player);
    if (!prompt) continue;
    const text = `${prompt.system}\n\n${prompt.user}`;
    // 人設逐人不同、只在 user：system 一律不得出現
    assert.doesNotMatch(prompt.system, /【角色设定】/, `${phase}: 角色設定不得進 system`);
    assert.match(text, /【角色设定】/, `${phase}: 缺少角色設定`);
    // 只有一份（不可重複注入）
    assert.equal(text.match(/【角色设定】/g)?.length, 1, `${phase}: 角色設定重複`);
    // 與【身份】綁成同一塊：緊接身份之後就是角色設定，中間不得插入其他小標題
    const settingIdx = text.indexOf("【角色设定】");
    assert.ok(settingIdx > 0, `${phase}: 角色設定未緊接身份`);
    const identityIdx = text.lastIndexOf("【身份】", settingIdx);
    assert.ok(identityIdx >= 0, `${phase}: 找不到身份區塊`);
    const between = text.slice(identityIdx + "【身份】".length, settingIdx);
    assert.ok(!between.includes("【"), `${phase}: 身份與角色設定之間插入了其他區塊`);
    assert.match(between, /你是 \d+号/, `${phase}: 身份區塊內容不完整`);
    // 人設必須是本座位那一份（不可串位）
    assert.match(text, new RegExp(`只按${player.seat + 1}号自己的视角表达`), `${phase}: 帶到別人的人設`);
    checked.push(phase);
  }
  // 13 個階段全數驗過，避免日後新增階段漏掉綁定
  assert.equal(checked.length, phases.length);
});

test("狼隊夜間商議也帶角色設定（狼隊操作不是例外）", async () => {
  const { buildWolfTeamPlanPrompt } = await import("@/lib/game-master");
  const state = fresh("NIGHT_WOLF_ACTION");
  const wolf = state.players.find((p) => p.role === "Werewolf" && p.agentProfile?.persona)!;
  state.currentSpeakerSeat = wolf.seat;
  const prompt = buildWolfTeamPlanPrompt(state, wolf);
  const text = `${prompt.system}\n\n${prompt.user}`;
  assert.doesNotMatch(prompt.system, /【角色设定】/);
  const settingIdx = text.indexOf("【角色设定】");
  const identityIdx = text.lastIndexOf("【身份】", settingIdx);
  assert.ok(identityIdx >= 0 && settingIdx > identityIdx, "角色設定未緊接身份");
  assert.ok(!text.slice(identityIdx + 4, settingIdx).includes("【"), "身份與角色設定之間插入了其他區塊");
  assert.match(text, new RegExp(`只按${wolf.seat + 1}号自己的视角表达`));
});

test("【第N天 白天记录】是獨立的 user content、排在第一個，且票型寫在同一段裡", async () => {
  const { buildMessagesForPrompt } = await import("@/lib/game-master");
  const state = fresh("DAY_SPEECH");
  state.day = 3;
  state.messages = [
    message(state, "第一天的發言", "DAY_SPEECH", 0, 0),
    {
      ...message(state, "发言结束，开始投票。", "DAY_VOTE", 0),
      playerId: "",
      isSystem: true,
      day: 1,
    },
    {
      ...message(state, "[VOTE_RESULT]{\"title\":\"投票详情\",\"results\":[{\"targetSeat\":5,\"voterSeats\":[0,1,2],\"voteCount\":3.5},{\"targetSeat\":0,\"voterSeats\":[5],\"voteCount\":1}]}", "DAY_VOTE", 0),
      playerId: "",
      isSystem: true,
      day: 1,
    },
    { ...message(state, "6号 玩家6 出局", "DAY_VOTE", 0), playerId: "", isSystem: true, day: 1 },
    { ...message(state, "第二天的發言", "DAY_SPEECH", 1, 0), day: 2 },
  ];

  const { PhaseManager } = await import("../core/PhaseManager");
  const player = state.players.find((p) => p.role === "Villager") ?? state.players[0];
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, player)!;
  const history = buildPastDaysTranscript(state);
  const { messages } = buildMessagesForPrompt({
    system: prompt.system,
    user: prompt.user,
    systemParts: prompt.systemParts,
    historyUser: history,
  });

  // 1) 獨立的 user content，排在第一個 user 位置（system 之後）
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  assert.equal(messages[2].role, "user");
  assert.equal(messages[1].content, history);
  assert.ok(String(messages[1].content).startsWith("【第1天 白天记录】"), "第一個 user 必須是過往紀錄");

  // 2) 主要 user 訊息不得再重複這份紀錄，也不再自己塞 <vote_rounds>
  assert.doesNotMatch(String(messages[2].content), /【第1天 白天记录】/);
  assert.doesNotMatch(String(messages[2].content), /<vote_rounds>/);
  assert.doesNotMatch(prompt.user, /<history>/);

  // 3) 票型寫在同一段紀錄裡：投票詳情＋逐票型（1 基座位、帶名字、警長 1.5 票）
  const historyText = String(messages[1].content);
  assert.match(historyText, /系统: 发言结束，开始投票。/);
  assert.match(historyText, /系统: 投票详情/);
  assert.match(historyText, /6号审计玩家6：3.5票，投票者为 1号审计玩家1、2号审计玩家2、3号审计玩家3/);
  assert.match(historyText, /1号审计玩家1：1票，投票者为 6号审计玩家6/);
  // 舊的原始 JSON 不得漏進 prompt
  assert.doesNotMatch(historyText, /\[VOTE_RESULT\]/);
});

test("出局玩家是合法線索：有人出局時附上的提醒要允許引用死者原話/遺言/票型/刀口", () => {
  const state = fresh("DAY_SPEECH");
  state.day = 3;
  state.players[4] = { ...state.players[4], alive: false };
  const ctx = buildGameContext(state, state.players[0]);

  assert.match(ctx, /<focus_reminder>/);
  // 明確允許：死者的話、遺言、票型、刀口都可引用對賬
  assert.match(ctx, /出局玩家说过的话、遗言、票型、被刀原因都是线索/);
  assert.match(ctx, /可以引用、可以对账/);
  // 只禁止無新資訊的重複與叫死者再發言
  assert.match(ctx, /不要反复复述已经公开过的旧信息/);
  assert.match(ctx, /不要请已经出局的玩家再发言/);
  // 舊的抑制措辭不得殘留
  assert.doesNotMatch(ctx, /不要过度复盘已出局玩家/);
});

test("ICU 參數漏傳會讓整段退化成 key：所有階段都不得出現未填佔位符或 i18n key", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const { buildWolfTeamPlanPrompt } = await import("@/lib/game-master");
  const phases: Phase[] = [
    "NIGHT_GUARD_ACTION", "NIGHT_MUTE_ACTION", "NIGHT_WOLF_ACTION", "NIGHT_WITCH_ACTION", "NIGHT_SEER_ACTION",
    "DAY_BADGE_SIGNUP", "DAY_BADGE_ELECTION", "BADGE_TRANSFER", "DAY_SPEECH", "DAY_VOTE",
    "HUNTER_SHOOT", "SELF_DESTRUCT", "KNIGHT_DUEL",
  ];
  // 沒填的 ICU 佔位符會讓 t() 拋 FORMATTING_ERROR 並回傳 key，prompt 就整段壞掉
  const broken = /\{(coreRules|seat|name|role|day|round|kind|vote|format|jsonFormat|v|who|seats|target|list|text|count|voters|alive|total|bullets|confirmed|phase|taskLine|campaignRequirements|guidelines|persona|options|example|knifeLine|speakOrder|phaseHintSection|phaseHint|todayTranscript|selfSpeech|selfSpeechSection|sharedContext|privateContext|noTranscript|lastWords|lastTarget|abstainLine|saveJsonFormat|poisonJsonFormat|passJsonFormat|tearJsonFormat|optionsLine)\}/;
  const keyLike = /\b(prompts|promptUtils|specialEvents|uiText|badgePhase)\.[a-zA-Z.]+/;
  const checked: string[] = [];
  for (const phase of phases) {
    const state = fresh(phase);
    const player = state.players.find((p) => p.agentProfile?.persona) ?? state.players[0];
    state.currentSpeakerSeat = player.seat;
    const prompt = new PhaseManager().getPrompt(phase, { state }, player);
    if (!prompt) continue;
    const text = `${prompt.system}\n${prompt.user}\n${prompt.historyUser ?? ""}`;
    assert.doesNotMatch(text, broken, `${phase}: 有未填的 ICU 佔位符`);
    assert.doesNotMatch(text, keyLike, `${phase}: prompt 出現 i18n key（t() 失敗回退）`);
    checked.push(phase);
  }
  // 狼隊商議（自組 prompt，不經 PhaseManager）
  const wolfState = fresh("NIGHT_WOLF_ACTION");
  const wolf = wolfState.players.find((p) => p.role === "Werewolf")!;
  const wolfPrompt = buildWolfTeamPlanPrompt(wolfState, wolf);
  const wolfText = `${wolfPrompt.system}\n${wolfPrompt.user}`;
  assert.doesNotMatch(wolfText, broken, "wolfTeamPlan: 有未填的 ICU 佔位符");
  assert.doesNotMatch(wolfText, keyLike, "wolfTeamPlan: prompt 出現 i18n key");
  assert.equal(checked.length, phases.length);
});

test("空表態不算發言：發言階段必須交出實質判斷（不能再「等X號」「且看警長定調」）", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  const player = state.players.find((p) => p.role === "Villager")!;
  state.currentSpeakerSeat = player.seat;
  const prompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, player)!;

  // 硬性底線（user 的發言底線）：每一輪至少交出一個實質結論
  assert.match(prompt.user, /发言必须有自己的判断：每一轮至少交出一个实质结论/);
  assert.match(prompt.user, /你此刻最怀疑谁、今天想把票给谁、或听到什么才会改/);
  assert.match(prompt.user, /「等X号」「先听听X号怎么说」「且看警长定调」/);
  // 攻略（system 共用前綴）也要有同一條
  const systemParts = (prompt.systemParts ?? []).map((part) => part.text).join("\n");
  assert.match(systemParts, /空表态不算发言/);
  assert.match(systemParts, /这一轮等于什么都没说/);
});

test("發言消極評估：每日摘要回報的消極座位，次日發言會被提醒積極參與", async () => {
  await import("@/lib/game-master");
  const { PhaseManager } = await import("../core/PhaseManager");
  const state = fresh("DAY_SPEECH");
  state.day = 2;
  const passive = state.players.find((p) => p.role === "Villager")!;
  const active = state.players.find((p) => p.role === "Werewolf")!;
  state.speechAssessment = { day: 1, passiveSeats: [passive.seat] };

  const passivePrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, passive)!;
  assert.match(passivePrompt.user, /【主持人評估】你上一輪的發言被判定為消極/);
  assert.match(passivePrompt.user, /這一輪請積極參與遊戲/);
  // 沒被評到的座位不受影響
  const activePrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state }, active)!;
  assert.doesNotMatch(activePrompt.user, /你上一輪的發言被判定為消極/);
  // 只管「次日」：第 3 天不再提醒
  const dayThree = { ...state, day: 3 };
  const laterPrompt = new PhaseManager().getPrompt("DAY_SPEECH", { state: dayThree }, passive)!;
  assert.doesNotMatch(laterPrompt.user, /你上一輪的發言被判定為消極/);
  // 提醒是逐人資訊，不得進 system 共用前綴
  assert.doesNotMatch(passivePrompt.system, /發言被判定為消極/);
});

test("發言消極名單正規化：1 基轉 0 基、去重，並排除出局與當日被禁言者", async () => {
  const { normalizePassiveSeats } = await import("@/lib/game-master");
  const state = fresh("DAY_SPEECH");
  state.day = 1;
  state.players = state.players.map((p, i) => (i === 3 ? { ...p, alive: false } : p));
  state.dayHistory = { 1: { muted: { seat: state.players[5].seat } } };

  const seats = normalizePassiveSeats([1, 1, "2", 4, 6, 99, "x", null], state);
  // 1 基 1、2 → 0 基 0、1；4 號已出局被排除；6 號當日被禁言被排除；99 越界、其餘非數字
  assert.deepEqual(seats, [0, 1]);
  // 非陣列一律視為空
  assert.deepEqual(normalizePassiveSeats(undefined, state), []);
  assert.deepEqual(normalizePassiveSeats("1,2", state), []);
});
