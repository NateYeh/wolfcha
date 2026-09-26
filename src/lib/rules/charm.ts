import type { GameState, Role } from "@/types/game";
import { getRoleCapabilities } from "./roles";

/**
 * 狼美人（WolfBeauty）規則（單一真相）。
 *
 * 規則（來源：官方「狼美騎士」版型／來源站 lang-mei-qi-shi 規則頁）：
 * 1. 狼美人**參與狼人刀人**（她是狼隊成員，見 `isWolfRole`），刀人之後**單獨魅惑**一名玩家。
 * 2. 每晚固定魅惑一人（不能空過、不能魅惑自己）；AI 沒給合法目標時由系統隨機指定。
 * 3. 狼美人**出局時**，被魅惑的玩家隨之殉情出局——放逐、被毒、夜死都算。
 * 4. **被騎士決鬥出局不發動魅惑**（也不翻牌）。
 * 5. 魅惑**不是普通狼刀**：不受守衛守護影響（來源站 FAQ 明列），所以殉情也不吃守護。
 * 6. 狼美人**不能自爆、不能被狼隊自刀**（自刀＝狼隊不能刀她；自爆見 `ROLE_CAPABILITIES.canBoom`）。
 *
 * 殉情死因記為 `"charm"`（不是 `"wolf"`），這樣死亡公告、賽後分析與
 * 封槍判定（`lib/rules/death-skills.ts`）都能把它與狼刀區分開。
 */

/** 殉情的死因標記（與 `nightHistory[day].deaths` 的 reason 一致） */
export const CHARM_DEATH_REASON = "charm" as const;

/** 會帶走狼美人的死因（騎士決鬥不觸發；其餘出局方式都算） */
export type CharmRevengeCause = "exile" | "night_kill" | "poison" | "milk" | "dream" | "shot" | "carried" | "duel";

/** 狼美人這個角色能不能魅惑自己（目前規則：不行） */
export function canCharmSelf(): boolean {
  return getRoleCapabilities("WolfBeauty").canSelfTarget;
}

/**
 * 今晚可以魅惑的座位：存活玩家、不含自己、排除「已死但尚未公布」的死者。
 *
 * 官方規則沒有限制不能連續兩晚魅惑同一人，所以不另做排除。
 */
export function getWolfBeautyEligibleSeats(state: GameState, beautySeat: number): number[] {
  const pending = new Set<number>();
  const { pendingWolfVictim, pendingPoisonVictim, pendingDreamVictim } = state.nightActions ?? {};
  for (const seat of [pendingWolfVictim, pendingPoisonVictim, pendingDreamVictim]) {
    if (typeof seat === "number") pending.add(seat);
  }
  const allowSelf = canCharmSelf();
  return state.players
    .filter(
      (player) =>
        player.alive && (allowSelf || player.seat !== beautySeat) && !pending.has(player.seat),
    )
    .map((player) => player.seat);
}

/** 這個魅惑目標是否合法（AI 契約與真人 UI 共用） */
export function isValidWolfBeautyTarget(
  state: GameState,
  beautySeat: number,
  targetSeat: number,
): boolean {
  return getWolfBeautyEligibleSeats(state, beautySeat).includes(targetSeat);
}

/**
 * 「未操作則系統隨機指定」的實作：從合法座位裡隨機挑一個。
 * 沒有合法座位（例如只剩她自己存活）時回 undefined——此時這一晚沒有魅惑對象。
 */
export function pickRandomWolfBeautyTarget(state: GameState, beautySeat: number): number | undefined {
  const seats = getWolfBeautyEligibleSeats(state, beautySeat);
  if (seats.length === 0) return undefined;
  return seats[Math.floor(Math.random() * seats.length)];
}

/**
 * 狼隊今晚可以刀的座位：存活玩家、**不含狼美人**。
 *
 * 官方規則明列狼美人「不能自刀」——狼隊不能刀她（可以刀其他狼隊友、也可以自刀騙藥，
 * 那些不受影響）。這一條同時管到 UI 可點選的目標、AI 的合法座位與提示詞裡的選項清單。
 */
export function getWolfKnifeEligibleSeats(state: GameState): number[] {
  return state.players
    .filter((player) => player.alive && !isWolfBeauty(player.role))
    .map((player) => player.seat);
}

