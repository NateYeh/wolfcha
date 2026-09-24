import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import type { ChatMessage, GameState, Player, Role } from "@/types/game";
import { ALL_ROLE_KEYS } from "./rules/boards";
import { getRoleName } from "./game-constants";
import {
  buildDecisionGrounding,
  buildPersonaSection,
  buildGameContext,
  buildPastDaysTranscript,
  buildPublicRoleConfiguration,
  buildSharedSystemParts,
  getStrategyGuide,
  buildTodayTranscript,
} from "./prompt-utils";

setLocale("zh-CN");

const rolesBySeat: Role[] = [
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
    isHuman: seat === 0,
  }));

const makeState = (messages: ChatMessage[] = []): GameState => ({
  gameId: "prompt-test",
  phase: "DAY_BADGE_SPEECH",
  day: 1,
  difficulty: "normal",
  players: makePlayers(),
  events: [],
  messages,
  currentSpeakerSeat: 0,
  daySpeechStartSeat: 7,
  speechDirection: "clockwise",
  badge: {
    holderSeat: null,
    candidates: [7, 8, 0, 2],
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
});

const message = (
  seat: number,
  content: string,
  phase: ChatMessage["phase"] = "DAY_BADGE_SPEECH",
  isLastWords = false
): ChatMessage => ({
  id: `m-${seat}-${content}`,
  playerId: `p${seat}`,
  playerName: `玩家${seat + 1}`,
  content,
  timestamp: Date.now(),
  day: 1,
  phase,
  isLastWords,
});

/** 共用前綴裡的那一份攻略：合併公開知識區塊後位置會變，用內容找比用索引穩。 */
const guidePart = (parts: { text: string }[]): string =>
  parts.find((part) => part.text.includes("【狼人杀攻略】"))?.text ?? "";

test("公开角色配置只包含人数板子，不包含座位身份", () => {
  const config = buildPublicRoleConfiguration({ players: Array.from({ length: 9 }, () => ({}) as never), fixedRoles: undefined });

  // 板子段落＝【本局公开角色配置】到【获胜条件】之前
  const board = config.slice(
    config.indexOf("【本局公开角色配置】"),
    config.indexOf("【获胜条件】"),
  );
  assert.match(board, /狼人 × 3/);
  assert.match(board, /预言家 × 1/);
  assert.match(board, /女巫 × 1/);
  assert.match(board, /猎人 × 1/);
  // 這局沒有的角色不得出現在板子裡（完整角色表另在【角色与技能】，且附了口径說明）
  assert.doesNotMatch(board, /白狼王/);
  assert.doesNotMatch(config, /\d+号/);
  assert.doesNotMatch(config, /玩家\d+/);
  assert.match(config, /狼人阵营：狼人数量 >= 好人数量 时获胜/);
  assert.match(config, /未被主持人公开确认的出局身份，不能用于断言当前剩余某角色的确切数量/);
});

test("公开角色配置必须包含本局每一个角色（禁言长老等新角色不得被静默吞掉）", () => {
  // 12 人预女猎禁版型：狼 4 + 预/女/猎/禁言长老 + 民 4（实测 log 里配置漏了禁言长老、总数 11≠12）
  const roles: Role[] = [
    "Werewolf", "Werewolf", "Werewolf", "Werewolf",
    "Seer", "Witch", "Hunter", "MuteElder",
    "Villager", "Villager", "Villager", "Villager",
  ];
  const players: Player[] = roles.map((role, seat) => ({
    playerId: `p${seat}`, seat, displayName: `玩家${seat + 1}`, alive: true, role,
    alignment: role === "Werewolf" ? "wolf" : "village", isHuman: false,
  }));
  const config = buildPublicRoleConfiguration({ players, fixedRoles: undefined });
  const board = config.slice(config.indexOf("【本局公开角色配置】"), config.indexOf("【获胜条件】"));
  assert.match(board, /狼人 × 4/);
  assert.match(board, /预言家 × 1/);
  assert.match(board, /女巫 × 1/);
  assert.match(board, /猎人 × 1/);
  assert.match(board, /禁言长老 × 1/, "配置漏角色 → AI 看到的总数对不上座位数");
  assert.match(board, /村民 × 4/);
  assert.doesNotMatch(board, /白狼王|守卫|白痴|骑士|狼王/);
});

test("每个实作角色都必须能出现在公开角色配置里（新角色加入 ALL_ROLE_KEYS 即生效）", () => {
  for (const role of ALL_ROLE_KEYS) {
    const players: Player[] = [{
      playerId: "p0", seat: 0, displayName: "玩家1", alive: true, role,
      alignment: role === "Werewolf" || role === "WhiteWolfKing" || role === "WolfKing" ? "wolf" : "village",
      isHuman: false,
    }];
    const config = buildPublicRoleConfiguration({ players, fixedRoles: undefined });
    assert.ok(
      config.includes(`${getRoleName(role)} × 1`),
      `角色 ${role}（${getRoleName(role)}）没出现在公开配置里`
    );
  }
});

test("攻略按本場陣容動態組合：缺席角色（守衛／獵人／白痴）不出現章節，狼私有段只留帳目", async () => {
  const { buildSharedSystemParts, getStrategyGuide } = await import("./prompt-utils");
  // 12 人预女猎禁变体：狼 4 + 预/女/禁言长老 + 民 5 —— 无守卫、无猎人、无白痴
  const roles: Role[] = [
    "Werewolf", "Werewolf", "Werewolf", "Werewolf",
    "Seer", "Witch", "MuteElder",
    "Villager", "Villager", "Villager", "Villager", "Villager",
  ];
  const players: Player[] = roles.map((role, seat) => ({
    playerId: `p${seat}`, seat, displayName: `玩家${seat + 1}`, alive: true, role,
    alignment: role === "Werewolf" ? "wolf" : "village", isHuman: false,
  }));
  const state: GameState = { ...makeState(), players, badge: { ...makeState().badge, candidates: [] } };
  const wolf = players[0];

  const guideText = guidePart(buildSharedSystemParts(state));
  // 本局有的角色：章節要在
  assert.match(guideText, /【预言家】/);
  assert.match(guideText, /【女巫】/);
  assert.match(guideText, /【禁言长老】/);
  assert.match(guideText, /【村民】/);
  assert.match(guideText, /【警徽流】/);
  // 本局沒有的角色：章節不得出現（免得模型去猜不存在的角色）
  assert.doesNotMatch(guideText, /【守卫】/);
  assert.doesNotMatch(guideText, /【猎人】/);
  assert.doesNotMatch(guideText, /【白痴】/);
  assert.doesNotMatch(guideText, /【骑士】/);
  assert.doesNotMatch(guideText, /【狼王开枪/);
  assert.doesNotMatch(guideText, /【白狼王自爆】/);
  assert.doesNotMatch(guideText, /守卫最可能守护公开跳神的玩家/);
  assert.doesNotMatch(guideText, /猎人是全场唯一「杀了会反弹」的牌/);
  // 泛用章節仍在
  assert.match(guideText, /【通用判读】/);
  assert.match(guideText, /【狼队】/);
  assert.match(guideText, /【夜间出刀】/);
  assert.match(guideText, /【警徽】/);

  // 狼私有段只留帳目
  const dayTeam = buildGameContext(state, wolf).match(/<your_wolf_team>[\s\S]*?<\/your_wolf_team>/)?.[0];
  assert.ok(dayTeam);
  assert.match(dayTeam, /【存活狼队】/);
  assert.doesNotMatch(dayTeam, /【狼队怎么配合】/);

  // 不傳 state＝全節都拼（測試／預覽用）
  const full = getStrategyGuide();
  assert.match(full, /【守卫】/);
  assert.match(full, /【猎人】/);
  assert.match(full, /【白痴】/);
});

test("攻略按本場陣容動態組合：守衛／獵人／白痴／騎士／狼王在場時章節跟著回來", async () => {
  const { buildSharedSystemParts } = await import("./prompt-utils");
  const roles: Role[] = [
    "Werewolf", "Werewolf", "WolfKing", "WhiteWolfKing",
    "Seer", "Witch", "Hunter", "Guard", "Idiot", "Knight",
    "Villager", "Villager",
  ];
  const players: Player[] = roles.map((role, seat) => ({
    playerId: `g${seat}`, seat, displayName: `玩家${seat + 1}`, alive: true, role,
    alignment: ["Werewolf", "WolfKing", "WhiteWolfKing"].includes(role) ? "wolf" : "village",
    isHuman: false,
  }));
  const state: GameState = { ...makeState(), players, badge: { ...makeState().badge, candidates: [] } };
  const guideText = guidePart(buildSharedSystemParts(state));
  assert.match(guideText, /【守卫】/);
  assert.match(guideText, /【猎人】/);
  assert.match(guideText, /【白痴】/);
  assert.match(guideText, /【骑士】/);
  assert.match(guideText, /【狼王开枪/);
  assert.match(guideText, /【白狼王自爆】/);
  assert.match(guideText, /【守卫博弈】/);
  assert.match(guideText, /【猎人在场时的刀口风险】/);
});


test("普通夜间出局只传死因未公开，公开技能死因才按主持人事件传入", () => {
  const state = makeState();
  state.phase = "DAY_SPEECH";
  state.players[4] = { ...state.players[4], alive: false };
  state.nightHistory = { 1: { deaths: [{ seat: 4, reason: "wolf" }] } };

  const unknownCauseContext = buildGameContext(state, state.players[2]);
  assert.match(unknownCauseContext, /\{seat: 5, name: 玩家5, day: 1, cause: 死因未公开\}/);
  assert.match(unknownCauseContext, /主持人已公开确认的身份事件】\n- 无/);
  assert.doesNotMatch(unknownCauseContext, /cause: 狼杀|cause: 毒杀/);

  state.players[5] = { ...state.players[5], alive: false };
  state.players[6] = { ...state.players[6], alive: false };
  state.dayHistory = { 1: { hunterShots: [{ hunterSeat: 5, targetSeat: 6 }] } };
  const publicShotContext = buildGameContext(state, state.players[2]);
  assert.match(publicShotContext, /\{seat: 7, name: 玩家7, day: 1, cause: 猎人公开开枪\}/);
  assert.match(publicShotContext, /6号玩家6 已由主持人公开确认为猎人/);
});

test("同一晚多槍：公開事實要逐槍列出，不能只留最後一槍", () => {
  // 槍打槍：5 號打死 6 號，6 號自己也開槍打死 7 號
  const state = makeState();
  state.players[5] = { ...state.players[5], alive: false };
  state.players[6] = { ...state.players[6], alive: false };
  state.players[7] = { ...state.players[7], alive: false };
  state.nightHistory = {
    1: {
      hunterShots: [
        { hunterSeat: 5, targetSeat: 6 },
        { hunterSeat: 6, targetSeat: 7 },
      ],
    },
  };
  const context = buildGameContext(state, state.players[2]);
  assert.match(context, /\{seat: 7, name: 玩家7, day: 1, cause: 猎人公开开枪\}/, "第一槍的目標要在");
  assert.match(context, /\{seat: 8, name: 玩家8, day: 1, cause: 猎人公开开枪\}/, "第二槍的目標也要在（以前會被覆蓋掉）");
});

test("狼人私密队伍按存活状态明确分组，且不包含村民", () => {
  const state = makeState();
  state.players[2] = { ...state.players[2], displayName: "村民玩家" };
  state.players[3] = { ...state.players[3], displayName: "死亡狼人", alive: false };

  const context = buildGameContext(state, state.players[1]);
  const wolfTeam = context.match(/<your_wolf_team>[\s\S]*?<\/your_wolf_team>/)?.[0];

  assert.ok(wolfTeam);
  assert.match(wolfTeam, /【存活狼队】2号玩家2、8号玩家8/);
  assert.match(wolfTeam, /【已出局狼队】4号死亡狼人/);
  assert.match(wolfTeam, /【狼人存活】2\/3/);
  assert.doesNotMatch(wolfTeam, /3号村民玩家/);
});

test("狼人协作原则已整併進統一攻略：私有段不再重複，日夜都能從共用前綴讀到", async () => {
  const { buildSharedSystemParts } = await import("./prompt-utils");
  const dayState = makeState();
  const dayTeam = buildGameContext(dayState, dayState.players[1]).match(/<your_wolf_team>[\s\S]*?<\/your_wolf_team>/)?.[0];
  assert.ok(dayTeam);
  assert.doesNotMatch(dayTeam, /【狼队怎么配合】/);

  const guideText = guidePart(buildSharedSystemParts(dayState));
  assert.match(guideText, /狼队是一个整体/);
  assert.match(guideText, /必要时把票投给他（弃车保帅）/);
  assert.match(guideText, /他还有救/);
});


test("票型／刀口读法已從 rules 移出：白天所有阵营都從共用攻略讀到同一份", async () => {
  const { buildSharedSystemParts } = await import("./prompt-utils");
  const dayState = makeState();
  const villager = dayState.players.find((p) => p.role === "Villager")!;
  const wolf = dayState.players.find((p) => p.role === "Werewolf")!;
  for (const actor of [villager, wolf]) {
    const ctx = buildGameContext(dayState, actor);
    // 動態規則區不再放時序與刀口常識（搬進共用攻略），只留逐日狀態相依的提示；
    // 非平安夜時整個 <rules> 區塊都可以不存在。
    const rules = ctx.match(/<rules>[\s\S]*?<\/rules>/)?.[0] ?? "";
    assert.doesNotMatch(rules, /【刀口常识】/);
    assert.doesNotMatch(rules, /阶段顺序/);
    assert.doesNotMatch(rules, /【票型怎么读】/);
    assert.doesNotMatch(rules, /【读刀口】/);
    // user context 也不再重貼同一段
    assert.doesNotMatch(ctx, /【刀口常识】/);
    assert.doesNotMatch(ctx, /阶段顺序/);
  }

  // 全桌同一份攻略：票型／刀口讀法（含反例）都在裡面，人人看得到
  const guideText = guidePart(buildSharedSystemParts(dayState));
  assert.match(guideText, /票型是最容易被骗的证据/);
  assert.match(guideText, /狼投队友的时候比谁都真/);
  assert.match(guideText, /同一批人反复把票集中到同一个人身上/);
  assert.match(guideText, /尤其是警徽票灌给同一个人/);
  assert.match(guideText, /也可以是嫁祸/);
  assert.match(guideText, /故意刀掉质疑某人最凶的好人/);
  assert.match(guideText, /「自刀洗白」基本不成立/);
  assert.match(guideText, /白狼王白天能自爆带人/);
  // 時序（含第一天例外）與刀口常識也在這份攻略裡
  assert.match(guideText, /【刀口常识】狼可以刀队友，也可以自刀/);
  assert.match(guideText, /第一天例外：警徽竞选先进行/);
  assert.match(guideText, /不要把今天的上警、跳身份或发言，当作昨夜被刀的直接原因/);
});


test("警徽竞选期间明确死亡结果未公布，不能从空死亡列表推断平安夜", () => {
  const state = makeState();
  state.nightHistory = { 1: { wolfTarget: 4, deaths: [] } };

  const context = buildGameContext(state, state.players[2], { excludePendingDeaths: true });

  assert.match(context, /<unannounced_night_result>/);
  assert.match(context, /主持人尚未公布昨夜死亡结果/);
  assert.match(context, /不能从当前死亡列表为空推断为平安夜/);
  assert.doesNotMatch(context, /平安夜说明/);
});

test("历史消息保持真实时间顺序，不把遗言通知提前到白天发言前", () => {
  const state = makeState([
    message(2, "3号警徽竞选发言"),
    {
      id: "badge-awarded",
      playerId: "system",
      playerName: "主持人",
      content: "警徽授予 1号 玩家1（2票）",
      timestamp: Date.now(),
      day: 1,
      phase: "DAY_BADGE_ELECTION",
      isSystem: true,
    },
    {
      id: "night-death-announced",
      playerId: "system",
      playerName: "主持人",
      content: "5号 玩家5 昨晚出局",
      timestamp: Date.now(),
      day: 1,
      phase: "DAY_BADGE_ELECTION",
      isSystem: true,
    },
    message(0, "1号白天自由发言", "DAY_SPEECH"),
    {
      id: "last-words-start",
      playerId: "system",
      playerName: "主持人",
      content: "请 3号 玩家3 发表遗言",
      timestamp: Date.now(),
      day: 1,
      phase: "DAY_LAST_WORDS",
      isSystem: true,
    },
    message(2, "3号最后发表遗言", "DAY_LAST_WORDS", true),
  ]);
  state.day = 2;
  state.players[4] = { ...state.players[4], alive: false };
  state.nightHistory = { 1: { deaths: [{ seat: 4, reason: "wolf" }] } };

  const history = buildPastDaysTranscript(state);

  assert.ok(history.indexOf("3号警徽竞选发言") < history.indexOf("警徽授予 1号"));
  assert.ok(history.indexOf("警徽授予 1号") < history.indexOf("5号 玩家5 昨晚出局"));
  assert.ok(history.indexOf("5号 玩家5 昨晚出局") < history.indexOf("1号白天自由发言"));
  assert.ok(history.indexOf("1号白天自由发言") < history.indexOf("请 3号 玩家3 发表遗言"));
  assert.ok(history.indexOf("请 3号 玩家3 发表遗言") < history.indexOf("3号最后发表遗言"));
  assert.doesNotMatch(history, /夜晚出局:/);
});

test("猎人公开开枪会结构化确认猎人身份，但不把目标身份当成查验结果", () => {
  const state = makeState();
  state.day = 3;
  state.phase = "DAY_SPEECH";
  state.players[5] = { ...state.players[5], alive: false };
  state.players[8] = { ...state.players[8], alive: false };
  state.nightHistory = {
    3: {
      deaths: [{ seat: 5, reason: "wolf" }],
      hunterShots: [{ hunterSeat: 5, targetSeat: 8 }],
    },
  };

  const context = buildGameContext(state, state.players[2]);

  assert.match(context, /6号玩家6 已由主持人公开确认为猎人/);
  assert.match(context, /开枪不产生查验结果，也不公开 9号玩家9 的身份/);
  assert.match(context, /<today_deaths>[\s\S]*seat: 6, name: 玩家6[\s\S]*seat: 9, name: 玩家9[\s\S]*<\/today_deaths>/);
  assert.doesNotMatch(context, /9号玩家9 已由主持人公开确认为/);
});

test("历史弃票不会被格式化成不存在的 0 号玩家", () => {
  const state = makeState();
  state.day = 3;
  state.phase = "DAY_SPEECH";
  state.voteHistory = { 2: { p0: -1, p1: 4 } };
  state.dayHistory = { 2: { executed: { seat: 4, votes: 1 }, sheriffSeatAtVote: null } };

  const context = buildGameContext(state, state.players[2]);
  const votes = context.match(/<votes>[\s\S]*?<\/votes>/)?.[0] || "";

  assert.doesNotMatch(votes, /0号/);
  assert.match(votes, /5号玩家5: \{票数: 1, 投票者: \[2\]\}/);
});

test("阶段顺序只写成静的公開知識：一般顺序为主、警徽竞选只写成第一天例外", async () => {
  const { buildSharedSystemParts } = await import("./prompt-utils");
  const state = makeState();
  state.day = 2;
  state.phase = "DAY_SPEECH";

  // 靜態前綴不能再隨「今天第幾天」變動：一般流程照寫（第一天先競選，見【通用规则】），
  // 攻略只留「第一天例外」與時間線讀法，不能把警徽竞选塞進常规顺序。
  const parts = buildSharedSystemParts(state);
  const publicBlock = parts[0].text;
  const guideText = guidePart(parts);
  assert.match(publicBlock, /每天流程：夜晚（狼人刀人）→ 第一天先进行警徽竞选 → 天亮公布死亡 → 自由发言 → 放逐投票/);
  assert.match(guideText, /第一天例外：警徽竞选先进行/);
  assert.doesNotMatch(publicBlock + guideText, /夜晚（狼人刀人）→ 警徽竞选 → 天亮公布死亡/);

  // user context 不再重複同一段（重複會稀釋前綴快取）
  const context = buildGameContext(state, state.players[2]);
  assert.match(context, /game_status: ongoing/);
  assert.doesNotMatch(context, /阶段顺序/);
});

test("当天玩家死亡后仍保留其已发生的发言，并保持遗言的真实顺序", () => {
  const state = makeState([
    message(7, "8号先发言"),
    message(8, "9号随后发言"),
    message(0, "我要验竞选了尚未发言的3号"),
    message(2, "3号之后才发言"),
    message(7, "8号最后发表遗言", "DAY_LAST_WORDS", true),
  ]);
  state.players[7] = { ...state.players[7], alive: false };

  const transcript = buildTodayTranscript(state);

  assert.match(transcript, /8号: 8号先发言/);
  // 不再逐句標「（当前已出局）」：時間線上後面的放逐／開槍／遺言標記已經說明白了
  assert.doesNotMatch(transcript, /当前已出局/);
  assert.ok(transcript.indexOf("8号先发言") < transcript.indexOf("9号随后发言"));
  assert.ok(transcript.indexOf("9号随后发言") < transcript.indexOf("我要验竞选了尚未发言的3号"));
  assert.ok(transcript.indexOf("我要验竞选了尚未发言的3号") < transcript.indexOf("3号之后才发言"));
  assert.ok(transcript.indexOf("3号之后才发言") < transcript.indexOf("8号最后发表遗言"));
});

test("行动者自己的发言仍保留在正式 Prompt 的原始时间位置", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "prompt-utils-test-key";
  await import("@/lib/game-master");
  const { DaySpeechPhase } = await import("@/game/phases/DaySpeechPhase");
  const state = makeState([
    message(7, "8号先发言"),
    message(8, "9号随后发言"),
    message(0, "我要验尚未发言的3号"),
    message(2, "3号之后才发言"),
  ]);
  state.phase = "DAY_SPEECH";
  state.badge.holderSeat = 0;
  const prompt = new DaySpeechPhase().getPrompt({ state }, state.players[0]);

  assert.ok(prompt.user.indexOf("8号先发言") < prompt.user.indexOf("9号随后发言"));
  assert.ok(prompt.user.indexOf("9号随后发言") < prompt.user.indexOf("我要验尚未发言的3号"));
  assert.ok(prompt.user.indexOf("我要验尚未发言的3号") < prompt.user.indexOf("3号之后才发言"));
  // 自己的發言不再另列一段重述（也不再印「已在時間線上」的自我說明）
  assert.doesNotMatch(prompt.user, /你的发言已作为1号保留/);
  assert.doesNotMatch(prompt.user, /【你本日已说过的话】/);
  // 但發言順序與內容仍留在時間線的實際位置（上面已驗相對順序）
  assert.match(prompt.user, /【本日讨论记录】/);
});

