import assert from "node:assert/strict";
import test from "node:test";
import {
  AVATAR_API_PATH,
  AvatarConfig,
  buildAvatarUrl,
  buildSimpleAvatarUrl,
  getAvatarBgColor,
  getHairForSeed,
  getHairVariantsForGender,
} from "./avatar-config";

const ALL = AvatarConfig.ALL_HAIR_VARIANTS;
const FEMALE = AvatarConfig.FEMALE_ONLY_HAIR;
const MALE = getHairVariantsForGender("male");

test("頭像：男女髮型清單不重疊，且剛好覆蓋全部 63 個 variant", () => {
  assert.equal(ALL.length, 63);
  const female = new Set(FEMALE);
  const male = new Set(MALE);
  // 不重疊
  for (const variant of female) {
    assert.equal(male.has(variant), false, `${variant} 同時出現在男女清單`);
  }
  // 完整覆蓋
  assert.equal(female.size + male.size, ALL.length);
  for (const variant of ALL) {
    assert.ok(female.has(variant) || male.has(variant), `${variant} 沒有被分配到任何性別`);
  }
});

test("頭像：長髮 variant 歸女性、短髮歸男性（男女外觀一致）", () => {
  // 這批是逐一眼檢後確認的長髮／髮髻，必須在女性清單內
  const longHair = ["variant39", "variant48", "variant58", "variant59", "variant62", "variant63"];
  for (const variant of longHair) {
    assert.ok(FEMALE.includes(variant), `${variant} 是長髮，應只給女性`);
    assert.equal(MALE.includes(variant), false, `${variant} 不該給男性`);
  }
  // 誤分修正：variant30 是短髮，不該在女性清單
  assert.equal(FEMALE.includes("variant30"), false);
  assert.ok(MALE.includes("variant30"));
});

test("頭像：同 seed 同性別永遠得到同一髮型，且落在該性別清單內", () => {
  const seeds = ["player-1", "abc", "坐位3", "x".repeat(40)];
  for (const seed of seeds) {
    for (const gender of ["male", "female"] as const) {
      const first = getHairForSeed(seed, gender);
      assert.equal(getHairForSeed(seed, gender), first);
      assert.ok(getHairVariantsForGender(gender).includes(first));
    }
  }
  // 不同性別清單不同，同 seed 也可能得到不同髮型（至少不強制相同）
  assert.ok(getHairVariantsForGender("female").length > 0);
});

test("頭像：URL 帶入性別髮型與 zero beard，且背景色穩定", () => {
  const url = buildAvatarUrl({ seed: "seed-1", gender: "female" });
  const params = new URLSearchParams(url.split("?")[1]);
  assert.equal(params.get("hair"), getHairForSeed("seed-1", "female"));
  assert.equal(params.get("beardProbability"), "0");
  assert.equal(params.get("backgroundColor"), getAvatarBgColor("seed-1"));
  assert.equal(buildAvatarUrl({ seed: "seed-1", gender: "male" }).includes("hair=variant"), true);
  // 走自家伺服器，不再連外部服務（避免限流與把角色名傳給第三方）
  assert.equal(url.startsWith(`${AVATAR_API_PATH}?`), true);
  assert.equal(url.includes("dicebear"), false);

  // 明確指定髮型時不再由性別決定
  const explicit = new URLSearchParams(buildAvatarUrl({ seed: "seed-1", gender: "male", hair: "variant10" }).split("?")[1]);
  assert.equal(explicit.get("hair"), "variant10");

  // 沒帶性別時不寫入 hair 參數（維持舊行為，供著陸頁等無性別資料處使用）
  const noGender = new URLSearchParams(buildSimpleAvatarUrl("seed-1").split("?")[1]);
  assert.equal(noGender.get("hair"), null);
});
