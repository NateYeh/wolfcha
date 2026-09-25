import type { GameState, Phase, Player, Role } from "@/types/game";
import { isWolfRole } from "@/types/game";
import { NIGHT_ACTION_ORDER, type NightActionPhase } from "./phases";
import { getMuteEligibleSeats } from "./mute";
import { getDreamEligibleSeats } from "./dream";
import { getWolfBeautyEligibleSeats } from "./charm";
import { getSwapEligibleSeats } from "./magician";

/**
 * 一夜的推進（單一真相）。
 *
 * 「這一晚還有哪些步驟、某一步完成了嗎、下一步是誰」過去由六處各自持有
 * （`NightPhase` 的分派與 5 個 `continueNightAfter*`、`useGameLogic` 的存檔恢復與
 * Dev 跳轉、`SmartJumpManager` 的補齊邏輯、存檔表），沒有一份是權威。新增一個夜間角色
 * 要同步改七個地方，漏一處不是編譯錯，而是「安靜地少一個分支」。
 *
 * 這裡讓三層問題用同一份資料回答：
 *   1. **順序**：有哪些步驟、下一步是誰 —— 以 `phases.ts` 的 `NIGHT_ACTION_ORDER` 為權威；
 *   2. **完成**：這一步做完了嗎 —— `decided`，含「沒有東西要決定」的退化情況；
 *   3. **補齊**：跳過的步驟還缺哪些決定 —— `pendingNightActions()` 的 `after` 選項。
 *
 * 因為 `NIGHT_STEP` 是 `Record<NightActionPhase, …>`，而 `NightActionPhase` 取自
 * `NIGHT_ACTION_ORDER` 的字面型別，所以**在權威表新增一個夜間行動階段時，tsc 會逼你補步驟**。
 *
 * 本 module 只描述、不驅動：不改狀態、不發指令、不碰 React。階段續跑與存檔恢復應改為問這裡，
 * 而不是自己重寫「誰完成了、下一步是誰」（見 `docs/night-sequencing-refactor-plan.md` 的 Phase 3-6）。
 */

/** 這一步由誰決定：單一角色的持有者，或整支狼隊（狼刀是團隊決定）。 */
export type NightActor = { kind: "role"; role: Role } | { kind: "wolfTeam" };

export type NightStep = {
  phase: NightActionPhase;
  actor: NightActor;
  /** 這一步的決定做完了嗎（含「沒有這個角色」與「沒有合法目標」的情況）。 */
  decided: (state: GameState) => boolean;
};

/** 守衛的決定是否已完成（沒有守衛在場也算完成）。 */
export const guardDecided = (state: GameState): boolean => {
  const guard = state.players.find((p) => p.role === "Guard" && p.alive);
  return !guard || state.nightActions.guardTarget !== undefined;
};

/**
 * 狼美人的決定是否已完成。
 *
 * 除了已指定魅惑對象，也要涵蓋「沒有合法目標可選」的退化情況（例如只剩她自己存活）。
 */
export const wolfBeautyDecided = (state: GameState): boolean => {
  const beauty = state.players.find((p) => p.role === "WolfBeauty" && p.alive);
  if (!beauty) return true;
  return (
    state.nightActions.wolfBeautyTarget !== undefined ||
    getWolfBeautyEligibleSeats(state, beauty.seat).length === 0
  );
};

/**
 * 禁言長老的決定是否已完成。
 *
 * 除了已指定目標，也要涵蓋「沒有合法目標可選」的退化情況（`getMuteEligibleSeats` 為空，
 * 例如只剩長老自己存活）——此時這一晚沒有可禁言的人，階段已經沒有東西要等。
 */
export const muteDecided = (state: GameState): boolean => {
  const elder = state.players.find((p) => p.role === "MuteElder" && p.alive);
  if (!elder) return true;
  return (
    state.nightActions.mutedTarget !== undefined ||
    getMuteEligibleSeats(state, elder.seat).length === 0
  );
};

/**
 * 攝夢人的決定是否已完成。
 *
 * 規則要求「不能空攝」，AI 沒給合法目標時由系統隨機指定，所以正常情況一定有 `dreamTarget`；
 * 唯一例外是沒有合法目標（例如只剩攝夢人自己存活），此時這一晚本來就沒有夢游者。
 */
export const magicianDecided = (state: GameState): boolean => {
  const magician = state.players.find((p) => p.role === "Magician" && p.alive);
  if (!magician) return true;
  return state.nightActions.magicianSwap !== undefined || getSwapEligibleSeats(state).length < 2;
};

export const dreamDecided = (state: GameState): boolean => {
  const dreamer = state.players.find((p) => p.role === "Dreamweaver" && p.alive);
  if (!dreamer) return true;
  return (
    state.nightActions.dreamTarget !== undefined ||
    getDreamEligibleSeats(state, dreamer.seat).length === 0
  );
};

/** 狼人的決定是否已完成（沒有存活狼人，或已指定刀口）。 */
export const wolfDecided = (state: GameState): boolean => {
  const aliveWolves = state.players.filter((p) => isWolfRole(p.role) && p.alive);
  return aliveWolves.length === 0 || state.nightActions.wolfTarget !== undefined;
};

