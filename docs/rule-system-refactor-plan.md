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
| 普通狼 | 白天／PK 發言 | ✗ | 警長死→由警長自己選傳徽或撕徽 | **直接天黑**（跳過當天放逐投票與剩餘發言） |
| 白狼王 | 白天／PK 發言 | ✓ 帶走一名 | 警長死→由警長自己選傳徽或撕徽 | **直接天黑**（跳過當天放逐投票與剩餘發言） |

- 「**警徽流失**」＝ `badge { holderSeat: null, lost: true }`：本局永久無警長，
  1.5 票加權失效、跳過警徽移交流程、UI／覆盤顯示「警徽流失」。
- 警長因自爆（或被白狼王帶走）死亡時，**由警長自己決定移交警徽或撕毀**（不再自動撕毀）。
- 自爆者死亡：**無遺言、無自爆宣言**（不進發言紀錄，只有系統公告「N號自爆」）；
  被白狼王帶走的人無遺言（現行）。
  - 實作影響：移除 `generateWhiteWolfKingBoomDecision` 的 `farewell` 欄位、
    `prompts.whiteWolfKingBoom` 的〈自爆宣言與理由〉段落（三語）、
    `useGameLogic.ts:698` 把 farewell 寫進發言紀錄的邏輯。
- 獵人被帶走仍可開槍（現行保留）；白狼王自爆帶走獵人時獵人可開槍（現行保留）。
- 每隻狼天生只能爆一次（爆完即出局），不需要額外次數上限；「雙爆」＝同一競選階段內
  兩隻不同狼各爆一次。
- **自爆只能帶走「場上存活」的玩家**：第一夜死者即使死訊還沒公布，邏輯上已算出局
  （見 `lib/rules/night-deaths.ts`），不能當作帶走目標；指定他們視為技能無效
  （不帶走任何人、寫 warn log）。因此第一夜死者的遺言權不受自爆影響。

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

### 自爆狀態轉移（可測純函式）

`lib/rules/self-destruct-apply.ts` 的 `applySelfDestructToState()` 是自爆的**唯一狀態真相**
（hook 只負責公告、遺言、移交警徽、進黑夜的流程）。標準雙爆流程以 `self-destruct-flow.test.ts`
逐一驗證：

1. 第一天競選發言第一隻狼自爆 → 補公布第一夜死訊 → 第一夜死者遺言進佇列（實際發表由 hook 跑）
   → 階段切 `SELF_DESTRUCT` → 直接天黑；`badge.lost` 不變、`electionBooms=1`、`electionSuspended=true`。
2. 天亮續辦競選（跳過已發言候選人）→ 第二天第二隻狼再自爆 → `badge.lost=true`、`electionSuspended=false`，
   且**第二夜的新死亡不進遺言佇列**（`pendingLastWordsSeats` 為空）。
3. 白狼王在競選發言自爆＝一次帶人＋一次吞徽（不需第二爆）。
4. 非競選階段自爆不動警徽；警長（含自爆者本人）死亡時交出移交權，由警長自己選傳徽或撕徽。

## 騎士（Knight）與白狼騎士版型

**版型**：`official-12-white-wolf-knight`＝預言家、女巫、守衛、騎士、4 村民、3 狼人、白狼王（12 人）。
另有 `official-12-seer-witch-hunter-idiot`（預女獵白）＝預言家、女巫、獵人、白痴、4 平民、4 狼人
與 `official-12-seer-witch-guard-idiot`（預女守白）＝預言家、女巫、守衛、白痴、4 平民、4 小狼
（**首個沒有獵人的 12 人版**：獵人相關流程全為條件觸發，無人持有該角色時不會進入 HUNTER_SHOOT）——
全為既有角色，只在版型註冊表加一筆資料即可（三層架構的預期效果）。
WelcomeScreen 開發者面板的「角色」分頁可用「套用官方版型」一鍵套用（`roleConfigValid` 改走
`validateBoardPreset`，任何合法組成都能開局）。

**規則（`lib/rules/knight-duel.ts`）**：

| 項目 | 規則 |
| --- | --- |
| 時機 | **只有白天發言階段**（自己發言輪）；**整個警長競選階段（競選報名／競選發言／競選投票／警上 PK 發言）與遺言階段都不能發動** |
| 次數 | 一場一次（`roleAbilities.duelUsedSeats`） |
| 目標 | 只能挑戰**場上存活**玩家（未公布死訊的第一夜死者已算出局，不可挑戰；不能挑戰自己） |
| 目標是狼 | 狼人當場出局，**隨即進入黑夜**（跳過當天剩餘發言與放逐投票）；決鬥不會發生在競選階段，因此不動競選狀態 |
| 目標是好人 | 騎士**以死謝罪**出局，白天流程照走（含放逐投票） |
| 遺言 | 決鬥出局者沒有遺言（與自爆／被帶走一致） |
| 死亡技能 | 被決鬥出局的狼人不能發動死亡技能（狼王開槍、白狼王帶人、狼美人殉情）＝`canTriggerDeathSkill(cause, role, flags)` |
| 技能無效 | 指定已出局者 → 不消耗技能、不改變狀態，只寫 warn log |

