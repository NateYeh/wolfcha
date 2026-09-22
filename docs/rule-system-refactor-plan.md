# 規則與版型重構計畫（狼人殺）

> 目的：支援「官方 12 人版型（預計 26 個）＋自定義版型」，並把角色規則改成可設定
> （守衛空守／不能連守、女巫全程不可自救、狼與白狼王自爆時機與雙爆吞警徽）。
> 本文件只描述計畫與規格，實作依 Phase 逐步進行。

---

## 1. 現況體檢（2026-09-22 實測）

| 項目 | 現況 | 問題 |
|---|---|---|
| 版型定義 | **四份互相抄**：`lib/role-configuration.ts`（權威，8–12 人）、`GameSetupModal.getAvailableRoles`（只列角色種類）、`game-constants.ROLE_CONFIG.STANDARD_ROLES`（只有 10 人）、`WelcomeScreen.buildDefaultRoles` | 加版型必漏改，UI 與實際配置會不一致 |
| 規則分岔 | **149 處 `role ===` 比較**；8 個角色字面值散在 17–31 個檔案 | 加角色等於掃全專案 |
| 角色狀態 | `roleAbilities` 固定 5 欄位（`witchHealUsed`、`witchPoisonUsed`、`hunterCanShoot`、`idiotRevealed`、`whiteWolfKingBoomUsed`） | 新角色要開欄位＋升 checkpoint 版本 |
| 自爆 | 白狼王專屬（`useGameLogic.ts:687` AI、`:2103` 真人），限 `DAY_SPEECH`／`DAY_BADGE_SPEECH`／`DAY_PK_SPEECH`；`whiteWolfKingBoomUsed` 是布林（一局一次）；帶人已實作 | 「全狼可自爆」「雙爆」是新機制 |
| 吞警徽 | 只有「警長死了就撕徽」（`useGameLogic.ts:738`） | 「競選階段自爆吞徽」不存在 |
| 守衛 | `generateGuardAction`（`game-master.ts:2386`）可選座位＝存活 − 上一晚目標，**必須選人** | 沒有空守 |
| 女巫 | 毒藥已排除自己（`game-master.ts:2283`）；**解藥自救目前明文允許**（prompt：「包括自救」） | 需移除既有行為；另有未被引用的殘留 i18n key `noSelfSave`（三語都有） |

---

## 2. 規則規格

### 2.1 守衛

- 不能連續兩晚守護同一名玩家（沿用現行 `lastGuardTarget` 排除邏輯）。
- 可以空守，**空守不寫入 `lastGuardTarget`**，因此可以連續多晚空守。
- AI 契約：`{"abstain":true,"reason":"..."}`（或 `seat:-1`，實作時定一種並寫進測試）。
- 真人 UI：夜晚守衛面板增加「空守」按鈕。
- 連帶：`guard_action` AI log 的 `parsed` 需帶 `abstain`；日總結／覆盤顯示「空守」。

### 2.2 女巫

- **全程不可自救（含首夜）**。
- 移除 prompt「解藥可救…（包括自救）」字樣。
- 行動合法性：`wolfTarget === 自己` → 解藥不可選（毒藥本來就排除自己）。
- 清掉未使用的 i18n key `noSelfSave`（zh-CN／zh-TW／en）。

### 2.3 自爆

**時機**：只有在「當前發言者＝自己」且階段 ∈ {`DAY_BADGE_SPEECH`（競選發言）、
`DAY_SPEECH`（白天發言）、`DAY_PK_SPEECH`（PK 發言）}。夜間、投票、遺言階段不可自爆。
非候選人的狼在競選階段沒有發言輪，因此競選階段實際上只有候選狼能爆。

