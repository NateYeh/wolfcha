# 角色立繪：生圖提示詞（待補的 7 張）

`public/roles/` 目前只有 7 張圖（`werewolf`／`white-wolf-king`／`seer`／`witch`／`hunter`／`guard`／`idiot`），
其餘角色在 `DialogArea.ROLE_PORTRAIT_MAP` 與 `analysis/constants.ROLE_ICONS` 裡**沿用最接近的一張**
（型別是 `Record<Role, string>`，所以不會靜默缺圖，但看起來就是同一張臉）。

| 角色 | 目前沿用 | 應補檔名 |
| --- | --- | --- |
| 村民 Villager | `guard.png` | `public/roles/villager.png` |
| 騎士 Knight | `guard.png` | `public/roles/knight.png` |
| 禁言長老 MuteElder | `guard.png` | `public/roles/mute-elder.png` |
| 狼王 WolfKing | `white-wolf-king.png`（白狼王） | `public/roles/wolf-king.png` |
| 攝夢人 Dreamweaver | `guard.png` | `public/roles/dreamweaver.png` |
| 魔術師 Magician | `guard.png` | `public/roles/magician.png` |
| 狼美人 WolfBeauty | `white-wolf-king.png`（白狼王） | `public/roles/wolf-beauty.png` |

## 1. 規格（硬要求）

- **1024×1024、PNG、背景透明**（現有 7 張都是 `1024×1024` + alpha，四角 `rgba(0,0,0,0)`）。
- **純黑白線稿**：黑線在透明底上，**沒有顏色、沒有灰階、沒有漸層**；立體感只靠
  排線（parallel hatching）與少量實心黑（鼻子、瞳孔、口袋底）。
- **半身（腰以上）、置中、四分之三側臉**；頭在上半部偏中，肩膀幾乎撐滿寬度，
  身體被畫布下緣裁掉（現有圖就是這樣）。四周留白、無外框、無地面陰影、無文字。
- 顯示端：`DialogArea` 夜間行動立繪最大寬 `300px`、`object-contain`，背後有一圈
  `bottom-[20%]` 的徑向光暈；比例不一致會很明顯，**同一批要一起生、構圖要一致**。

## 2. 共用風格提示詞（每張都貼同一段）

```text
Black-and-white ink line art character portrait, bold hand-drawn comic/manga ink illustration:
thick confident black outlines with strong line-weight variation, large solid black shadow shapes
(pocket flaps, under the jaw, inside cloth folds), only a few sparse parallel hatch marks elsewhere,
high-contrast screen-print look, no pencil-like light shading, pure black lines on a plain flat white
background, no color, no greyscale, no gradients, no screentone texture.

Anthropomorphic animal character, waist-up bust, three-quarter view, head in the upper-centre of a
square canvas, shoulders spanning the full width, torso cut off by the bottom edge, generous empty
margin, no frame, no border, no background scenery, no cast shadow, no text, no signature, no watermark.

Same character-design language as the rest of the cast: plaid shirts, denim vests, knitted or leather
armour, hooded robes, leather jackets — a modern-folk village-fantasy world, slightly gritty but friendly.
Single character only.
```

## 3. 負向提示詞（共用）

```text
color, colored, greyscale painting, soft shading, watercolour, screentone, crosshatch-heavy shading,
3D render, photorealistic, oil painting, blurry, low contrast, glowing effects, sparkles, text, letters,
logo, signature, watermark, frame, border, background scenery, multiple characters, full body, cropped head,
chibi proportions, extra limbs, deformed hands, weapon in both hands
```

## 4. 逐角色提示詞

> 物種只是建議（好辨識、和現有角色不撞臉）；要換動物就把 `Species` 那句換掉，
> 其餘道具與表情照留，那是「一眼看出職業」的關鍵。

### 4.1 村民 `villager.png`

```text
Character: an ordinary village farmer, no powers and no armour.
Species: anthropomorphic rabbit, long ears, one ear flopped forward through a hole in his hat, buck teeth.
Wearing: patched linen shirt with rolled-up sleeves, rope belt, a straw hat pushed back on the head.
Holding: a hoe resting over one shoulder.
Expression: plain honest face, slightly worried, ears half-dropped, eyebrows raised.
```

