import type { AwardVote, PlayerAward } from "@/types/analysis";
import type { Player, Role } from "@/types/game";

/** 系統客觀分析票的權重：像警長票，同票時比 AI 多 0.5 票。 */
export const SYSTEM_VOTE_WEIGHT = 1.5;
/** 每個 AI 角色一張票。 */
export const AI_VOTE_WEIGHT = 1;

/** 賽後感言時每個 AI 角色投出的一組票（MVP＋SVP 各一張）。 */
export interface AwardBallot {
  voterId: string;
  voterName: string;
  voterRole: Role;
  mvpPlayerId: string | null;
  mvpReason: string;
  svpPlayerId: string | null;
  svpReason: string;
}

export interface AwardTallyResult {
  /** 最高票者；同票並列時含全部並列者（依座位排序）。 */
  mvp: PlayerAward[];
  svp: PlayerAward[];
  awardVotes: {
    mvp: AwardVote[];
    svp: AwardVote[];
  };
}

function toPlayerAward(player: Player, reason: string): PlayerAward {
  return {
    playerId: player.playerId,
    playerName: player.displayName,
    reason,
    avatar: player.avatarSeed || player.characterId || player.displayName,
    gender: player.agentProfile?.persona?.gender,
    avatarStyle: player.avatarStyle,
    role: player.role,
  };
}

/**
 * 由票數找出所有最高票者（同票並列即多人當選，依座位排序）。
 * 分數：AI 票 1、系統票 1.5。
 *
 * 系統票是半整數，所以系統人選永遠不會與人同票——要嘛以最高分獨得，
 * 要嘛被兩張以上的 AI 票壓過而落敗；並列只會發生在 AI 之間。
 */
function tallyOne(params: {
  votes: AwardVote[];
  players: Player[];
  fallbackReason: string;
}): PlayerAward[] {
  const { votes, players, fallbackReason } = params;
  const scores = new Map<string, number>();
  for (const vote of votes) {
    if (!players.some((p) => p.playerId === vote.targetPlayerId)) continue;
    scores.set(vote.targetPlayerId, (scores.get(vote.targetPlayerId) ?? 0) + vote.weight);
  }

  let maxScore = 0;
  for (const score of scores.values()) {
    if (score > maxScore) maxScore = score;
  }

  const winners = players
    .filter((p) => maxScore > 0 && (scores.get(p.playerId) ?? 0) === maxScore)
    .sort((a, b) => a.seat - b.seat);
  // 完全沒有有效票（理論上不會發生，系統票一定在）時退回存活的第一位，避免空獎項。
  const pool =
    winners.length > 0
      ? winners
      : [players.find((p) => p.alive) ?? players[0]].filter((p): p is Player => Boolean(p));

  return pool.map((player) => {
    // 每位當選者各自的理由：系統若選中他，用系統的客觀理由；否則用投給他的一張票的理由。
    const systemVote = votes.find((v) => v.isSystem && v.targetPlayerId === player.playerId);
    const aiVote = votes.find((v) => !v.isSystem && v.targetPlayerId === player.playerId);
    return toPlayerAward(player, systemVote?.reason || aiVote?.reason || fallbackReason);
  });
}

/**
 * 把 AI 角色的 MVP／SVP 票與系統客觀票合併計分。
 * 票投錯邊（例如 MVP 投給敗方）不做校正：照實計分，供 UI 顯示與人工評估。
 */
export function tallyAwards(params: {
  ballots: AwardBallot[];
  systemMvp: { playerId: string; reason: string } | null;
  systemSvp: { playerId: string; reason: string } | null;
  players: Player[];
}): AwardTallyResult {
  const { ballots, systemMvp, systemSvp, players } = params;
  const findPlayer = (playerId: string | null): Player | null =>
    playerId ? players.find((p) => p.playerId === playerId) ?? null : null;

  const mvpVotes: AwardVote[] = [];
  const svpVotes: AwardVote[] = [];

  for (const ballot of ballots) {
    const voterSeat = players.find((p) => p.playerId === ballot.voterId)?.seat ?? -1;
    const mvpTarget = findPlayer(ballot.mvpPlayerId);
    if (mvpTarget) {
      mvpVotes.push({
        voterId: ballot.voterId,
        voterName: ballot.voterName,
        voterRole: ballot.voterRole,
        voterSeat,
        targetPlayerId: mvpTarget.playerId,
        targetName: mvpTarget.displayName,
        targetSeat: mvpTarget.seat,
        reason: ballot.mvpReason,
        weight: AI_VOTE_WEIGHT,
        isSystem: false,
      });
    }
    const svpTarget = findPlayer(ballot.svpPlayerId);
    if (svpTarget) {
      svpVotes.push({
        voterId: ballot.voterId,
        voterName: ballot.voterName,
        voterRole: ballot.voterRole,
        voterSeat,
        targetPlayerId: svpTarget.playerId,
        targetName: svpTarget.displayName,
        targetSeat: svpTarget.seat,
        reason: ballot.svpReason,
        weight: AI_VOTE_WEIGHT,
        isSystem: false,
      });
    }
  }

  const systemMvpPlayer = findPlayer(systemMvp?.playerId ?? null);
  if (systemMvp && systemMvpPlayer) {
    mvpVotes.push({
      voterId: "__system__",
      voterName: "",
      voterRole: null,
      voterSeat: -1,
      targetPlayerId: systemMvpPlayer.playerId,
      targetName: systemMvpPlayer.displayName,
      targetSeat: systemMvpPlayer.seat,
      reason: systemMvp.reason,
      weight: SYSTEM_VOTE_WEIGHT,
      isSystem: true,
    });
  }
  const systemSvpPlayer = findPlayer(systemSvp?.playerId ?? null);
  if (systemSvp && systemSvpPlayer) {
    svpVotes.push({
      voterId: "__system__",
      voterName: "",
      voterRole: null,
      voterSeat: -1,
      targetPlayerId: systemSvpPlayer.playerId,
      targetName: systemSvpPlayer.displayName,
      targetSeat: systemSvpPlayer.seat,
      reason: systemSvp.reason,
      weight: SYSTEM_VOTE_WEIGHT,
      isSystem: true,
    });
  }

  return {
    mvp: tallyOne({ votes: mvpVotes, players, fallbackReason: "本局關鍵勝利貢獻" }),
    svp: tallyOne({ votes: svpVotes, players, fallbackReason: "雖敗仍有亮點" }),
    awardVotes: { mvp: mvpVotes, svp: svpVotes },
  };
}
