import { recordVoteRound } from "@/lib/vote-rounds";
import { type GameState, type Player } from "@/types/game";
import { GamePhase } from "../core/GamePhase";
import type { GameAction, GameContext, PromptResult, SystemPromptPart } from "../core/types";
import {
  bindIdentityAndRoleSetting,
  buildGameContextParts,
  buildTodayTranscript,
  buildPlayerTodaySpeech,
  getRoleText,
  buildSharedSystemParts,
  buildSystemTextFromParts,
  buildDecisionGrounding,
} from "@/lib/prompt-utils";
import { getI18n } from "@/i18n/translator";
import {
  addSystemMessage,
  checkWinCondition,
  generateAIVote,
  tallyVotes,
  transitionPhase,
} from "@/lib/game-master";
import { canUseDeathShot } from "@/lib/rules/death-skills";
import { voteWeightByPlayerId } from "@/lib/rules/vote-weight";
import { getSystemMessages, getUiText } from "@/lib/game-texts";
import { DELAY_CONFIG } from "@/lib/game-constants";
import { delay, type FlowToken } from "@/lib/game-flow-controller";
import { createRevealPacer } from "@/lib/reveal-pacer";
import { playNarrator } from "@/lib/narrator-audio-player";
import { getPlayerDiedKey } from "@/lib/narrator-voice";

/** 逐票落地的畫面節奏（網路已併發完成，這裡只錯開 UI 更新） */
const VOTE_REVEAL_BEAT_MS = 120;

type VotePhaseRuntime = {
  token: FlowToken;
  getGameState?: () => GameState;
  isRevote?: boolean;
  humanPlayer: Player | null;
  setGameState: (value: GameState | ((prev: GameState) => GameState)) => void;
  setDialogue: (speaker: string, text: string, isStreaming?: boolean) => void;
  setIsWaitingForAI: (waiting: boolean) => void;
  waitForUnpause: () => Promise<void>;
  isTokenValid: (token: FlowToken) => boolean;
  onVoteComplete: (state: GameState, result: { seat: number; count: number } | null) => Promise<void>;
  onGameEnd: (state: GameState, winner: "village" | "wolf") => Promise<void>;
  runAISpeech: (state: GameState, player: Player) => Promise<void>;
};

export class VotePhase extends GamePhase {
  async onEnter(context: GameContext): Promise<void> {
    const runtime = this.getRuntime(context);
    if (!runtime) return;

    const { t } = getI18n();
    const uiText = getUiText();
    const systemMessages = getSystemMessages();
    const speakerHost = t("speakers.host");
    const speakerHint = t("speakers.hint");

    const { humanPlayer, setDialogue, setGameState, waitForUnpause, isTokenValid, token } = runtime;
    const isRevote = runtime.isRevote === true;

    let currentState = transitionPhase(context.state, "DAY_VOTE");
    currentState = {
      ...currentState,
      currentSpeakerSeat: null,
      nextSpeakerSeatOverride: null,
      votes: {},
      voteReasons: {},
      pkTargets: isRevote ? context.state.pkTargets : undefined,
      pkSource: isRevote ? "vote" : undefined,
    };
    currentState = addSystemMessage(currentState, systemMessages.voteStart);
    const isRevealedIdiot = humanPlayer?.role === "Idiot" && currentState.roleAbilities.idiotRevealed;
    setDialogue(speakerHost, humanPlayer?.alive && !isRevealedIdiot ? uiText.votePrompt : uiText.aiVoting, false);
    setGameState(currentState);

    await playNarrator("voteStart");
    await waitForUnpause();

    if (humanPlayer?.alive && !isRevealedIdiot) {
      setDialogue(speakerHint, uiText.clickToVote, false);
    }

    if (!isTokenValid(token)) return;
    await this.continueVoting(currentState, runtime);
  }

