# 版型目錄核對表（來源：LAL 狼人殺版型站）

**建立日期**：2026-09-24　**狀態**：待決策（尚未實作任何新版型）

來源：<https://werewolves.games/variants/>（LAL 邏輯與謊言，26 個版型、全部 12 人局，每個版型另有自己的規則頁）。
來源資料頁面標記的最後更新日是 2026-05-16；附錄有 26 個規則頁的網址與重新核對的方法。

本檔只記**事實**：版型名稱、角色組成、勝負條件。來源站的解說文字與賽事影片一律不採用——
本作的規則文字、提示詞與 UI 文案本來就自己寫，版型名稱與角色組成屬於社群通用資訊。

## 1. 結論

- 來源 26 個版型裡，**6 個**只靠現有角色就能做。其中 5 個本作本來就有，第 6 個「八獵四狼」已於 2026-09-24 加入（見第 5 節）。
- **9 個**需要新增 1–2 個角色，不動到共用機制 → 中等工作量。
- **11 個**需要動到共用機制（陣營判定、死亡結算、夜間順序、勝負條件）或一次要 3 個以上新角色 → 大工作量。
- 全部加起來約 **42 個新角色**，其中多數只服務一個版型——這是真正的工作量所在，不是版型清單。

## 2. 核對：索引表與各版型頁不一致之處

來源站的目錄表**有漏列**，逐頁核對後更正如下（以各版型頁的「陣容配置」為準，且 26 個版型座位數都剛好 12）：

| 版型 | 目錄表寫的 | 規則頁寫的（採用這個） |
| --- | --- | --- |
| 忍法帖 | 好人：預言家、女巫、獵人、守衛、平民×4｜狼人×3 | 好人：預言家、女巫、守衛、獵人、平民×3、**忍者**｜**狼人×4** |
| 預女獵白混 | 好人：預言家、女巫、獵人、白痴、平民×4｜狼人×3 | 好人：預言家、女巫、獵人、白痴、**混血兒**、平民×3｜**狼人×4** |
| 夢魘攝夢 | 狼人陣營：「夢魘」 | 狼人陣營：「**夢魘之影**」（正式名稱） |

另外兩個只是排列順序不同（狼王守衛、幽靈狼），組成一樣。

## 3. 本作現況

- 已支援角色 12 個：`Werewolf`／`WhiteWolfKing`／`WolfKing`／`Seer`／`Witch`／`Hunter`／`Guard`／`Idiot`／`Knight`／`MuteElder`／`Dreamweaver`／`Villager`。
- 陣營模型只有 `wolf`／`god`／`villager` 三種（`RoleCamp`）→ **第三方陣營（丘比特情侶、混血兒跟隨榜樣）目前表達不了**。
- 官方版型 11 個，其中 12 人版型 7 個；版型資料結構 `BoardPreset` 已足夠，加版型不用改 UI 架構。
- 夜間順序是**全遊戲一份**：守衛 → 禁言 → 攝夢 → 狼人 → 女巫 → 預言家（`NIGHT_ACTION_ORDER`）。

## 4. 核對表（26 個）

