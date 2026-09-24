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
| 10 | 魔鬼騎士 | 預言家、女巫、獵人、騎士、平民×4 | 狼人×3、狼美人 | 需新增角色 | B | 狼美人 | 與狼美騎士同一組角色，差異只在玩家約定（騎士不決鬥對跳預言家）→ 可與狼美騎士一起做。 |
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

### 這個版型已知的兩個小限制

1. **結構化紀錄只存最後一槍**：`dayHistory/nightHistory[day].hunterShot` 是單一物件，
   一個夜晚/白天開多槍（鏈）時只會留最後一槍——事件紀錄面板（EventLog）的多槍當天因此只顯示一槍。
   對話裡的系統訊息（主持人公告）每一槍都在，玩家實際看得到完整過程。要完整化得把該欄位改成陣列，
   連帶要改 EventLog 與 DevConsole，屬於另一個改動。
2. **Dev 跳階補全只看第一個獵人**：`SmartJumpManager` 是用 `find((p) => p.role === "Hunter")` 填補獵人開槍，
   多獵人時只會填到第一個。這是開發工具的便利功能，不影響實際對局。

### 後續建議

新角色（B 級）要沿用這條判定而不是另寫一份，也不要再寫 `role === "Hunter"`。

（版型名稱目前走 `tags`（中文），所以英文語系下選單也顯示「八獵四狼」——這是所有既有版型的共同行為，
不是這次新增的；要三語系版型名稱得另外把 `BoardPreset.nameKey` 接上 UI。）

多獵人的槍鏈已在真實對局中實測通過（見上方「槍打槍」小節）。既有版型最多只有 1 個獵人，
所以這條路是這個版型才會走到的。

## 5.5 B 級第一棒：狼美人（實作清單，尚未動工）

「狼美人騎士」與「魔鬼騎士」兩個版型共用同一個新角色，是 B 級裡 CP 值最高的第一棒。
下面是 2026-09-24 實際盤點出來的完整清單（跑 `pnpm exec tsc --noEmit` 會把 1–7 全部列出來）。

### 規則（來源頁已核對，勿憑印象）

- 狼美人**參與狼隊刀人**（她是狼隊成員），刀人之後**單獨魅惑**一名玩家；每晚固定魅惑一人，不能空過、不能魅惑自己。
- 狼美人**出局時**，被魅惑者隨之殉情出局——放逐、被毒、夜死都算。
- **被騎士決鬥出局不發動魅惑**（也不翻牌）。
- 魅惑**不是普通狼刀**：不受守衛守護影響（來源站 FAQ 明列）。
- 狼美人**不能自爆、不能被狼隊自刀**。
- 法官順序（來源站）：魅惑 → 守衛 → 狼隊 → 女巫 → 預言家。本作建議沿用既有順序，把魅惑放在狼人之後、女巫之前（魅惑不影響夜間結算，位置只影響體驗）。

### 1. 型別（2 個檔）

- `src/types/game.ts`：`Role` 加 `"WolfBeauty"`、`Phase` 加 `"NIGHT_WOLF_BEAUTY_ACTION"`、
  `isWolfRole()` 加它、`nightActions` 加 `wolfBeautyTarget?`／`wolfBeautyReason?`、
  `nightHistory[day]` 加 `wolfBeautyTarget?`、`deaths[].reason` 加 `"charm"`。

### 2. 角色能力與階段權威表（4 個檔）

- `src/lib/rules/roles.ts`：`NightActionKind` 加 `"charm"`；`ROLE_CAPABILITIES.WolfBeauty`
  （`camp: "wolf"`、`canAbstain: false`、`canSelfTarget: false`、`canBoom: false`）。
- `src/lib/rules/boards.ts`：`ALL_ROLE_KEYS` 加它。
- `src/lib/rules/phases.ts`：`PHASE_KIND`、`PHASE_SEQUENCE`、`NIGHT_ACTION_ORDER`、`ACTION_PHASES`、
  `PROMPT_NEEDS_PUBLIC_EVIDENCE`。
- `src/lib/rules/night-progress.ts`：`NIGHT_STEP` 加一步（actor＝role WolfBeauty）＋ `wolfBeautyDecided` 謂詞
  （含「沒有合法目標可選」的退化情況，與禁言／攝夢同一條規則）。

### 3. 存檔與續跑（3 個檔）

- `src/lib/rules/checkpoints.ts`：`CHECKPOINT_SAFE`（`wolfBeautyDecided`）＋ `RESTORE_FALLBACK`（退回狼人／攝夢／守衛）。
- `src/game/phases/night-resume.ts`：`NightResumeCommand` 加 `CONTINUE_NIGHT_AFTER_WOLF_BEAUTY`、
  `ADVANCE_PLAN`、`REPLAY_COMMAND`（重播要從 `START_NIGHT` 重跑）。
- `src/store/game-machine.ts`：`VALID_TRANSITIONS`（狼人 → 魅惑 → 女巫）＋ `PHASE_CONFIGS` 一筆。

### 4. UI 對照表（8 個檔，全部是機械補齊）

`src/app/page.tsx`（`PHASE_ICON`）、`src/components/game/DialogArea.tsx`（`PHASE_ROLE`）、
`GameSetupModal`、`PlayerCardCompact`、`RoleRevealHistoryCard`（`ROLE_META`＋標籤）、
`TutorialOverlay`、`WelcomeScreen`（標籤＋數量）、`useTutorial`、
`src/components/analysis/constants.ts`（三張表）、`src/lib/game-analysis.ts`（陣營）、
`src/components/DevTools/DevConsole.tsx`（死因標籤加 `charm`）。