  private async continueVoting(currentState: GameState, runtime: VotePhaseRuntime): Promise<void> {
    const { setGameState, setIsWaitingForAI, isTokenValid, token } = runtime;
    // 恢复和新开轮次共用同一个循环；已有票（包括弃票）不能重投。
    // PK投票时，参与PK的人不能投票
    const pkTargets = currentState.pkSource === "vote" && Array.isArray(currentState.pkTargets) ? currentState.pkTargets : [];
    // 已翻牌白痴不参与投票（节省 AI 调用）
    const revealedIdiotId = currentState.roleAbilities.idiotRevealed
      ? currentState.players.find((p) => p.role === "Idiot" && p.alive)?.playerId
      : undefined;
    const aiPlayers = currentState.players.filter((p) => p.alive && !p.isHuman && !pkTargets.includes(p.seat) && p.playerId !== revealedIdiotId && typeof currentState.votes[p.playerId] !== "number");
    const roundIdentity = `${currentState.gameId}:${currentState.day}:${currentState.pkSource}:${(currentState.voteRounds ?? []).length}`;
    const stillCurrent = () => {
      const latest = runtime.getGameState?.() ?? currentState;
      return isTokenValid(token) && latest.phase === "DAY_VOTE" &&
        `${latest.gameId}:${latest.day}:${latest.pkSource}:${(latest.voteRounds ?? []).length}` === roundIdentity;
    };
    let tokenInvalidated = false;
    setIsWaitingForAI(true);
    try {
      // 第一席本身就是暖機：它的 prefill 會把共用前綴（系統＋逐字發言紀錄）寫進上游快取，
      // 等它算完，後面席位的併發請求直接命中（不必再送 max_tokens=1 暖機——那只是把同樣的計算提前付一次）。
      const writeVote = (aiPlayer: (typeof aiPlayers)[number], vote: { seat: number; reason: string }) => {
        setGameState((prevState) => ({
          ...prevState,
          votes: { ...prevState.votes, [aiPlayer.playerId]: vote.seat },
          voteReasons: { ...(prevState.voteReasons || {}), [aiPlayer.playerId]: vote.reason },
        }));
        currentState = {
          ...currentState,
          votes: { ...currentState.votes, [aiPlayer.playerId]: vote.seat },
          voteReasons: { ...(currentState.voteReasons || {}), [aiPlayer.playerId]: vote.reason },
        };
      };

      // 第一席先算完：它的票會寫進公共資訊，後面的人看得到（保留一點「跟票」的連鎖感）。
      const [firstVoter, ...laterVoters] = aiPlayers;
      if (firstVoter) {
        const firstVote = await generateAIVote(currentState, firstVoter);
        if (!stillCurrent()) {
          tokenInvalidated = true;
        } else {
          writeVote(firstVoter, firstVote);
        }
      }

      // 其餘席位**併發**送（逐席 await 會讓總時間＝各席加總）。
      // 票是同一時間投的，彼此看不到對方；只有第一席的票在公共資訊裡，
      // 共用前綴已被第一席的 prefill 寫進快取，併發批直接命中。
      if (!tokenInvalidated && laterVoters.length > 0) {
        // 票一到就寫進 UI（不再等所有人回傳才一次顯示）；節奏器只保證相鄰兩票的最小間隔。
        const revealVote = createRevealPacer(VOTE_REVEAL_BEAT_MS);
        await Promise.all(
          laterVoters.map(async (aiPlayer) => {
            let vote: { seat: number; reason: string };
            try {
              vote = await generateAIVote(currentState, aiPlayer);
            } catch (error) {
              console.warn("[wolfcha] AI vote threw, skipping this seat", error);
              return;
            }
            await revealVote(() => {
              if (!stillCurrent()) {
                tokenInvalidated = true;
                return;
              }
              writeVote(aiPlayer, vote);
            });
          })
        );
      }
    } finally {
      if (stillCurrent()) setIsWaitingForAI(false);
    }
    if (tokenInvalidated) return;
    currentState = runtime.getGameState?.() ?? currentState;
    const voters = currentState.players.filter((p) => p.alive && !pkTargets.includes(p.seat) && p.playerId !== revealedIdiotId);
    if (voters.every((p) => typeof currentState.votes[p.playerId] === "number")) {
      await this.resolveVotes(currentState, runtime);
    }
  }

