/**
 * 角色池 id 清單（輕量模組）。
 *
 * 這裡刻意不 import 角色資料：`settings.ts` 與設定 UI 只需要 id，
 * 若從 character-roster 取，會把上百 KB 的角色 JSON 一起拉進主 bundle。
 * 新增池時：這裡加 id、character-roster 的 buildPools 加一筆、
 * i18n 補 rosterPools.<id>.name 三語。
 */
export const ROSTER_POOL_IDS = ["jin_yong"] as const;

export type RosterPoolId = (typeof ROSTER_POOL_IDS)[number];

export const DEFAULT_POOL_ID: RosterPoolId = ROSTER_POOL_IDS[0];