| 自爆者 | 階段 | 帶人 | 警徽 | 後續流程 |
|---|---|---|---|---|
| 普通狼 | 競選發言（該競選階段第 1 爆） | ✗ | 保留 | **直接天黑**；天亮後**繼續競選**（接續未發言的候選人） |
| 普通狼 | 競選發言（同階段第 2 爆＝雙爆） | ✗ | **流失** | **直接天黑**＋**競選結束** |
| 白狼王 | 競選發言 | ✓ 帶走一名 | **流失** | **直接天黑** |
| 普通狼 | 白天／PK 發言 | ✗ | 警長死→撕徽（現行） | **直接天黑**（跳過當天放逐投票與剩餘發言） |
| 白狼王 | 白天／PK 發言 | ✓ 帶走一名 | 警長死→撕徽（現行） | **直接天黑**（跳過當天放逐投票與剩餘發言） |

- 「**警徽流失**」＝ `badge { holderSeat: null, lost: true }`：本局永久無警長，
  1.5 票加權失效、跳過警徽移交流程、UI／覆盤顯示「警徽流失」。
- 自爆者死亡：**無遺言、無自爆宣言**（不進發言紀錄，只有系統公告「N號自爆」）；
  被白狼王帶走的人無遺言（現行）。
  - 實作影響：移除 `generateWhiteWolfKingBoomDecision` 的 `farewell` 欄位、
    `prompts.whiteWolfKingBoom` 的〈自爆宣言與理由〉段落（三語）、
    `useGameLogic.ts:698` 把 farewell 寫進發言紀錄的邏輯。
- 獵人被帶走仍可開槍（現行保留）；白狼王自爆帶走獵人時獵人可開槍（現行保留）。
- 每隻狼天生只能爆一次（爆完即出局），不需要額外次數上限；「雙爆」＝同一競選階段內
  兩隻不同狼各爆一次。

### 2.4 版型

- **官方版型**：預計收錄 26 個 12 人局版型。
- **自定義版型**：玩家自行組合角色（與規則覆寫）。

資料格式（草案）：

```ts
type RuleFlags = {
  guardCanAbstain: boolean;     // 預設 true
  guardCannotRepeat: boolean;   // 預設 true
  witchCanSelfSave: boolean;    // 預設 false（本計畫改成禁止）
  boom: {
    anyWolf: boolean;           // 預設 true
    takePlayer: ("WhiteWolfKing")[];      // 誰能帶人
    swallowBadge: { electionBoomCount: 1 | 2 }; // 幾爆吞徽（本計畫：2；白狼王競選自爆另有專屬規則）
  };
};

type BoardPreset = {
  id: string;                   // 例 "official-12-prelady-hunter-guard"
  nameKey: string;              // i18n key（三語）
  playerCount: number;          // 目前 12
  official: boolean;
  roles: Role[];                // 長度 = playerCount，允許重複
  rules?: Partial<RuleFlags>;   // 版型級覆寫，繼承全域預設
  tags?: string[];
};
```

- `validateBoard()`：角色數＝人數、狼陣營 ≥1、不能包含未實作角色、重複上限、必備角色檢查。
- 自定義版型存 localStorage（沿用現有 settings 的匯出／匯入 JSON 樣式）。
- 測試：對**全部**版型跑初始化 invariants（一次覆蓋 26 個版型）。

### 2.5 遺言（2026-09-22 修改）

| 死亡情況 | 遺言 |
|---|---|
| 第一夜死亡的玩家（刀殺／毒殺／奶穿，無論幾個） | **有遺言** |
| 第二夜起夜間死亡的玩家 | **沒有遺言** |
| 投票放逐者 | 有遺言（不受本規則影響，沿用現行） |
| 自爆者、被白狼王帶走的人 | 沒有遺言 |

- 現行流程是「第一天先競選、後報刀」：第一夜死亡公告排在警徽競選之後，
  因此第一夜死者的遺言也排在競選之後、白天討論之前。
- **自爆／雙爆吞警徽不會取消第一夜死者的遺言**：遺言以佇列
  （`GameState.pendingLastWordsSeats`）保存，白天被中斷時留到下一次天亮補發表。
- 實作：`lib/rules/last-words.ts`（純規則）＋ `useSpecialEvents.resolveNight` 入列
  ＋ `DaySpeechPhase.startDaySpeechAfterBadge`（公告後、討論前跑佇列）
  ＋ `useGameLogic` 的 `drainPendingLastWords`（用 ref 遞迴，人類遺言完成後續跑）。

