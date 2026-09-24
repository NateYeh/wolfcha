# 夜間行動續跑鏈重構計畫

> 目的：把「這一晚還有哪些角色要行動、各自是否已完成、下一步是誰」收斂成單一決定點。
> 現況是同一條知識被六處各自持有、沒有一份是權威，新增一個夜間角色要同步改七個地方。
> 本文件只描述計畫與驗收，實作依 Phase 逐步進行。

---

## 1. 現況體檢（2026-09-24 實測）

| 項目 | 現況 | 問題 |
|---|---|---|
| 夜間順序 | 至少六處各自列舉：`NightPhase.ts:88-113`（分派）、`:618-735`（續跑鏈）、`useGameLogic.ts:1196-1339`（存檔恢復）、`:1669-1710`（Dev 軟編輯）、`:1757-1776`（Dev 跳轉）、`:2297-2449`（真人操作）、`game-machine.ts` 的轉移表 | 沒有一份是權威；`getNextNightPhase` 已於 `8fa2b9c` 刪除 |
| 續跑樣板 | `NightPhase` 有 5 個人手寫的 `continueNightAfter*`（`:642`／`:647`／`:670`／`:703`／`:726`），每個都重複「真人已決定 → 停住等輸入 → 否則延遲前進」 | 新角色要新增第 6 個樣板 |
| 控制流 | `useGameLogic.ts` 2,804 行、43 個 `useRef`、100 處 `ref.current =`、188 處 `ref.current` 讀取、43 個 `useCallback`、對外 36 個成員 | 流程狀態藏在 ref 網路裡，無法從介面測試 |
| 變更頻率 | `NightPhase.ts` 45 commits、`useGameLogic.ts` 94 commits（近 150 次提交中 `useGameLogic` 被動 26 次） | 這是最高摩擦、最高 churn 的區域 |
| 測試 | `useGameLogic` 完全測不到（無 jsdom／RTL）；hook 測試靠 5 份手寫 VM 宿主 | 真正會出錯的地方沒有安全網 |

### 近期 bug 的形狀（本計畫要根除的東西）

`e5e94ad`（狼王被票出開不了槍）、`834ae23`、`02f19c0` 都是同一形狀：
**規則純函式（`rules/death-skills.ts`、`rules/self-destruct-apply.ts`）正確，bug 在呼叫端**。
以 `e5e94ad` 為例，修正前 `useGameLogic.ts` 該處是`executedPlayer?.role === "Hunter"`，
修正後改走 `canUseDeathShot()`，並在原處留下註解：
「死亡技能（獵人槍／狼王槍）：以 canUseDeathShot 統一判定，避免寫死 role === "Hunter" 漏掉狼王」
（現行 `src/hooks/useGameLogic.ts:1568`）。`rules/death-skills.ts:14` 也把這條公約寫進註解。
這正是缺少 locality 的症狀：規則已經被抽成純函式，但「誰該用它」散在呼叫端。

---

## 2. 已完成的前置（本計畫的地基）

| commit | 內容 | 對本計畫的意義 |
|---|---|---|
| `02646ea` | `src/lib/rules/phases.ts`：`PHASE_KIND`／`PHASE_SEQUENCE`／`NIGHT_ACTION_ORDER`／`SPEECH_PHASES`／`ACTION_PHASES` | 夜間順序已有權威資料（守衛→禁言→攝夢→狼→女巫→預言家） |
| `09e1a1b` | 消費端接上權威表 | 跳階順序不再自帶清單 |
| `a7da2cf` | `isCheckpointSafe`／`getRestorePhase`／`getPhaseRole`／`PhaseManager` 改 `Record<Phase, …>` | 存檔安全與回退點已經有明確的每階段宣告，是續跑鏈的兩個關鍵輸入 |
| `c933174` | 證據矩陣由 `PROMPT_NEEDS_PUBLIC_EVIDENCE` 衍生 | 新增階段不可能再漏補矩陣 |
| `fe5b645` | 消費端等價守衛 | 表與表之間不會再漂移 |

**原本的既存怪癖（已於 Phase 1 處理）**：`NIGHT_MUTE_ACTION`／`NIGHT_DREAM_ACTION` 的
`CHECKPOINT_SAFE` 為 false，但 `RESTORE_FALLBACK` 是「回退點＝自己」。兩者並存代表
「不落盤、但恢復時停在原地」；查證後確認這是舊 `switch` 的 `default` 殘留，不是刻意設計
（結論與修法見 §5.1）。