### 4.2 騎士 `knight.png`

```text
Character: a daylight duelling knight who stakes his own life on the challenge.
Species: anthropomorphic stag, antlers.
Wearing: steel plate armour with a dented pauldron and visible rivets, tattered cape, gauntlets,
antlers poking out of an open helm.
Holding: a longsword held point-down in front of his chest, both hands resting on the pommel.
Expression: stern and unwavering, brows lowered, chin lifted, mouth a flat line.
```

（刻意不拿盾、不拿長槍：那是 `guard.png` 的剪影，要一眼分得開。）

### 4.3 禁言長老 `mute-elder.png`

```text
Character: an elder who silences one player every night.
Species: old ram, thick curled horns, long pointed beard, drooping ears.
Wearing: long hooded robe with a woven shawl and a small bell at the collar, hood down.
Holding: one raised index finger pressed to his lips in a shush gesture; the other hand grips a tall
wooden staff with a small bell hanging from it.
Expression: narrow stern eyes, mouth closed, unimpressed.
```

（「食指貼唇」就是這個角色的可讀剪影，一定要畫出來。）

### 4.4 狼王 `wolf-king.png`

```text
Character: the alpha wolf of the pack — older, bigger and heavier than the other wolves.
Species: huge grey wolf, thick neck, broad chest, notched ear, scar over one eye.
Wearing: plain torn tunic and a heavy fur mantle, a crude iron band-crown with a single dark gem.
Pose: shoulders squared, one hand clenched into a fist at chest height, baring his fangs mid-snarl.
Expression: commanding, contemptuous, one eye narrowed.
```

（和 `white-wolf-king.png`（皮衣、冷笑）要分得出：**鐵冠 + 更壯更舊**是識別點。）

### 4.5 攝夢人 `dreamweaver.png`

```text
Character: the one who decides who dreams tonight.
Species: tapir with a long snout and small round ears (Baku, the dream-eater).
Wearing: long hooded night-robe with crescent-moon and star embroidery, loose sash.
Holding: one hand raises a hoop dreamcatcher with dangling feathers; the other holds a small round
lantern with a thin curl of smoke rising from it.
Expression: half-closed sleepy eyes, gentle drowsy smile, head tilted to one side.
```

（夢幻感只靠「捕夢網 + 一縷煙 + 愛睏的臉」，不要發光特效。）

### 4.6 魔術師 `magician.png`

```text
Character: a stage magician who swaps two players every night.
Species: fox, sly grin, bushy tail visible past one shoulder.
Wearing: formal tailcoat with a waistcoat, bow tie, white gloves, a top hat with a band.
Holding: two playing cards held crossed in an X in front of his chest; three small cards fan out
in mid-air beside him.
Expression: confident sly grin, one eyebrow raised, chin turned slightly aside.
```

（和熊女巫要分開：**禮帽 + 燕尾服 + 撲克牌**，沒有藥瓶、沒有長袍。）

### 4.7 狼美人 `wolf-beauty.png`

```text
Character: the wolf pack's charmer — whoever she charms dies with her.
Species: elegant female wolf, sleek long mane, long eyelashes, narrow muzzle — same pack as the brothers.
Wearing: long fur-collared coat over a slit dress, a choker with a small heart pendant, a rose tucked
behind one ear, a ribbon of thread wound around one wrist.
Pose: one hand raised near her lips blowing a kiss, thread trailing from her fingertip.
Expression: sultry half-lidded smile, chin lowered, looking straight at the viewer.
```

（必須看得出是「同一個狼族的女版」但走華麗路線，不是盔甲、不是皮衣。）

## 5. 三種產圖流程（文字／單欄／參考圖）

速查：**正向與負向不要串在一起**。