| # | 版型 | 好人陣營 | 狼人陣營 | 本作狀態 | 分級 | 需要的新角色 | 備註（機制／成本） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 預女獵白 | 預言家、女巫、獵人、白痴、平民×4 | 狼人×4 | **已存在** `official-12-seer-witch-hunter-idiot` | A | — | 組成與現有版型完全相同，不需新增任何東西。 |
| 2 | 預女獵禁 | 預言家、女巫、獵人、禁言長老、平民×4 | 狼人×4 | **已存在** `official-12-seer-witch-hunter-mute` | A | — | 組成與現有版型完全相同，不需新增任何東西。 |
| 3 | 預女獵白混 | 預言家、女巫、獵人、白痴、混血兒、平民×3 | 狼人×4 | 需新增角色 | C | 混血兒 | 混血兒（`HalfBlood`）：選榜樣並跟隨其陣營 → 動到陣營判定與勝負條件。 |
| 4 | 狼王守衛 | 預言家、女巫、守衛、獵人、平民×4 | 狼人×3、狼王 | **已存在** `official-12-wolf-king-guard` | A | — | 組成與現有版型完全相同，不需新增任何東西。 |
| 5 | 狼王攝夢人 | 預言家、女巫、獵人、攝夢人、平民×4 | 狼人×3、狼王 | **已存在** `official-12-wolf-king-dreamweaver` | A | — | 組成與現有版型完全相同，不需新增任何東西。 |
| 6 | 狼王魔術師 | 預言家、女巫、獵人、魔術師、平民×4 | 狼人×3、狼王 | 需新增角色 | B | 魔術師 | 魔術師（`Magician`）：每夜交換兩名玩家的位置，交換後刀口／查驗／毒口全部改判。 |
| 7 | 夢魘攝夢 | 預言家、女巫、獵人、攝夢人、平民×4 | 狼人×3、夢魘之影 | 需新增角色 | B | 夢魘之影 | 夢魘之影（`Nightmare`）：恐懼一名玩家；恐懼到狼人則狼隊當晚無刀（動到夜間結算）。 |
| 8 | 白狼王騎士 | 預言家、女巫、獵人、騎士、平民×4 | 狼人×3、白狼王 | **已存在** `official-12-white-wolf-knight` | A | — | 組成與現有版型完全相同，不需新增任何東西。 |
| 9 | 狼美騎士 | 預言家、女巫、守衛、騎士、平民×4 | 狼人×3、狼美人 | 需新增角色 | B | 狼美人 | 狼美人（`WolfBeauty`）：每夜魅惑一名玩家，自己被出局時被魅惑者一起出局（動到死亡結算）。 |
| 10 | 魔鬼騎士 | 預言家、女巫、獵人、騎士、平民×4 | 狼人×3、狼美人 | **已加入** `official-12-wolf-beauty-hunter-knight` | B | 狼美人 | 與狼美騎士共用狼美人，但**神職不同**（狼美騎士＝守衛、魔鬼騎士＝獵人），不是「只差玩家約定」；2026-09-24 補上版型。 |
| 11 | 石像鬼守墓人 | 預言家、女巫、獵人、守墓人、平民×4 | 狼人×3、石像鬼 | 需新增角色 | B | 守墓人、石像鬼 | 石像鬼（`Gargoyle`：不進狼窩、查具體身份）＋守墓人（`Gravekeeper`：查被放逐者的身份）。 |
| 12 | 陰陽師 | 陰陽師、女巫、守衛、小精靈、平民×4 | 狼人×3、惡靈騎士 | 需新增角色 | C | 陰陽師、小精靈、惡靈騎士 | 陰陽師（`Onmyoji`）＋小精靈（附身：`Sprite`）＋惡靈騎士（催眠：當晚無刀、神牌技能無效）。 |
| 13 | 幽靈狼 | 道士、守衛、女巫、預言家、平民×4 | 狼人×3、幽靈狼 | 需新增角色 | C | 道士、幽靈狼 | 道士（結印：`Taoist`）＋幽靈狼（一次性換位＋靈魂鎖鏈：`GhostWolf`）→ 換位＋連帶死亡。 |
| 14 | 忍法帖 | 預言家、女巫、守衛、獵人、平民×3、忍者 | 狼人×4 | 需新增角色 | C | 忍者 | 忍者（`Ninja`）：認主後繼承主人技能或勝利條件 → 動態身份／陣營。 |
| 15 | 機械狼通靈師 | 通靈師、女巫、獵人、守衛、平民×4 | 狼人×3、機械狼 | 需新增角色 | B | 通靈師、機械狼 | 通靈師（`Medium`：查具體身份）＋機械狼（`MachineWolf`：不進狼窩、可學習身份並繼承技能，動到技能繼承）。 |
| 16 | 賭鬼天師 | 預言家、女巫、獵人、天師、平民×4 | 狼人×3、賭鬼 | 需新增角色 | C | 天師、賭鬼 | 天師（每晚換位：`CelestialMaster`）＋賭鬼（知道三小狼、猜出局號碼單雙換額外刀權：`Gambler`）。 |
| 17 | 暗黑破壞 | 凱恩、天使長、女巫、攝夢人、平民×4 | 莉莉絲、莉婭、狼王、狼人 | 需新增角色 | C | 凱恩、天使長、莉莉絲、莉婭 | 凱恩＋天使長（復活）＋莉莉絲（禁錮）＋莉婭（迷霧）→ 復活／迷霧／禁錮三套新機制。 |
| 18 | 血月獵魔 | 預言家、女巫、獵魔人、白痴、平民×4 | 狼人×3、血月使徒 | 需新增角色 | B | 獵魔人、血月使徒 | 獵魔人（`DemonHunter`：夜間追輪次）＋血月使徒（`BloodMoonApostle`：自爆封印神職技能）。 |
| 19 | 黑夜傳說 | 預言家、女巫、魔術師、神父、平民×4 | 狼人×2、夜魘、吸血鬼 | 需新增角色 | C | 魔術師、神父、夜魘、吸血鬼 | 魔術師＋神父（聖光：`Priest`）＋夜魘（追加夜晚行動：`NightTerror`）＋吸血鬼（雙命：`Vampire`）→ 追加夜晚＋雙命。 |
| 20 | 丘比特 | 預言家、獵人、愚者、丘比特、盜賊、平民×3 | 狼人×3、狼王 | 需新增角色 | C | 愚者、丘比特、盜賊 | 丘比特（連結情侶：`Cupid`）＋愚者（`Fool`）＋盜賊（選牌：`Thief`）→ 第三方陣營，勝負條件要重寫。 |
| 21 | 覺醒狼王 | 預言家、女巫、獵人、守衛、平民×4 | 狼人×3、覺醒狼王 | 需新增角色 | B | 覺醒狼王 | 覺醒狼王（`AwakenedWolfKing`）：兩次狼王爪，可保留雙槍或傳承給狼隊友。 |
| 22 | 假面舞會 | 預言家、女巫、白痴、舞者、平民×4 | 狼人×3、假面 | 需新增角色 | B | 舞者、假面 | 舞者（`Dancer`）＋假面（`Masked`）：身份置換機制（動到身份可見性）。 |
| 23 | 四狼八獵 | 獵人×8 | 狼人×4 | 可玩（只加資料） | A | — | 只加版型資料。8 個獵人的死亡槍會互相觸發，要驗證連帶死亡不會漏發或無限迴圈。 |
| 24 | 狐妖祭司 | 祭司、女巫、守衛、獵人、平民×4 | 狼人×3、狐妖 | 需新增角色 | C | 祭司、狐妖 | 大祭司（天譴：`HighPriest`）＋狐妖（詛咒：`FoxSpirit`）→ 方向性連鎖死亡。 |
| 25 | 血魔狂舞 | 預言家、女巫、守衛、驅魔師、平民×4 | 狼人×3、血魔 | 需新增角色 | C | 驅魔師、血魔 | 驅魔師（連續號碼驅散：`Exorcist`）＋血魔（割裂→延遲死亡：`BloodDemon`）。 |
| 26 | IMBA | BT預言家、BT女巫、BT守衛、BT獵魔人、平民×4 | 混沌領主、美杜莎、狼妃、狼王 | 需新增角色 | C | BT預言家、BT女巫、BT守衛、BT獵魔人、混沌領主、美杜莎、狼妃 | BT 系列四角色（雙驗／雙毒／雙守／雙獵）＋混沌領主（混沌風暴）＋美杜莎（石化）＋狼妃 → 高變體規則集合。 |

