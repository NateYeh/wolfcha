/**
 * 票值規則（單一真相）。
 *
 * 「警長的一票值 1.5」過去在七處各自以 `? 1.5 : 1` 重寫：引擎計票（`tallyVotes`）、
 * 階段計票（`VotePhase` 兩處）、prompt 顯示（`prompt-utils` 兩處）與兩個 UI 顯示
 * （`VotingProgress`、`TimelineReview`），而且判斷基準不一致（有的比 `playerId`、
 * 有的比座位）。漂移時 AI 會看到與引擎不同的票型，玩家也會看到錯的票數。
 *
 * 這裡集中「票值」與「誰是警長」的判定；各呼叫端**自己的適用條件**留在呼叫端
 * （例如警徽競選期間顯示層不加權是顯示政策，不是票值規則）。
 */

/** 一般玩家的票值。 */
export const REGULAR_VOTE_WEIGHT = 1;

/** 警長的一票值（放逐與警徽競選的票數規則相同）。 */
export const SHERIFF_VOTE_WEIGHT = 1.5;

/** 依「投票者是不是警長」取得這一票的權重。 */
export const voteWeightFor = (isSheriff: boolean): number =>
  isSheriff ? SHERIFF_VOTE_WEIGHT : REGULAR_VOTE_WEIGHT;

/** 以 playerId 判定（引擎計票、階段計票與 prompt 顯示使用）。 */
export const voteWeightByPlayerId = (
  voterPlayerId: string,
  sheriffPlayerId: string | null | undefined,
): number => voteWeightFor(Boolean(sheriffPlayerId) && voterPlayerId === sheriffPlayerId);

/** 以座位判定（分析與 UI 使用）。 */
export const voteWeightBySeat = (
  voterSeat: number,
  sheriffSeat: number | null | undefined,
): number =>
  voteWeightFor(sheriffSeat !== null && sheriffSeat !== undefined && voterSeat === sheriffSeat);