| 工具 | 怎麼貼 |
| --- | --- |
| SD／Flux（ComfyUI、Forge、Fooocus…） | **正向欄**＝§2＋§4 的角色段；**負向欄**＝§3 那串 |
| gpt-image-1／Nano Banana／Seedream／即夢（指令型，單欄） | 只貼**肯定句版**（見 B），負向清單整串丟掉 |
| Midjourney | 一行到底，結尾 `--ar 1:1 --style raw --no color, text, watermark` |

**A. 純文字（最省事）**：共用風格段 + 該角色的段落 + 負向詞，一次生一張，同一輪把 7 張生完
（模型換輪次會飄風格）。

**B. 單欄（指令型模型：gpt-image-1、Nano Banana／Gemini、Seedream、即夢）**：這些模型沒有負向欄，
**不要把 §3 的負向清單貼進去**（指令型模型會照著把 `color`／`text` 畫出來）。改成三件事：

1. 把硬要求寫成**肯定句**：「pure black ink lines on a plain flat white background, exactly one
   character, square 1:1 canvas, generous empty margin, plain empty background」。
2. 整串負向詞拿掉，只留「空白背景／乾淨留白」這類正向描述去排掉背景雜物。
3. 尺寸交給參數：gpt-image API 帶 `size: "1024x1024"`、`background: "transparent"`。

以村民為例（其餘角色同格式：第 1 段硬要求 → 第 2 段構圖 → 第 3 段角色）：

```text
Hand-drawn black-and-white ink line art character portrait, bold comic/manga ink illustration:
thick confident black outlines with strong line-weight variation, large solid black shadow shapes,
only a few sparse parallel hatch marks elsewhere, high-contrast screen-print look. Pure black lines
on a plain flat white background, exactly one character, on a square 1:1 canvas.

Anthropomorphic rabbit village farmer, waist-up bust, three-quarter view, head in the upper-centre,
shoulders spanning the full width, torso cut off by the bottom edge, generous empty margin around the
character, plain empty background.

Long ears, one ear flopped forward through a hole in his straw hat, buck teeth. Patched linen shirt
with rolled-up sleeves, rope belt, straw hat pushed back on the head. A hoe rests over one shoulder.
Plain honest face, slightly worried, ears half-dropped, eyebrows raised. Modern-folk village-fantasy
world, slightly gritty but friendly, matching a cast of anthropomorphic animals in plaid shirts,
denim vests and hooded robes.
```

**C. 參考圖（風格最穩，建議）**：如果你的工具吃參考圖（nano-banana／gpt-image 的 edit／
Flux Kontext／Seedream 都吃），就把 `public/roles/guard.png`（或 `werewolf.png`）當**純風格參考**附上：

```text
Keep the attached image's exact ink technique, line weight, framing and pure black-and-white
style (style reference only, do not copy the character). Draw a completely different character:
<該角色的段落>
```

參考強度抓 0.4–0.6（太高會直接畫成原本那隻熊），並同樣附負向詞。

## 6. 生完之後（我這邊接）

1. **後處理**（腳本：`/tmp/role_art_fill.py`，步驟如下）：
   - 原圖是「白底黑線」→ **RGB 完全不動**（黑線仍黑、紙面仍白），只做去背：以亮度 >200
     取紙面遮罩，再用 `cv2.connectedComponents` 找出「與畫布邊界相連的紙面」＝外部背景，
     **只把外部背景設為透明**。人物內部與所有線條保持不透明 → 白色實心人體＋黑線。
   - **不要**用「alpha＝255−亮度」把整張變線稿：那會讓人體內部也透明，暗色底會從身體透出來
     （實測 `mute-elder`／`knight` 一開始就是這樣，看起來像空心線稿，使用者回報「圖沒正確載入」）。
   - 依人物外框（alpha>0）縮放並置中：**高度 0.905×畫布、頂端 0.092×畫布**，輸出 1024×1024 RGBA。
   - 生的時候**留白就好**（不要自己置中或裁切），統一由這邊處理。
   - 踩過的坑：`PIL.ImageDraw.floodfill(..., thresh=0)` 的語意不是「填充同色連通區域」，
     實測完全不會填；改用 OpenCV 連通元件（或自寫 BFS）。