**共用機制**：`lib/rules/settle-night-deaths.ts` 把「補公布未宣布的夜間死亡＋第一夜遺言入列」
抽出來，自爆與決鬥兩條「提前結束白天」的路徑共用；`lib/rules/knight-duel-apply.ts` 是決鬥的
唯一狀態真相（`game-master.knight-duel.test.ts` 驗 AI 契約、`rules/knight-duel.test.ts` 驗規則與狀態）。

### 發言階段技能合併成一次請求（自爆／翻牌決鬥）

原本每個狼／騎士的發言輪會送**兩次**請求：先發言，再由 `generateSelfDestructDecision` /
`generateKnightDuelDecision` 單獨問一次技能（第二次的盤面與逐字稿幾乎與第一次相同，等於白花
一次 7～10k token 的 context）。

現在技能角色改成輸出**單一 JSON 物件**：

```json
{"speech": ["第一段。", "第二段。"], "skill": {"action": "boom", "seat": 5, "reason": "…"}}
{"speech": ["…"], "skill": {"action": "none"}}
```

- `StreamingSpeechParser` 只把 public 欄位（`speech`）當字幕／TTS，`skill` 整棵子樹不會外洩到畫面，
  所以合併輸出不會洩漏私有決定。
- `lib/speech-skill.ts`：`resolveSpeechSkillKind()`（prompt 與解析共用同一份判斷）＋
  `extractSpeechSkillDecision()`（容忍 `skill`／`skill_decision`／`ability` 欄位名與 `boom|duel|pass` 等寫法）。
- `useDayPhase` 以「gameId:day:phase:playerId」為回合識別碼存放決定（預取路徑也帶著 `skill` 一起沿用），
  `useGameLogic` 的兩個技能檢查先取用、取不到才退回獨立請求。
- 模型漏寫、寫壞或走恢復路徑時 → **行為與改動前完全相同**（退回獨立請求），只是多一次呼叫。
- 兩種 log（`self_destruct_decision`／`knight_duel_decision`）都保留：沿用發言決定時
  寫 `parsed.source = "speech"`、`attempts = 0`，可用來量測合併成功率；發言的 `speech` log
  也帶 `response.parsed.skill`（`"missing"` 表示模型漏寫）。

## 禁言長老（MuteElder）與預女獵禁版型

**版型**：`official-12-seer-witch-hunter-mute`＝預言家、女巫、獵人、禁言長老、4 平民、4 狼人。

**規則（`lib/rules/mute.ts` 為單一真相）**：

| 項目 | 規則 |
| --- | --- |
| 夜間行動 | 每晚指定一名**存活**玩家禁言；不能指定自己、不能指定死訊未公布的死者；沒有次數上限（可連續禁言同一人） |
| 效果 | 被禁言者**次日白天不能發言**（`DAY_SPEECH`／`DAY_BADGE_SPEECH`／`DAY_PK_SPEECH`） |
| 不受限 | **警徽競選投票、放逐投票、遺言**（`DAY_LAST_WORDS` 明確不過濾）、上警報名 |
| 公開性 | 天亮時主持人公告（`system.playerMuted`），並寫進 `dayHistory[day].muted`；prompt 公共 `game_state` 也有 `muted: [N]` |
| 副作用 | 被禁言的狼人當天沒有發言輪 → 也無法當天自爆（規則的自然結果） |
| 生命週期 | 公告後即消耗（`nightActions.mutedTarget` 清空），下一晚重新指定 |

**夜間順序**：天黑 →（守衛）→ **禁言長老** → 狼人 → 女巫 → 預言家 → 結算。
`NightPhase` 的 AI／真人續跑鏈統一走 `continueNightAfterMute()`，避免 AI 與真人的分支分歧。

**發言輪整合點**：`getSpeechPhaseOrder()` 過濾被禁言者（`speech-order.ts`），
因此輪次狀態、下一位發言者、prompt 的順序提示一起生效；`startDayDiscussion` 的首位發言者
改從過濾後的權威順序取，避免把發言輪交給被禁言者。

### 版型選擇是「設定」的一部分（身份偏好清單跟著版型）

- `store/settings.ts`：新增 `boardIdAtom`（`wolfcha.settings.board_id`，空字串＝依人數的預設版型）；
  身份偏好的合法角色清單改讀規則層 `ALL_ROLE_KEYS`——舊的硬編 8 角色清單會把「騎士／禁言長老」
  的偏好直接清成「隨機」。
