import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { GameState, Role } from "@/types/game";

// SmartJumpManager 間接載入 supabase.ts（llm → game-session-tracker），
// 缺環境變數會在 import 時直接丟錯；這裡沿用其他測試的作法先塞假值。
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "smart-jump-manager-test-key";

/**
 * 跳階順序守衛。
 *
 * `getPhaseIndex` 原本查的是這個檔案自己手寫的 `PHASE_ORDER`，漏了 `DAY_PK_SPEECH`：
 * `indexOf` 回 -1，於是「PK 發言比大廳更早」，跳階方向、跨日清理與補全清單全部跟著失準。
 * 現在順序取自 `@/lib/rules/phases` 的 `PHASE_SEQUENCE`。
 */

test("順序表涵蓋所有階段，任何階段都不得回 -1", async () => {
  const { getPhaseIndex } = await import("@/lib/SmartJumpManager");
  const { PHASE_SEQUENCE } = await import("@/lib/rules/phases");
  const missing = PHASE_SEQUENCE.filter((phase) => getPhaseIndex(phase) < 0);
  assert.deepEqual(missing, [], `以下階段不在跳階順序表內：${missing.join(", ")}`);
});

test("PK 發言晚於警徽評選、早於白天發言", async () => {
  const { getPhaseIndex } = await import("@/lib/SmartJumpManager");
  assert.ok(
    getPhaseIndex("DAY_BADGE_ELECTION") < getPhaseIndex("DAY_PK_SPEECH"),
    "警徽評選應早於 PK 發言",
  );
  assert.ok(
    getPhaseIndex("DAY_PK_SPEECH") < getPhaseIndex("DAY_SPEECH"),
    "PK 發言應早於白天發言",
  );
});

test("同一天的先後比較不得把 PK 發言判成比大廳更早", async () => {
  const { compareTimePoints } = await import("@/lib/SmartJumpManager");
  const pk = { day: 1, phase: "DAY_PK_SPEECH" as const };
  const election = { day: 1, phase: "DAY_BADGE_ELECTION" as const };
  assert.ok(compareTimePoints(election, pk) < 0, "警徽評選應早於 PK 發言");
  assert.ok(compareTimePoints(pk, election) > 0, "PK 發言應晚於警徽評選");
  assert.ok(
    compareTimePoints(pk, { day: 1, phase: "LOBBY" }) > 0,
    "PK 發言不該比大廳更早（這是 indexOf 回 -1 的症狀）",
  );
});

// ============ 夜間補全清單（Phase 6） ============

/**
 * 跳階補全清單的守衛。
 *
 * 這張清單過去由 `createMissingTask` 自己重寫「這一步決定了嗎」，而且**沒有禁言長老分支**
 * （`ACTION_PHASES` 把它算進來，卻永遠不會產生補全項）；填寫後的套用端
 * （`applySmartJumpWithFilledData`）又是一個沒有 `default` 的 switch，**漏了 `dreamTarget`**——
 * 開發者填了攝夢目標會被靜默丟掉。現在判定問 `rules/night-progress`，套用端也補齊了。
 */

const NIGHT_ROLE_BOARD: Role[] = [
  "Guard", "MuteElder", "Dreamweaver", "Werewolf", "Werewolf", "Witch",
  "Seer", "Villager", "Villager", "Villager", "Villager",
];

const MAGICIAN_BOARD: Role[] = [
  "Magician", "Werewolf", "Werewolf", "Seer", "Witch", "Villager",
  "Villager", "Villager", "Villager", "Villager", "Villager", "Villager",
];

const WOLF_BEAUTY_BOARD: Role[] = [
  "WolfBeauty", "Werewolf", "Werewolf", "Seer", "Witch", "Villager",
  "Villager", "Villager", "Villager", "Villager", "Villager", "Villager",
];

async function nightBoard(
  nightActions: GameState["nightActions"] = {},
  roles: Role[] = NIGHT_ROLE_BOARD
): Promise<GameState> {
  const [{ createSinglePlayerContextAuditState }] = await Promise.all([
    import("../../scripts/single-player-context-audit"),
  ]);
  const base = createSinglePlayerContextAuditState() as unknown as GameState;
  return {
    ...base,
    phase: "NIGHT_GUARD_ACTION",
    day: 1,
    players: base.players.map((player, index) => ({
      ...player,
      role: roles[index] ?? "Villager",
      isHuman: false,
      alive: true,
    })),
    messages: [],
    nightHistory: {},
    dayHistory: {},
    nightActions: { ...nightActions },
    roleAbilities: { ...base.roleAbilities, witchHealUsed: false, witchPoisonUsed: false },
  } as GameState;
}

