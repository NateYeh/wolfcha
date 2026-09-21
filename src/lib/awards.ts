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
  mvp: PlayerAward;
  svp: PlayerAward;
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
    avatar: player.avatarSeed || player.displayName,
    gender: player.agentProfile?.persona?.gender,
    avatarStyle: player.avatarStyle,
    role: player.role,
  };
}

/**
 * 由票數算出得票最高者。
 * 分數：AI 票 1、系統票 1.5；同票時存活者優先，再比座位小（保證可重現）。
 */
function tallyOne(params: {
  votes: AwardVote[];
  players: Player[];
  fallbackReason: string;
}): { player: Player; reason: string } {
  const { votes, players, fallbackReason } = params;
  const scores = new Map<string, number>();
  for (const vote of votes) {
    if (!players.some((p) => p.playerId === vote.targetPlayerId)) continue;
    scores.set(vote.targetPlayerId, (scores.get(vote.targetPlayerId) ?? 0) + vote.weight);
  }

  let best: { player: Player; score: number } | null = null;
  for (const player of players) {
    const score = scores.get(player.playerId) ?? 0;
    if (!best || score > best.score) {
      best = { player, score };
      continue;
    }
    if (score === best.score) {
      const aliveBetter = player.alive && !best.player.alive;
      const seatBetter = player.alive === best.player.alive && player.seat < best.player.seat;
      if (aliveBetter || seatBetter) best = { player, score };
    }
  }

  // players 非空時 best 必不為 null；保險起見仍給一個明確結果。
  const winner = best?.player ?? players[0];
  if (!winner) {
    throw new Error("tallyOne requires at least one player");
  }
  // 最終理由：系統若選中他，用系統的客觀理由；否則用投給他的一張票的理由。
  const systemVote = votes.find((v) => v.isSystem && v.targetPlayerId === winner.playerId);
  const aiVote = votes.find((v) => !v.isSystem && v.targetPlayerId === winner.playerId);
  return { player: winner, reason: systemVote?.reason || aiVote?.reason || fallbackReason };
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

  const mvp = tallyOne({ votes: mvpVotes, players, fallbackReason: "本局關鍵勝利貢獻" });
  const svp = tallyOne({ votes: svpVotes, players, fallbackReason: "雖敗仍有亮點" });

  return {
    mvp: toPlayerAward(mvp.player, mvp.reason),
    svp: toPlayerAward(svp.player, svp.reason),
    awardVotes: { mvp: mvpVotes, svp: svpVotes },
  };
}