/** 這個角色是不是狼美人 */
export function isWolfBeauty(role: Role | string | undefined): boolean {
  return role === "WolfBeauty";
}

/**
 * 當下有效的魅惑對象。
 *
 * 讀取順序對應資料的生命週期：
 * 1. `nightActions.wolfBeautyTarget`：今晚（或剛結束那一晚）的決定；
 * 2. `nightActions.lastWolfBeautyTarget`：天黑時從上一晚沿用下來的（今晚還沒決定時生效）；
 * 3. `nightHistory[day]`：夜間結算落盤的紀錄。
 *
 * 三個都查才不會漏：狼美人可能夜間出局（此時是第 1 項），也可能隔天才被放逐
 * （此時第 1 項可能已被清空、只剩第 2 項）。
 */
export function getCharmedSeat(state: GameState): number | undefined {
  const { wolfBeautyTarget, lastWolfBeautyTarget } = state.nightActions ?? {};
  if (typeof wolfBeautyTarget === "number") return wolfBeautyTarget;
  if (typeof lastWolfBeautyTarget === "number") return lastWolfBeautyTarget;
  const record = state.nightHistory?.[state.day];
  return typeof record?.wolfBeautyTarget === "number" ? record.wolfBeautyTarget : undefined;
}

/**
 * 把殉情套用到狀態上：被魅惑者跟著出局。
 *
 * 只改 `players[].alive`，**不**寫任何訊息（公告是 UI 的事）；
 * 刻意不 import `game-master`（會循環引用），公告由呼叫端負責。
 *
 * 夜晚的殉情不走這裡：夜間死亡名單由 `rules/night-resolution` 一次算完，
 * 這支是給白天（放逐、被帶走、獵人槍）用的。
 */
export function applyCharmRevenge(
  state: GameState,
  deadSeat: number,
  cause: CharmRevengeCause,
): { state: GameState; victimSeat: number | null } {
  const victimSeat = getCharmRevengeSeat(state, deadSeat, cause);
  if (victimSeat === null) return { state, victimSeat: null };
  return {
    state: {
      ...state,
      players: state.players.map((player) =>
        player.seat === victimSeat ? { ...player, alive: false } : player,
      ),
      dayHistory: recordDayCharmDeath(state, victimSeat),
    },
    victimSeat,
  };
}

/**
 * 把「當日殉情」寫進 `dayHistory`。
 *
 * 賽後分析的死因與死亡日只從 `nightHistory` 與 `dayHistory` 推導（`game-analysis.ts` 的
 * `buildPlayerSnapshots`）：夜間殉情由 `rules/night-resolution` 落盤，白天的殉情若不寫這一筆，
 * 殉情者就會變成「沒有死因、沒有死亡日」（2026-09-26 個案：12號 葉小雷 隨狼美人殉情，
 * 紀錄上卻查不出他怎麼死的）。
 */
function recordDayCharmDeath(state: GameState, seat: number): GameState["dayHistory"] {
  const dayHistory = state.dayHistory ?? {};
  const today = dayHistory[state.day] ?? {};
  const charmDeaths = today.charmDeaths ?? [];
  if (charmDeaths.includes(seat)) return dayHistory;
  return { ...dayHistory, [state.day]: { ...today, charmDeaths: [...charmDeaths, seat] } };
}

/** 這個死因會不會觸發殉情 */
export function triggersCharmRevenge(cause: CharmRevengeCause): boolean {
  return cause !== "duel";
}

/**
 * 狼美人出局時要一起走的座位；沒有則回 null。
 *
 * 回傳的座位一定是「還活著」且不等於狼美人自己的——被魅惑者若已經先出局，
 * 殉情自然就不成立（屍體不會再死一次）。
 * 守護**不**擋殉情（魅惑不是狼刀），所以這裡不查 guardTarget。
 */
export function getCharmRevengeSeat(
  state: GameState,
  deadSeat: number,
  cause: CharmRevengeCause,
): number | null {
  const dead = state.players.find((player) => player.seat === deadSeat);
  if (!dead || !isWolfBeauty(dead.role)) return null;
  if (!triggersCharmRevenge(cause)) return null;
  const charmed = getCharmedSeat(state);
  if (typeof charmed !== "number" || charmed === deadSeat) return null;
  const victim = state.players.find((player) => player.seat === charmed);
  if (!victim || !victim.alive) return null;
  return charmed;
}