2. **驗收**：`src/lib/rules/role-art.test.ts` 的像素守門會自動檢查——亮墨（亮度 ≥200）佔
   不透明像素 ≥20%、不透明佔比 ≥5%、高度 ≥50% 畫布、四角必須透明。這條抓的是
   「整張黑墨」（亮墨 0%）與「整張不透明底」這兩類壞圖。
3. **接線**：改 `src/lib/rules/role-art.ts` 的 `ROLE_PORTRAIT_MAP`（單一真相，對話框與
   賽後分析都 import 它）；新角色要從 `ROLES_REUSING_PORTRAIT` 移除，否則測試會紅。
4. **夜間立繪**：同檔案的 `PHASE_ROLE_PORTRAIT`（階段→立繪）與 `ROLE_PORTRAIT_GLOW`
   （光暈配色）也要一起補——有真人夜間面板卻沒立繪、或夜間舞台上沒配色的角色，
   `role-art.test.ts` 會直接點名。
5. **選擇性**：暗色主題下若黑線對比不足，可加一層淺色卡片底或 `invert`。

把原始檔（白底即可）丟到 `temp/role-art/` 我就接手，或直接告訴我生成器是哪一個，我照它的習慣再調提示詞。

## 7. ChatGPT 直接複製版（7 段，單欄肯定句）

ChatGPT 生圖是**單欄**且會照著字面畫，所以這一節把 §2／§3／§4 合成「一段一段可直接貼」的版本：
沒有負向清單，硬要求全部寫成肯定句。**一段訊息生一張，同一輪把 7 張生完**（換聊天室會飄風格）。

**實測（用 `chatgpt.com` 生村民那張）**：純文字生出來的線條偏細、偏鉛筆草稿感，
與現有 7 張的「重墨、實心黑塊」有落差 → 共用風格段已改成
`thick confident black outlines … large solid black shadow shapes … high-contrast screen-print look`，
並且**建議附一張現有立繪當風格參考**（見 §5.C；ChatGPT 吃附件，比純文字準得多）。

生出來多半是白底非透明——**留白就好，不要自己裁切或置中**，去背與比例統一由程式端處理。

### 7.1 村民 → `villager.png`

```text
Hand-drawn black-and-white ink line art character portrait, bold comic/manga ink illustration:
thick confident black outlines with strong line-weight variation, large solid black shadow shapes
(pocket flaps, under the jaw, inside cloth folds), only a few sparse parallel hatch marks elsewhere,
high-contrast screen-print look. Pure black lines on a plain flat white background, exactly one
character, on a square 1:1 canvas, generous empty margin, plain empty background.

Anthropomorphic rabbit, waist-up bust, three-quarter view, head in the upper-centre, shoulders
spanning the full width, torso cut off by the bottom edge.

An ordinary village farmer with no armour and no weapon of war: long ears, one ear flopped forward
through a hole in his straw hat, buck teeth. He wears a patched linen shirt with rolled-up sleeves
and a rope belt, his straw hat pushed back on his head, and rests a hoe over one shoulder. Plain
honest face, slightly worried, ears half-dropped, eyebrows raised.
Matching a cast of anthropomorphic animals in plaid shirts, denim vests, hooded robes and leather jackets — a modern-folk village-fantasy world, slightly gritty but friendly.
```

### 7.2 騎士 → `knight.png`

```text
Hand-drawn black-and-white ink line art character portrait, bold comic/manga ink illustration:
thick confident black outlines with strong line-weight variation, large solid black shadow shapes
(pocket flaps, under the jaw, inside cloth folds), only a few sparse parallel hatch marks elsewhere,
high-contrast screen-print look. Pure black lines on a plain flat white background, exactly one
character, on a square 1:1 canvas, generous empty margin, plain empty background.

Anthropomorphic stag with antlers, waist-up bust, three-quarter view, head in the upper-centre, shoulders
spanning the full width, torso cut off by the bottom edge.

A daylight duelling knight who stakes his own life on the challenge: steel plate armour with a dented
pauldron and visible rivets, a tattered cape, gauntlets on both hands, the antlers poking out of an
open helm. He holds a longsword point-down in front of his chest, both hands resting on the pommel,
no shield. Stern and unwavering, brows lowered, chin lifted, mouth a flat line.
Matching a cast of anthropomorphic animals in plaid shirts, denim vests, hooded robes and leather jackets — a modern-folk village-fantasy world, slightly gritty but friendly.
```