test("同日前跳：跳過的夜間步驟全部列進補全清單（含禁言長老）", async () => {
  const { analyzeJump } = await import("@/lib/SmartJumpManager");
  const state = await nightBoard();
  const analysis = analyzeJump(state, { day: 1, phase: "NIGHT_SEER_ACTION" });
  const fields = analysis.missingTasks.map((task) => task.field);
  for (const expected of ["guardTarget", "mutedTarget", "dreamTarget", "wolfTarget"]) {
    assert.ok(fields.includes(expected), `${expected} 應該要被補全，實際：${fields.join(", ")}`);
  }
  // 禁言長老的補全項要有合法目標（不能選自己）
  const muteTask = analysis.missingTasks.find((task) => task.field === "mutedTarget")!;
  assert.ok(muteTask.options && muteTask.options.length > 0, "禁言長老要有可選目標");
  assert.equal(
    muteTask.options.some((option) => option.value === 1),
    false,
    "長老自己（座位 1）不該出現在可選清單",
  );
});

test("已決定的夜間步驟不會再要求補全（含退化情況）", async () => {
  const { analyzeJump } = await import("@/lib/SmartJumpManager");
  const decided = await nightBoard({ mutedTarget: 5, dreamTarget: 6, wolfTarget: 7 });
  const fields = analyzeJump(decided, { day: 1, phase: "NIGHT_SEER_ACTION" }).missingTasks.map((t) => t.field);
  for (const gone of ["mutedTarget", "dreamTarget", "wolfTarget"]) {
    assert.equal(fields.includes(gone), false, `${gone} 已決定，不該再要求補全`);
  }
  assert.ok(fields.includes("guardTarget"), "守衛還沒決定，還是要補");
});

test("補全清單填好之後真的寫進狀態（攝夢與禁言過去會被靜默丟掉）", async () => {
  const { applySmartJumpWithFilledData } = await import("@/lib/SmartJumpManager");
  const state = await nightBoard();
  const next = applySmartJumpWithFilledData(state, { day: 1, phase: "NIGHT_SEER_ACTION" }, {
    guardTarget: 7,
    mutedTarget: 8,
    dreamTarget: 9,
    wolfTarget: 10,
    witchSave: "false",
    witchPoison: "none",
  });
  assert.equal(next.nightActions.guardTarget, 7);
  assert.equal(next.nightActions.mutedTarget, 8, "禁言目標必須寫入（套用端原本沒有這一格）");
  assert.equal(next.nightActions.dreamTarget, 9, "攝夢目標必須寫入（套用端原本漏了 dreamTarget）");
  assert.equal(next.nightActions.wolfTarget, 10);
  assert.equal(next.nightActions.witchSave, false, "女巫明確不救");
});

test("跨日前跳的 day<N> 欄位要寫進狀態（狼美人與攝夢人原本被靜默丟掉）", async () => {
  const { applySmartJumpWithFilledData } = await import("@/lib/SmartJumpManager");
  const state = await nightBoard({}, WOLF_BEAUTY_BOARD);
  const next = applySmartJumpWithFilledData(state, { day: 2, phase: "DAY_START" }, {
    day1WolfTarget: 5,
    day1WolfBeautyTarget: 3,
    day1WitchSave: "false",
    day1WitchPoison: "none",
  });
  assert.equal(
    next.nightHistory?.[1]?.wolfBeautyTarget,
    3,
    "狼美人魅惑目標必須寫入（套用端原本沒有 day<N>WolfBeautyTarget 這一段）"
  );
  assert.equal(next.nightHistory?.[1]?.wolfTarget, 5);
  assert.equal(
    next.nightActions.pendingWolfVictim,
    5,
    "跳轉造成的夜間刀口要進待公布死亡，白天才會公告、才會判開槍窗口"
  );
});