分級定義：**A**＝只加版型資料；**B**＝新增 1–2 個角色且不動共用機制；**C**＝要動共用機制，或一次需要 3 個以上新角色。

## 5. A 級：已完成

這 6 個不需要新角色。5 個本來就已經存在，第 6 個「八獵四狼」已加入（`official-12-eight-hunters`，
`roles` = 4 狼 ＋ 8 獵人，`tags` = `["八獵四狼", "12人"]`）。新增時一併修了一個它才會踩到的規則缺口：

### 槍打槍（八個獵人才會遇到的路）

| 情境 | 修之前 | 現在 |
| --- | --- | --- |
| 獵人 A 開槍打死獵人 B | B 的槍被吃掉（不能開） | B 接著開，鏈一路遞到沒人能開 |
| 被自爆帶走的獵人 | 可以開（本來就有處理） | 不變，只是改用同一個判定 `getChainedShooter()` |
| 狼王被帶走 | 不能開 | 不變（狼王槍只能被放逐） |
| 被毒死的獵人 | 不能開 | 不變（查夜史封槍） |

判定集中在 `src/lib/rules/death-skills.ts` 的 `getChainedShooter()`（被打死屬於 `cause: "carried"`，
所以與「被自爆帶走」同一套規則）；AI 與真人兩條開槍流程都接上這條鏈。
鏈每執行一槍就少一個活人，所以一定會收斂（不會無限循環）。

實測（dev server 真實開一局八獵四狼，用 DevConsole 把狼刀指向獵人）：事件紀錄出現連續兩槍——
「4號 戚芳 獵人開槍帶走了 5號 天山童姥」→「5號 天山童姥 獵人開槍帶走了 1號 左冷禪」（1 號是狼），
之後流程正常回到發言階段。

### 這個版型已知的小限制

1. ~~結構化紀錄只存最後一槍~~ → **已修**：欄位改成 `hunterShots` 陣列（單一真相 `rules/hunter-shots`），
   同一晚每一槍都留著；事件紀錄（EventLog）、DevConsole、賽後分析、公開事實、跳轉回放全部逐槍處理。
   槍打槍的鏈因此不再有「紀錄只看得到最後一槍」的問題。
2. **Dev 跳階補全只看第一個獵人**：`SmartJumpManager` 是用 `find((p) => p.role === "Hunter")` 填補獵人開槍，
   多獵人時只會填到第一個。這是開發工具的便利功能，不影響實際對局。

### 後續建議

新角色（B 級）要沿用這條判定而不是另寫一份，也不要再寫 `role === "Hunter"`。

（版型名稱目前走 `tags`（中文），所以英文語系下選單也顯示「八獵四狼」——這是所有既有版型的共同行為，
不是這次新增的；要三語系版型名稱得另外把 `BoardPreset.nameKey` 接上 UI。）

多獵人的槍鏈已在真實對局中實測通過（見上方「槍打槍」小節）。既有版型最多只有 1 個獵人，
所以這條路是這個版型才會走到的。

