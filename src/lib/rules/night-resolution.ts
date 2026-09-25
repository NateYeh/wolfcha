import type { GameState } from "@/types/game";
import { redirectSeat } from "./magician";

/** 夜晚死亡原因（與 `nightHistory[day].deaths` 一致） */
export type NightDeathReason = "wolf" | "poison" | "milk" | "dream" | "charm";

/** 夜晚的一筆死亡紀錄 */
export interface NightDeath {
  seat: number;
  reason: NightDeathReason;
}

/** 夜間行動者種類（回放「這一晚他還在不在場上」用） */
export type NightActor = "guard" | "wolf" | "witch" | "dreamweaver" | "wolfBeauty" | "magician";

export interface NightResolutionInput {
  /** 狼刀刀口 */
  wolfTarget?: number;
  /** 守衛守護目標 */
  guardTarget?: number;
  /** 女巫是否用解藥 */
  witchSave?: boolean;
  /** 女巫毒藥目標 */
  witchPoison?: number;
  /** 攝夢人當晚的夢游者 */
  dreamTarget?: number;
  /** 攝夢人的座位（判斷「攝夢人夜間出局」連帶） */
  dreamerSeat?: number;
  /** 狼美人今晚魅惑的座位 */
  wolfBeautyTarget?: number;
  /** 狼美人的座位（判斷「狼美人夜間出局」連帶） */
  wolfBeautySeat?: number;
  /** 魔術師當晚交換的兩名玩家（指向其中一人的技能改判到另一人） */
  magicianSwap?: [number, number];
  /** 魔術師的座位（判斷換位是否生效） */
  magicianSeat?: number;
  /** 前晚的夢游者（連續兩晚被攝 → 出局） */
  previousDreamTarget?: number;
  /**
   * 這一晚該行動者是否還在場上。
   * 只有 SmartJumpManager 的歷史回放需要（它會從「夜晚開始時存活名單」往前推）；
   * 正常即時流程不傳，代表全部在場。
   */
  isActorAlive?: (actor: NightActor) => boolean;
}

export interface NightResolutionResult {
  /** 當晚死亡名單（座位升冪） */
  deaths: NightDeath[];
  /** 狼刀有沒有真的殺死人（夢游者免疫 → false） */
  wolfKillSuccessful: boolean;
  /** 實際死於狼刀的座位（被免疫時 undefined） */
  wolfVictimSeat?: number;
  /** 實際死於毒藥的座位（被免疫時 undefined） */
  poisonVictimSeat?: number;
  /** 被夢帶走出局的座位（連續兩晚被攝／攝夢人夜死連帶） */
  dreamVictimSeat?: number;
  /** 隨狼美人殉情出局的座位 */
  charmVictimSeat?: number;
  /** 這一晚生效的夢游者（沒有攝夢人／沒指定時 undefined） */
  dreamedSeat?: number;
}

/**
 * 夜間結算（單一真相）：狼刀＋守護＋解藥＋毒藥＋攝夢，算出當晚死亡名單。
 *
 * 為什麼抽成純函式：這段規則原本有兩份抄本（即時流程 `useSpecialEvents.resolveNight`、
 * 開發者跳轉回放 `SmartJumpManager` 的兩處），加一個角色就要改三個地方、且很容易漂移。
 *
 * 結算順序（＝規則語意）：
 * 1. 狼刀：被守又被救＝毒奶（同歸），只有其中一種保護則存活；**夢游者免疫**（技能落空）。
 * 2. 毒藥：命中夢游者同樣落空（藥照樣消耗，由呼叫端記錄）。
 * 3. 攝夢連帶：攝夢人當晚出局、或同一座位連續兩晚被攝 → 夢游者一并出局。
 *    夢死**女巫救不活**，也不受夢游者自身的免疫影響。
 * 4. 狼美人殉情連帶：狼美人當晚出局 → 被魅惑者一并出局（死因 `charm`）。
 *    魅惑不是狼刀，**守護擋不住**；連帶死亡不是傷害，所以夢游者免疫同樣不影響（與夢死同一條理由）。
 *    騎士決鬥出局不在此路徑（見 `rules/charm` 的 `triggersCharmRevenge`）。
 *
 * 死因優先序：同一座位同時被刀又被毒時記「毒」（封槍與公告都以毒為準），
 * 夢死不覆蓋既有死因。
 *
 * 步驟 0：魔術師的換位。**所有夜間指向**（狼刀、守護、毒藥、攝夢、魅惑）都先過一次
 * `redirectSeat`，之後的判定全部用改判後的座位——所以「被守又被救」也自然跟著換位後的
 * 位置算。槍口不在此路徑（白天才開，見 `rules/charm`／`death-skills`）。
 */