---

## 3. 架構改造

三層資料 + 一層引擎：

1. `src/lib/rules/boards.ts` — 版型註冊表（**唯一真相**），UI／初始化／測試／覆盤都從這裡讀。
2. `src/lib/rules/roles.ts` — 角色能力表
   `{ camp, nightAction, canAbstain, canSelfTarget, canBoom, boomEffect, winCondition, promptKey, privateBlockKey }`。
3. `src/lib/rules/flags.ts` — `RuleFlags` 與合併邏輯（全域預設 ← 版型覆寫）。
4. 引擎：
   - `WHITE_WOLF_KING_BOOM` → 泛化為 `SELF_DESTRUCT`（誰爆／是否帶人／是否吞徽／爆後去哪）。
   - 狀態：`whiteWolfKingBoomUsed`（布林）→ `boomState { electionBooms: number; badgeLost: boolean }`
     （自爆者出局本身即限制每狼一次）。
   - 階段機 `store/game-machine.ts` 新增「跨日續競選」路徑：
     `DAY_BADGE_SPEECH → SELF_DESTRUCT → NIGHT_* → DAY_START → DAY_BADGE_SPEECH`，
     並保存 `badge.electionProgress`（已發言／未發言候選人、是否已投票）。

---

## 4. 分階段落地（每階段獨立可驗證、可回退）

| Phase | 內容 | 規模 | 驗收 |
|---|---|---|---|
| **0** | 版型與規則**資料化**（僅現有 8–12 人版型，行為 0 差異）；刪掉四份重複定義 | S | 快照測試：舊行為逐字不變；SPC 全綠 |
| **1** | 規則旗標：守衛空守、女巫不可自救 | S | 規則測試＋AI 契約測試（abstain、不能自救） |
| **2** | 自爆系統泛化：`SELF_DESTRUCT`、全狼自爆、雙爆吞徽、跨日續競選、白狼王帶人併入能力表、AI 自爆決策 prompt、真人自爆按鈕 | L | 階段轉移測試矩陣（表格每一列一條）＋模擬對局 |
| **3** | 官方 26 版型收錄（先用現有角色組合）＋自定義版型 UI／儲存／驗證 | M | 26 版型初始化 invariants |
| **4** | 新角色（依版型需求排優先序） | 每個 M | 每角色：夜間行動＋prompt＋隔離測試＋覆盤顯示 |

> **執行順序（2026-09-22 拍板）**：先做「功能」＝ Phase 0（只建旗標／能力層＋現有 8–12 人版型）
> → Phase 1 → Phase 2；**Phase 3（26 個官方版型）與 Phase 4（新角色：狼美人、隱狼、騎士、
> 石像鬼…）延後**，待功能完成後再排。因此 `boards.ts` 第一版只需容納現有版型，欄位設計要留擴充空間。

---

## 5. 每個 Phase 都要同步的影響面

- **型別／狀態**：`types/game.ts`（`Role`、`roleAbilities`、`badge`、`Phase`）、
  `store/game-machine.ts` 轉移表、checkpoint `version`。
- **Prompt／i18n**：`zh-CN` 手寫 → `zh-TW` 用 OpenCC `s2twp` 重生 → `en` 同步；
  `locale-parity.test.ts` 會擋沒同步的鍵。
- **AI 契約**：守衛 abstain、自爆決策、白狼王帶人。
- **UI**：夜晚面板（空守）、發言時的「自爆」按鈕、警徽流失顯示、版型選擇與自定義編輯器。
- **分析／統計**：`game-analysis.ts`、`character-stats.ts`、`awards.ts`、日總結、覆盤 prompt。
- **測試**：SPC（新增規則測試）、版型 invariants、角色資訊隔離（`factual-context`／`context-regressions`）。

---

## 6. 風險

1. **跨日續競選**讓「第 N 天」語意變複雜（D1 競選被切成兩天）：日總結、覆盤、勝負判定、
   統計都要能處理；`dayHistory` 需記「競選被中斷」事件。