test("同日前跳的夜間死亡也要進待公布死亡（否則白天不公告、狼王／獵人不會被問要不要開槍）", async () => {
  const { applySmartJumpWithFilledData } = await import("@/lib/SmartJumpManager");
  const state = await nightBoard();
  const next = applySmartJumpWithFilledData(state, { day: 1, phase: "DAY_START" }, {
    guardTarget: 0,
    mutedTarget: 0,
    dreamTarget: 0,
    wolfTarget: 5,
    witchSave: "false",
    witchPoison: "none",
  });
  assert.ok(
    next.nightHistory?.[1]?.deaths?.some((death) => death.seat === 5 && death.reason === "wolf"),
    `刀口要死，實際：${JSON.stringify(next.nightHistory?.[1]?.deaths)}`
  );
  assert.equal(next.nightActions.pendingWolfVictim, 5, "刀口要進 pendingWolfVictim");
  assert.equal(next.nightActions.pendingPoisonVictim, undefined, "沒用毒藥就不要有這一格");
  assert.equal(next.nightActions.pendingDreamVictim, undefined, "沒攝夢就不要有這一格");
});

test("跨日前跳補全「毒殺狼美人」會帶走被魅惑者（回歸：目標被丟掉時不會有殉情）", async () => {
  const { applySmartJumpWithFilledData } = await import("@/lib/SmartJumpManager");
  const state = await nightBoard({}, WOLF_BEAUTY_BOARD);
  const next = applySmartJumpWithFilledData(state, { day: 2, phase: "DAY_START" }, {
    day1WolfTarget: 5,
    day1WolfBeautyTarget: 3,
    day1WitchSave: "false",
    day1WitchPoison: 0, // 毒狼美人自己
  });
  const deaths = next.nightHistory?.[1]?.deaths ?? [];
  assert.ok(
    deaths.some((d) => d.seat === 0 && d.reason === "poison"),
    `狼美人自己要被毒死，實際：${JSON.stringify(deaths)}`
  );
  assert.ok(
    deaths.some((d) => d.seat === 3 && d.reason === "charm"),
    `被魅惑的 3 號要殉情，實際：${JSON.stringify(deaths)}`
  );
  assert.equal(next.players[0]?.alive, false);
  assert.equal(next.players[3]?.alive, false);
});

test("單階段補全的狼美人魅惑也要寫進 nightActions", async () => {
  const { applySmartJumpWithFilledData } = await import("@/lib/SmartJumpManager");
  const state = await nightBoard();
  const next = applySmartJumpWithFilledData(state, { day: 1, phase: "NIGHT_SEER_ACTION" }, {
    wolfBeautyTarget: 5,
  });
  assert.equal(next.nightActions.wolfBeautyTarget, 5, "魅惑目標必須寫入（switch 原本沒有這一格）");
});

test("補全清單的每一格，套用端都要有對應分支（少一格就是靜默丟掉）", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/lib/SmartJumpManager.ts"), "utf8");
  const applyStart = source.indexOf("export function applySmartJumpWithFilledData");
  assert.ok(applyStart > 0, "找不到套用端函式");
  const applyBody = source.slice(applyStart);

  // 清單端：跨日欄位寫成 `day${d}Suffix`，同日欄位寫成 "plainName"
  const prefixed = [...source.matchAll(/field:\s*`day\$\{d\}(\w+)`/g)].map((m) => m[1]!);
  const plain = [...source.matchAll(/field:\s*"(\w+)"/g)].map((m) => m[1]!);
  assert.ok(prefixed.length > 0 && plain.length > 0, "應該要掃到兩種欄位寫法");

  const missing = [
    ...prefixed.filter((name) => !applyBody.includes(name)),
    ...plain.filter((name) => !applyBody.includes(`"${name}"`)),
  ];
  assert.deepEqual(missing, [], `以下補全欄位在套用端沒有分支：${missing.join(", ")}`);
});

test("補全項的說明文字不得原樣顯示 i18n key（狼美人那一題漏傳 {day} 參數）", async () => {
  const { analyzeJump } = await import("@/lib/SmartJumpManager");
  // 同日與跨日兩條路徑都要掃：說明文字若渲染失敗，next-intl 會回退成 key 本身
  const cases = [
    { state: await nightBoard({}, WOLF_BEAUTY_BOARD), target: { day: 1, phase: "DAY_START" as const } },
    { state: await nightBoard({}, WOLF_BEAUTY_BOARD), target: { day: 2, phase: "DAY_START" as const } },
    { state: await nightBoard(), target: { day: 1, phase: "NIGHT_SEER_ACTION" as const } },
  ];
  const rawKeys: string[] = [];
  for (const { state, target } of cases) {
    for (const task of analyzeJump(state, target).missingTasks) {
      if (/^[a-zA-Z][\w]*\.[a-zA-Z][\w.]*$/.test(task.description)) {
        rawKeys.push(`${task.field} → ${task.description}`);
      }
    }
  }
  assert.deepEqual(rawKeys, [], `以下補全項顯示成 i18n key（缺參數或鍵不存在）：${rawKeys.join("; ")}`);
});

