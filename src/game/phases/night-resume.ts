import type { GameState, Phase } from "@/types/game";
import type { NightActionPhase } from "@/lib/rules/phases";
import { NIGHT_STEP, actorsForNightStep, isNightActionPhase } from "@/lib/rules/night-progress";

/**
 * 夜晚續跑的指令表（單一真相）。
 *
 * 存檔恢復、Dev 跳轉、Dev 動作軟編輯，問的都是同一個問題：
 * **「現在停在這個夜間階段，接下來該下哪個指令？」** 過去這個答案散在
 * `useGameLogic` 三處、各自寫死字串，而且 wolf 那處寫成了 `CONTINUE_NIGHT_AFTER_GUARD`——
 * 那會沿著續跑鏈把「禁言」「攝夢」兩個已經決定好的步驟**再問一次 AI**，把玩家看過的決定覆蓋掉。
 *
 * 續跑鏈現在每一步都問單一真相 `NIGHT_STEP[phase].decided(state)`（`rules/night-progress`）
 * 來決定「這一步要不要跑」，**不再看 phase 是不是自己**。這一點很重要：
 * 「帶著的 phase 已經在這一階段」有兩種可能——(a) 這一步真的做完了；(b) 這一步的決定沒有落盤。
 * 只有 `decided()` 能分辨兩者（夜晚開始時 `useGameLogic` 會重建 `nightActions`，所以
 * 新的一夜一切仍未決定；而重跑與恢復都是在同一夜之內）。
 *
 * 因此：
 *
 * - **跳過**這一步（已完成）＝ `CONTINUE_NIGHT_AFTER_X`；
 * - **重跑**缺少決定的步驟＝ `START_NIGHT`：沿著夜間順序走一遍，
 *   已決定的步驟會被 `decided()` 擋掉、**不會重問 AI**，未決定的才會補上。
 *
 * 這張表以前逐階段不同（守衛／禁言／攝夢／魔術師／狼美人只能下 `START_NIGHT`），
 * 而那些 `START_NIGHT` 會把前面已決定的步驟重新問一遍——現在統一成同一個指令。
 * `night-resume-flow.test.ts` 逐階段驗證「下了重跑指令之後，那一步的決定真的有被寫入，
 * 而且前面已決定的步驟沒有被覆蓋」。
 */

/** 夜間續跑鏈可下的指令（與 `NightPhase.handleAction` 的 vocabulary 一致）。 */
export type NightResumeCommand =
  | "START_NIGHT"
  | "CONTINUE_NIGHT_AFTER_GUARD"
  | "CONTINUE_NIGHT_AFTER_MUTE"
  | "CONTINUE_NIGHT_AFTER_DREAM"
  | "CONTINUE_NIGHT_AFTER_MAGICIAN"
  | "CONTINUE_NIGHT_AFTER_WOLF"
  | "CONTINUE_NIGHT_AFTER_WOLF_BEAUTY"
  | "CONTINUE_NIGHT_AFTER_WITCH";

/** 停在一個夜間階段時該做的事。 */
export type NightResumePlan =
  /** 這一步已完成 → 跳過它，從下一步繼續 */
  | { kind: "advance"; command: NightResumeCommand }
  /** 夜間動作全數完成（預言家是最後一個動作步驟）→ 進結算 */
  | { kind: "resolve" }
  /** AI 的決定沒有落盤 → 從這一步重跑（前面的步驟不會被重問） */
  | { kind: "replay"; command: NightResumeCommand }
  /** 真人在等輸入 → 停在這裡等前端把決定寫進狀態 */
  | { kind: "wait" };

/** 跳過某一步、從下一步繼續的指令。 */
const ADVANCE_PLAN: Record<NightActionPhase, NightResumePlan> = {
  NIGHT_GUARD_ACTION: { kind: "advance", command: "CONTINUE_NIGHT_AFTER_GUARD" },
  NIGHT_MUTE_ACTION: { kind: "advance", command: "CONTINUE_NIGHT_AFTER_MUTE" },
  NIGHT_DREAM_ACTION: { kind: "advance", command: "CONTINUE_NIGHT_AFTER_DREAM" },
  NIGHT_MAGICIAN_ACTION: { kind: "advance", command: "CONTINUE_NIGHT_AFTER_MAGICIAN" },
  NIGHT_WOLF_ACTION: { kind: "advance", command: "CONTINUE_NIGHT_AFTER_WOLF" },
  NIGHT_WOLF_BEAUTY_ACTION: { kind: "advance", command: "CONTINUE_NIGHT_AFTER_WOLF_BEAUTY" },
  NIGHT_WITCH_ACTION: { kind: "advance", command: "CONTINUE_NIGHT_AFTER_WITCH" },
  NIGHT_SEER_ACTION: { kind: "resolve" },
};

/**
 * 重跑某一步的指令：**一律 `START_NIGHT`**。
 *
 * 鏈上的守衛現在問 `NIGHT_STEP[phase].decided(state)`，所以從頭走一遍
 * *只會* 補上還沒決定的步驟：已決定的不會被重問 AI（舊表逐階段不同，
 * 守衛／禁言／攝夢／魔術師／狼美人的 `START_NIGHT` 會把前面已決定的重新問一次）。
 */
const REPLAY_COMMAND: NightResumeCommand = "START_NIGHT";

/** 重跑某一步的指令（Dev 跳轉到某個夜間階段也是用同一個答案）。 */
export const replayCommandFor = (_phase: NightActionPhase): NightResumeCommand => REPLAY_COMMAND;

/**
 * 停在一個夜間階段時的續跑計畫。
 *
 * `phase` 應傳入 `state.phase`（呼叫端通常已先用型別守衛縮窄）。
 */
export const nightResumePlan = (state: GameState, phase: Phase): NightResumePlan => {
  if (!isNightActionPhase(phase)) {
    throw new Error(`nightResumePlan 只接受夜間行動階段，收到 ${phase}`);
  }
  const step = NIGHT_STEP[phase];
  if (step.decided(state)) return ADVANCE_PLAN[phase];
  if (actorsForNightStep(state, phase).some((player) => player.isHuman)) return { kind: "wait" };
  return { kind: "replay", command: replayCommandFor(phase) };
};