---

## 3. 目標 seam

把「一晚的推進」建模成一個**不依賴 React 的純模組**，對外只回答三個問題：

1. 這一晚還要問哪些角色（順序、跳過條件）？
2. 現在輪到誰、還缺什麼決定（已完成判定）？
3. 這個決定完成後，下一步是誰（或今晚結束、進結算）？

介面只吃「狀態 + 一晚的已完成事實」，吐「下一個要問的角色或結束」。
真人輸入與 AI 決策的差異只能表現為「決定已存在／不存在」，不得表現為控制流分支。

---

## 4. 依賴分類與跨 seam 測試策略

- 分類：**in-process**（順序與已完成判定都是純資料推導）＋ **local-substitutable**
  （真人輸入＝狀態欄位；LLM 決策用假回應；旁白音訊 no-op）。
- 跨 seam 測法：餵入「一份 `GameState` + 一組角色決定」→ 觀察「最終狀態 + 被詢問的角色順序」。
  `src/game/phases/night-dream-flow.test.ts` 與 `src/lib/rules/self-destruct-flow.test.ts`
  已經是這個形狀的雛型，可直接作為新 seam 的驗收樣本。
- 唯一真正的外部依賴是 LLM 決策（用既有 `makeFetchMock`）與 narration 音訊（no-op）。

---

## 5. 分階段落地（每階段獨立可驗證、可回退）

| Phase | 內容 | 驗收 | 風險 |
|---|---|---|---|
| **1** | ✅ **已完成**（結論見下方 §5.1）：兩張表搬到 `src/lib/rules/checkpoints.ts`、修掉 MUTE／DREAM 的 `default` 殘留、加上四條不變式守衛；並修掉同一路徑上挖出的第八條 bug（`IN_PROGRESS_PHASES` 漏階段——進禁言階段會刪掉整局存檔） | `checkpoints.test.ts` 9 支 + store 整合測試 1 支全綠 | 低 |
| **2** | ✅ **已完成**（見下方 §5.2）：純新增 `src/lib/rules/night-progress.ts`（順序 / 已完成 / 下一步），**尚未接任何消費端** | `night-progress.test.ts` 11 支全綠 | 零（不接線） |
| **3** | ✅ **已完成**（結論見 §5.3）：續跑鏈的 5 處「等真人」判定收成 `humanActorPending()`；查證後確認鏈上沒有寫死的「下一步」階段，因此不需要（也移除了）`nextNightPhaseAfter` | 新增 `night-human-wait.test.ts`（原本真人等待分支零覆蓋）+ 既有夜晚流程測試全綠 | 中 |
| **4** | ✅ **已完成**（見 §5.4）：新增 `src/game/phases/night-resume.ts`（續跑指令表），`useGameLogic` 的存檔恢復／軟編輯／Dev 跳轉全部改問它；存檔恢復的 5 個同型 case 合併成一個 | 計畫表 10 支 + 行為驗證 3 支（真實一夜，逐階段）+ 既有夜晚流程測試全綠 | 中高（涉及存檔相容） |
| **5** | ✅ **已完成**（見 §5.5）：真人五條夜間操作與狼隊分工改走同一份計畫表；女巫「不救」改為落盤 | 新增女巫不救落盤測試；真人對話框仍需手動驗證 | 中 |
| **6** | ✅ **已完成**（見 §5.6）：`createMissingTask` 改用模組判定並補上禁言分支；套用端補上 `dreamTarget`／`mutedTarget` | `analyzeJump` smoke + 套用端回歸 6 支全綠 | 低 |

> 每階段都要跑：`pnpm test` → `pnpm exec tsc --noEmit` → `pnpm build`（專案自訂驗證鏈）。
> 每個階段結束時，`useGameLogic` 的 `useRef` 數量與 `CONTINUE_NIGHT_AFTER_` 出現次數
> 都應該下降；把這兩個數字記錄在 commit 訊息裡，作為「真的有收斂」的客觀證據。

---

## 5.1 Phase 1 的結論與新增發現（已完成）

**決定**：MUTE／DREAM 與其他夜間角色同一規則——“已決定即可落盤；未決定時不落盤，刷新後由前一個
穩定點重播”。證據是恢復鏈（`useGameLogic` 的 MUTE／DREAM 案例）**早就**以 `mutedTarget`／
`dreamTarget` 寫好了「已決定則續跑」的判定；存檔端之所以拒絕，只是舊 
`switch` 的 `default`（同族的第七條，也是最後一條）。