test("发言顺序上下文只陈述本轮客观记录，不加入策略建议", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "prompt-utils-test-key";
  await import("@/lib/game-master");
  const { DaySpeechPhase } = await import("@/game/phases/DaySpeechPhase");
  const state = makeState([
    message(7, "8号先发言"),
    message(8, "9号随后发言"),
  ]);
  state.phase = "DAY_BADGE_SPEECH";
  state.currentSpeakerSeat = 0;
  state.daySpeechStartSeat = 7;
  state.speechRoundStartMessageIndex = 0;
  const prompt = new DaySpeechPhase().getPrompt({ state }, state.players[0]);
  const statusSection = prompt.user.match(/【发言顺序】\n([\s\S]*?)\n\n轮到你发言/)?.[1];

  assert.ok(statusSection);
  assert.match(statusSection, /本轮全部发言参与者（共4人，含已发言与尚未发言）：8号、9号、1号、3号/);
  assert.match(statusSection, /当前轮到：1号（第3\/4位）/);
  assert.match(statusSection, /已有公开发言记录：8号、9号/);
  assert.match(statusSection, /尚未轮到且没有公开发言记录：3号/);
  // 發言順序區段本身不得夾帶任何策略建議（規則區塊不在這一段內）
  assert.doesNotMatch(
    statusSection,
    /可以|建议|应该|先抛|回应|更想看谁|能不能带队|哪里站不住|想争取的东西|想达到什么效果|你可以坦诚|带节奏/
  );
});