  getPrompt(context: GameContext, player: Player): PromptResult {
    const state = context.state;
    const gameContextParts = buildGameContextParts(state, player);
    const eligibleSeats =
      state.pkSource === "vote" && state.pkTargets && state.pkTargets.length > 0
        ? new Set(state.pkTargets)
        : null;
    const alivePlayers = state.players.filter(
      (p) =>
        p.alive &&
        p.playerId !== player.playerId &&
        (!eligibleSeats || eligibleSeats.has(p.seat))
    );
    const exampleSeat = (alivePlayers[0]?.seat ?? player.seat) + 1;

    const { t } = getI18n();
    const todayTranscript = buildTodayTranscript(state);
    const selfSpeech = buildPlayerTodaySpeech(state, player);

    // 放逐票和警徽票一樣事後必被復盤；狼隊最容易在票型上整隊暴露，
    // 因此把票型紀律只拼給狼人（好人沒有這個問題，多給反而稀釋其他指引）。
    const dynamicContent = t("prompts.vote.task", {
      options: alivePlayers.map((p) => t("prompts.vote.option", { seat: p.seat + 1, name: p.displayName })).join(", "),
    });
    // system 只放全桌逐字相同的內容：只要是逐人不同的字串出現在 system，
    // 後面的公共區（含本日逐字紀錄）就全部無法共用快取。逐人內容一律進 user 個人區。
    const identityContent = bindIdentityAndRoleSetting(t("prompts.vote.base", {
      seat: player.seat + 1,
      name: player.displayName,
      role: getRoleText(player.role),
      coreRules: "",
    }).trim(), player, !!state.isGenshinMode);
    const systemParts: SystemPromptPart[] = [
      ...buildSharedSystemParts(state),
    ];
    const system = buildSystemTextFromParts(systemParts);

    // user 區塊順序：公共上下文 → 本日逐字紀錄 → 個人區（身份／勝負條件／階段任務）→ 輸出契約。
    const privateZone = [
      gameContextParts.private,
      identityContent,
      dynamicContent,
    ].filter(Boolean).join("\n\n");
    const user = t("prompts.vote.user", {
      sharedContext: gameContextParts.shared,
      privateContext: privateZone,
      todayTranscript: todayTranscript || t("prompts.vote.userNoTranscript"),
      voteJsonFormat: JSON.stringify({ seat: exampleSeat }),
    }) + `\n\n${buildDecisionGrounding(state, player)}\n<my_public_position>\n${selfSpeech || t("promptUtils.gameContext.noPublicSpeechToday")}\n</my_public_position>\n投票前核对自己最后明确支持或排除的目标。改口是你的自由——真人也会反悔、会被说服；想改就在 reason 里写一句为什么。如果本轮没有新发言、新事件，沿用自己公开的结论就行，别编造还没发生的回应。不要拿别人的结论当依据：你要引用“某人账算不平”“某人不合逻辑”这类说法，必须自己先核对原始记录（票型、发言、死亡）；核对后发现对方讲的是事实，就不能再用这个理由投票。只输出 {"seat":座位号,"reason":"本次投票依据"}。`;

    return { system, user, systemParts };
  }

  async handleAction(_context: GameContext, _action: GameAction): Promise<void> {
    const runtime = this.getRuntime(_context);
    if (!runtime) return;
    if (_action.type === "RESUME_VOTES") {
      const { t } = getI18n();
      runtime.setDialogue(t("speakers.hint"), getUiText().clickToVote, false);
      await this.continueVoting(_context.state, runtime);
    } else if (_action.type === "RESOLVE_VOTES") {
      await this.resolveVotes(_context.state, runtime);
    }
  }

  async onExit(): Promise<void> {
    return;
  }

  private getRuntime(context: GameContext): VotePhaseRuntime | null {
    const raw = context.extras as VotePhaseRuntime | undefined;
    if (!raw) return null;
    if (!raw.setGameState || !raw.setDialogue || !raw.waitForUnpause || !raw.isTokenValid) return null;
    return raw;
  }

  private getVoteCounts(state: GameState): Record<number, number> {
    const counts: Record<number, number> = {};
    const sheriffSeat = state.badge.holderSeat;
    const sheriffPlayer =
      sheriffSeat !== null ? state.players.find((p) => p.seat === sheriffSeat && p.alive) : null;
    const sheriffPlayerId = sheriffPlayer?.playerId;
    const aliveById = new Set(state.players.filter((p) => p.alive).map((p) => p.playerId));
    const aliveBySeat = new Set(state.players.filter((p) => p.alive).map((p) => p.seat));

    // Revealed Idiot cannot vote
    const revealedIdiotId = state.roleAbilities.idiotRevealed
      ? state.players.find((p) => p.role === "Idiot" && p.alive)?.playerId
      : undefined;

    for (const [voterId, targetSeat] of Object.entries(state.votes)) {
      if (!aliveById.has(voterId)) continue;
      if (!aliveBySeat.has(targetSeat)) continue;
      if (voterId === revealedIdiotId) continue; // Idiot's vote doesn't count
      const weight = voteWeightByPlayerId(voterId, sheriffPlayerId);
      counts[targetSeat] = (counts[targetSeat] || 0) + weight;
    }
    return counts;
  }