### 7.3 禁言長老 → `mute-elder.png`

```text
Hand-drawn black-and-white ink line art character portrait, bold comic/manga ink illustration:
thick confident black outlines with strong line-weight variation, large solid black shadow shapes
(pocket flaps, under the jaw, inside cloth folds), only a few sparse parallel hatch marks elsewhere,
high-contrast screen-print look. Pure black lines on a plain flat white background, exactly one
character, on a square 1:1 canvas, generous empty margin, plain empty background.

Anthropomorphic old ram, waist-up bust, three-quarter view, head in the upper-centre, shoulders
spanning the full width, torso cut off by the bottom edge.

An elder who silences one player every night: thick curled horns, a long pointed beard, drooping
ears, wearing a long hooded robe with a woven shawl and a small bell at the collar, hood down. One
raised index finger is pressed to his lips in a shush gesture; his other hand grips a tall wooden
staff with a small bell hanging from it. Narrow stern eyes, mouth closed, unimpressed.
Matching a cast of anthropomorphic animals in plaid shirts, denim vests, hooded robes and leather jackets — a modern-folk village-fantasy world, slightly gritty but friendly.
```

### 7.4 狼王 → `wolf-king.png`

```text
Hand-drawn black-and-white ink line art character portrait, bold comic/manga ink illustration:
thick confident black outlines with strong line-weight variation, large solid black shadow shapes
(pocket flaps, under the jaw, inside cloth folds), only a few sparse parallel hatch marks elsewhere,
high-contrast screen-print look. Pure black lines on a plain flat white background, exactly one
character, on a square 1:1 canvas, generous empty margin, plain empty background.

Anthropomorphic huge grey wolf, waist-up bust, three-quarter view, head in the upper-centre, shoulders
spanning the full width, torso cut off by the bottom edge.

The alpha wolf of the pack — older, bigger and heavier than the other wolves: thick neck, broad
chest, a notched ear and a scar over one eye, in a plain torn tunic under a heavy fur mantle, and a
crude iron band-crown with a single dark gem. Shoulders squared, one hand clenched into a fist at
chest height, baring his fangs mid-snarl, commanding and contemptuous.
Matching a cast of anthropomorphic animals in plaid shirts, denim vests, hooded robes and leather jackets — a modern-folk village-fantasy world, slightly gritty but friendly.
```

### 7.5 攝夢人 → `dreamweaver.png`

```text
Hand-drawn black-and-white ink line art character portrait, bold comic/manga ink illustration:
thick confident black outlines with strong line-weight variation, large solid black shadow shapes
(pocket flaps, under the jaw, inside cloth folds), only a few sparse parallel hatch marks elsewhere,
high-contrast screen-print look. Pure black lines on a plain flat white background, exactly one
character, on a square 1:1 canvas, generous empty margin, plain empty background.

Anthropomorphic tapir with a long snout and small round ears, waist-up bust, three-quarter view, head in the upper-centre, shoulders
spanning the full width, torso cut off by the bottom edge.

The one who decides who dreams tonight: a tapir (the Baku that eats dreams) in a long hooded
night-robe with crescent-moon and star embroidery and a loose sash. One hand raises a hoop
dreamcatcher with dangling feathers, the other holds a small round lantern with a thin curl of smoke
rising from it. Half-closed sleepy eyes, gentle drowsy smile, head tilted to one side.
Matching a cast of anthropomorphic animals in plaid shirts, denim vests, hooded robes and leather jackets — a modern-folk village-fantasy world, slightly gritty but friendly.
```

### 7.6 魔術師 → `magician.png`