2. **26 版型若含新角色**，工作量呈倍數成長（每角色＝夜晚階段＋prompt＋UI＋分析＋測試）。
3. **AI 亂爆**：自爆 prompt 必須寫明收益條件（例如「自己被查殺」「即將被票出去」「保住關鍵狼」），
   否則 AI 會隨機爆掉整局。
4. **存檔遷移**：舊 checkpoint 的 `roleAbilities`／`badge` 欄位與新 schema 對不上，
   需版本升級與降級保護。

---

## 7. 已拍板（2026-09-22）

| # | 問題 | 裁定 |
|---|---|---|
| 1 | 普通狼在白天／PK 發言自爆 | **是**：直接天黑＋跳過放逐投票＋不帶人 |
| 2 | 自爆者的遺言／宣言 | **無遺言、無自爆宣言**（只有系統公告） |
| 3 | 天亮後繼續競選 | **是**：接續未發言候選人（已發言者不重複），之後競選投票照常 |
| 4 | 第一次自爆是白狼王後是否還需第二爆 | **不用**，白狼王競選自爆即結束競選＋警徽流失 |
| 5 | 26 個官方版型與新角色 | **延後**：先把功能（Phase 0–2）做完，版型與角色之後再添加 |

---

## 8. 進度

| Phase | 狀態 | 備註 |
|---|---|---|
| 0 版型／角色能力／規則旗標三層資料 | ✅ 完成（`7be874b`） | 四份重複的版型定義收斂為 `lib/rules/boards.ts`；8–12 人版型逐字不變（快照測試） |
| 1 守衛空守＋女巫不可自救 | ✅ 完成 | 守衛：`seat 0` 表示空守（strict schema enum 已納入 0）、空守不寫入 `lastGuardTarget`（可連續多晚空守）；女巫：`selfSaveRule` 依旗標切換、刀口是自己時不提供解藥選項、人類 UI 不顯示解藥按鈕 |
| 2 自爆系統泛化 | ✅ 完成（rename 為 `SELF_DESTRUCT`） | 全狼可自爆、無遺言無宣言、直接天黑（先補死訊＋遺言）、競選階段白狼王吞徽／普通狼雙爆吞徽、跨日續辦競選；AI 決策與真人按鈕一併泛化 | `SELF_DESTRUCT`、全狼自爆、雙爆吞警徽、跨日續競選、移除自爆宣言 |
| 3 官方 26 版型＋自定義版型 | ⬜ 延後 | 依使用者裁定，功能完成後再添加 |
| 4 新角色 | ⬜ 延後 | 同上（狼美人、隱狼、騎士、石像鬼…） |

### Phase 1 遺留（可選）

- 覆盤／日總結目前把空守顯示成「沒有守護目標」；若要在賽後報告中明確顯示「空守」，
  需在夜晚結算時記錄 `dayHistory.guardAbstained`（狀態與分析層都要加欄位）。

### Phase 2 實作備註

- 階段 ID：`SELF_DESTRUCT`（原本 `WHITE_WOLF_KING_BOOM`）；舊存檔在 `normalizeGameState` 內自動換算
  （含 `roleAbilities.whiteWolfKingBoomUsed` → `boomedSeats`）。
- 狀態：`roleAbilities.boomedSeats`（自爆過的座位）、`badge.electionBooms`（本競選階段自爆次數）、
  `badge.electionSuspended` ＋ `badge.electionSpokenSeats`（跨天續辦競選用）、`badge.lost`（警徽流失）。
- 直接天黑前會先 `settleUnannouncedNightDeaths`：把「已結算但還沒公布」的夜間死亡套用＋公告，
  再跑第一夜遺言佇列，最後才進黑夜（否則第一夜死訊與遺言會被自爆吃掉）。
- AI log 類型：`wwk_boom_decision` → `self_destruct_decision`（舊 log 仍用舊名）。
- 續辦競選：`startDayPhaseInternal` 先看 `shouldResumeBadgeElection`，天亮時補公布死訊後
  交給 `useBadgePhase.resumeBadgeSpeechPhase`（跳過已發言候選人）。