**語意細節**：

- 「已決定」包含「沒有東西要決定」：長老／攝夢人不在場，或合法目標為空
  （`getMuteEligibleSeats`／`getDreamEligibleSeats` 為空，例如只剩自己存活；
  `dream.ts` 的註解本來就承認後者）。
- 回退點採「前一個**穩定**點」而非「前一個階段」：禁言未決定時它不是穩定點，
  因此 DREAM 在全部未決定時退回 `NIGHT_START`。
- 兩張表用同一組 `*Decided()` 判定，同一角色不會有兩種「已決定」。

**新增的四條不變式守衛**（`src/lib/rules/checkpoints.test.ts`）：

1. 動作階段（`ACTION_PHASES`）的回退點**不得是自己**；
2. 夜間回退點不得往前跳（否則形成迴圈）；
3. 回退目標**自身必須是穩定點**（回退到存不下來的點＝把不完整狀態當穩定點）；
4. 真正的中間態（`NIGHT_RESOLVE`／`DAY_RESOLVE`／`BADGE_TRANSFER`／`HUNTER_SHOOT`／
   `SELF_DESTRUCT`／`KNIGHT_DUEL`）仍然拒絕落盤。

> 第 1 條就會抓到 MUTE／DREAM 的舊行為，第 3 條會抓到任何「回退到不穩定點」的新寫法。

**本階段顺帶查到、尚未處理的兩件事**（供 Phase 3／5 使用）：

1. 恢復鏈與階段續跑用的是 `field !== undefined`（`NightPhase.ts:658`／`:681`、
   `useGameLogic.ts:1234`／`:1249`／`:1680`），**不涵蓋「沒有合法目標」的退化情況**；
   該情況要求「只剩攝夢人自己存活」，正常對局不可達（那時早應該 GAME_END），因此只記錄。
2. 「某個夜間決定完成了嗎」的推導散布在 8 處以上（`mutedTarget` 3、`dreamTarget` 5，
   `guardTarget` 11、`wolfTarget` 28 等，含非「已完成」語意的讀取）——這是 Phase 2 的消費端清單。

### 順帶修掉的第八條同族 bug：進禁言階段會刪掉整局存檔

寫「已決定能撐過刷新」的整合測試（`src/store/game-machine.test.ts`）時，測試**沒有**失敗在存檔判定上，
而是失敗在它前面的一道閘門，因而挖出這個：

- `isRestorableGameState = isGameInProgress && hasGameSessionId`，而 `isGameInProgress` 讀的是
  **手寫清單** `IN_PROGRESS_PHASES`（18 項），
  漏了後加的 `NIGHT_MUTE_ACTION`／`NIGHT_DREAM_ACTION`／`KNIGHT_DUEL`（三者都在 `PHASE_SEQUENCE` 裡）。
- `saveGameState` 在**每次狀態變更**都會先問 `isRestorableGameState`；答案為否就走「清掉存檔」那一支
  （原意是「回到大廳才清」）。所以進入禁言階段（或攝夢、騎士決鬥）時，**整局存檔被刪掉**，
  重新整理直接回大廳；`page.tsx` 的 `isGameInProgress` 也會把對局當成已結束（設定面板藏「退出對局」）。
- 這比原本以為的「不能落盤」嚴重得多：不是退回上一個檢查點，是**全部丟失**。

**修法**：`IN_PROGRESS_PHASES` 改由權威表以排除法推導（`PHASE_SEQUENCE` 扣掉 `LOBBY`／`SETUP`／`GAME_END`），
新增階段預設算「進行中」，不再需要記得回來補這份清單。差集已比對：只多了這三項，沒有其他變動。

> 教訓：「階段清單手寫 + 新增階段靠人記得補」這個家族，光把「有紀錄的地方」清完不夠，
> 要清到**存檔閘門**這種「平時不會讀到」的地方。整合測試比表格測試更會撈到這種。

**尚未處理（已記錄）**：`DevConsole` 的 `ALL_PHASES` 與 `usePhaseNames` 也是手寫且漏成員
（缺 MUTE／DREAM／`SELF_DESTRUCT`／`KNIGHT_DUEL`），而且用 `as Record<Phase, string>` 把 tsc 騙過去，
所以開發者工具在那些階段顯示 `undefined`、下拉選單也選不到。
修它需要補三個語系的 `devConsole.phases.*` 鍵，**開發者工具可見、玩家不可見**，所以不在本階段順手改。

