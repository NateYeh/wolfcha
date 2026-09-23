import type { GameState, Phase } from "@/types/game";
import { getCurrentSpeechRoundMessages } from "@/lib/speech-order";
import type { RuleFlags } from "./flags";
import { getPendingDeathSeats } from "./night-deaths";
import {
  markPlayerDead,
  settleUnannouncedNightDeaths,
  type NewlyAnnouncedDeath,
} from "./settle-night-deaths";
import { resolveSelfDestructOutcome, type SelfDestructOutcome } from "./self-destruct";

/**
 * 自爆的**狀態轉移**（純函式，不含任何 UI／LLM／音效）。
 *
 * 流程（2026-09-22 拍板，標準雙爆吞警徽）：
 *
 * 第一天競選發言，第一隻狼自爆：
 *   1. 自爆者出局（無遺言、無宣言）
 *   2. 補公布「已結算但還沒公布」的夜間死訊（＝第一夜死者）
 *   3. 第一夜死者的遺言排進佇列（由呼叫方實際發表）
 *   4. 直接天黑；警徽沒被吞、競選狀態保留（`electionSuspended`）
 *
 * 第二天競選發言，第二隻狼再自爆：
 *   5. 警徽正式流失（`badge.lost`）
 *   6. 這一夜（第二夜）的新死亡沒有遺言
 *
 * 白狼王在競選發言自爆則是「一次帶人＋一次吞徽」，不需要第二爆。
 */

export interface SelfDestructApplyInput {
  state: GameState;
  /** 自爆者座位 */
  boomerSeat: number;
  /** 帶走的目標（只有能帶人的角色會被採用） */
  targetSeat: number | null;
  reason?: string;
  /** 自爆發生在哪個階段（決定警徽規則） */
  originPhase: Phase;
  flags: RuleFlags;
}

export interface SelfDestructApplyResult {
  state: GameState;
  outcome: SelfDestructOutcome;
  /** 這次被帶走的座位（沒有帶人、或指定了已出局者則 undefined） */
  victimSeat?: number;
  /** 指定了已出局者而被判技能無效的座位 */
  voidedTargetSeat?: number;
  /** 尚未公布、這次要補公布的夜間死亡（依天數、再依記錄順序） */
  newlyAnnouncedDeaths: NewlyAnnouncedDeath[];
  /** 需要移交警徽的座位（警長死亡且警徽還在）；null＝不需要移交 */
  badgeTransferSeat: number | null;
  /** 這次結算後待發表遺言的佇列（呼叫方負責實際發表） */
  pendingLastWordsSeats: number[];
}

const markDead = markPlayerDead;

export function applySelfDestructToState(input: SelfDestructApplyInput): SelfDestructApplyResult {
  const { state, boomerSeat, targetSeat, reason = "", originPhase, flags } = input;
  const boomer = state.players.find((player) => player.seat === boomerSeat);
  if (!boomer) throw new Error(`自爆失敗：找不到座位 ${boomerSeat} 的玩家`);

  const electionBoomsBefore = state.badge.electionBooms ?? 0;
  const outcome = resolveSelfDestructOutcome({
    phase: originPhase,
    role: boomer.role,
    flags,
    electionBooms: electionBoomsBefore,
  });

  // 1) 自爆者出局（沒有遺言、沒有宣言）
  let currentState = markDead(state, boomerSeat);
  currentState = {
    ...currentState,
    roleAbilities: {
      ...currentState.roleAbilities,
      boomedSeats: [...new Set([...(currentState.roleAbilities.boomedSeats ?? []), boomerSeat])],
    },
  };

  // 2) 帶人（只有能帶人的角色，且只能帶「場上存活」的人）
  //    第一夜死者即使死訊還沒公布也已經算出局，指定他們視為技能無效。
  const pendingDeathSeats = getPendingDeathSeats(state);
  let victimSeat: number | undefined;
  if (outcome.takesPlayer && targetSeat !== null) {
    const target = currentState.players.find((player) => player.seat === targetSeat);
    if (target?.alive && !pendingDeathSeats.includes(targetSeat)) {
      currentState = markDead(currentState, targetSeat);
      victimSeat = targetSeat;
    }
  }

  // 3) 警徽：吞徽／競選順延／（警長死亡則交由呼叫方安排移交）
  const isElectionPhase = originPhase === "DAY_BADGE_SPEECH";
  let badge = {
    ...currentState.badge,
    electionBooms: isElectionPhase && !outcome.swallowBadge ? electionBoomsBefore + 1 : electionBoomsBefore,
  };
  if (outcome.swallowBadge) {
    badge = { ...badge, holderSeat: null, lost: true, electionSuspended: false };
  } else if (outcome.suspendElection) {
    // 跨天續辦時，當日發言紀錄不再包含前一天的競選發言，因此把已發言候選人記進狀態
    const sheriffSeatBefore = currentState.badge.holderSeat;
    const spokenToday = getCurrentSpeechRoundMessages(state)
      .map((message) => state.players.find((player) => player.playerId === message.playerId)?.seat)
      .filter((seat): seat is number => seat !== undefined);
    badge = {
      ...badge,
      holderSeat: sheriffSeatBefore,
      electionSuspended: true,
      electionSpokenSeats: [...new Set([...(badge.electionSpokenSeats ?? []), ...spokenToday])],
    };
  }

  // 4) 補公布尚未公布的夜間死訊（第一夜死者），並把第一夜遺言排進佇列
  const settled = settleUnannouncedNightDeaths(currentState);
  currentState = settled.state;
  const newlyAnnouncedDeaths = settled.newlyAnnouncedDeaths;
  const pendingLastWordsSeats = settled.pendingLastWordsSeats;

  // 5) 警長死亡：警徽還在就交出移交權（由呼叫方讓警長自己選傳徽或撕徽）
  const holderSeat = badge.holderSeat;
  const deadSheriffSeat =
    holderSeat !== null && !currentState.players.find((player) => player.seat === holderSeat)?.alive
      ? holderSeat
      : null;

  // 6) 自爆紀錄 + 階段切到 SELF_DESTRUCT（後續移交／遺言／天黑都是合法轉移）
  const prevDayRecord = (currentState.dayHistory || {})[currentState.day] || {};
  currentState = {
    ...currentState,
    phase: "SELF_DESTRUCT",
    badge,
    pendingLastWordsSeats: pendingLastWordsSeats.length > 0 ? pendingLastWordsSeats : undefined,
    nightActions: {
      ...currentState.nightActions,
      pendingWolfVictim: undefined,
      pendingPoisonVictim: undefined,
      pendingDreamVictim: undefined,
    },
    dayHistory: {
      ...(currentState.dayHistory || {}),
      [currentState.day]: {
        ...prevDayRecord,
        selfDestruct: {
          boomSeat: boomerSeat,
          ...(victimSeat !== undefined ? { targetSeat: victimSeat } : {}),
          reason,
          swallowBadge: outcome.swallowBadge,
          suspendedElection: outcome.suspendElection,
        },
      },
    },
  };

  const voidedTargetSeat =
    outcome.takesPlayer && targetSeat !== null && victimSeat === undefined ? targetSeat : undefined;

  return {
    state: currentState,
    outcome,
    victimSeat,
    voidedTargetSeat,
    newlyAnnouncedDeaths,
    badgeTransferSeat: deadSheriffSeat,
    pendingLastWordsSeats,
  };
}
