import type { Phase, Player } from "@/types/game";
import { GamePhase } from "./GamePhase";
import type { GameContext, PromptResult } from "./types";
import { VotePhase } from "../phases/VotePhase";
import { NightPhase } from "../phases/NightPhase";
import { DaySpeechPhase } from "../phases/DaySpeechPhase";
import { BadgePhase } from "../phases/BadgePhase";
import { HunterPhase } from "../phases/HunterPhase";
import { KnightDuelPhase } from "../phases/KnightDuelPhase";
import { SelfDestructPhase } from "../phases/SelfDestructPhase";

export class PhaseManager {
  /**
   * 階段 → 產生該階段提示詞的實作。用完整 `Record` 而非 `Partial`：
   * 沒有提示詞需求的階段必須明確寫 `null`，新增 Phase 時 tsc 會逼你決定。
   */
  private readonly phases: Record<Phase, GamePhase | null>;

  constructor() {
    const nightPhase = new NightPhase();
    const votePhase = new VotePhase();
    const daySpeechPhase = new DaySpeechPhase();
    const badgePhase = new BadgePhase();
    const hunterPhase = new HunterPhase();
    const selfDestructPhase = new SelfDestructPhase();
    const knightDuelPhase = new KnightDuelPhase();
    this.phases = {
      NIGHT_START: nightPhase,
      NIGHT_GUARD_ACTION: nightPhase,
      NIGHT_MUTE_ACTION: nightPhase,
      NIGHT_DREAM_ACTION: nightPhase,
      NIGHT_WOLF_ACTION: nightPhase,
      NIGHT_WITCH_ACTION: nightPhase,
      NIGHT_SEER_ACTION: nightPhase,
      DAY_VOTE: votePhase,
      DAY_SPEECH: daySpeechPhase,
      DAY_LAST_WORDS: daySpeechPhase,
      DAY_BADGE_SPEECH: daySpeechPhase,
      DAY_PK_SPEECH: daySpeechPhase,
      DAY_BADGE_SIGNUP: badgePhase,
      DAY_BADGE_ELECTION: badgePhase,
      BADGE_TRANSFER: badgePhase,
      HUNTER_SHOOT: hunterPhase,
      SELF_DESTRUCT: selfDestructPhase,
      KNIGHT_DUEL: knightDuelPhase,

      // 以下階段不需要提示詞（大廳／設定／夜間結算／白天過場／對局結束）
      LOBBY: null,
      SETUP: null,
      NIGHT_RESOLVE: null,
      DAY_START: null,
      DAY_RESOLVE: null,
      GAME_END: null,
    };
  }

  getPhase(phase: Phase): GamePhase | null {
    return this.phases[phase];
  }

  getPrompt(phase: Phase, context: GameContext, player: Player): PromptResult | null {
    const phaseImpl = this.getPhase(phase);
    if (!phaseImpl) return null;
    return phaseImpl.getPrompt(context, player);
  }
}