## 5.5 B 級第一棒：狼美人（已完成）

「狼美人騎士」與「魔鬼騎士」兩個版型共用同一個新角色，是 B 級裡 CP 值最高的第一棒。
2026-09-24 完成，內容如下。

### 已實作

| 項目 | 內容 |
| --- | --- |
| 角色權威表 | `WolfBeauty`（`camp: "wolf"`、`nightAction: "charm"`、不能空過／不能選自己／不能自爆） |
| 新階段 | `NIGHT_WOLF_BEAUTY_ACTION`，順序：守衛 → 禁言 → 攝夢 → **狼人 → 魅惑** → 女巫 → 預言家 |
| 規則模組 | `src/lib/rules/charm.ts`（合法座位、隨機指定、`getCharmedSeat`、`getCharmRevengeSeat`、`applyCharmRevenge`、`getWolfKnifeEligibleSeats`） |
| 夜間結算 | `rules/night-resolution` 的步驟 4：狼美人當晚出局 → 被魅惑者一并出局，死因 `charm` |
| 白天連帶 | 放逐（`useGameLogic.handleVoteComplete`）、自爆帶走（`useGameLogic`）、獵人槍（`useSpecialEvents`）三條路都會帶走被魅惑者 |
| 提示詞 | `prompts.wolfBeauty.{base,task,user}` ×3 語系＋玩法指引 `promptUtils.strategyGuide.wolfBeauty` |
| 真人操作 | `NIGHT_WOLF_BEAUTY_ACTION` 的可選目標、`gameLogicMessages.youCharmed` 對話、存檔／續跑／Dev 跳轉全部接上（跳轉補全的魅惑目標一開始被靜默丟掉，已修，見下）；狼美人是狼陣營，首夜與出刀同樣會走到狼隊分工與出刀確認 |
| 版型 | `official-12-wolf-beauty-knight`＝狼人×3＋狼美人＋預女守騎＋4 民（12 人、4 狼） |

**不能自刀也實作了**：`getWolfKnifeEligibleSeats()` 排除狼美人，UI 可點選、AI 合法座位與狼刀提示詞選項都走這份名單
（其他狼隊友仍可被刀、也可以自刀騙藥，那些規則不變）。

**真人操作補完（實機對局後）**：面板（`DialogArea`）與路由（`page.tsx` 的 `confirmSelectedSeat`）
原本各寫一份夜間階段清單，狼美人只寫進了路由那側，所以真人狼美人**根本按不了確認、階段卡死**；
現在兩邊都讀 `rules/human-input.ts` 的單一清單（`SEAT_ACTION_CONFIRM_PHASES`），並有
`human-input.test.ts` 用狀態機反過來掃描守衛。順手修掉同源的既有缺口：真人攝夢人原本是面板有、路由漏。

另外實機驗證殉情時發現 **DevConsole 跳轉補全的魅惑目標被靜默丟掉**（補全清單有這一題、套用端沒有分支），導致「毒殺狼美人」不會帶走被魅惑者；已補上兩條套用分支（含同類的 `day<N>DreamTarget`）並加一道「清單端每一格，套用端都要有分支」的原始碼掃描守衛。

### 本作自行決定的兩條（來源站沒有明文，已寫進程式註解）

1. **殉情不封死亡技能**：官方只列「被毒／毒奶／被夢帶走」三種封槍，殉情不在其中，所以被魅惑的獵人仍可開槍。
   夜史仍記 `reason: "charm"`；賽後分析的分類與文案（`DeathCause = "charmed"` →「隨狼美人殉情出局」）與三張死因標籤表都已接上——一開始 `parseDeathCause` 沒有 `charm` 分支，掉進 `default` 被寫成「夜晚被刀」，已修。
2. **殉情者不發遺言**：連帶死亡比照一般連帶（夢死同樣不進遺言佇列），只公告不發言。

### 已知限制

- **殉情與守護無關**（魅惑不是狼刀），但**夢游者免疫也不擋殉情**——連帶死亡不是「夜間傷害」，與夢死同一條理由。
- `dayHistory`／`nightHistory` 的 `deaths` 死因欄位只記最後一筆，同晚多重連帶（例如殉情＋毒）時以既有死因為準、不覆蓋。
- 「魔鬼騎士」已於同日補上版型（`official-12-wolf-beauty-hunter-knight`）：與狼美騎士共用狼美人，神職是**獵人**而不是守衛。
- **角色頭像沿用白狼王**（`/roles/white-wolf-king.png`，程式碼註解已標明）：美術沒有狼美人立繪，
  這與先前紀錄的「狼王／禁言長老／攝夢人頭像」是同一批待補美術，不是這次新增的缺口。
- 版型標籤沿用中文（`tags: ["狼美騎士", "12人"]`），英文語系下仍顯示中文——與所有既有版型一致。