---

### 5.2 Phase 2 的產出與 Phase 3-6 的接線清單（已完成）

新 module `src/lib/rules/night-progress.ts`（只描述、不驅動；不改狀態、不發指令、不碰 React）：

| 出口 | 回答什麼 | 預計消費端 |
|---|---|---|
| `NIGHT_STEP: Record<NightActionPhase, NightStep>` | 每一步的階段、決定者（單一角色／狼隊）、完成判定 | 全部 |
| `guardDecided`／`muteDecided`／`dreamDecided`／`wolfDecided`／`witchDecided`／`seerDecided` | 這一步做完了嗎（含「沒有這個角色」「沒有合法目標」） | Phase 3 階段續跑的「真人未決定就停住」；`checkpoints.ts`（已接） |
| `isNightActionPhase`／`nightStepFor` | 型別守衛與查表 | Phase 3-6 |
| `pendingNightActions(state, { after })` | 還缺哪些決定（`after` 用於跳階補齊） | Phase 6 `SmartJumpManager.createMissingTask`（現用 `ACTION_PHASES`） |
| `nextPendingNightAction(state, { after })`、`isNightComplete` | 下一個要處理的步驟／今晚結束了嗎 | Phase 4 存檔恢復、Phase 5 真人操作 |
| `actorsForNightStep(state, phase)` | 這一步由哪些玩家決定 | Phase 5 真人操作、UI 顯示 |
| `humanActorPending(state, phase)` | 這一步是不是「正在等真人決定」 | ✅ `NightPhase` 續跑鏈（Phase 3 已接） |

**編譯期保證**：`NIGHT_ACTION_ORDER` 改成 `as const satisfies readonly Phase[]` 並匯出 `NightActionPhase`；
`NIGHT_STEP` 是 `Record<NightActionPhase, …>`，所以在權威表新增一個夜間角色階段時，**tsc 會紅**，
不像過去只是安靜地少一個分支。

**跨 seam 守衛**（`night-progress.test.ts`，11 支）：步驟表正好覆蓋權威順序、每步的決定者與完成判定、
退化情況、女巫的「明確不救」、狼隊（多狼都是決定者）、`after` 補齊查詢、
以及「**夜間順序必須是狀態機 `VALID_TRANSITIONS` 允許的轉移**」（順序表與轉移表不得漂移）。

---

### 5.3 Phase 3 的結論與教訓（已完成）

**查證推翻了計畫的假設**：原本以為 5 個 `continueNightAfter*` 各自寫死「下一步是哪個階段」，
實際上順序是由**呼叫鏈**編碼的（`continueNightAfterGuard → …Mute → …Dream → runWolfAction →
…Wolf → runWitchAction → …Witch → runSeerAction → onNightComplete`），檔案裡沒有任何
「下一步」的階段字面值。所以 `nextNightPhaseAfter()` 沒有真實消費端——那個概念過去就是死碼
`getNextNightPhase`（已於 `8fa2b9c` 刪除），於是把它一併移除，而不是留一個沒人用的介面。

> 教訓：計畫文件裡的「現況」也要驗證。這條錯誤假設是從掃描階段的印象寫下的，
> 實際讀程式才發現。

**Phase 3 真正該做、也做了的事**：續跑鏈上**5 處**「真人還沒決定就停在該階段」的判定各寫各的
（`guard?.isHuman && guardTarget === undefined` 這種），女巫那處還把「藥用完了」的規則重推一次。
現在收成 `rules/night-progress` 的一個概念：

```ts
humanActorPending(state, phase)  // 決定者裡有真人，而且這一步還沒完成
```

5 處全部改用它（守衛／禁言／攝夢／女巫／預言家）。等價性由 `night-progress.test.ts` 逐角色釘住
（含女巫「明確不救」「兩瓶藥用完」、狼隊只要一位真人在、沒有決定者時不算等）。

**順帶補上的覆蓋缺口**：真人等待分支過去**完全沒有測試**（`night-dream-flow.test.ts` 只跑全 AI 的一夜）。
新增 `src/game/phases/night-human-wait.test.ts`：真人攝夢人在 AI 跑到他那裡時，夜晚**不會**走完、
停在 `NIGHT_DREAM_ACTION`、AI 不代答；前端寫入決定並下 `CONTINUE_NIGHT_AFTER_DREAM` 之後才把
狼人／女巫／預言家跑完。