  private generateVoteDetails(
    votes: Record<string, number>,
    players: Player[],
    title: string,
    sheriffSeat: number | null
  ): string {
    const { t } = getI18n();
    const sheriffPlayer =
      sheriffSeat !== null ? players.find((p) => p.seat === sheriffSeat && p.alive) : null;
    const sheriffPlayerId = sheriffPlayer?.playerId;
    const aliveById = new Set(players.filter((p) => p.alive).map((p) => p.playerId));
    const aliveBySeat = new Set(players.filter((p) => p.alive).map((p) => p.seat));

    const voteGroups: Record<number, number[]> = {};
    Object.entries(votes).forEach(([playerId, targetSeat]) => {
      if (!aliveById.has(playerId)) return;
      if (!aliveBySeat.has(targetSeat)) return;
      const voter = players.find((p) => p.playerId === playerId);
      if (voter) {
        if (!voteGroups[targetSeat]) voteGroups[targetSeat] = [];
        voteGroups[targetSeat].push(voter.seat);
      }
    });

    const voteResults = Object.entries(voteGroups)
      .map(([targetSeat, voterSeats]) => {
        const target = players.find((p) => p.seat === Number(targetSeat));
        let voteCount = 0;
        voterSeats.forEach((voterSeat) => {
          const voter = players.find((p) => p.seat === voterSeat);
          if (voter) {
            voteCount += voteWeightByPlayerId(voter.playerId, sheriffPlayerId);
          }
        });
        return {
          targetSeat: Number(targetSeat),
          targetName: target?.displayName || t("devConsole.unknown"),
          voterSeats,
          voteCount,
        };
      })
      .sort((a, b) => b.voteCount - a.voteCount);

    return `[VOTE_RESULT]${JSON.stringify({ title, results: voteResults })}`;
  }