### 魔鬼騎士（同日補上版型）

`official-12-wolf-beauty-hunter-knight`＝狼人×3＋狼美人＋預女**獵**騎＋4 民（12 人、4 狼）。

原本目錄與程式碼註解把它寫成「與狼美騎士同一組角色、只差玩家約定」——**那是錯的**：
狼美騎士的神職是**守衛**（<https://werewolves.games/lang-mei-qi-shi/>），魔鬼騎士是**獵人**
（<https://werewolves.games/mo-gui-qi-shi/>）。`boards.test.ts` 因此多一條守衛，把兩張版型的角色
集合釘成「只差 Guard ↔ Hunter 一格」，日後不會再被寫歪（同一輪也修掉程式碼裡那條被放錯位置的
「四狼八獵」註解）。

來源站另外兩件與本作對照：

- **「狼美人被騎士決鬥出局時不發動魅惑」**：兩個來源頁都明講（狼美騎士被放逐才結算殉情）。
  本作**早已實作**：`charm.ts` 的 `triggersCharmRevenge` 就是 `cause !== "duel"`，
  `knight-duel.ts` 的註解也明列狼美人殉情不可發動，`charm.test.ts` 有 3 條斷言。
  這次是逐條查證，沒有改動程式。
- **法官夜間順序把「魅惑」排在狼刀之前**（魅惑 → 守衛／狼刀 → 女巫 → 預言家）：本作的階段順序是
  狼人 → 魅惑。兩者結算等價（魅惑只取決於狼美人自己是否出局，與當晚刀口無關），暫不更動。

## 6. B 級：需要 1–2 個新角色（建議先做這批）

| 版型 | 新角色 | 為什麼值得先做 |
| --- | --- | --- |
| 狼王魔術師 | 魔術師 | 魔術師（`Magician`）：每夜交換兩名玩家的位置，交換後刀口／查驗／毒口全部改判。 |
| 夢魘攝夢 | 夢魘之影 | 夢魘之影（`Nightmare`）：恐懼一名玩家；恐懼到狼人則狼隊當晚無刀（動到夜間結算）。 |
| ~~狼美騎士~~ | ~~狼美人~~ | ✅ 已完成（見 §5.5） |
| 魔鬼騎士 | 狼美人 | ✅ 2026-09-24 完成（`official-12-wolf-beauty-hunter-knight`）。與狼美騎士差在神職：守衛 → 獵人。 |
| 石像鬼守墓人 | 守墓人、石像鬼 | 石像鬼（`Gargoyle`：不進狼窩、查具體身份）＋守墓人（`Gravekeeper`：查被放逐者的身份）。 |
| 機械狼通靈師 | 通靈師、機械狼 | 通靈師（`Medium`：查具體身份）＋機械狼（`MachineWolf`：不進狼窩、可學習身份並繼承技能，動到技能繼承）。 |
| 血月獵魔 | 獵魔人、血月使徒 | 獵魔人（`DemonHunter`：夜間追輪次）＋血月使徒（`BloodMoonApostle`：自爆封印神職技能）。 |
| 覺醒狼王 | 覺醒狼王 | 覺醒狼王（`AwakenedWolfKing`）：兩次狼王爪，可保留雙槍或傳承給狼隊友。 |
| 假面舞會 | 舞者、假面 | 舞者（`Dancer`）＋假面（`Masked`）：身份置換機制（動到身份可見性）。 |

### 6.1 下一個 B 級角色：狼王魔術師（`Magician`）實作清單

來源：<https://werewolves.games/lang-wang-mo-shu-shi/>（2026-09-24 核對）。
版型＝狼人×3＋狼王／**預言家、女巫、獵人、魔術師**＋4 民。

**來源規則（要照抄的部分）**

- 魔術師每晚選**兩名玩家交換**：當晚**指向其中一人的技能結算到另一人身上**。
- 來源明確點名會受影響的是**刀口、毒口、查驗、守護**（「交換會影響刀口、毒口、查驗和死亡公佈對象」）。
- 來源明確排除的是**槍口**：「狼王槍按出局方式與開槍狀態判定……魔術師換位主要影響夜間指向結算」
  → 我們的獵人槍／狼王槍**不套用換位**（這條要寫成測試）。
- 來源的法官順序是「魔術師 → 狼隊 → 女巫 → 預言家」→ 本作插在 `NIGHT_DREAM_ACTION` 之後、
  `NIGHT_WOLF_ACTION` 之前。

**要動的檔案（照狼美人那一輪的順序，一步一個 commit 可以）**