**一處刻意保留的行為差異**：改用 `decided()` 之後，真人決定的「沒有合法目標可選」退化情況
（例如只剩攝夢人自己存活）不再讓夜晚停在等他——那正是 `dream.ts` 註解承認的「這一晚沒有夢游者」，
原本會卡住。

---

### 5.4 Phase 4：續跑指令表（已完成）

新增 `src/game/phases/night-resume.ts`：回答「停在某個夜間階段時，接下來該下哪個指令」。
出口只有兩個（`nightResumePlan`、`replayCommandFor`）＋一張 `ADVANCE_PLAN` 表，四種結果：
`advance`（跳過這一步往下）、`resolve`（預言家之後進結算）、`replay`（AI 的決定沒落盤，從這一步重跑）、
`wait`（真人在等輸入）。指令字串屬階段層 vocabulary，所以放在 `src/game/phases/`，不放 rules 層
（rules 只描述、不發指令）。

`useGameLogic` 的三處因此收斂：

| 位置 | 之前 | 現在 |
|---|---|---|
| 存檔恢復 switch | 6 個 case 各自寫死指令與「已完成」判定（約 100 行） | 5 個同型 case 合併成 1 個＋預言家 1 個，都只問 `nightResumePlan` |
| Dev 動作軟編輯 | 5 個 if，各自寫死判定；漏了禁言 | 一個 `isNightActionPhase` 判斷＋計畫表；補上禁言 |
| Dev 跳轉 | 手寫「跳到 X 要下哪個指令」，**漏了禁言與攝夢**（跳到那兩階段夜晚會卡住） | `replayCommandFor(X)`，六個階段齊全 |
| `runNightPhaseAction` 的參數 | 行內 union 手抄 6 個指令字串 | `NightResumeCommand`（單一來源） |

**客觀收斂**：`useGameLogic` 2,804 → 2,697 行；`CONTINUE_NIGHT_AFTER_` 出現次數 16 → 6
（剩下的 5 個是真人提交處理器，Phase 5 要處理；1 個是狼隊分工放行）。`useRef` 數量沒變（43）——
夜間順序本來就不是靠 ref 表達的，這個指標沒有下降是正常的，不假裝。

#### 讀鏈得到的三個事實（計畫原本寫錯了一個）

1. **順序是「呼叫鏈」編碼的，不是資料**：`continueNightAfterGuard → …Mute → …Dream → runWolfAction
   → …Wolf → runWitchAction → …Witch → runSeerAction → onNightComplete`。所以 Phase 3 把
   `nextNightPhaseAfter` 移除了（它沒有真實消費端）。
2. **每個 `CONTINUE_NIGHT_AFTER_X` 的語意是「X 已經決定，把 X 之後的步驟跑掉」**，而跳過機制是
   「帶著的 phase 等於這一階段就不重跑」，且每個 `run*Action` 都會把 phase 改成自己。
3. **「重跑某一步」不能只用順序推導**：禁言的重跑若用前一步的 `CONTINUE_NIGHT_AFTER_GUARD`，
   因為那支只是轉呼叫、不改 phase，禁言行動會被整步跳過（決定根本不會做）。所以 `REPLAY_COMMAND`
   是一張逐項寫理由的表，並由 `night-resume-flow.test.ts` 實際跑一夜驗證。

> 教訓：「看起來等價」的指令在這種「靠攜帶的 phase 決定要不要跑」的鏈上不等價。
> 兩次錯誤推論（禁言重跑、`nextNightPhaseAfter`）都是靠**實際跑一夜**才發現，靜態閱讀不夠。

#### 這階段的驗收測試

- `night-resume.test.ts`（10 支）：逐階段釘住三種結果、退化情況（沒有角色／沒有合法目標／藥用完）、
  「重跑≠跳過」、「重跑指令必須是已知指令」、非夜間階段明確報錯。
- `night-resume-flow.test.ts`（3 支）：**真實跑一夜**，逐階段確認「下了重跑指令之後，那一步的
  決定真的有被寫入」並走完夜晚；另有一支確認鏈只往前走（從狼人階段重跑時，女巫／預言家照樣被問到）。

#### 尚未處理（本階段發現、留待後續）

- **重跑會把前面的 AI 步驟重新問一次**（例如從狼人階段重跑會先重跑禁言／攝夢，覆蓋原本的目標）。
  這是舊行為，原樣保留；要修得在階段層加一個「就從這一步續跑」的指令。
