import { canSelfDestruct, hasAlreadyBoomed, isSelfDestructPhase } from "./rules/self-destruct";
import { canDuel } from "./rules/knight-duel";
import { getBoardRuleFlags } from "./rules/boards";
import { parseLLMJson } from "./llm-json";
import type { GameState, Player } from "@/types/game";

/**
 * 發言階段技能：把技能決定**併進同一次發言請求**（省掉一輪完整 context 的重送）。
 *
 * 原本每個狼／騎士的發言輪要送兩次請求（先發言、再單獨問要不要自爆／翻牌），
 * 第二次的 prompt 幾乎與第一次相同（同樣的白天逐字稿與盤面），等於白花一次
 * 7～10k token 的 context。現在技能角色改成輸出
 * `{"speech": ["…"], "skill": {"action": "boom"}}`，串流解析器只挑 public 欄位當字幕／TTS，
 * `skill` 整棵子樹不會外洩到畫面；這支模組負責從原始回應裡把決定抽出來。
 *
 * 模型漏寫 skill 時回傳 null，呼叫端退回原本的獨立決策請求（行為不變、只是多一次呼叫）。
 */
export type SpeechSkillKind = "self_destruct" | "knight_duel";

export interface SpeechSkillDecision {
  kind: SpeechSkillKind;
  /** use＝發動；none＝不發動 */
  action: "use" | "none";
  /** 0 基座位（不帶人／不指定時為 null） */
  seat: number | null;
  reason: string;
}

/** 這個玩家在這個階段發言時，是否附帶技能決定（單一真相：prompt 與解析共用） */
export function resolveSpeechSkillKind(state: GameState, player: Player): SpeechSkillKind | null {
  if (!player.alive || player.isHuman) return null;
  const flags = getBoardRuleFlags(state.players.length);
  if (
    isSelfDestructPhase(state.phase) &&
    canSelfDestruct({ phase: state.phase, role: player.role, flags }) &&
    !hasAlreadyBoomed(state.roleAbilities.boomedSeats, player.seat)
  ) {
    return "self_destruct";
  }
  if (
    canDuel({
      phase: state.phase,
      role: player.role,
      flags,
      duelUsedSeats: state.roleAbilities.duelUsedSeats,
      seat: player.seat,
    })
  ) {
    return "knight_duel";
  }
  return null;
}

/** 這個角色這次發言自爆時能不能帶人（白狼王） */
export function speechSkillTakesPlayer(state: GameState, player: Player): boolean {
  const flags = getBoardRuleFlags(state.players.length);
  return flags.boom.takesPlayerRoles.includes(player.role);
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** 從任意欄位名找出技能物件（模型偶爾會改名） */
function findSkillRecord(root: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ["skill", "skill_decision", "skillDecision", "skill_action", "skillAction", "ability"]) {
    const record = asRecord(root[key]);
    if (record) return record;
  }
  return null;
}

function normalizeSeat(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number.parseInt(value.trim(), 10)
        : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric - 1; // 顯示座位從 1 起算
}

/**
 * 從發言回應的原始內容抽出技能決定。
 *
 * @returns null＝模型沒給決定（呼叫端退回獨立請求）
 */
export function extractSpeechSkillDecision(
  rawContent: string,
  kind: SpeechSkillKind
): SpeechSkillDecision | null {
  const parsed = parseLLMJson<unknown>(rawContent);
  const root = asRecord(parsed);
  if (!root) return null;
  const skill = findSkillRecord(root);
  if (!skill) return null;

  const actionText = String(skill.action ?? skill.type ?? skill.decision ?? "").trim().toLowerCase();
  const seatValue = skill.seat ?? skill.targetSeat ?? skill.target ?? null;
  const uses = actionText === "use" || actionText === "boom" || actionText === "duel" ||
    actionText === "challenge" || actionText === "reveal" || actionText === "yes" || actionText === "true" ||
    (actionText === "" && normalizeSeat(seatValue) !== null);
  const passes = actionText === "none" || actionText === "pass" || actionText === "skip" ||
    actionText === "no" || actionText === "false" || actionText === "0";

  const reasonValue = skill.reason ?? skill.why ?? "";
  const reason = typeof reasonValue === "string" ? reasonValue.trim().slice(0, 120) : "";
  if (!uses && !passes) return null;

  return {
    kind,
    action: uses ? "use" : "none",
    seat: uses ? normalizeSeat(seatValue) : null,
    reason,
  };
}
