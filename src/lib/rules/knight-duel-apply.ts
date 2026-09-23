import type { GameState, Phase } from "@/types/game";
import type { RuleFlags } from "./flags";
import {
  canDuel,
  hasAlreadyDueled,
  resolveKnightDuelOutcome,
  type KnightDuelOutcome,
} from "./knight-duel";
import { isPendingDeath } from "./night-deaths";
import {
  markPlayerDead,
  settleUnannouncedNightDeaths,
  type NewlyAnnouncedDeath,
} from "./settle-night-deaths";

/**
 * 騎士翻牌決鬥的**狀態轉移**（純函式，不含 UI／LLM／音效）。
 *
 * 流程（2026-09-22 拍板）：
 * - 挑戰目標是狼人 → 該狼人出局，**隨即進入黑夜**（跳過當天剩餘發言與放逐投票）。
 *   決鬥只能發生在白天發言階段（警徽競選早已結束），因此不影響競選狀態。
 * - 挑戰目標是好人 → 騎士以死謝罪出局，**白天流程照走**。
 * - 決鬥死亡沒有遺言；被決鬥出局的狼人不能發動死亡技能。
 */

export interface KnightDuelApplyInput {
  state: GameState;
  /** 發動決鬥的騎士座位 */
  duelistSeat: number;
  /** 被挑戰的座位 */
  targetSeat: number;
  /** 決鬥發生在哪個階段（決定了之後回到白天還是進入黑夜） */
  originPhase: Phase;
  flags: RuleFlags;
}

export interface KnightDuelApplyResult {
  state: GameState;
  /** 決鬥結果（技能無效時沒有結果） */
  outcome?: KnightDuelOutcome;
  /** 決鬥出局的座位（成功＝被挑戰的狼、失敗＝騎士本人）；技能無效時不設 */
  deadSeat?: number;
  /** 指定了已出局的目標而被判技能無效（此時技能未消耗、狀態不變） */
  voidedTargetSeat?: number;
  /** 尚未公布、這次要補公布的夜間死亡（成功決鬥直接天黑時使用） */
  newlyAnnouncedDeaths: NewlyAnnouncedDeath[];
  /** 這次結算後待發表遺言的佇列（不含決鬥死者本人：決鬥死亡沒有遺言） */
  pendingLastWordsSeats: number[];
  /** 需要移交警徽的座位（警長死亡且警徽還在）；null＝不需要移交 */
  badgeTransferSeat: number | null;
}

export function applyKnightDuelToState(input: KnightDuelApplyInput): KnightDuelApplyResult {
  const { state, duelistSeat, targetSeat, originPhase, flags } = input;
  const duelist = state.players.find((player) => player.seat === duelistSeat);
  if (!duelist) throw new Error(`決鬥失敗：找不到座位 ${duelistSeat} 的騎士`);
  if (!canDuel({
    phase: originPhase,
    role: duelist.role,
    flags,
    duelUsedSeats: state.roleAbilities.duelUsedSeats,
    seat: duelistSeat,
  })) {
    throw new Error(`決鬥失敗：${duelistSeat} 號（${duelist.role}）在 ${originPhase} 不能發動決鬥`);
  }
  if (duelistSeat === targetSeat) throw new Error("決鬥失敗：不能挑戰自己");

  const target = state.players.find((player) => player.seat === targetSeat);
  const targetUsable = Boolean(target?.alive) && !isPendingDeath(state, targetSeat);

  // 技能只能指向場上存活的玩家：指定已出局（含死訊未公布的第一夜死者）＝技能無效，
  // 不消耗決鬥次數、狀態原樣返回（由呼叫方把階段切回來源階段）。
  if (!target || !targetUsable) {
    return {
      state,
      voidedTargetSeat: targetSeat,
      newlyAnnouncedDeaths: [],
      pendingLastWordsSeats: [...new Set(state.pendingLastWordsSeats ?? [])],
      badgeTransferSeat: null,
    };
  }

  const outcome = resolveKnightDuelOutcome({ targetRole: target.role, flags });
  const deadSeat = outcome.targetDies ? targetSeat : duelistSeat;

  // 1) 標記決鬥已使用（一場一次）＋ 決鬥死者出局
  let currentState: GameState = {
    ...state,
    roleAbilities: {
      ...state.roleAbilities,
      duelUsedSeats: [...new Set([...(state.roleAbilities.duelUsedSeats ?? []), duelistSeat])],
    },
  };
  currentState = markPlayerDead(currentState, deadSeat);

  // 2) 決鬥死亡的狼人不能發動死亡技能（含狼王槍：DEATH_SHOT_RULES.wolf_gun.onDuel = false）（狼王開槍、白狼王帶人、狼美人殉情）。
  //    死因記在 dayHistory.knightDuel 與 knight-duel.ts 的 canTriggerDeathSkill()，
  //    由未來角色的死亡技能自行查表；目前白狼王只剩自爆能發動（自爆需存活），故不影響現行流程。

  // 3) 直接天黑：競選還沒結束就順延（不動 electionBooms），並補公布未宣布的夜間死訊
  let newlyAnnouncedDeaths: NewlyAnnouncedDeath[] = [];
  let pendingLastWordsSeats = [...new Set(currentState.pendingLastWordsSeats ?? [])];
  const badge = { ...currentState.badge };
  let nextPhase: Phase = originPhase;

  if (outcome.goToNight) {
    nextPhase = "KNIGHT_DUEL";
    const settled = settleUnannouncedNightDeaths(currentState);
    currentState = settled.state;
    newlyAnnouncedDeaths = settled.newlyAnnouncedDeaths;
    pendingLastWordsSeats = settled.pendingLastWordsSeats;
  }

  // 4) 警長死亡：警徽還在就交出移交權（由呼叫方讓警長自己選傳徽或撕徽）
  const holderSeat = badge.holderSeat;
  const deadSheriffSeat =
    holderSeat !== null && !currentState.players.find((player) => player.seat === holderSeat)?.alive
      ? holderSeat
      : null;

  // 5) 決鬥紀錄 + 階段（成功＝進 KNIGHT_DUEL 由呼叫方續跑天黑；失敗＝回到白天階段）
  const prevDayRecord = (currentState.dayHistory || {})[currentState.day] || {};
  currentState = {
    ...currentState,
    phase: nextPhase,
    badge,
    pendingLastWordsSeats: pendingLastWordsSeats.length > 0 ? pendingLastWordsSeats : undefined,
    nightActions: outcome.goToNight
      ? {
          ...currentState.nightActions,
          pendingWolfVictim: undefined,
          pendingPoisonVictim: undefined,
          pendingDreamVictim: undefined,
        }
      : currentState.nightActions,
    dayHistory: {
      ...(currentState.dayHistory || {}),
      [currentState.day]: {
        ...prevDayRecord,
        knightDuel: {
          duelistSeat,
          targetSeat,
          targetIsWolf: outcome.targetIsWolf,
          goToNight: outcome.goToNight,
        },
      },
    },
  };

  return {
    state: currentState,
    outcome,
    deadSeat,
    newlyAnnouncedDeaths,
    pendingLastWordsSeats,
    badgeTransferSeat: deadSheriffSeat,
  };
}

/** 這個座位的騎士是否已經用過決鬥（供 UI／AI 檢查） */
export function knightHasDueled(state: GameState, seat: number): boolean {
  return hasAlreadyDueled(state.roleAbilities.duelUsedSeats, seat);
}
