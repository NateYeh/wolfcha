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

**仍然存在、且屬於本計畫範圍的既存怪癖**：`NIGHT_MUTE_ACTION`／`NIGHT_DREAM_ACTION` 的
`CHECKPOINT_SAFE` 為 false，但 `RESTORE_FALLBACK` 是「回退點＝自己」。兩者並存代表
「不落盤、但恢復時停在原地」；Phase 1 必須先決定這是否符合預期，再動手。

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
| **1** | 決定並記錄 MUTE／DREAM 的 checkpoint 語意（可存檔？回退點？），順手讓 `CHECKPOINT_SAFE` 與 `RESTORE_FALLBACK` 的關係有測試 | 存檔／恢復測試涵蓋這兩個階段 | 低（純決策＋測試） |
| **2** | **純新增**：夜的推進模組（順序 + 已完成判定 + 下一步），不接任何消費端；用 `NIGHT_ACTION_ORDER` 當順序來源 | 新模組自己的測試（含「角色死亡→跳過」「無守衛在場」等矩陣） | 零（不接線） |
| **3** | `NightPhase` 的 5 個 `continueNightAfter*` 改成向新模組查「下一步」，保留對外行為 | `context-regressions` + 夜晚流程整合測試全綠 | 中 |
| **4** | `useGameLogic` 的存檔恢復 switch（7 個 night case）與 Dev 跳轉／軟編輯分支改向新模組查 | 存檔恢復、Dev 跳轉測試 | 中高（涉及存檔相容） |
| **5** | 真人夜間操作分支（`:2297-2449`）改為「把決定寫進狀態」再由新模組推進 | 真人對局的手動驗證 + 既有 hook 測試 | 中 |
| **6** | `SmartJumpManager` 改成純消費者（目標選擇 UI + 呼叫新模組） | 跳階 smoke test；`analyzeJump` 回歸 | 低 |

> 每階段都要跑：`pnpm test` → `pnpm exec tsc --noEmit` → `pnpm build`（專案自訂驗證鏈）。
> 每個階段結束時，`useGameLogic` 的 `useRef` 數量與 `CONTINUE_NIGHT_AFTER_` 出現次數
> 都應該下降；把這兩個數字記錄在 commit 訊息裡，作為「真的有收斂」的客觀證據。

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