```text
Hand-drawn black-and-white ink line art character portrait, bold comic/manga ink illustration:
thick confident black outlines with strong line-weight variation, large solid black shadow shapes
(pocket flaps, under the jaw, inside cloth folds), only a few sparse parallel hatch marks elsewhere,
high-contrast screen-print look. Pure black lines on a plain flat white background, exactly one
character, on a square 1:1 canvas, generous empty margin, plain empty background.

Anthropomorphic fox, waist-up bust, three-quarter view, head in the upper-centre, shoulders
spanning the full width, torso cut off by the bottom edge.

A stage magician who swaps two players every night: a sly grin and a bushy tail visible past one
shoulder, wearing a formal tailcoat with a waistcoat, a bow tie, white gloves and a top hat with a
band. He holds two playing cards crossed in an X in front of his chest, with three small cards
fanning out in mid-air beside him. Confident sly grin, one eyebrow raised, chin turned slightly aside.
Matching a cast of anthropomorphic animals in plaid shirts, denim vests, hooded robes and leather jackets — a modern-folk village-fantasy world, slightly gritty but friendly.
```

### 7.7 狼美人 → `wolf-beauty.png`

```text
Hand-drawn black-and-white ink line art character portrait, bold comic/manga ink illustration:
thick confident black outlines with strong line-weight variation, large solid black shadow shapes
(pocket flaps, under the jaw, inside cloth folds), only a few sparse parallel hatch marks elsewhere,
high-contrast screen-print look. Pure black lines on a plain flat white background, exactly one
character, on a square 1:1 canvas, generous empty margin, plain empty background.

Anthropomorphic elegant female wolf, waist-up bust, three-quarter view, head in the upper-centre, shoulders
spanning the full width, torso cut off by the bottom edge.

The wolf pack's charmer — whoever she charms dies with her: a sleek long mane, long eyelashes and a
narrow muzzle, wearing a long fur-collared coat over a slit dress, a choker with a small heart
pendant, a rose tucked behind one ear and a ribbon of thread wound around one wrist. One hand raised
near her lips blowing a kiss. Sultry half-lidded smile, chin lowered, looking at the viewer.
Matching a cast of anthropomorphic animals in plaid shirts, denim vests, hooded robes and leather jackets — a modern-folk village-fantasy world, slightly gritty but friendly.
```

## 8. 實測筆記（2026-09-25，用 `chatgpt.com` 免費版）

**額度**：Free plan 的圖像生成上限是 **3 張／24 小時**。實測順序：村民（純文字 pilot）→
騎士、禁言長老（附參考圖），第 4 張開始回應
`You've hit the Free plan limit for image generations requests. You can create more images when the limit resets in 24 hours.`
→ 要一次生完 7 張得等額度重置分幾天跑，或升級 Plus／改用額度較寬的生成器（Nano Banana、Gemini 等）。

**附參考圖有效**：拿 `guard.png`＋`werewolf.png` 當附件（純風格參考、明確寫「不要複製這兩個角色」）之後，
生出來的騎士（鹿）與禁言長老（公羊）在筆觸、實心黑塊、線寬變化上都與現有 7 張同級；
純文字版的村民則明顯偏細、偏鉛筆草稿感 → **優先走這條**。

**抓圖**：生成圖的 `img.src` 是 `https://chatgpt.com/backend-api/estuary/content?id=file_…`（同源），
`fetch(src, {credentials:'include'})` 就能拿到原檔（實測 1254×1254 PNG，非 1024）→ 後處理再縮到 1024。
注意頁面是**延遲渲染**：捲動範圍外的圖還沒有 `src`，抓圖前要先確認目標圖已渲染。

**驅動腳本的坑**（`/tmp/cg_gen_all.py`，暫存檔不進版控）：
- 對話裡的**參考圖附件在 DOM 裡也是 `img`**，計數要把基準線扣掉，否則「等下一張」會立刻成立、
  抓到上一張圖（曾把狼王／攝夢人存成禁言長老的副本）。
- 存證檔名不可含 `/`（`5/7 magician.png` 會讓寫檔失敗，蓋掉真正的錯誤）。