test("与玩家有关的公开信息只陈述事实，不引导如何发言", async () => {
  const { buildPublicFactsForPlayer } = await import("./prompt-utils");
  const state = makeState([
    message(1, "我点名1号说一下"),
  ]);
  state.phase = "DAY_SPEECH";
  const facts = buildPublicFactsForPlayer(state, state.players[0]);

  assert.match(facts, /【与你有关的公开事实】/);
  assert.match(facts, /2号点名提到过你/);
  assert.doesNotMatch(facts, /可以|建议|应该|先抛|回应|想想|角度/);
});

test("警徽移交后仍按事件快照展示原竞选赢家和历史警长票权", () => {
  const state = makeState();
  state.day = 2;
  state.phase = "DAY_SPEECH";
  state.badge.holderSeat = 4;
  state.badge.history = { 1: { p4: 8 } };
  state.badge.electionWinners = { 1: 8 };
  state.voteHistory = {
    1: {
      p0: 2,
      p1: 8,
      p2: 8,
      p3: 8,
      p4: 8,
      p5: 8,
      p6: 2,
      p7: 8,
      p8: 2,
    },
  };
  state.dayHistory = {
    1: { executed: { seat: 8, votes: 6 }, sheriffSeatAtVote: 8 },
  };
  // 模拟旧错误摘要，事件快照必须优先于它。
  state.dailySummaryVoteData = {
    1: {
      sheriff_election: { winner: 4, votes: { 8: [4] } },
      execution_vote: { eliminated: 8, votes: { 8: [1, 2, 3, 4, 5, 7], 2: [0, 6, 8] } },
    },
  };

  const context = buildGameContext(state, state.players[0]);
  const votes = context.match(/<votes>[\s\S]*?<\/votes>/)?.[0] || "";

  assert.match(votes, /结果: 9号玩家9 当选警长/);
  assert.doesNotMatch(votes, /结果: 5号玩家5 当选警长/);
  assert.match(votes, /9号玩家9: \{票数: 6, 投票者: \[2,3,4,5,6,8\]\}/);
  assert.match(votes, /3号玩家3: \{票数: 3\.5, 投票者: \[1,7,9\]\}/);
});

