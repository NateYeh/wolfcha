import assert from "node:assert/strict";
import test from "node:test";
import { getHairForSeed } from "./avatar-config";
import { renderAvatarSvg } from "./avatar-render";

test("頭像繪製：產生 SVG，且同一組參數永遠相同", () => {
  const first = renderAvatarSvg({ seed: "player-1", gender: "female" });
  const second = renderAvatarSvg({ seed: "player-1", gender: "female" });
  assert.equal(first, second);
  assert.ok(first.startsWith("<svg"));
  assert.ok(first.includes("viewBox"));
  assert.ok(first.includes("</svg>"));
});

test("頭像繪製：性別決定髮型池，等同於明確指定該性別抽到的髮型", () => {
  const seed = "player-2";
  assert.equal(
    renderAvatarSvg({ seed, gender: "female" }),
    renderAvatarSvg({ seed, hair: getHairForSeed(seed, "female") }),
  );
  assert.equal(
    renderAvatarSvg({ seed, gender: "male" }),
    renderAvatarSvg({ seed, hair: getHairForSeed(seed, "male") }),
  );
  // 男女髮型不同 → 圖也不同
  assert.notEqual(renderAvatarSvg({ seed, gender: "female" }), renderAvatarSvg({ seed, gender: "male" }));
});

test("頭像繪製：不同 seed 給不同長相，指定髮型時不再依性別", () => {
  assert.notEqual(renderAvatarSvg({ seed: "a" }), renderAvatarSvg({ seed: "b" }));
  assert.equal(
    renderAvatarSvg({ seed: "a", gender: "female", hair: "variant10" }),
    renderAvatarSvg({ seed: "a", gender: "male", hair: "variant10" }),
  );
});

test("頭像繪製：說話嘴型會改變圖，透明背景不填色", () => {
  const idle = renderAvatarSvg({ seed: "player-3", gender: "male" });
  const talking = renderAvatarSvg({ seed: "player-3", gender: "male", lips: "variant04" });
  assert.notEqual(idle, talking);

  const solid = renderAvatarSvg({ seed: "player-3", backgroundColor: "e8d5c4" });
  const transparent = renderAvatarSvg({ seed: "player-3", backgroundColor: "transparent" });
  assert.notEqual(solid, transparent);
});

test("頭像繪製：scale 超出範圍會被夾住，不會產生無效參數", () => {
  const max = renderAvatarSvg({ seed: "player-4", scale: 200 });
  assert.equal(renderAvatarSvg({ seed: "player-4", scale: 500 }), max);
  assert.equal(renderAvatarSvg({ seed: "player-4", scale: -10 }), renderAvatarSvg({ seed: "player-4", scale: 0 }));
  // 一般情況仍可正常產生
  assert.ok(renderAvatarSvg({ seed: "player-4", scale: 100, translateY: 5 }).includes("<svg"));
});

test("頭像繪製：角色指定的鬍子與眼鏡會反映在圖上", () => {
  const base = renderAvatarSvg({ seed: "player-5", gender: "male" });
  const beard = renderAvatarSvg({ seed: "player-5", gender: "male", beard: true });
  assert.notEqual(base, beard);

  const withGlasses = renderAvatarSvg({ seed: "player-5", gender: "male", glasses: true });
  const withoutGlasses = renderAvatarSvg({ seed: "player-5", gender: "male", glasses: false });
  assert.notEqual(withGlasses, withoutGlasses);
  // 沒指定眼鏡時，結果會等於其中一種（由 seed 決定），但不會同時等於兩者
  assert.ok(base === withGlasses || base === withoutGlasses);
});

test("頭像繪製：指定髮型時不受性別影響（手寫角色的固定外觀）", () => {
  const styled = renderAvatarSvg({ seed: "player-6", gender: "female", hair: "variant03" });
  assert.equal(styled, renderAvatarSvg({ seed: "player-6", hair: "variant03" }));
  assert.notEqual(styled, renderAvatarSvg({ seed: "player-6", gender: "female" }));
});