- **AI 女巫「不動作」完全不寫欄位**（`runWitchAction` 的 pass 分支不落盤），所以 `witchDecided`
  對 AI 女巫的明確不救是 false：那一刻的存檔不可落盤、恢復會再問一次 AI 女巫。
  真人女巫的 pass 也一樣沒寫（`witchSave: false` 的語意是文件自己承認的）——Phase 5 處理。

---

### 5.5 Phase 5：真人夜間操作（已完成）

新增 `continueNightAfterHumanAction(state, phase, token)`：真人剛把決定寫進狀態後，「該下哪個指令」
問同一張計畫表。五條路徑（守衛／禁言／攝夢／狼人／女巫／預言家）與狼隊分工的放行都改用它；
若計畫回 `wait`（＝呼叫端以為寫入了、狀態其實沒寫進去）會 `console.warn`，不讓夜晚靜默卡住。
預言家的「按下確認後結算」抽成 `armNightResolve(token)`，由恢復鏈、Dev 軟編輯、真人查驗共用。

**修掉一個語意缺口**：女巫「明確不救」過去**什麼都不寫**（真人與 AI 都一樣），於是
`witchDecided` 對「不救」永遠是 false——刷新／恢復會再問一次女巫，存檔閘門也把女巫階段當成不穩定點。
現在真人 pass 寫 `witchSave: false`，AI pass（`runWitchAction`）也一併寫入。所有讀取端都是
`=== true`／truthy 判斷（逐處確認過），寫 `false` 不會被誤解成「用了解藥」。

**兩處刻意保留的例外**（都附註解）：守衛的空守（`guardTarget: undefined` 在狀態裡就是「還沒決定」，
計畫表無法表達「決定不守」）與女巫按到已經用完的那一瓶（UI 已 disable，正常不可達），這兩條仍然
明確往下推，與舊行為一致。

> 沒有自動化測試覆蓋的範圍：真人對話框那幾條路徑屬於 UI 互動，只能靠實際對局驗證。
> 建議手動留意：女巫「不使用藥水」之後刷新、守衛「空守」之後刷新、真人狼第一夜分工。

### 5.6 Phase 6：`SmartJumpManager` 當消費者（已完成）

- `createMissingTask`：守衛／攝夢／狼人／預言家的「這一步決定了嗎」改問 `rules/night-progress`；
  **補上禁言長老的補全項**（`ACTION_PHASES` 早就把它算進來，卻永遠不會產生補全項——
  檔案自己的註解也承認這只是「宣告意圖」）。需要三語系的 `smartJump.muteAction` 鍵。
- **修掉套用端的靜默失敗**：`applySmartJumpWithFilledData` 的 switch 沒有 `default`，
  過去**漏了 `dreamTarget`**——開發者在補全清單填了攝夢目標會被靜默丟掉（禁言也沒有）。
  現在兩格都補上。
- 新增 3 支測試：同日前跳要把跳過的夜間步驟全部列出（含禁言，且不可選自己）、已決定就不再要求補全、
  填好之後真的寫進狀態（攝夢／禁言回歸）。

**尚未處理（已記錄）**：跨日前跳的補全迴圈（`analyzeForwardJump` 的 `d` 迴圈）仍是手寫，也還沒有禁言
（那需要 DevConsole 的 `day<N>MutedTarget` 欄位讀取與套用一起改）。

---

## 6. 風險與注意

1. **存檔相容**：Phase 4 動到恢復路徑。舊 checkpoint 沒有新模組需要的「已完成事實」時，
   必須能從既有 `nightActions`／`roleAbilities` 反推，且要有降級保護
   （`docs/单人上下文约束.md` 明訂歷史結構變更要同步檢查持久化兼容與開發回滾）。
2. **DevTools 行為**：Phase 6 之前，開發者跳轉仍走舊路徑；兩套並存期間要確保
   跳轉後的状态是「新模組也認得」的。
3. **真人輸入的等待語意**：現行用「停住 → 等 UI 寫入 → 繼續」；改成純模組後，
   「等待」必須變成「模組回報缺這個決定」，不要讓 hook 自己判斷該不該停。
4. **不要一次做完**：NightPhase 45 commits、useGameLogic 94 commits 說明這個區域一直在動；
   每階段獨立可回退，比一次大爆炸安全。

---