test("旧存档缺少投票时警长快照时不使用当前警长伪造历史票数", () => {
  const state = makeState();
  state.day = 2;
  state.phase = "DAY_SPEECH";
  state.badge.holderSeat = 4;
  state.badge.history = { 1: { p4: 8 } };
  state.badge.electionWinners = undefined;
  state.voteHistory = {
    1: { p0: 2, p1: 8, p2: 8, p3: 8, p4: 8, p5: 8, p6: 2, p7: 8, p8: 2 },
  };
  state.dayHistory = { 1: { executed: { seat: 8, votes: 6 } } };

  const context = buildGameContext(state, state.players[0]);
  const votes = context.match(/<votes>[\s\S]*?<\/votes>/)?.[0] || "";
  const execution = votes.split("\nday_1:").at(-1) || "";

  assert.match(votes, /结果: 9号玩家9 当选警长/);
  assert.match(execution, /9号玩家9: \{投票者: \[2,3,4,5,6,8\]\}/);
  assert.match(execution, /3号玩家3: \{投票者: \[1,7,9\]\}/);
  assert.doesNotMatch(execution, /9号玩家9: \{票数:/);
  assert.doesNotMatch(execution, /3号玩家3: \{票数:/);
});

test("decision_grounding：否認憑空補金水，但承認警徽移交等已公布事件可作推論依據", () => {
  const state = makeState();
  const player = state.players[1]!;
  const grounding = buildDecisionGrounding(state, player);
  // 收緊的部分仍在：不能靠「某人說可信」補金水
  assert.match(grounding, /不能凭空补成金水——「某人说了一句可信」不构成依据/);
  // 例外：警徽移交等主持人已公布事件是事實，可用於推論
  assert.match(grounding, /主持人已公布的事件（谁出局、警徽移交给谁、公开技能翻牌）属于事实/);
  // 警徽流的解讀：死者最後的信任，不是矛盾
  assert.match(grounding, /唯一跳预言家者被夜刀后把警徽交给的人，应按「死者最后的信任／倾向金水」理解，不是「说法矛盾」/);
});

test("白痴打法已整併進統一攻略：不再有私有筆記段（免死翻牌由遊戲自動觸發）", async () => {
  const { buildSharedSystemParts } = await import("./prompt-utils");
  const dayState = makeState();
  dayState.phase = "DAY_SPEECH";
  const villager = dayState.players.find((p) => p.role === "Villager")!;
  dayState.players[villager.seat] = { ...villager, role: "Idiot" };
  const idiot = dayState.players[villager.seat];

  const dayCtx = buildGameContext(dayState, idiot);
  assert.doesNotMatch(dayCtx, /<your_idiot_notes>/);
  assert.doesNotMatch(dayCtx, /【白痴怎么打/);

  const guideText = guidePart(buildSharedSystemParts(dayState));
  assert.match(guideText, /白痴是弱神/);
  assert.match(guideText, /你会自动翻牌免死|自动翻牌免死/);
});


test("熟人局：注入全桌每个人的印象与交手记录（含自己，全桌同一份）；关闭或无素材不拼入", () => {
  const dayState = makeState();
  dayState.phase = "DAY_SPEECH";
  const actor = dayState.players[2];
  /** 熟人局素材已移到 system 共用開場（攻略之後）：取 system 全文來斷言。 */
  const acquaintanceText = (state: GameState) =>
    buildSharedSystemParts(state).map((part) => part.text).join("\n");

  // 关闭开关：缺席
  assert.doesNotMatch(acquaintanceText({ ...dayState, isAcquaintanceGame: false }), /<acquaintance_notes>/);
  assert.doesNotMatch(buildGameContext({ ...dayState, isAcquaintanceGame: false }, actor), /<acquaintance_notes>/);
  // 开启但无素材：只有真人标记（真人恒有标记；AI 无印象无记录则不列）
  const emptyCtx = acquaintanceText({ ...dayState, isAcquaintanceGame: true });
  assert.match(emptyCtx, /- 1号玩家1：真人玩家（不是 AI，行为没有固定套路）/);
  assert.doesNotMatch(emptyCtx, /- 2号玩家2：/);
  assert.doesNotMatch(emptyCtx, /- 1号玩家1：.*交手记录/);

  // 有印象+有交手记录：真人标真人＋交手记录；AI 标底层模型＋印象；本人不列
  const state: GameState = { ...dayState, isAcquaintanceGame: true };
  // 真人（players[0] isHuman=true，无 agentProfile）：只有真人标记＋交手记录
  state.characterStats = { [state.players[0].displayName]: { games: 12, wins: 7, mvps: 2, svps: 1 } };
  // AI（players[1]）：persona＋playerMind＋底层模型
  state.players[1] = {
    ...state.players[1],
    agentProfile: {
      modelRef: { provider: "tokendance", model: "glm-5.3-flash:cloud" },
      persona: {
        voiceRules: ["说话直接"],
        mbti: "ENTP",
        gender: "male",
        age: 32,
        pressureStyle: "被查杀会急着自证",
        wolfDeceptionStyle: "拿狼时话变多",
      },
      playerMind: {
        courage: "偏怂",
        memoryBias: "记得住数字记不住口径",
        suspicionThreshold: "容易起疑",
        selfProtection: "优先自保",
        logicDepth: "两层",
        tablePresence: "存在感强",
      },
    },
  };

  // 本人（players[2]）也給一份交手記錄：證明自己那一行同樣會列
  state.characterStats = {
    ...state.characterStats,
    [state.players[2].displayName]: { games: 4, wins: 1, mvps: 0, svps: 1 },
  };

  const ctx = buildGameContext(state, actor);
  // 存活玩家列表的真人标记（一般性信息，不受熟人局开关影响）
  assert.match(ctx, /1号 玩家1（真人）/);
  // 熟人局素材在 system：user 的個人區不該再出現
  assert.doesNotMatch(ctx, /<acquaintance_notes>/);
  const ctxAcq = acquaintanceText(state);
  assert.match(ctxAcq, /<acquaintance_notes>/);
  assert.match(ctxAcq, /【熟人局】/);
  // 真人行：真人标记＋交手记录（用户自己的历史战绩）
  assert.match(ctxAcq, /- 1号玩家1：真人玩家（不是 AI，行为没有固定套路）、交手记录：12 场、胜率 58%、MVP 2 次/);
  // AI 行：底层模型＋行为印象
  assert.match(ctxAcq, /- 2号玩家2：底层模型：glm-5.3-flash:cloud、/);
  assert.match(ctxAcq, /拿狼伪装：拿狼时话变多/);
  assert.match(ctxAcq, /胆量：偏怂/);
  assert.match(ctxAcq, /自保倾向：优先自保/);
  assert.match(ctxAcq, /场上存在感：存在感强/);
  // 自己那一行也在名單內（含自己 → 內容逐字不隨座位改變，整段可共用）
  assert.match(ctxAcq, /- 3号玩家3：交手记录：4 场、胜率 25%、MVP 0 次/);
  // 每個有素材的座位都在同一份裡（1／2／3 號），且不含沒素材的座位
  for (const seat of [1, 2, 3]) {
    assert.match(ctxAcq, new RegExp(`- ${seat}号玩家${seat}：`));
  }
  assert.doesNotMatch(ctxAcq, /- 4号玩家4：/);
});

/** 熟人局素材在 system 共用開場裡（攻略之後）。 */
const acquaintanceTextOf = (state: GameState): string =>
  buildSharedSystemParts(state).map((part) => part.text).join("\n");

test("開局建構點：LOBBY 與 NIGHT_START 都要帶上熟人局旗標（漏一個就會靜默掉）", async () => {
  const { buildGameStartState } = await import("./game-master");
  const base = makeState();
  const characterStats = { [base.players[0].displayName]: { games: 5, wins: 3, mvps: 1, svps: 0 } };

  // 實際對局那份（NIGHT_START）過去漏帶這兩個欄位，導致第一次 AI 呼叫前就掉了。
  const nightState = buildGameStartState({
    gameSessionId: "session-1",
    players: base.players,
    phase: "NIGHT_START",
    day: 1,
    difficulty: base.difficulty,
    isGenshinMode: false,
    isSpectatorMode: false,
    isAcquaintanceGame: true,
    characterStats,
  });
  assert.equal(nightState.isAcquaintanceGame, true);
  assert.deepEqual(nightState.characterStats, characterStats);

  const lobbyState = buildGameStartState({
    gameSessionId: "session-1",
    players: base.players,
    phase: "LOBBY",
    day: 0,
    difficulty: base.difficulty,
    isGenshinMode: false,
    isSpectatorMode: false,
    isAcquaintanceGame: true,
    characterStats,
  });
  assert.equal(lobbyState.isAcquaintanceGame, true);
  assert.deepEqual(lobbyState.characterStats, characterStats);

  // 端到端：這份開局狀態進到 prompt 後，熟人局區塊真的存在
  assert.match(acquaintanceTextOf(nightState), /<acquaintance_notes>/);
});

test("角色設定分簡繁：hidden 區塊（講話習慣底層欄位、玩家心智）也要跟語系走", () => {
  const state = makeState();
  const base = state.players[1];
  const player: Player = {
    ...base,
    agentProfile: {
      modelRef: { provider: "tokendance", model: "glm-5.3-flash:cloud" },
      persona: {
        voiceRules: ["说话直接"],
        mbti: "ENTP",
        gender: "male",
        age: 32,
        werewolfExperience: "老手",
        vocabularyStyle: "口语",
        reasoningStyle: "两层",
        speechLengthHabit: "短",
        pressureStyle: "急",
        uncertaintyStyle: "沉默",
        mistakePattern: "爱记错票",
        wolfDeceptionStyle: "话变多",
      },
      playerMind: {
        courage: "偏怂",
        memoryBias: "记得住数字",
        suspicionThreshold: "容易起疑",
        selfProtection: "优先自保",
        logicDepth: "两层",
        tablePresence: "存在感强",
      },
    },
  };

  // 繁中：小標題、欄位名、說明句全部要是繁體（過去這幾段寫死在程式碼裡，繁中局照樣吐簡體）
  setLocale("zh-TW");
  const tw = buildPersonaSection(player);
  assert.match(tw, /【角色設定】/);
  assert.match(tw, /說話習慣/);
  assert.match(tw, /這些資訊只用於塑造你的狼人殺水平/);
  for (const label of ["狼人殺理解", "詞彙習慣", "推理方式", "發言長短", "壓力反應", "不確定性", "常見誤判", "拿狼偽裝"]) {
    assert.match(tw, new RegExp(`- ${label}：`), `${label} 沒轉成繁體`);
  }
  for (const label of ["膽量", "記憶偏好", "懷疑閾值", "自保傾向", "邏輯水平", "桌面存在感"]) {
    assert.match(tw, new RegExp(`- ${label}：`), `${label} 沒轉成繁體`);
  }
  assert.doesNotMatch(tw, /这些信息只用于塑造|狼人杀理解|词汇习惯/);
  assert.doesNotMatch(tw, /【角色设定】/);

  // 簡中：原文不得被改動（SPC 大量斷言依賴這些字串）
  setLocale("zh-CN");
  const cn = buildPersonaSection(player);
  assert.match(cn, /【角色设定】/);
  assert.match(cn, /这些信息只用于塑造你的狼人杀水平、词汇和发言长度/);
  assert.match(cn, /这些信息是你稳定的玩家心智/);
  assert.match(cn, /- 狼人杀理解：老手/);
  assert.match(cn, /- 胆量：偏怂/);
});

test("繁中局：程式碼組出的 prompt 不得混入簡體字（各角色私有帳目、決策帳本、票型）", async () => {
  const { createSinglePlayerContextAuditState } = await import("../../scripts/single-player-context-audit");
  setLocale("zh-TW");
  const audit = createSinglePlayerContextAuditState();
  // 只留程式碼/i18n 產生的內容：清掉訊息與簡體字名字、人設，避免把測試 fixture 的簡體算進來
  const state: GameState = {
    ...audit,
    phase: "DAY_SPEECH",
    messages: [],
    players: audit.players.map((p, index) => ({
      ...p,
      displayName: `甲${index + 1}`,
      agentProfile: p.agentProfile
        ? {
            ...p.agentProfile,
            persona: {
              ...p.agentProfile.persona,
              voiceRules: ["直接講重點"],
              werewolfExperience: "老手",
              vocabularyStyle: "口語",
              reasoningStyle: "兩層",
              speechLengthHabit: "短",
              pressureStyle: "急",
              uncertaintyStyle: "沉默",
              mistakePattern: "記錯票",
              wolfDeceptionStyle: "話變多",
            },
            playerMind: {
              courage: "偏慫",
              memoryBias: "記得數字",
              suspicionThreshold: "容易起疑",
              selfProtection: "先自保",
              logicDepth: "兩層",
              tablePresence: "存在感強",
            },
          }
        : p.agentProfile,
    })),
  };

  // 抽樣「只出現在簡體」的字：出現任何一個就代表某段文案沒走 i18n
  const simplifiedOnly = /[这说语认为场门后与个号决记录药护忆怀阈倾逻辑胆词汇惯压应误伪装队击杀胜负条规则阵预猎验骑卫]/;
  const roleTexts: string[] = [];
  for (const role of ["Seer", "Witch", "Guard", "Werewolf"] as const) {
    const player = state.players.find((p) => p.role === role);
    if (!player) continue;
    const context = buildGameContext({ ...state, phase: "NIGHT_SEER_ACTION" }, player);
    roleTexts.push(`### ${role}\n${context}\n${buildDecisionGrounding(state, player)}`);
  }
  assert.ok(roleTexts.length >= 3, "至少要驗到三個角色的私有帳目");
  for (const text of roleTexts) {
    const match = text.match(simplifiedOnly);
    assert.equal(match, null, `繁中 prompt 混入簡體字「${match?.[0]}」：\n${text.slice(0, 400)}`);
  }

  // 白天：公開事實、票型輪次、逐字稿的系統訊息前綴也要是繁體
  const dayPlayer = state.players.find((p) => p.role === "Villager") ?? state.players[0];
  state.messages = [
    {
      id: "m1",
      playerId: state.players[1].playerId,
      playerName: state.players[1].displayName,
      content: "我先講兩句。",
      phase: "DAY_SPEECH",
      day: state.day,
      timestamp: 1,
    },
  ];
  const dayText = buildGameContext(state, dayPlayer);
  const dayMatch = dayText.match(simplifiedOnly);
  assert.equal(dayMatch, null, `白天 prompt 混入簡體字「${dayMatch?.[0]}」`);
  setLocale("zh-CN");
});

test("攻略：被查殺時不得認同查殺自己的人（好人自證／狼反打或搶線）", () => {
  const guide = getStrategyGuide();
  // 好人通用：不要因為對方「語氣果斷」就認同他，要正面自證，票不送
  assert.match(guide, /被查杀不要认同对方/);
  assert.match(guide, /等于替他把自己那一票要齐了/);
  assert.match(guide, /警徽票和放逐票都不要顺手送给他/);
  // 狼隊：別替對方背書，只有反打或搶線（悍跳）
  assert.match(guide, /被查杀时别替对方背书/);
  assert.match(guide, /等于当场自认狼还把票送出去/);
  assert.match(guide, /①反打[\s\S]{0,120}②抢线（悍跳）/);
  // 兩段都要進 system 共用前綴（全桌同文）
  const state = makeState();
  const systemText = buildSharedSystemParts(state).map((part) => part.text).join("\n");
  assert.match(systemText, /被查杀不要认同对方/);
  assert.match(systemText, /被查杀时别替对方背书/);
});

test("公開技能翻牌分清獵人槍與狼王槍：狼王不能被寫成獵人", async () => {
  const { buildPublicRecordForRemark } = await import("./public-record");
  const state = makeState();
  const wolfKing = { ...state.players[0], role: "WolfKing" as Role, alive: false };
  const hunter = { ...state.players[1], role: "Hunter" as Role, alive: false };
  const wolfShotTarget = { ...state.players[2], alive: false };
  const hunterShotTarget = { ...state.players[3], alive: false };
  state.players = state.players.map((p, i) =>
    i === 0 ? wolfKing : i === 1 ? hunter : i === 2 ? wolfShotTarget : i === 3 ? hunterShotTarget : p
  );
  state.day = 2;
  state.nightHistory = {};
  state.dayHistory = {
    1: { hunterShots: [{ hunterSeat: wolfKing.seat, targetSeat: wolfShotTarget.seat }] },
    2: { hunterShots: [{ hunterSeat: hunter.seat, targetSeat: hunterShotTarget.seat }] },
  };

  const context = buildGameContext(state, state.players[4]);
  // 狼王槍：講狼王，不可以講獵人
  assert.match(context, new RegExp(`第1天：\\d+号.*已由主持人公开确认为狼王`));
  assert.doesNotMatch(context, /第1天：.*确认为猎人/);
  // 獵人槍照舊
  assert.match(context, new RegExp(`第2天：\\d+号.*已由主持人公开确认为猎人`));
  // 死因文案也要分開
  assert.match(context, /狼王公开开枪/);
  assert.match(context, /猎人公开开枪/);
  // 賽後公開記錄同樣分清
  const record = buildPublicRecordForRemark(state).join("\n");
  assert.match(record, /狼王开枪带走/);
  assert.match(record, /猎人开枪带走/);
});
