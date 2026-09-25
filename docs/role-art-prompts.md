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
Black-and-white ink line art character portrait, hand-drawn comic/manga ink illustration:
crisp confident outlines with variable line weight, form described by sparse parallel hatching
and a few solid black fills (nose, pupils, pocket flaps), pure black lines on a plain flat white
background, no color, no greyscale shading, no gradients, no screentone texture.

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
Hand-drawn black-and-white ink line art character portrait, comic/manga ink illustration: crisp
confident outlines with variable line weight, form described by sparse parallel hatching and a few
solid black fills (nose, pupils, pocket flaps). Pure black ink lines on a plain flat white background,
exactly one character, on a square 1:1 canvas.

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

1. **後處理**：白底去背 → 透明 PNG、自動裁切、統一頭部比例、補成 1024×1024。
   現有 7 張的頭部大小差不多，新圖若沒對齊，放在一起會大小不一。
   生的時候**留白就好**（不要自己置中或裁切），統一由這邊處理。
2. **接線**：改 `DialogArea.ROLE_PORTRAIT_MAP` + `analysis/constants.ROLE_ICONS` 兩處映射
   （現在是 `Record<Role, string>`，漏改會編譯失敗，所以不會漏）。
3. **選擇性**：暗色主題下 `--glass-bg` 是深色（`rgba(20,16,14,.70)`），黑線立繪會不好看，
   屆時可加一層淺色卡片底或 `invert`；夜間光暈目前只認 6 個角色，新角色可一併配色。

把原始檔（白底即可）丟到 `temp/role-art/` 我就接手，或直接告訴我生成器是哪一個，我照它的習慣再調提示詞。
