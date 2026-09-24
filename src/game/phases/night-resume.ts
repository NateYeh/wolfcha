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
 * 續跑鏈上每個步驟自己的守衛是「帶著的 phase 已經在這一階段就不重跑」
 * （`if (currentState.phase !== "NIGHT_X_ACTION")`），而**每個 `run*Action` 都會把 phase 改成自己**。
 * 因此「跳過」與「重跑」各自要下什麼指令是從這個機制推出來的：
 *
 * - **跳過**這一步（已完成）＝ `CONTINUE_NIGHT_AFTER_X`：帶著的 phase 就是 X，正好跳過它、往下繼續；
 * - **重跑**這一步（AI 的決定沒落盤）＝ 必須讓鏈帶著一個 **≠ X** 的 phase 走到這一步，所以只能從
 *   「更前面的指令」進去（`REPLAY_COMMAND` 表逐項說明了理由）。
 *
 * 這張表無法只用順序推導：例如禁言的重跑**不能**用前一步的 `CONTINUE_NIGHT_AFTER_GUARD`
 * （它只是轉呼叫、不改 phase，於是禁言步驟被跳過、決定根本不會做）。這種細節只有實際跑過
 * 一夜才看得出來，所以 `night-resume-flow.test.ts` 逐階段驗證「下了重跑指令之後，那一步的
 * 決定真的有被寫入」。
 */

/** 夜間續跑鏈可下的指令（與 `NightPhase.handleAction` 的 vocabulary 一致）。 */
export type NightResumeCommand =
  | "START_NIGHT"
  | "CONTINUE_NIGHT_AFTER_GUARD"
  | "CONTINUE_NIGHT_AFTER_MUTE"
  | "CONTINUE_NIGHT_AFTER_DREAM"
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
  NIGHT_WOLF_ACTION: { kind: "advance", command: "CONTINUE_NIGHT_AFTER_WOLF" },
  NIGHT_WOLF_BEAUTY_ACTION: { kind: "advance", command: "CONTINUE_NIGHT_AFTER_WOLF_BEAUTY" },
  NIGHT_WITCH_ACTION: { kind: "advance", command: "CONTINUE_NIGHT_AFTER_WITCH" },
  NIGHT_SEER_ACTION: { kind: "resolve" },
};

/**
 * 重跑某一步的指令：讓續跑鏈「帶著不等於該步驟的 phase」走到那一步，於是那一步的行動會被執行。
 *
 * 逐項理由（由 `NightPhase` 的鏈結構推導，並由 `night-resume-flow.test.ts` 實際驗證）：
 *
 * | 階段 | 重跑指令 | 為何是它 |
 * |---|---|---|
 * | 守衛 | `START_NIGHT` | `runNightPhase` 是唯一會跑守衛行動的入口 |
 * | 禁言 | `START_NIGHT` | `CONTINUE_NIGHT_AFTER_GUARD` 只是轉呼叫、不改 phase，禁言會被跳過 |
 * | 攝夢 | `START_NIGHT` | 同上：從頭跑才會帶著守衛／禁言的 phase 走到攝夢 |
 * | 狼人 | `CONTINUE_NIGHT_AFTER_GUARD` | 鏈會先跑禁言／攝夢（AI 重問），然後無條件跑狼人 |
 * | 女巫 | `CONTINUE_NIGHT_AFTER_WOLF` | 這一支無條件呼叫 `runWitchAction` |
 * | 預言家 | `CONTINUE_NIGHT_AFTER_WITCH` | 這一支無條件呼叫 `runSeerAction` |
 *
 * ⚠️ 狼人／女巫／預言家以外的重跑會把**前面的 AI 步驟重新問一次**（覆蓋掉原本的目標）。
 * 這是舊行為，這裡先原樣保留；要修得在階段層加一個「就從這一步續跑」的指令，
 * 屬 Phase 5／6 的範圍（見 docs/night-sequencing-refactor-plan.md）。
 */
const REPLAY_COMMAND: Record<NightActionPhase, NightResumeCommand> = {
  NIGHT_GUARD_ACTION: "START_NIGHT",
  NIGHT_MUTE_ACTION: "START_NIGHT",
  NIGHT_DREAM_ACTION: "START_NIGHT",
  NIGHT_WOLF_ACTION: "CONTINUE_NIGHT_AFTER_GUARD",
  // 重播魅惑這一步：前面每一步都可能還沒做完，所以從最前面的 START_NIGHT 重跑
  NIGHT_WOLF_BEAUTY_ACTION: "START_NIGHT",
  NIGHT_WITCH_ACTION: "CONTINUE_NIGHT_AFTER_WOLF",
  NIGHT_SEER_ACTION: "CONTINUE_NIGHT_AFTER_WITCH",
};

/** 重跑某一步的指令（Dev 跳轉到某個夜間階段也是用同一張表）。 */
export const replayCommandFor = (phase: NightActionPhase): NightResumeCommand => REPLAY_COMMAND[phase];

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