| # | 檔案／項目 | 內容 |
| --- | --- | --- |
| 1 | `src/types/game.ts` + `rules/roles.ts` | `Role` 加 `Magician`；`ROLE_CAPABILITIES`（`camp: "villager"`、`nightAction: "swap"`、不能空過、`canSelfTarget: true`（裁定 3））；`ALL_ROLE_KEYS` 同步（`role-enumeration.test.ts` 會反過來掃） |
| 2 | `src/lib/rules/phases.ts` | 新階段 `NIGHT_MAGICIAN_ACTION`，插在 `NIGHT_DREAM_ACTION` 與 `NIGHT_WOLF_ACTION` 之間（`PHASE_SEQUENCE`、`PHASE_CONFIGS`、`CHECKPOINT_SAFE`／`PHASE_ROLE`／`RESTORE_FALLBACK` 都是 `Record<Phase,…>`，少一格 tsc 就紅） |
| 3 | `src/lib/rules/magician.ts`（新） | 單一真相：`getMagicianSwapOptions(state, magicianSeat)`（存活、不含自己、不重複同一人）、`isValidSwap`、`pickRandomSwap`、`redirectSeat(seat, swap)`。**換位只有這一份對照**，其他模組一律呼叫它 |
| 4 | `src/lib/rules/night-resolution.ts` | `NightResolutionInput` 加 `magicianSwap?: [number, number]` + `magicianSeat?: number`；在讀 `wolfTarget`／`guardTarget`／`witchPoison`／`dreamTarget`／`wolfBeautyTarget` 前先過 `redirectSeat`。**`NightActor` 也要加 `magician`**（回放用） |
| 5 | `src/game/phases/` + `useSpecialEvents.ts` | 新階段模組（AI 決策）＋夜間推進；預言家查驗的結算在 `useSpecialEvents`／`game-master`，**查驗目標也要過 `redirectSeat`**（這是第 4 步之外的漏接熱點） |
| 6 | 真人操作 `rules/human-input.ts` + `DialogArea` + `page.tsx` | 交換要點**兩張卡**（不是一張）→ `SEAT_ACTION_CONFIRM_PHASES` 這種「單一選座位」的清單**裝不下**：要新增「兩段式選取」的判定，並讓 `human-input.test.ts` 的狀態機守衛涵蓋它（狼美人那次就是面板與路由各寫一份清單而卡死） |
| 7 | 提示詞與文案 | `prompts.magician.{base,task,user}` ×3 語系＋`promptUtils.strategyGuide.magician`＋`dialog.action.swap`（＝「交換」）＋死亡公告不提及交換（見下方裁定 3） |
| 8 | 紀錄與賽後 | 夜史 `nightHistory[day].magicianSwap`；`DevConsole`「全場動作資訊記錄」＋跳轉補全（`SmartJumpManager` 的 `field:` 與**套用分支兩邊都要有**，`day<N>MagicianSwap` 也是——這是被靜默丟掉兩次的同一類坑）；賽後分析要能解釋「誰被換到哪」 |
| 9 | 版型 | `official-12-wolf-king-magician`（狼王魔術師，`tags: ["狼王魔術師", "12人"]`）＋`boards.test.ts` 釘角色組成 |

**已經裁定的 5 件事（2026-09-24 使用者拍板）**

1. **守護一起換位**：照來源——守衛守的人被換走時，守護也改判到換到的對象。
2. **槍口不換位**：獵人槍／狼王槍是**白天**才開，夜間換位不影響；寫成一條測試釘住。
3. **可以換自己**：魔術師可以是兩名被交換者之一（`canSelfTarget: true`）；
   但 `(X, X)` 同一人仍然不合法、兩人必須都是存活玩家。
4. **允許重複被換**：不採來源的「通常整局只能換一次」，程式註解與文件都要寫明這是本作選擇。
5. **交換不公告**：遊戲中不公告，只寫進 `nightHistory[day].magicianSwap` 供賽後分析與 DevTools 使用。

**目前進度（2026-09-24）**

| 步驟 | 狀態 |
| --- | --- |
| 1 角色權威表（`Role`／`ROLE_CAPABILITIES`／`ALL_ROLE_KEYS`）＋六張 UI 名稱與圖示表＋`game-constants`／`prompt-utils`／`PlayerDetailModal`／`RoleRevealOverlay` 的角色列舉＋i18n 三語系（`roles`／`roleReveal`／`promptUtils.roleText`／設定偏好說明） | ✅ 完成 |
| 3 `rules/magician.ts`（合法組合、隨機選擇、`redirectSeat`、`getMagicianSwap`） | ✅ 完成（測試待補） |
| 2 階段 `NIGHT_MAGICIAN_ACTION` | ✅ 完成（17 處 `Record<Phase,…>` ＋ 12 條釘子測試同步，`tsc` 逼出來的） |
| 4 `night-resolution` 的換位套用 | ✅ 完成（夜間指向全過 `redirectSeat`；預言家查驗在 AI／真人兩條路徑各改判一次；槍口刻意不碰） |
| 5 AI 決策 `runMagicianAction`／`generateMagicianSwap` | ✅ 完成（回應格式 `{"seats":[a,b],"reason":…}`；不合法就 `pickRandomSwap`，不靜默少做） |
| 6 真人兩段式選取（面板與路由） | ⬜ 待做（**下一步**：`requiresHumanInput` 目前仍是 `() => false`） |
| 7 `prompts.magician.*` 與玩法指引 | ✅ 完成（三語系 `prompts.magician`＋`strategyGuide.magician`＋`ui/system` 文案＋旁白鍵） |
| 8 夜史、DevConsole、跳轉補全、賽後分析 | ⬜ 待做 |
| 9 版型 `official-12-wolf-king-magician` | ⬜ 待做 |

