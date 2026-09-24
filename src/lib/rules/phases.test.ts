import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_PHASES,
  NIGHT_ACTION_ORDER,
  PHASE_KIND,
  PHASE_SEQUENCE,
  PROMPT_NEEDS_PUBLIC_EVIDENCE,
  SPEECH_PHASES,
  isDayPhase,
  isNightPhase,
  isSpeechPhase,
} from "@/lib/rules/phases";
import type { Phase } from "@/types/game";

/**
 * Phase 權威表守衛。
 *
 * `PHASE_KIND`／`PHASE_SEQUENCE` 等表是「新增階段只補一筆資料」的前提：
 * 型別（`Record<Phase, …>`）保證新增 Phase 時編譯會紅，這支測試保證
 * 各張表之間彼此同步，不會出現「聯集加了、順序表漏了」這種安靜的漂移。
 */

test("PHASE_KIND 與 PHASE_SEQUENCE 涵蓋同一組階段，且各出現一次", () => {
  const kinds = Object.keys(PHASE_KIND).sort();
  const sequence = [...PHASE_SEQUENCE].sort();
  assert.deepEqual(sequence, kinds, "PHASE_SEQUENCE 與 PHASE_KIND 的階段集合不一致");
  assert.equal(
    new Set(PHASE_SEQUENCE).size,
    PHASE_SEQUENCE.length,
    "PHASE_SEQUENCE 有重複的階段",
  );
  assert.equal(kinds.length, 25, `Phase 聯集應為 25 個，目前 ${kinds.length} 個`);
});

test("夜晚行動順序：全為夜間階段，且順序與規則記載一致（守衛→禁言→攝夢→狼→魅惑→女巫→預言家）", () => {
  for (const phase of NIGHT_ACTION_ORDER) {
    assert.ok(isNightPhase(phase), `${phase} 不是夜間階段，不該出現在夜晚行動順序`);
    assert.ok(PHASE_SEQUENCE.includes(phase), `${phase} 不在 PHASE_SEQUENCE 內`);
  }
  assert.deepEqual([...NIGHT_ACTION_ORDER], [
    "NIGHT_GUARD_ACTION",
    "NIGHT_MUTE_ACTION",
    "NIGHT_DREAM_ACTION",
    "NIGHT_WOLF_ACTION",
    // 狼美人魅惑排在狼刀之後、女巫之前（她參與刀人，之後才單獨行動）
    "NIGHT_WOLF_BEAUTY_ACTION",
    "NIGHT_WITCH_ACTION",
    "NIGHT_SEER_ACTION",
  ]);
});

test("發言階段：全為白天階段，且涵蓋競選／PK／白天／遺言四種發言輪", () => {
  for (const phase of SPEECH_PHASES) {
    assert.ok(isDayPhase(phase), `${phase} 不是白天階段，不該出現在發言階段`);
  }
  assert.deepEqual([...SPEECH_PHASES].sort(), [
    "DAY_BADGE_SPEECH",
    "DAY_LAST_WORDS",
    "DAY_PK_SPEECH",
    "DAY_SPEECH",
  ]);
});

test("跳階需補全的決策階段：只能是夜間行動階段或放逐投票", () => {
  const backfillable = new Set<Phase>([...NIGHT_ACTION_ORDER, "DAY_VOTE"]);
  for (const phase of ACTION_PHASES) {
    assert.ok(backfillable.has(phase), `${phase} 不是需要補全資料的決策階段`);
  }
});

test("每個夜間行動階段都必須在跳階補全名單內（漏一個就會跳過該角色的決定）", () => {
  const missing = NIGHT_ACTION_ORDER.filter((phase) => !ACTION_PHASES.includes(phase));
  assert.deepEqual(missing, [], `以下夜間行動階段未列入 ACTION_PHASES：${missing.join(", ")}`);
});

test("isNightPhase／isDayPhase／isSpeechPhase 與 PHASE_KIND 一致", () => {
  for (const phase of PHASE_SEQUENCE) {
    assert.equal(isNightPhase(phase), PHASE_KIND[phase] === "night", `${phase} 夜間判斷不一致`);
    assert.equal(isDayPhase(phase), PHASE_KIND[phase] === "day", `${phase} 白天判斷不一致`);
    assert.equal(isSpeechPhase(phase), SPEECH_PHASES.includes(phase), `${phase} 發言判斷不一致`);
  }
});

test("證據矩陣名單由權威表衍生，且等於已確認的十個決策階段", () => {
  const matrix = PHASE_SEQUENCE.filter((phase) => PROMPT_NEEDS_PUBLIC_EVIDENCE[phase]);
  assert.deepEqual([...matrix].sort(), [
    "BADGE_TRANSFER",
    "DAY_BADGE_ELECTION",
    "DAY_BADGE_SIGNUP",
    "DAY_LAST_WORDS",
    "DAY_PK_SPEECH",
    "DAY_SPEECH",
    "DAY_VOTE",
    "HUNTER_SHOOT",
    "KNIGHT_DUEL",
    "SELF_DESTRUCT",
  ]);
});
