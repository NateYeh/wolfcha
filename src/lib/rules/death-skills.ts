import type { GameState, Player, Role } from "@/types/game";
import { getRoleCapabilities, isWolfRole, type DeathShotKind } from "./roles";
import { hasSeatShot } from "./hunter-shots";

/**
 * 死亡技能（「槍」）規則（單一真相）。
 *
 * 目前有兩把槍（規則由使用者 2026-09-25 校訂、2026-09-26 再校訂）：
 *
 * 「正常死亡」才能開槍＝**被投票放逐**、**被狼人夜刀**。其餘死因一律不能開：
 * 被女巫毒死、**被白狼王自爆帶走**、被狼美人魅惑殉情、被騎士決鬥出局。
 *
 * - 獵人槍（`hunter_gun`）：放逐／夜刀可以開；毒死、自爆帶走不能開。
 * - 狼王槍（`wolf_gun`）：放逐／夜刀可以開；毒死、自爆帶走、被決鬥不能開；
 *   只剩自己這一隻狼時也沒有開槍窗口。
 * - **槍打槍是獨立的死因 `shot`**（2026-09-26 校訂）：被**別的槍**打死時，兩把槍都能開——
 *   獵人與狼王互打時兩邊都會反擊。這正是 `carried` 與 `shot` 必須分開的原因：
 *   同為「技能帶走」，但自爆帶走不給窗口、槍打死要給窗口。
 * - **公告不揭露槍種**：狼王槍與獵人槍的公開公告一模一樣（「某號開槍帶走某號」），
 *   只有賽後紀錄（`hunterShots`）與 DevTools 看得到是誰開的槍。
 *
 * 這一張表就是「誰、在什麼死因下、能不能開槍」的唯一答案：流程端只呼叫
 * `canUseDeathShot()`，不要在各階段自己寫 `role === "Hunter"`。
 */
export interface DeathShotRules {
  /** 被投票放逐時可開槍 */
  onExile: boolean;
  /** 夜間被狼人刀死時可開槍 */
  onNightKill: boolean;
  /** 被女巫毒死時可開槍（毒藥封鎖死亡技能，一律 false） */
  onPoison: boolean;
  /** 被白狼王自爆帶走時可開槍（2026-09-26 校訂：兩把槍都不可） */
  onCarried: boolean;
  /** 被另一把槍打死時可開槍（槍打槍；獵人與狼王都可，兩邊互打會互相反擊） */
  onShot: boolean;
  /** 自己就是自爆者時可開槍（一律 false：狼王、白狼王自爆後都沒有槍） */
  onSelfDestruct: boolean;
  /** 被騎士翻牌決鬥出局時可開槍（一律 false） */
  onDuel: boolean;
  /** 只剩自己這一隻狼時不得開槍（狼王專屬） */
  forbiddenWhenLastWolf: boolean;
}

const NO_SHOT: DeathShotRules = {
  onExile: false,
  onNightKill: false,
  onPoison: false,
  onCarried: false,
  onShot: false,
  onSelfDestruct: false,
  onDuel: false,
  forbiddenWhenLastWolf: false,
};

export const DEATH_SHOT_RULES: Record<DeathShotKind, DeathShotRules> = {
  none: NO_SHOT,
  hunter_gun: {
    ...NO_SHOT,
    onExile: true,
    onNightKill: true,
    onShot: true,
  },
  wolf_gun: {
    ...NO_SHOT,
    onExile: true,
    // 夜裡被狼刀死也能開槍（2026-09-25 校訂；先前只認白天放逐）
    onNightKill: true,
    // 被獵人槍打死時可以反擊（2026-09-26 校訂：獵人與狼王互打，兩邊都開）
    onShot: true,
    forbiddenWhenLastWolf: true,
  },
};

/** 死因（流程端傳入；與 dayHistory／nightHistory 的記法對齊） */
export type DeathShotCause =
  | "exile"
  | "night_kill"
  | "poison"
  | "carried"
  | "shot"
  | "self_destruct"
  | "duel";

/** 這個角色的死亡技能種類 */
export function getDeathShotKind(role: Role | string): DeathShotKind {
  return getRoleCapabilities(role).deathShot;
}

/** 這個座位的槍現在能不能開 */
export function canUseDeathShot(input: {
  state: GameState;
  role: Role | string;
  seat: number;
  cause: DeathShotCause;
}): boolean {
  const { state, role, seat, cause } = input;
  const rules = DEATH_SHOT_RULES[getDeathShotKind(role)];
  if (cause === "exile" && !rules.onExile) return false;
  if (cause === "night_kill" && !rules.onNightKill) return false;
  if (cause === "poison" && !rules.onPoison) return false;
  if (cause === "carried" && !rules.onCarried) return false;
  if (cause === "shot" && !rules.onShot) return false;
  if (cause === "self_destruct" && !rules.onSelfDestruct) return false;
  if (cause === "duel" && !rules.onDuel) return false;
  // 被毒／毒奶／被夢帶走的座位：死亡技能一律封鎖（查夜史死亡紀錄，取代舊的全域 hunterCanShoot=false hack）。
  // 被夢帶走（連續兩晚被攝、或被夜死的攝夢人連帶）依官方規則同樣不能發動技能。
  const diedByBlockedCause = Object.values(state.nightHistory ?? {}).some((record) =>
    (record?.deaths ?? []).some(
      (death) =>
        death.seat === seat &&
        (death.reason === "poison" ||
          death.reason === "milk" ||
          death.reason === "dream" ||
          death.reason === "charm"),
    ),
  );
  if (diedByBlockedCause) return false;
  // 非最後一狼：只剩他這隻狼時，死了就終局，沒有開槍窗口
  if (rules.forbiddenWhenLastWolf) {
    const otherAliveWolves = state.players.filter(
      (player) => player.alive && player.seat !== seat && isWolfRole(player.role)
    ).length;
    if (otherAliveWolves === 0) return false;
  }
  return true;
}

/** 開槍可選的目標：場上存活、不含自己 */
export function getDeathShotTargets(state: GameState, shooterSeat: number): number[] {
  return state.players
    .filter((player) => player.alive && player.seat !== shooterSeat)
    .map((player) => player.seat);
}

/**
 * 「槍打槍」的下一棒：被帶走的人自己也有槍時，誰要接著開。
 *
 * `cause` 由呼叫端指定，兩者規則不同、不可混用（2026-09-26 校訂）：
 * - `"shot"`：被**另一把槍**打死（獵人↔狼王互打）→ 兩把槍都可開。
 * - `"carried"`：被**自爆**帶走 → 兩把槍都不可開。
 *
 * 每人只有一把槍：已經開過槍的座位一律不再開（用開槍紀錄判定，不必另外記狀態），
 * 這同時擋掉「獵人打死狼王、狼王反擊打死獵人」之後的無限往復。
 *
 * 八獵四狼這種版型才會用到（多把獵人槍互相觸發）；一般版型只有一個獵人，
 * 這條路永遠不會被走到。回傳要接著開槍的玩家，沒有則回 `null`。
 */
export function getChainedShooter(
  state: GameState,
  victimSeat: number,
  cause: "shot" | "carried"
): Player | null {
  const victim = state.players.find((player) => player.seat === victimSeat);
  if (!victim) return null;
  if (!state.roleAbilities.hunterCanShoot) return null;
  if (hasSeatShot(state, victim.seat)) return null;
  if (!canUseDeathShot({ state, role: victim.role, seat: victim.seat, cause })) return null;
  return victim;
}
