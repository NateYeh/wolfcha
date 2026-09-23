import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import { getRoleName } from "./game-constants";
import { getSystemMessages } from "./game-texts";

setLocale("zh-CN");

test("開槍公告要寫明槍的種類：獵人槍與狼王槍不能被混為一談", () => {
  const messages = getSystemMessages();

  const hunterLine = messages.hunterShoot(7, "葉小雷", 8, "范蠡", getRoleName("Hunter"));
  assert.equal(hunterLine, "7号 葉小雷 猎人开枪带走了 8号 范蠡");

  // 狼王槍：公告必須寫「狼王」，不能沿用預設的猎人
  const wolfKingLine = messages.hunterShoot(7, "葉小雷", 8, "范蠡", getRoleName("WolfKing"));
  assert.equal(wolfKingLine, "7号 葉小雷 狼王开枪带走了 8号 范蠡");
  assert.doesNotMatch(wolfKingLine, /猎人/);
});
