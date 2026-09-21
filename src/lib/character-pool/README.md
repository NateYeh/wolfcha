# 角色池資料

## 檔案

| 檔案 | 用途 | 可否手改 |
|------|------|----------|
| `character-names.json` | 角色身分唯一來源：`id` → `{ zh-CN, zh-TW, en }` 顯示名 | 可（新增角色時補） |
| `jin-yong-pool.zh-CN.json` | 金庸池 persona 文案（手寫來源）；每筆有 `id`，**不含名字** | 可（來源） |
| `jin-yong-pool.zh-TW.json` | 同上，OpenCC `s2twp` 轉換產物；與 zh-CN 逐筆同序、同 `id` | ✗ 產物，勿手改 |

## 設計

- 角色「身分」= `id`（拼音 slug，如 `ling-hu-chong`），**與語系無關**；統計、熟人局提示、頭像 seed 都用它。
- 顯示名一律由 `character-names.json` 依目前語系查表（見 `character-roster.ts` 的 `resolveCharacterName`）。
- `en` 只做名字；英文介面的 persona 沿用 zh-CN 文案。
- `avatarSeed` 固定存簡中名（跨語系一致，**勿改成顯示名**）。

## 新增角色

1. 兩份 pool JSON 各加一筆（同順序、同 `id`），填 `persona`／`playerMind`。
2. 在 `character-names.json` 補該 `id` 的三語名字。
3. 更新 `character-roster.test.ts` 的 `POOL_SIZE`。

## 產生方式

- `jin-yong-pool.zh-TW.json`：以 OpenCC `s2twp` 從 zh-CN 逐筆轉換（同序）。
- `character-names.json` 的 `id`／`en`：一次性以 LLM（gpt-load2 閘道器、`glm-new`）依簡中名生成拼音 slug 與羅馬字，人工校對後入庫。
