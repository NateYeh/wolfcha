import assert from "node:assert/strict";
import test from "node:test";

import { SYSTEM_VOTE_WEIGHT, tallyAwards, type AwardBallot } from "@/lib/awards";
import type { Player, Role } from "@/types/game";

function makePlayer(seat: number, overrides: Partial<Player> = {}): Player {
  return {
    playerId: `p${seat}`,
    seat,
    displayName: `P${seat}`,
    alive: true,
    role: "Villager" as Role,
    alignment: "village",
    isHuman: false,
    ...overrides,
  };
}

function ballot(
  voterSeat: number,
  mvpSeat: number | null,
  svpSeat: number | null,
  overrides: Partial<AwardBallot> = {},
): AwardBallot {
  return {
    voterId: `voter${voterSeat}`,
    voterName: `Voter${voterSeat}`,
    voterRole: "Villager",
    mvpPlayerId: mvpSeat === null ? null : `p${mvpSeat}`,
    mvpReason: `mvp by voter${voterSeat}`,
    svpPlayerId: svpSeat === null ? null : `p${svpSeat}`,
    svpReason: `svp by voter${voterSeat}`,
    ...overrides,
  };
}

test("系統票 1.5：AI 同票時由系統票多出的 0.5 決定勝負", () => {
  const players = [makePlayer(0), makePlayer(1), makePlayer(2)];
  const result = tallyAwards({
    ballots: [ballot(0, 0, 1), ballot(1, 1, 0)],
    systemMvp: { playerId: "p1", reason: "客观最佳" },
    systemSvp: null,
    players,
  });
  // seat0 = 1（AI），seat1 = 1（AI） + 1.5（系統）= 2.5
  assert.equal(result.mvp.playerId, "p1");
  assert.equal(result.mvp.reason, "客观最佳");
  const systemVote = result.awardVotes.mvp.find((vote) => vote.isSystem);
  assert.equal(systemVote?.weight, SYSTEM_VOTE_WEIGHT);
  assert.equal(systemVote?.voterSeat, -1);
});

test("AI 票數過半可壓過系統票；理由取投給他的一張票", () => {
  const players = [makePlayer(0), makePlayer(1)];
  const result = tallyAwards({
    ballots: [ballot(0, 0, 1), ballot(1, 0, 1), ballot(2, 0, 1)],
    systemMvp: { playerId: "p1", reason: "客观最佳" },
    systemSvp: null,
    players,
  });
  // seat0 = 3（AI） > seat1 = 1.5（系統）
  assert.equal(result.mvp.playerId, "p0");
  assert.equal(result.mvp.reason, "mvp by voter0");
});

test("投錯邊不校正：MVP 票投給誰就記誰", () => {
  const players = [makePlayer(0), makePlayer(1)];
  const result = tallyAwards({
    ballots: [ballot(0, 1, 0)],
    systemMvp: null,
    systemSvp: null,
    players,
  });
  // 即使 p1 是敗方，AI 把 MVP 票投給他仍照實計分。
  assert.equal(result.mvp.playerId, "p1");
  assert.equal(result.mvp.reason, "mvp by voter0");
});

test("未知／無效的投票目標直接忽略", () => {
  const players = [makePlayer(0), makePlayer(1)];
  const result = tallyAwards({
    ballots: [ballot(0, null, null), ballot(1, 99, 99)],
    systemMvp: { playerId: "p0", reason: "客观最佳" },
    systemSvp: null,
    players,
  });
  assert.equal(result.mvp.playerId, "p0");
  assert.equal(result.awardVotes.mvp.length, 1);
});

test("純 AI 同票（無系統票）時：存活者優先，再比座位小", () => {
  const players = [
    makePlayer(0, { alive: false }),
    makePlayer(1, { alive: true }),
    makePlayer(2, { alive: true }),
  ];
  const result = tallyAwards({
    ballots: [ballot(0, 0, 0), ballot(1, 1, 1), ballot(2, 2, 2)],
    systemMvp: null,
    systemSvp: null,
    players,
  });
  // 三人都 1 票；seat0 已出局 → 由存活的 seat1／seat2 比座位，seat1 勝。
  assert.equal(result.mvp.playerId, "p1");
});

test("SVP 與 MVP 各自獨立計票", () => {
  const players = [makePlayer(0), makePlayer(1), makePlayer(2)];
  const result = tallyAwards({
    ballots: [ballot(0, 0, 2), ballot(1, 0, 2)],
    systemMvp: { playerId: "p0", reason: "客观最佳" },
    systemSvp: { playerId: "p1", reason: "虽败犹荣" },
    players,
  });
  assert.equal(result.mvp.playerId, "p0");
  // seat2 = 2（AI） > seat1 = 1.5（系統）
  assert.equal(result.svp.playerId, "p2");
  assert.equal(result.svp.reason, "svp by voter0");
  assert.equal(result.awardVotes.svp.filter((v) => v.isSystem).length, 1);
});