  private async resolveVotes(state: GameState, runtime: VotePhaseRuntime): Promise<void> {
    const { t } = getI18n();
    const uiText = getUiText();
    const systemMessages = getSystemMessages();
    const speakerHost = t("speakers.host");
    const speakerHint = t("speakers.hint");

    let currentState = transitionPhase(state, "DAY_RESOLVE");

    const currentVotes = { ...state.votes };
    const newHistory = { ...state.voteHistory, [state.day]: currentVotes };
    const previousDayRecord = (state.dayHistory || {})[state.day] || {};
    currentState = {
      ...currentState,
      voteHistory: newHistory,
      dayHistory: {
        ...(state.dayHistory || {}),
        [state.day]: {
          ...previousDayRecord,
          sheriffSeatAtVote: state.badge.holderSeat,
        },
      },
    };

    runtime.setGameState(currentState);
    await runtime.waitForUnpause();

    const result = tallyVotes(currentState);

    const immunity = !!result && currentState.players.some((p) => p.seat === result.seat && p.role === "Idiot") &&
      !currentState.roleAbilities.idiotRevealed;
    currentState = recordVoteRound(currentState, {
      kind: "execution", round: state.pkSource === "vote" ? 2 : 1,
      candidates: state.pkSource === "vote" && state.pkTargets?.length ? state.pkTargets : state.players.filter((p) => p.alive).map((p) => p.seat),
      votes: currentVotes, sheriffSeat: state.badge.holderSeat, winnerSeat: result?.seat ?? null,
      outcome: result ? immunity ? "idiot-revealed" : "executed" : Object.keys(this.getVoteCounts(currentState)).length ? "tie" : "no-votes",
    });
    const prevDayRecord = (currentState.dayHistory || {})[currentState.day] || {};
    if (result) {
      currentState = {
        ...currentState,
        dayHistory: {
          ...(currentState.dayHistory || {}),
          [currentState.day]: { ...prevDayRecord, executed: immunity ? undefined : { seat: result.seat, votes: result.count }, voteTie: false },
        },
      };
    } else {
      currentState = {
        ...currentState,
        dayHistory: {
          ...(currentState.dayHistory || {}),
          [currentState.day]: { ...prevDayRecord, executed: undefined, voteTie: true },
        },
      };
    }

    runtime.setGameState(currentState);

    const voteDetailMessage = this.generateVoteDetails(
      currentVotes,
      currentState.players,
      t("votePhase.voteDetailTitle"),
      currentState.badge.holderSeat
    );
    currentState = addSystemMessage(currentState, voteDetailMessage);

    if (result) {
      const executed = currentState.players.find((p) => p.seat === result.seat);

      // --- Idiot immunity: if the executed player is Idiot and hasn't revealed yet ---
      if (executed?.role === "Idiot" && !currentState.roleAbilities.idiotRevealed) {
        const idiotMsg = t("system.idiotRevealed", { seat: result.seat + 1, name: executed.displayName });
        currentState = addSystemMessage(currentState, idiotMsg);
        const prevDayRec = currentState.dayHistory?.[currentState.day] || {};
        currentState = {
          ...currentState,
          roleAbilities: { ...currentState.roleAbilities, idiotRevealed: true },
          dayHistory: {
            ...(currentState.dayHistory || {}),
            [currentState.day]: { ...prevDayRec, executed: undefined, voteTie: false, idiotRevealed: { seat: result.seat } },
          },
          pkTargets: undefined,
          pkSource: undefined,
        };
        runtime.setDialogue(speakerHost, idiotMsg, false);
        runtime.setGameState(currentState);

        // Skip execution — Idiot stays alive but loses voting rights
        const winner = checkWinCondition(currentState);
        if (winner) {
          await runtime.onGameEnd(currentState, winner);
          return;
        }
        await runtime.onVoteComplete(currentState, null);
        return;
      }

      currentState = addSystemMessage(
        currentState,
        systemMessages.playerExecuted(result.seat + 1, executed?.displayName || "", result.count)
      );
      runtime.setDialogue(
        speakerHost,
        systemMessages.playerExecuted(result.seat + 1, executed?.displayName || "", result.count),
        false
      );

      const diedKey = getPlayerDiedKey(result.seat);
      if (diedKey) await playNarrator(diedKey);

      currentState = {
        ...currentState,
        pkTargets: undefined,
        pkSource: undefined,
      };
    } else {
      const voteCounts = this.getVoteCounts(currentState);
      const maxVotes = Math.max(0, ...Object.values(voteCounts));
      const topSeats = Object.entries(voteCounts)
        .filter(([, c]) => c === maxVotes)
        .map(([s]) => Number(s));

      if (topSeats.length > 1 && currentState.pkSource !== "vote") {
        const pkState = {
          ...currentState,
          pkTargets: topSeats,
          pkSource: "vote" as const,
        };
        let nextState = transitionPhase(pkState, "DAY_PK_SPEECH");
        const firstSeat = topSeats[0] ?? null;
        nextState = {
          ...nextState,
          currentSpeakerSeat: firstSeat,
          daySpeechStartSeat: firstSeat,
        };
        nextState = addSystemMessage(nextState, t("votePhase.tiePk"));
        runtime.setGameState(nextState);
        runtime.setDialogue(speakerHost, t("votePhase.tiePk"), false);

        await delay(DELAY_CONFIG.DIALOGUE);
        await runtime.waitForUnpause();

        const firstSpeaker = nextState.players.find((p) => p.seat === firstSeat);
        if (firstSpeaker && !firstSpeaker.isHuman) {
          await runtime.runAISpeech(nextState, firstSpeaker);
        } else if (firstSpeaker?.isHuman) {
          runtime.setDialogue(speakerHint, uiText.yourTurn, false);
        }
        return;
      }

      currentState = {
        ...currentState,
        pkTargets: undefined,
        pkSource: undefined,
      };
      currentState = addSystemMessage(currentState, systemMessages.voteTie);
      runtime.setDialogue(speakerHost, systemMessages.voteTie, false);
    }

    runtime.setGameState(currentState);

    const executed =
      result ? currentState.players.find((p) => p.seat === result.seat) : null;
    // 死亡技能（獵人槍／狼王槍）：只有在這張表允許的死因下才開窗
    if (
      result &&
      executed &&
      currentState.roleAbilities.hunterCanShoot &&
      canUseDeathShot({ state: currentState, role: executed.role, seat: executed.seat, cause: "exile" })
    ) {
      // Defer win check until after the death shot resolves.
      await runtime.onVoteComplete(currentState, result);
      return;
    }

    const winner = checkWinCondition(currentState);
    if (winner) {
      await runtime.onGameEnd(currentState, winner);
      return;
    }

    await runtime.onVoteComplete(currentState, result);
  }
}