- `rules/boards.ts`：`resolveBoardPreset(playerCount, boardId)`（人數或 id 不符就退回該人數預設版型）、
  `getSelectedBoardRoles`、`getSelectedBoardRoleKinds`、`countSelectedBoardRoles`。
- `GameSetupModal`：新增「版型」下拉（在身份偏好之前），**身份偏好可選角色＝選定版型的角色種類**；
  切換版型時若偏好角色不在新版型內會自動回到「隨機分配」。
- `WelcomeScreen`：開局角色組成與大廳的角色數量摘要都跟著版型；選了非預設版型才會把 `fixedRoles`
  寫進開局選項（避免無謂地關掉「身份偏好直接換角色」的行為）。開發者面板的版型下拉與主 UI 共用同一個設定。
- `game-master.setupPlayers`：身份偏好交換改成「只要該角色在這局組成裡就換」，因此**選版型與用身份偏好
  可以同時生效**（以前只要帶 `fixedRoles` 就整段跳過）。

## 狼王（WolfKing）與狼王守衛版型

**版型**：`official-12-wolf-king-guard`＝3 小狼、狼王、預言家、女巫、守衛、獵人、4 平民。

**規則（`lib/rules/death-skills.ts` 為單一真相）**：死亡技能（「槍」）分成兩把，

| 死因 | 獵人槍 | 狼王槍 |
| --- | --- | --- |
| 白天被投票放逐 | ✅ | ✅（且**非最後一狼**） |
| 夜間被狼刀 | ✅ | ✅（2026-09-25 校訂：先前只有白天放逐能開） |
| 被女巫毒死 | ❌ | ❌ |
| 被自爆／技能帶走 | ✅ | ❌ |
| 被騎士決鬥出局 | ❌ | ❌ |
| 自爆（自己） | — | ❌（自爆本身沒有技能，`cause: "self_destruct"` 一律 false） |

- 流程端不再寫 `role === "Hunter"`：`VotePhase`（放逐）、`DaySpeechPhase`（夜刀公告）、
  `applySelfDestruct`（被帶走）、警徽移交後的放逐路徑，全部改呼叫
  `canUseDeathShot({ state, role, seat, cause })`；`cause` ∈ exile／night_kill／poison／carried／duel。
- 狼王「非最後一狼」由 `forbiddenWhenLastWolf` 實現：只剩他這隻狼時，出局即終局、不開窗。
- 開槍窗口沿用既有的 `HUNTER_SHOOT` 階段與 `hunterDeathRef` 流程（真人 UI、AI 決策、警徽移交、
  勝負判定都不變），但提示文字依角色切換：`prompts.hunter.*` vs `prompts.wolfKingShot.*`，
  系統訊息**完全角色中立**：公開公告與公開紀錄都只說「某號開槍帶走某號」，
  **不揭露是獵人槍還是狼王槍**（2026-09-25 校訂）；真實槍種只留在 `hunterShots` 紀錄裡，
  只有 EventLog／DevTools／賽後分析看得到（那些是賽後視角，不算公告）。
- 順帶收斂：`RoleCapabilities.deathShot` 取代散落的 `role === "Hunter"`；`getRoleText`／
  `getRoleWinCondition`／`getRoleName`／教學卡（`tutorialOverlay.roles`）補齊 Knight／MuteElder／WolfKing
  （先前缺這幾個 case 會讓新角色的 prompt 說自己是「村民」、教學卡讀到 undefined）。

## 攝夢人（Dreamweaver）與狼王攝夢人版型（進階）

**版型**：`official-12-wolf-king-dreamweaver`＝3 小狼、狼王、預言家、女巫、攝夢人、獵人、4 平民（tags
`狼王攝夢`／`12人`；曾標 `進階`，已移除）。夜晚順序：天黑 →（守衛）→（禁言長老）→ **攝夢人** → 狼人／狼王 → 女巫 → 預言家。

**規則（`lib/rules/dream.ts` 為單一真相）**：

| 規則 | 內容 |
| --- | --- |
| 必須指定 | 每晚一定要指定一名存活玩家當夢游者（不能空攝）；不能選自己（`ROLE_CAPABILITIES.canSelfTarget=false`） |
| 未操作 | AI 沒給出合法目標 → 系統隨機指定（`pickRandomDreamTarget`），保證「每晚都有夢游者」 |
| 免疫 | 夢游者當晚免疫夜間傷害（狼刀／女巫毒藥）：技能照樣消耗、只是落空 |
| 連攝 | 同一座位**連續兩晚**成為夢游者 → 該玩家出局（夢死；女巫解藥救不活） |
| 連帶 | 攝夢人**夜間出局**（被刀／被毒） → 當晚夢游者一并出局 |
| 封槍 | 被夢帶走者不能發動死亡技能（獵人槍／狼王槍），比照被毒（`death-skills.canUseDeathShot` 查夜史 reason=dream） |
| 可見性 | 夢游狀態不公開（被攝者自己也不知道）；天亮只公布「誰出局」，不公布死因 |