## 7. 驗收標準

- 新增一個夜間角色（例如石像鬼）時，需要改的地方從「7 個檔案」降到「權威表 + 該角色的決策函式」。
- `useGameLogic.ts` 的 `CONTINUE_NIGHT_AFTER_` 出現次數降到 5 以下（現況 22）。
- 夜間流程可以在不依賴 React 的情況下測完一整晚（候選 8 的測試宿主因此可以收斂成一份）。

### 完成後的實測（Phase 1–6 全部落地）

| 指標 | 之前 | 之後 |
|---|---|---|
| `useGameLogic` 的 `CONTINUE_NIGHT_AFTER_` 出現次數 | 22 | **2**（守衛空守、女巫按到無藥那瓶；都附註解說明為何不能問計畫表） |
| `useGameLogic.ts` 行數 | 2,804 | **2,697** |
| 「這一步決定了嗎」的推導 | 散在 ≥8 處 | `rules/night-progress` 一處；`checkpoints`／`NightPhase`／`useGameLogic`／`SmartJumpManager` 都是消費者 |
| 「接下來該下哪個指令」 | 散在 3 處、各自寫死（其中 2 處有漏／寫錯） | `game/phases/night-resume` 一張表 |
| 測試 | 391（+97 server） | **477（+97 server）** |

**現在新增一個夜間角色要改哪裡**（不再有「安靜地少一個分支」）：

1. `rules/phases.ts` 的 `NIGHT_ACTION_ORDER`（權威順序）；
2. `rules/night-progress.ts` 的 `NIGHT_STEP` 與該角色的 `*Decided`（**漏了 tsc 會紅**）；
3. `game/phases/night-resume.ts` 的 `ADVANCE_PLAN`／`REPLAY_COMMAND`（**漏了 tsc 會紅**）；
4. 階段層的 `run*Action` 與 UI／prompt（本來就要寫的部分）。

`checkpoints`、存檔恢復、Dev 跳轉、Dev 軟編輯、跳階補全都會自動跟上，因為它們只問
「這一步決定了嗎／下一個指令是什麼」。

**仍記錄在案、尚未處理**：

1. 夜間重跑會把前面的 AI 步驟重新問一次（要修得在階段層加「就從這一步續跑」的指令）。
2. 跨日前跳的補全迴圈仍是手寫，也還沒有禁言（需要 DevConsole 的 `day<N>MutedTarget` 一起改）。
3. 守衛的「空守」在狀態上無法表達（`guardTarget: undefined` ＝還沒決定），所以空守後刷新會重問。
4. `DevConsole` 的 `ALL_PHASES`／`usePhaseNames` 仍是手寫且漏成員（缺 MUTE／DREAM／
   `SELF_DESTRUCT`／`KNIGHT_DUEL`），用 `as Record<Phase, string>` 把 tsc 騙過去；需補三語系鍵。
5. ~~真人對話框的夜間操作路徑沒有自動化測試~~ → **已補**（`rules/human-input.test.ts`，見 §5.7）。

---

### 5.7 真人夜間操作的兩處漏接（實機測試後補）

實際開一局真人狼美騎士時查出：`DialogArea`（面板出不出的來）與 `page.tsx` 的
`confirmSelectedSeat`（確認送去哪裡）**各自手寫一份階段清單**，兩邊都沒有被型別或測試綁住，
所以各漏一個階段，而且都不會報錯：

| 症狀 | 漏在哪 |
| --- | --- |
| 真人**狼美人**：階段永遠停在原地（遊戲卡死） | 面板缺 `NIGHT_WOLF_BEAUTY_ACTION` → 確認面板根本不出現 |
| 真人**攝夢人**：面板出現、按了沒反應 | 路由缺 `NIGHT_DREAM_ACTION`（既有缺口，狼美人只是照抄同一份清單） |

改法：集中到 `rules/human-input.ts` 的 `SEAT_ACTION_CONFIRM_PHASES` 與
`canHumanConfirmSeatAction`，兩個消費端讀同一份；`NIGHT_WOLF_BEAUTY_ACTION` 的確認鈕文字
補 `dialog.action.charm`（三語系）。

守衛測試用狀態機反過來掃：對每個 `actionType === "night_action"` 的階段，
只要 `PHASE_CONFIGS[...].requiresHumanInput` 對某個角色回 true，就要求
**面板與路由都接得住**；有專屬面板的女巫另行列出。少任何一邊都會紅。
