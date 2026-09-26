# 遊玩紀錄（首頁按鈕 → 歷史局清單 → 賽後分析檢視）實作計畫

## 目標

首頁（歡迎畫面）新增「遊玩紀錄」按鈕：列出**已完賽**的每一局，點進去看整局對話、夜晚行動、
每個角色身分。僅限完賽紀錄。

## 為什麼來源不是 `logs/wolfcha/*.log`

原本的構想是直接掃 `WOLFCHA_AI_LOG_DIR`（`/mnt/public/Develop/Projects/project/logs/wolfcha`，
當時 21 檔、74MB）。實測後不可行：

| 問題 | 實測證據 |
| --- | --- |
| 一個日誌檔 ≠ 一局 | `wolfcha-20260926-070948-006521.log` 實際 2 局（`seer_action` ×2、`witch_action` ×2、`daily_summary` ×4），但 `game_end_remark` 出現 **11** 次（重試／串流分塊）。用出現次數當完賽判準會把局數算成 11。 |
| 沒有遊戲 ID、沒有明確開局標記 | 只能靠 `seer_action`／`daily_summary` 這類線索推斷局邊界，日誌格式一改就壞。 |
| 沒有玩家身分 | 檔案是「這台主機跑過的所有局」，無法過濾成「我的局」。 |
| 掃描成本 | 74MB 且持續成長（`WOLFCHA_AI_LOG_KEEP=20`），每次載入列表都要解析文字。 |

日誌仍是**技術追查**（prompt／token／耗時）的來源，本功能與它互補而不取代：紀錄裡帶 `gameId`，
要追 AI 細節時可再對回日誌。

## 資料格式：直接複用 `GameAnalysisData`

賽後分析（`src/types/analysis.ts` 的 `GameAnalysisData`）已經是自帶完整內容的結構，且
`PostGameAnalysisPage` 是**吃 prop** 的（不綁 atom），因此詳情頁可以直接複用它，
不必另寫檢視器。它剛好涵蓋需求的三項：

| 需求 | 欄位 |
| --- | --- |
| 整局對話 | `timeline[].speeches`、`timeline[].dayPhases[].speeches` |
| 夜晚行動 | `timeline[].nightEvents`（`kill`／`save`／`poison`／`check`／`guard`／`swap`，含 source／target／result） |
| 每個角色身分 | `players[]`（role／alignment／deathCause／isHumanPlayer）、`roundStates[]`（逐回合快照） |

分析本來就在完賽時產生（`useGameAnalysis`），所以落地紀錄**不增加任何模型呼叫**。

## 儲存：伺服器端 JSON 檔（沿用 `api/dev-ai-logs` 的既有慣例）

- 目錄：`WOLFCHA_GAME_RECORD_DIR`，未設定時用 `<repo>/data/game-records`。
- 結構：`<dir>/<ownerKey>/<recordId>.json`（完整紀錄）＋ `<dir>/<ownerKey>/index.json`（清單用的
  中繼資料，避免列表時讀入全部檔案）。`ownerKey` = `sha256(userId)` 前 16 碼，避免把使用者
  輸入直接當路徑。寫入用 tmp + rename，索引不會半寫。
- 保留：`WOLFCHA_GAME_RECORD_KEEP`（預設 100），依 `savedAt` 保留最新。
- 索引缺失時由檔案重建（不靜默失敗：讀不到就記 log 並回空清單）。

不採 Supabase 的理由：需要 migration（本機 `supabase` CLI 未 link，我無法代跑），而本機是
`WOLFCHA_LOCAL_DEMO_MODE=1`，`game-sessions` 根本不寫資料庫。檔案方案自帶、可即刻驗證，
之後若要搬到資料庫，只需換掉 `server-game-records.ts`。

## 身分

沿用 `game-sessions` 的規則（同一事實不手抄，抽成 `src/lib/server-auth.ts`）：

- 有 Supabase token → `user.id`
- 否則在 `WOLFCHA_LOCAL_NO_AUTH=1` 或 Demo Mode 下接受 `x-guest-id`（`guest_*`）
- 兩者皆無 → `401`

紀錄依 `ownerId` 分目錄，列表／詳情都只讀自己的。

## API

| 端點 | 方法 | 說明 |
| --- | --- | --- |
| `/api/game-records` | `POST` | 存一筆（body：`analysis`、`difficulty`）。完賽時由 `useGameAnalysis` 在分析成功後呼叫。 |
| `/api/game-records` | `GET` | 自己的清單（中繼資料，新到舊）。 |
| `/api/game-records/[id]` | `GET` | 單局完整紀錄（僅自己的）。 |

## 驗證

- `src/lib/game-records.test.ts`：中繼資料抽取（天數、真人座位／角色、勝負）、id 淨化、索引形狀驗證。
- `server/game-records-contract.test.ts`：暫存目錄下 POST → GET 清單 → GET 詳情；無身分 401；
  別人身分看不到（隔離）。
- i18n 三語系鍵值齊全（既有 locale-parity 測試涵蓋）。
- 提交前：`pnpm test`、`pnpm exec tsc --noEmit`、`pnpm build`。

## 分期

1. **階段一（已完成）**：`game-records.ts`（純函式）、`server-auth.ts`（從 `game-sessions` 抽出）、
   `server-game-records.ts`（檔案儲存）、兩支 API、單元測試 9 項＋伺服器契約測試 7 項。
2. **階段二（已完成）**：`useGameRecords`、`/records` 清單頁、`/records/[id]` 詳情頁（複用
   `PostGameAnalysisPage`）、歡迎畫面按鈕（桌機列＋手機選單）、`useGameAnalysis` 完賽存檔、i18n ×3。

## 已知限制

- 分析生成失敗的那一局不會有紀錄（列表只收「分析完成＝完賽」的局）。日後若要「先存原始狀態、
  分析後補」再擴充。
- 換瀏覽器（guest id 變）就看不到舊紀錄；檔案仍在磁碟上（依 `ownerKey` 分目錄），可手動搬。
- 詳情頁沿用既有賽後分析 UI，那個頁面的文案本來就只寫中文（如「局勢回顧」），因此非中文語系
  在詳情頁會看到中文；清單頁與按鈕已三語系。要在地化整個分析頁是另一件較大的工作。
- 紀錄是寫在**執行這個 Next 服務的主機**上（跟 `api/dev-ai-logs` 同一套慣例）。若之後改用
  Vercel 這類沒有持久磁碟的部署，要換成資料庫或物件儲存——只需換掉 `server-game-records.ts`。
