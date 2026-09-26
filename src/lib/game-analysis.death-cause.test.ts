import assert from "node:assert/strict";
import test from "node:test";
import type { DeathCause } from "@/types/analysis";

// game-analysis 間接載入 supabase.ts，缺環境變數會在 import 時直接丟錯；
// 先塞假值再動態 import（沿用其他測試的作法）。
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "death-cause-test-key";

/**
 * 死因對照守衛。
 *
 * 殉情（`reason: "charm"`）一開始不在 `parseDeathCause` 的 switch 裡，於是掉進
 * `default: "killed"`——賽後分析把「隨狼美人殉情出局」寫成「夜晚被刀」，玩家看到的是
 * **錯的死因**而不是壞掉，極難發現。夜史新增任何死因，這裡都要有對應分類與文案。
 */

/** 夜史 `deaths[].reason` 的權威清單（新增死因時這裡會少一格，測試會紅）。 */
const NIGHT_DEATH_REASONS = ["wolf", "poison", "milk", "dream", "charm"] as const;

test("每個夜史死因都有自己的分類，不得掉進 default", async () => {
  const { parseDeathCause } = await import("@/lib/game-analysis");
  const causes = new Map<string, string>();
  for (const reason of NIGHT_DEATH_REASONS) {
    const cause = parseDeathCause(reason);
    assert.ok(cause, `${reason} 取不到分類`);
    causes.set(reason, cause);
  }
  assert.equal(
    causes.get("charm"),
    "charmed",
    "殉情必須有自己的分類（原本掉進 default 被當成狼刀）"
  );
  const duplicated = [...causes.entries()].filter(
    ([reason, cause]) => [...causes.entries()].some(([other, c]) => other !== reason && c === cause)
  );
  assert.deepEqual(duplicated, [], `不同死因不該共用同一分類：${JSON.stringify(duplicated)}`);
});

test("每個分類都有非空且彼此不同的文案", async () => {
  const { formatDeathCauseText, parseDeathCause } = await import("@/lib/game-analysis");
  const seen = new Map<string, DeathCause>();
  for (const reason of NIGHT_DEATH_REASONS) {
    const cause = parseDeathCause(reason);
    const label = formatDeathCauseText(cause);
    assert.ok(label && label.trim().length > 0, `${cause} 沒有文案`);
    assert.notEqual(label, "出局原因未记录", `${cause} 掉進了未記錄的預設文案`);
    const previous = seen.get(label);
    assert.equal(previous, undefined, `${cause} 與 ${previous} 文案相同（${label}）`);
    seen.set(label, cause);
  }
  assert.match(formatDeathCauseText("charmed"), /殉情/, "殉情的文案要講清楚是殉情");
});

/**
 * 白天殉情（2026-09-26 個案：12號 葉小雷 隨狼美人殉情出局）：分析要認得
 * `dayHistory.charmDeaths`。這一筆由 `rules/charm` 的 `applyCharmRevenge` 落盤，
 * 讀不到就會讓殉情者在紀錄上「沒有死因、沒有死亡日」。
 */
test("白天殉情：分析從 dayHistory.charmDeaths 取得死因 charmed", async () => {
  const { buildPlayerSnapshots } = await import("@/lib/game-analysis");
  const { createSinglePlayerContextAuditState } = await import("../../scripts/single-player-context-audit");
  const base = createSinglePlayerContextAuditState();
  const state = {
    ...base,
    day: 2,
    dayHistory: { 2: { charmDeaths: [5] } },
  } as typeof base;
  const snapshot = buildPlayerSnapshots(state).find((player) => player.seat === 5);
  assert.equal(snapshot?.deathDay, 2, "殉情要記得出局的那一天");
  assert.equal(snapshot?.deathCause, "charmed", "殉情不得掉成別的（或沒有）死因");
});