test("夜間結算寫回夜史時要保留狼美人魅惑目標（DevTools 與賽後分析都讀這格）", async () => {
  const { applySmartJumpWithFilledData } = await import("@/lib/SmartJumpManager");
  const state = await nightBoard({}, WOLF_BEAUTY_BOARD);
  const next = applySmartJumpWithFilledData(state, { day: 2, phase: "DAY_START" }, {
    day1WolfTarget: 5,
    day1WolfBeautyTarget: 3,
    day1WitchSave: "false",
    day1WitchPoison: "none",
  });
  assert.equal(
    next.nightHistory?.[1]?.wolfBeautyTarget,
    3,
    "結算後夜史仍要留有魅惑目標，否則動作記錄會顯示「無」"
  );
});

test("魔術師的補全是兩列（第一人／第二人），兩列都填才合成一組寫進 nightActions", async () => {
  const { analyzeJump, applySmartJumpWithFilledData } = await import("@/lib/SmartJumpManager");
  const state = await nightBoard({}, MAGICIAN_BOARD);
  const fields = analyzeJump(state, { day: 1, phase: "NIGHT_WOLF_ACTION" }).missingTasks.map((t) => t.field);
  assert.ok(fields.includes("magicianSwapFirst"), `換位第一人應該要被補全，實際：${fields.join(", ")}`);
  assert.ok(fields.includes("magicianSwapSecond"), `換位第二人應該要被補全，實際：${fields.join(", ")}`);

  const next = applySmartJumpWithFilledData(state, { day: 1, phase: "NIGHT_WOLF_ACTION" }, {
    magicianSwapFirst: 6,
    magicianSwapSecond: 3,
  });
  assert.deepEqual(next.nightActions.magicianSwap, [6, 3], "兩列合成一組，寫進 nightActions");
});

test("魔術師的兩列只填一列或填同一人 → 不寫入（留給夜間流程決定，但會出聲）", async () => {
  const { applySmartJumpWithFilledData } = await import("@/lib/SmartJumpManager");
  const state = await nightBoard({}, MAGICIAN_BOARD);

  const half = applySmartJumpWithFilledData(state, { day: 1, phase: "NIGHT_WOLF_ACTION" }, {
    magicianSwapFirst: 6,
  });
  assert.equal(half.nightActions.magicianSwap, undefined, "只填一列不該寫入半組");

  const same = applySmartJumpWithFilledData(state, { day: 1, phase: "NIGHT_WOLF_ACTION" }, {
    magicianSwapFirst: 6,
    magicianSwapSecond: 6,
  });
  assert.equal(same.nightActions.magicianSwap, undefined, "(X, X) 不是合法的換位");
});

test("跨日前跳的換位要寫進夜史，而且結算後仍在（DevTools 與賽後分析都讀這格）", async () => {
  const { applySmartJumpWithFilledData } = await import("@/lib/SmartJumpManager");
  const state = await nightBoard({}, MAGICIAN_BOARD);
  const next = applySmartJumpWithFilledData(state, { day: 2, phase: "DAY_START" }, {
    day1MagicianSwapFirst: 6,
    day1MagicianSwapSecond: 3,
    day1WolfTarget: 5,
    day1WitchSave: "false",
    day1WitchPoison: "none",
  });
  assert.deepEqual(
    next.nightHistory?.[1]?.magicianSwap,
    [6, 3],
    "夜間結算寫回夜史時仍要保留換位組合，否則動作記錄會顯示「無」"
  );
});

test("魔術師在場時，換位也會反映在跳轉後的死亡結算（刀口改判）", async () => {
  const { applySmartJumpWithFilledData } = await import("@/lib/SmartJumpManager");
  const state = await nightBoard({}, MAGICIAN_BOARD);
  // 狼刀 5 號、魔術師把 5 號與 1 號交換 → 死的應該是被換到的 1 號
  const next = applySmartJumpWithFilledData(state, { day: 2, phase: "DAY_START" }, {
    day1MagicianSwapFirst: 5,
    day1MagicianSwapSecond: 1,
    day1WolfTarget: 5,
    day1WitchSave: "false",
    day1WitchPoison: "none",
  });
  assert.equal(next.players.find((p) => p.seat === 1)?.alive, false, "換位後死的應該是被換到的 1 號");
  assert.equal(next.players.find((p) => p.seat === 5)?.alive, true, "原本被刀的 5 號被換走了，應該活著");
});