### 5. i18n（3 語系各 9 組；zh-TW 用專案的 OpenCC 從 zh-CN 轉）

`roles.wolfBeauty`、`gameSetup.rolePreference.desc.wolfBeauty`、
`roleReveal.roles.wolfBeauty.{title,subtitle}`、`roleReveal.nextStep.wolfBeauty`、
`phase.nightWolfBeauty.{description,human}`、`ui.wolfBeautyActing`／`ui.waitingWolfBeauty`、
`tutorialOverlay.roles.WolfBeauty.{desc,points,action,tips}`、
`devConsole.phases.NIGHT_WOLF_BEAUTY_ACTION`、`devConsole.deathReason.charm`、
`promptUtils.roleText.wolfBeauty`、`promptUtils.strategyGuide.wolfBeauty`（AI 玩法指引，必寫）、
`prompts.wolfBeauty.{base,task,user}`（夜間技能提示詞）。

### 6. 行為層（核心，4 個檔）

- `src/lib/rules/charm.ts`（新檔，照 `dream.ts` 的形狀）：
  `getWolfBeautyEligibleSeats`、`isValidWolfBeautyTarget`、`pickRandomWolfBeautyTarget`、
  `getCharmedSeat`、`triggersCharmRevenge`（決鬥不算）、`getCharmRevengeSeat(state, deadSeat, cause)`。
- `src/game/phases/NightPhase.ts`：`buildWolfBeautyPrompt`、`runWolfBeautyAction`、
  `continueNightAfterWolfBeauty`（＝跑女巫），並把魅惑插進 `continueNightAfterWolf` 與 `handleAction` 分派；
  `getPrompt` 的 switch 要加 case（現在的 `default` 會讓狼美人拿到狼人提示詞）。
- `src/lib/game-master.ts`：`generateWolfBeautyAction`（照 `generateDreamAction` 抄，換 prompt 階段與 log type）。
- `src/hooks/useGameLogic.ts`：真人狼美人的分支（照 `NIGHT_DREAM_ACTION` 那一段），
  寫入 `nightActions.wolfBeautyTarget` 後走 `continueNightAfterHumanAction`。

### 7. 殉情結算（要接三條死亡路徑，最容易漏）

- `src/lib/rules/night-resolution.ts`：夜間死亡名單出爐後，若狼美人當晚出局 → 把她魅惑的座位也推進死亡名單
  （reason `"charm"`）。注意「魅惑不吃守護」，所以不要走狼刀那條判定。
- 白天放逐：`VotePhase`／`useGameLogic` 的放逐死亡套用它（`cause: "exile"`）。
- 被帶走（白狼王自爆）：`useGameLogic` 的 `continueAfterSettle` 套用它（`cause: "carried"`）。
- 騎士決鬥：**不要**接（`triggersCharmRevenge` 已回 false）。
- `death-skills.canUseDeathShot`：殉情屬於「被技能帶走」，要不要封槍是我們的選擇——
  建議比照夢死封槍並在文件寫明（來源站沒有規定）。

### 8. 版型與文件（最後才做）

`boards.ts` 加 `official-12-wolf-beauty-knight`（3 狼＋狼美人＋預女守騎＋4 民）；
「魔鬼騎士」與它角色相同，差別只是玩家約定，可直接沿用同一組角色再開一個版型。
**版型一定要等第 6、7 項完成才加**，否則會出現「可以選但規則不完整」的版型。

## 6. B 級：需要 1–2 個新角色（建議先做這批）

| 版型 | 新角色 | 為什麼值得先做 |
| --- | --- | --- |
| 狼王魔術師 | 魔術師 | 魔術師（`Magician`）：每夜交換兩名玩家的位置，交換後刀口／查驗／毒口全部改判。 |
| 夢魘攝夢 | 夢魘之影 | 夢魘之影（`Nightmare`）：恐懼一名玩家；恐懼到狼人則狼隊當晚無刀（動到夜間結算）。 |
| 狼美騎士 | 狼美人 | 狼美人（`WolfBeauty`）：每夜魅惑一名玩家，自己被出局時被魅惑者一起出局（動到死亡結算）。 |
| 魔鬼騎士 | 狼美人 | 與狼美騎士同一組角色，差異只在玩家約定（騎士不決鬥對跳預言家）→ 可與狼美騎士一起做。 |
| 石像鬼守墓人 | 守墓人、石像鬼 | 石像鬼（`Gargoyle`：不進狼窩、查具體身份）＋守墓人（`Gravekeeper`：查被放逐者的身份）。 |
| 機械狼通靈師 | 通靈師、機械狼 | 通靈師（`Medium`：查具體身份）＋機械狼（`MachineWolf`：不進狼窩、可學習身份並繼承技能，動到技能繼承）。 |
| 血月獵魔 | 獵魔人、血月使徒 | 獵魔人（`DemonHunter`：夜間追輪次）＋血月使徒（`BloodMoonApostle`：自爆封印神職技能）。 |
| 覺醒狼王 | 覺醒狼王 | 覺醒狼王（`AwakenedWolfKing`）：兩次狼王爪，可保留雙槍或傳承給狼隊友。 |
| 假面舞會 | 舞者、假面 | 舞者（`Dancer`）＋假面（`Masked`）：身份置換機制（動到身份可見性）。 |

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

