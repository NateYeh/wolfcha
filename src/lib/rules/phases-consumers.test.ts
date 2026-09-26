import assert from "node:assert/strict";
import test from "node:test";
import { PHASE_CATEGORIES } from "@/lib/game-constants";
import {
  PHASE_SEQUENCE,
  SPEECH_PHASES,
  isDayPhase,
  isNightPhase,
} from "@/lib/rules/phases";

// SmartJumpManager／game-machine／PhaseManager 會間接載入 supabase.ts，
// 缺環境變數會在 import 時直接丟錯；沿用其他測試的作法先塞假值（動態 import 才有效）。
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "phases-consumers-test-key";

/**
 * 消費端等價守衛。
 *
 * Phase 知識過去被手寫在十多處，各自漂移（NIGHT_PHASES 漏 MUTE／DREAM、
 * PHASE_ORDER 漏 DAY_PK_SPEECH、VALID_PHASES 漏 KNIGHT_DUEL）。現在每張消費表都必須
 * 與 `@/lib/rules/phases` 的權威表等價；這支測試把「等價」這件事釘死在行為上。
 *
 * 為何不做「原始碼不得出現 phase 陣列字面值」的掃描守衛：合法的陣列字面值太多
 * （VALID_TRANSITIONS 自己就有 14 個 3 元素以上的陣列、mute 的禁言階段清單也是合理概念），
 * 掃描只會產生大量誤報。真正的機制是型別：所有表都是 `Record<Phase, …>`，
 * 新增一個 Phase 會直接產生約 10 個編譯錯誤，指向每一處該做決定的地方。
 */

test("PHASE_CATEGORIES 與權威表等價（夜／晝／發言）", () => {
  assert.deepEqual([...PHASE_CATEGORIES.NIGHT_PHASES], PHASE_SEQUENCE.filter(isNightPhase));
  assert.deepEqual([...PHASE_CATEGORIES.DAY_PHASES], PHASE_SEQUENCE.filter(isDayPhase));
  assert.deepEqual([...PHASE_CATEGORIES.SPEECH_PHASES].sort(), [...SPEECH_PHASES].sort());
});

test("跳階順序就是 PHASE_SEQUENCE 的順序，每個階段都有非負索引", async () => {
  const { getPhaseIndex } = await import("@/lib/SmartJumpManager");
  PHASE_SEQUENCE.forEach((phase, index) => {
    assert.equal(getPhaseIndex(phase), index, `${phase} 的跳階索引應為 ${index}`);
  });
});

test("VALID_TRANSITIONS 涵蓋所有階段（新增階段必須補上轉移）", async () => {
  const { VALID_TRANSITIONS } = await import("@/store/game-machine");
  assert.deepEqual(Object.keys(VALID_TRANSITIONS).sort(), [...PHASE_SEQUENCE].sort());
  for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
    for (const target of targets) {
      assert.ok(
        PHASE_SEQUENCE.includes(target),
        `${from} → ${target}：目標不是合法階段`,
      );
    }
  }
});

test("PhaseManager：恰好 20 個階段有提示詞實作，其餘明確為 null", async () => {
  const { PhaseManager } = await import("@/game/core/PhaseManager");
  const manager = new PhaseManager();
  const withPrompt = PHASE_SEQUENCE.filter((phase) => manager.getPhase(phase) !== null);
  assert.deepEqual(withPrompt, [
    "NIGHT_START",
    "NIGHT_GUARD_ACTION",
    "NIGHT_MUTE_ACTION",
    "NIGHT_DREAM_ACTION",
    "NIGHT_MAGICIAN_ACTION",
    "NIGHT_WOLF_BEAUTY_ACTION",
    "NIGHT_WOLF_ACTION",
    "NIGHT_WITCH_ACTION",
    "NIGHT_SEER_ACTION",
    "DAY_BADGE_SIGNUP",
    "DAY_BADGE_SPEECH",
    "DAY_BADGE_ELECTION",
    "DAY_PK_SPEECH",
    "DAY_SPEECH",
    "DAY_VOTE",
    "DAY_LAST_WORDS",
    "BADGE_TRANSFER",
    "HUNTER_SHOOT",
    "SELF_DESTRUCT",
    "KNIGHT_DUEL",
  ]);
});