export function resolveNightDeaths(input: NightResolutionInput): NightResolutionResult {
  const isAlive = input.isActorAlive ?? (() => true);

  // 0. 魔術師換位：沒有魔術師／沒給組合時原樣回傳
  const swap = isAlive("magician") ? input.magicianSwap : undefined;
  const at = (seat: number | undefined): number | undefined => redirectSeat(seat, swap);
  const dreamedSeat = isAlive("dreamweaver") ? at(input.dreamTarget) : undefined;
  const dreamerSeat = isAlive("dreamweaver") ? input.dreamerSeat : undefined;

  const deaths: NightDeath[] = [];
  const pushDeath = (seat: number, reason: NightDeathReason) => {
    const existing = deaths.find((death) => death.seat === seat);
    if (!existing) {
      deaths.push({ seat, reason });
      return;
    }
    // 刀／夢／殉情不覆蓋既有死因；毒（含毒奶）是最終死因，決定封槍與公告。
    // 殉情只是一條「連帶出局」，不能把已經被刀死的人改寫成殉情（封槍與公告都會錯）。
    if (reason === "wolf" || reason === "dream" || reason === "charm") return;
    existing.reason = reason;
  };

  /** 夢游者免疫夜間傷害：技能照樣使用，只是落空 */
  const immune = (seat: number | undefined): boolean =>
    seat !== undefined && dreamedSeat !== undefined && seat === dreamedSeat;

  // 1. 狼刀
  let wolfKillSuccessful = false;
  let wolfVictimSeat: number | undefined;
  const wolfTarget = isAlive("wolf") ? at(input.wolfTarget) : undefined;
  if (wolfTarget !== undefined && !immune(wolfTarget)) {
    const isProtected = isAlive("guard") && at(input.guardTarget) === wolfTarget;
    const isSaved = isAlive("witch") && input.witchSave === true;
    if ((isProtected && isSaved) || (!isProtected && !isSaved)) {
      wolfKillSuccessful = true;
      wolfVictimSeat = wolfTarget;
      pushDeath(wolfTarget, isProtected && isSaved ? "milk" : "wolf");
    }
  }

  // 2. 女巫毒殺
  let poisonVictimSeat: number | undefined;
  const witchPoison = isAlive("witch") ? at(input.witchPoison) : undefined;
  if (witchPoison !== undefined && !immune(witchPoison)) {
    poisonVictimSeat = witchPoison;
    pushDeath(witchPoison, "poison");
  }

  // 3. 攝夢連帶
  let dreamVictimSeat: number | undefined;
  if (dreamedSeat !== undefined) {
    const dreamerDied = dreamerSeat !== undefined && deaths.some((death) => death.seat === dreamerSeat);
    const dreamedTwice =
      input.previousDreamTarget !== undefined && input.previousDreamTarget === dreamedSeat;
    if (dreamerDied || dreamedTwice) {
      dreamVictimSeat = dreamedSeat;
      pushDeath(dreamedSeat, "dream");
    }
  }

  // 4. 狼美人殉情連帶：狼美人今晚出局 → 被魅惑者一并出局。
  //    魅惑不是狼刀，守護擋不住；連帶死亡也不是傷害，所以夢游者免疫不影響（與夢死同理）。
  let charmVictimSeat: number | undefined;
  const charmerSeat = isAlive("wolfBeauty") ? input.wolfBeautySeat : undefined;
  const charmedSeat = isAlive("wolfBeauty") ? at(input.wolfBeautyTarget) : undefined;
  if (charmerSeat !== undefined && charmedSeat !== undefined && charmedSeat !== charmerSeat) {
    if (deaths.some((death) => death.seat === charmerSeat)) {
      charmVictimSeat = charmedSeat;
      pushDeath(charmedSeat, "charm");
    }
  }

  deaths.sort((a, b) => a.seat - b.seat);
  return {
    deaths,
    wolfKillSuccessful,
    wolfVictimSeat,
    poisonVictimSeat,
    dreamVictimSeat,
    charmVictimSeat,
    dreamedSeat,
  };
}

/**
 * 夜間結算 → 「待公布死亡」三個欄位（白天開場的死亡公告、當日禁言、以及獵人／狼王
 * 開槍窗口都只讀這三個欄位）。
 *
 * 真實夜間流程（`useSpecialEvents`）與 DevTools 跳轉補全（`SmartJumpManager`）都必須
 * 從同一份結算結果推導——跳轉路徑先前只寫 `nightHistory.deaths` 而漏了這三個欄位，
 * 造成「跳轉出來的夜間死亡不公告、也不開槍」。
 */
export function toPendingVictims(resolution: NightResolutionResult): {
  pendingWolfVictim?: number;
  pendingPoisonVictim?: number;
  pendingDreamVictim?: number;
} {
  return {
    // 狼刀被守護／解藥擋掉時 `wolfKillSuccessful` 為 false，此時沒有待公布的刀口
    pendingWolfVictim: resolution.wolfKillSuccessful ? resolution.wolfVictimSeat : undefined,
    pendingPoisonVictim: resolution.poisonVictimSeat,
    pendingDreamVictim: resolution.dreamVictimSeat,
  };
}

/** 該座位是不是被夢帶走出局（封槍判斷用） */
export function isDreamDeath(state: GameState, seat: number): boolean {
  return Object.values(state.nightHistory ?? {}).some((record) =>
    (record?.deaths ?? []).some((death) => death.seat === seat && death.reason === "dream"),
  );
}