> 官方規則是「**可以**連續兩晚攝同一人，但連攝必死」，不存在「禁止重複」的硬性限制——連攝就是這個角色
> 唯一的主動殺人手段。`dream.ts` 的註解也寫明這點（若哪天要改成硬性禁止，改的是 `getDreamEligibleSeats`
> 一處，但那樣「連續兩晚被攝出局」就永遠不會觸發）。

**夜間結算收斂成單一真相**：`lib/rules/night-resolution.ts` 的 `resolveNightDeaths()`（純函式）負責
「狼刀＋守護＋解藥＋毒藥＋攝夢 → 當晚死亡名單」。原本這段規則有 **三份抄本**
（即時流程 `useSpecialEvents.resolveNight`、開發者跳轉回放 `SmartJumpManager` 的兩處），
加一個角色要改三個地方且很容易漂移；現在三處都呼叫同一個函式，`isActorAlive` 讓回放端表達
「這一晚他還在不在場上」。死因新增 `dream`（`NightDeathReason`）。

**整合點（新角色都要走一遍）**：`types/game.ts`（`Role`／`Phase`／`nightActions`／`nightHistory`）、
`rules/roles.ts`、`rules/boards.ts`、`store/game-machine.ts`（`PHASE_CONFIGS`＋`VALID_TRANSITIONS`）、
`game/core/PhaseManager.ts`、`game/phases/NightPhase.ts`（`runDreamAction`＋續跑鏈，AI 與真人共用）、
`game-master.generateDreamAction`（log type `dream_action`）、`game-texts.ts`／`narrator-voice.ts`
（旁白鍵 `dreamWake`／`dreamClose`，音檔由 `scripts/generate-narrator-audio.ts zh dreamWake dreamClose` 補）、
`DaySpeechPhase.announceNightResults`（第一夜死者延後公布：`pendingDreamVictim`）、
`rules/night-deaths.ts`／`rules/mute.ts`（死訊未公布者不能被指定）、UI（`DialogArea` 確認面板、
`page.tsx` 選取色調與階段圖示、`PlayerCardCompact`／`RoleRevealOverlay`／`TutorialOverlay`／
`analysis/constants` 的角色地圖，`Record<Role, …>` 會被 tsc 逼著補齊）。

## 新增角色檢查清單（踩過的坑）

新角色上線時最容易「安靜地錯」的不是規則，而是顯示層。已收斂成單一真相，照這個順序補：

1. `src/types/game.ts`：`Role` 聯集。
2. `src/lib/rules/roles.ts`：`ROLE_CAPABILITIES`（`Record<Role, …>`，tsc 會逼你補齊）。
3. `src/lib/rules/boards.ts`：`ALL_ROLE_KEYS` ＋ 版型資料。
4. i18n：`roles.*`、`promptUtils.roleText.*`／`winCondition.*`、`roleReveal.roles.*`＋`nextStep.*`、
   `tutorialOverlay.roles.*`（`t.raw`，缺了教學卡會讀到 undefined）、`gameSetup.rolePreference.desc.*`、
   公共規則 `roleSkills`／`basicRules`（AI 讀的就是這份，沒同步會照舊規則打）。
5. `src/lib/game-constants.ts`：`getRoleName`（**顯示名稱的單一真相**）。UI 一律呼叫它，
   不要自己維護 `Record<string, string>` ＋ `?? t("roles.villager")`：
   這種寫法不受型別保護，新角色會顯示成「村民」（玩家看到的是錯的身份，不是壞掉）。
6. 角色列舉檔案：`DevTools/DevConsole.tsx` 的 `ALL_ROLES` 要等於 `ALL_ROLE_KEYS`
   （寫死清單會讓 `<select>` 找不到 option，瀏覽器顯示第一個選項＝村民）。
7. 賽後分析：`game-analysis.ts` 的標籤規則走 `ROLE_ALIGNMENT`（狼陣營一律吃狼標籤），
   分析 prompt 的角色清單由 `ALL_ROLE_KEYS` 產生；`analysis/constants.ts` 的圖／名／簡稱。

`src/lib/rules/role-enumeration.test.ts` 兜底：每個角色的顯示名稱必須互不相同，
且任何出現角色鍵（`Idiot:`）的原始碼檔案都必須列出所有角色。