**第二輪（階段層＋AI 決策＋換位結算）的補充**

- AI 的回應契約是**一對座位** `{"seats":[a,b],"reason":…}`（`generateMagicianSwap`），
  不能沿用單一座位的 `seatSelectionResponseFormat`，所以另寫了 `swapResponseFormat`；
  schema 只擋「不在名單裡」，真正的把關仍在 `isValidSwap`（單一真相）。
- `night-resume-flow.test.ts` 的板子補上魔術師之後，那條「重跑指令要真的執行那一步的行動」
  對魔術師改成斷言**一對座位且包含 AI 給的那一席**（其他角色仍是單一座位）。
- 續跑鏈：`continueNightAfterMagician` 現在會先跑 `runMagicianAction`（真人則停在等待），
  再往下接狼人——與 `continueNightAfterDream` 同一個形狀。

**階段層為什麼收回**：加 `NIGHT_MAGICIAN_ACTION` 時 `tsc` 會逼出 17 處 `Record<Phase, …>`
（`PHASE_KIND`／`PHASE_SEQUENCE`／`NIGHT_ACTION_ORDER`／`ACTION_PHASES`／`PROMPT_NEEDS_PUBLIC_EVIDENCE`／
`CHECKPOINT_SAFE`／`RESTORE_FALLBACK`／`NIGHT_STEP`／`VALID_TRANSITIONS`／`PHASE_CONFIGS`／階段圖示／
動作名稱／`NightPhase` 續跑鏈／兩個 night-resume 測試 fixture），另外有 13 條「釘子測試」
（階段順序、PhaseManager 提示詞實作數、證據矩陣覆蓋、存檔／續跑 fixture…）要同步更新。
其中 **`night-resume-flow.test.ts` 的「重跑指令要真的執行那一步的行動」必須等 AI 決策實作才會過**，
所以階段層與 AI 決策應該**同一輪一起做**，不要分兩次改測試。這一輪先把角色層與規則模組做進去、
把階段層原樣收回，維持全綠（角色沒有任何版型收錄，狀態是惰性的）。

**測試清單（照狼美人那輪的教訓）**

- `magician.test.ts`：合法座位、`redirectSeat` 對稱性（換兩次＝還原）、`(X,X)` 不合法。
- `night-resolution` 加測：刀口被換 → 死的是被換到的座位；毒口被換；守護被換；**夢遊者免疫與殉情連帶都跟著換位後的目標**。
- **槍不換位**：換位後獵人／狼王槍仍指向原始目標。
- `human-input.test.ts`：狀態機掃到 `NIGHT_MAGICIAN_ACTION` 時，面板與路由都要接得住（兩段式選取）。
- `SmartJumpManager.test.ts`：補全清單每一格都有套用分支的原始碼掃描要能涵蓋 `magicianSwap`。
- `boards.test.ts`：新版的角色組成（狼人×3＋狼王／預女獵魔＋4 民）。

## 7. C 級：動到共用機制或一次多角色

- **預女獵白混**（混血兒）：混血兒（`HalfBlood`）：選榜樣並跟隨其陣營 → 動到陣營判定與勝負條件。
- **陰陽師**（陰陽師、小精靈、惡靈騎士）：陰陽師（`Onmyoji`）＋小精靈（附身：`Sprite`）＋惡靈騎士（催眠：當晚無刀、神牌技能無效）。
- **幽靈狼**（道士、幽靈狼）：道士（結印：`Taoist`）＋幽靈狼（一次性換位＋靈魂鎖鏈：`GhostWolf`）→ 換位＋連帶死亡。
- **忍法帖**（忍者）：忍者（`Ninja`）：認主後繼承主人技能或勝利條件 → 動態身份／陣營。
- **賭鬼天師**（天師、賭鬼）：天師（每晚換位：`CelestialMaster`）＋賭鬼（知道三小狼、猜出局號碼單雙換額外刀權：`Gambler`）。
- **暗黑破壞**（凱恩、天使長、莉莉絲、莉婭）：凱恩＋天使長（復活）＋莉莉絲（禁錮）＋莉婭（迷霧）→ 復活／迷霧／禁錮三套新機制。
- **黑夜傳說**（魔術師、神父、夜魘、吸血鬼）：魔術師＋神父（聖光：`Priest`）＋夜魘（追加夜晚行動：`NightTerror`）＋吸血鬼（雙命：`Vampire`）→ 追加夜晚＋雙命。
- **丘比特**（愚者、丘比特、盜賊）：丘比特（連結情侶：`Cupid`）＋愚者（`Fool`）＋盜賊（選牌：`Thief`）→ 第三方陣營，勝負條件要重寫。
- **狐妖祭司**（祭司、狐妖）：大祭司（天譴：`HighPriest`）＋狐妖（詛咒：`FoxSpirit`）→ 方向性連鎖死亡。
- **血魔狂舞**（驅魔師、血魔）：驅魔師（連續號碼驅散：`Exorcist`）＋血魔（割裂→延遲死亡：`BloodDemon`）。
- **IMBA**（BT預言家、BT女巫、BT守衛、BT獵魔人、混沌領主、美杜莎、狼妃）：BT 系列四角色（雙驗／雙毒／雙守／雙獵）＋混沌領主（混沌風暴）＋美杜莎（石化）＋狼妃 → 高變體規則集合。