/** 女巫的決定是否已完成（沒有女巫、藥已用完，或已明確決定救／毒／不救）。 */
export const witchDecided = (state: GameState): boolean => {
  const witch = state.players.find((p) => p.role === "Witch" && p.alive);
  if (!witch) return true;
  if (state.roleAbilities.witchHealUsed && state.roleAbilities.witchPoisonUsed) return true;
  // witchSave === false 表示明確不救，undefined 表示還沒決定
  return state.nightActions.witchSave !== undefined || state.nightActions.witchPoison !== undefined;
};

/** 預言家的決定是否已完成（沒有預言家，或已查驗）。 */
export const seerDecided = (state: GameState): boolean => {
  const seer = state.players.find((p) => p.role === "Seer" && p.alive);
  return !seer || state.nightActions.seerTarget !== undefined;
};

/** 每一步由誰決定、怎麼判定完成（鍵必須覆蓋 `NIGHT_ACTION_ORDER` 的每個成員）。 */
export const NIGHT_STEP: Record<NightActionPhase, NightStep> = {
  NIGHT_GUARD_ACTION: {
    phase: "NIGHT_GUARD_ACTION",
    actor: { kind: "role", role: "Guard" },
    decided: guardDecided,
  },
  NIGHT_MUTE_ACTION: {
    phase: "NIGHT_MUTE_ACTION",
    actor: { kind: "role", role: "MuteElder" },
    decided: muteDecided,
  },
  NIGHT_DREAM_ACTION: {
    phase: "NIGHT_DREAM_ACTION",
    actor: { kind: "role", role: "Dreamweaver" },
    decided: dreamDecided,
  },
  NIGHT_MAGICIAN_ACTION: {
    phase: "NIGHT_MAGICIAN_ACTION",
    actor: { kind: "role", role: "Magician" },
    decided: magicianDecided,
  },
  NIGHT_WOLF_ACTION: {
    phase: "NIGHT_WOLF_ACTION",
    actor: { kind: "wolfTeam" },
    decided: wolfDecided,
  },
  NIGHT_WOLF_BEAUTY_ACTION: {
    phase: "NIGHT_WOLF_BEAUTY_ACTION",
    actor: { kind: "role", role: "WolfBeauty" },
    decided: wolfBeautyDecided,
  },
  NIGHT_WITCH_ACTION: {
    phase: "NIGHT_WITCH_ACTION",
    actor: { kind: "role", role: "Witch" },
    decided: witchDecided,
  },
  NIGHT_SEER_ACTION: {
    phase: "NIGHT_SEER_ACTION",
    actor: { kind: "role", role: "Seer" },
    decided: seerDecided,
  },
};

/** 這個階段是不是夜間角色行動階段（型別守衛，之後可直接索引 `NIGHT_STEP`）。 */
export const isNightActionPhase = (phase: Phase): phase is NightActionPhase =>
  NIGHT_ACTION_ORDER.includes(phase as NightActionPhase);

/** 這個階段的步驟描述；不是夜間行動階段就回 undefined。 */
export const nightStepFor = (phase: Phase): NightStep | undefined =>
  isNightActionPhase(phase) ? NIGHT_STEP[phase] : undefined;

/**
 * 還沒完成的步驟（依夜間順序）。
 *
 * `after` 用在「跳過某個階段」：只看它之後的步驟，用來補齊被跳過的決定。
 * 沒有這個角色、或沒有合法目標可選的步驟，因為 `decided` 為真而不會出現在結果裡。
 */
export const pendingNightActions = (
  state: GameState,
  options: { after?: Phase } = {}
): NightStep[] => {
  const afterIndex = options.after === undefined ? -1 : NIGHT_ACTION_ORDER.indexOf(options.after as NightActionPhase);
  return NIGHT_ACTION_ORDER.slice(afterIndex + 1)
    .map((phase) => NIGHT_STEP[phase])
    .filter((step) => !step.decided(state));
};

/** 下一個要處理的步驟；全部完成時回 undefined（代表今晚可以進結算）。 */
export const nextPendingNightAction = (
  state: GameState,
  options: { after?: Phase } = {}
): NightStep | undefined => pendingNightActions(state, options)[0];

/** 今晚（或 `after` 之後）是否已全部完成。 */
export const isNightComplete = (state: GameState, options: { after?: Phase } = {}): boolean =>
  pendingNightActions(state, options).length === 0;

/** 這一步由哪些玩家決定（單一角色的存活持有者，或全部存活狼人）。 */
export const actorsForNightStep = (state: GameState, phase: Phase): Player[] => {
  const step = nightStepFor(phase);
  if (!step) return [];
  const actor = step.actor;
  if (actor.kind === "wolfTeam") {
    return state.players.filter((p) => isWolfRole(p.role) && p.alive);
  }
  const { role } = actor;
  return state.players.filter((p) => p.role === role && p.alive);
};

/**
 * 這一步是不是「正在等真人決定」：決定者裡有真人，而且這一步還沒完成。
 *
 * 階段層（`NightPhase` 的續跑鏈）需要的就是這個判斷：AI 已經做完事、真人還沒選，就停在這裡
 * 等前端寫入；以前五處各自以 `x?.isHuman && 某欄位 === undefined` 重寫（女巫那處還把
 * 「藥用完了」的規則重推一次）。
 */
export const humanActorPending = (state: GameState, phase: Phase): boolean => {
  const step = nightStepFor(phase);
  if (!step || step.decided(state)) return false;
  return actorsForNightStep(state, phase).some((p) => p.isHuman);
};