## 8. 其他要一起決定的事

1. **夜間順序**：來源站是「狼人 → 女巫 → 預言家 →（白痴確認）→（獵人狀態）」，本作是「守衛 → 禁言 → 攝夢 → 狼人 → 女巫 → 預言家」。
   兩種都是常見約定。建議**沿用本作既有順序**，新角色找位置插進去，不要為了對齊來源站改動現行版型的行為。
2. **勝負條件**：來源站一律「屠邊」；本作已有自己的勝負判定。C 級裡涉及第三方（丘比特、混血兒）的必須先決定第三方怎麼贏。
3. **角色名稱三語系**：每個新角色要 zh-CN／zh-TW／en 三份名稱＋技能說明＋AI 提示詞，這部分不能只做中文。
4. **肖像與立繪**：新角色需要 UI 頭像／夜間行動立繪（既有 `Avatar`／角色卡系統）。
5. **AI 玩法指引**：每個新角色都要寫「該怎麼玩」的提示詞（本作既有 12 個角色都有），否則 AI 會亂用技能。

## 9. 建議的下一步

1. ✅ **已完成**：加「八獵四狼」＋驗證多獵人的槍鏈（見第 5 節）。
2. 再挑 **B 級 2–3 個**做一輪（例如狼王魔術師、夢魘攝夢、狼美騎士），每個角色一個 commit，做完一輪再決定要不要繼續。
3. **C 級另外立項**：第三方陣營要先擴充 `RoleCamp`，那是動到勝負判定的改動，值得單獨規劃。

---

## 附錄：來源站網址對照（要重新核對時用）

- 預女獵白：<https://werewolves.games/yu-nv-lie-bai/>
- 預女獵禁：<https://werewolves.games/yu-nv-lie-jin/>
- 預女獵白混：<https://werewolves.games/yu-nv-lie-bai-hun/>
- 狼王守衛：<https://werewolves.games/lang-wang-shou-wei/>
- 狼王攝夢人：<https://werewolves.games/lang-wang-she-meng-ren/>
- 狼王魔術師：<https://werewolves.games/lang-wang-mo-shu-shi/>
- 夢魘攝夢：<https://werewolves.games/meng-yan-she-meng/>
- 白狼王騎士：<https://werewolves.games/bai-lang-wang-qi-shi/>
- 狼美騎士：<https://werewolves.games/lang-mei-qi-shi/>
- 魔鬼騎士：<https://werewolves.games/mo-gui-qi-shi/>
- 石像鬼守墓人：<https://werewolves.games/shi-xiang-gui-shou-mu-ren/>
- 陰陽師：<https://werewolves.games/yin-yang-shi/>
- 幽靈狼：<https://werewolves.games/you-ling-lang/>
- 忍法帖：<https://werewolves.games/ren-fa-tie/>
- 機械狼通靈師：<https://werewolves.games/ji-xie-lang/>
- 賭鬼天師：<https://werewolves.games/du-gui-tian-shi/>
- 暗黑破壞：<https://werewolves.games/an-hei-po-huai/>
- 血月獵魔：<https://werewolves.games/xue-yue-lie-mo/>
- 黑夜傳說：<https://werewolves.games/hei-ye-chuan-shuo/>
- 丘比特：<https://werewolves.games/qiu-bi-te/>
- 覺醒狼王：<https://werewolves.games/jue-xing-lang-wang/>
- 假面舞會：<https://werewolves.games/jia-mian-wu-hui/>
- 四狼八獵：<https://werewolves.games/si-lang-ba-lie/>
- 狐妖祭司：<https://werewolves.games/hu-yao-ji-si/>
- 血魔狂舞：<https://werewolves.games/xie-mo-kuang-wu/>
- IMBA：<https://werewolves.games/imba/>

重新核對的方式：抓上列頁面的「陣容配置」兩行，角色數量加總必須等於 12。

