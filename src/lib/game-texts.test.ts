import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "@/i18n/locale-store";
import { getSystemMessages } from "./game-texts";

setLocale("zh-CN");

/**
 * 開槍公告**不得揭露槍種**（規則 2026-09-25 校訂）。
 *
 * 理由：公告如果寫「狼王開槍」或「獵人開槍」，等於把開槍者的身份直接送給全場；
 * 規則要求場上只知道「某號開槍帶走某號」。真實槍種留在 `hunterShots` 紀錄裡，
 * 只有賽後分析與 DevTools 看得到。
 */
test("開槍公告不揭露槍種：兩把槍的公告必須一模一樣，且不得出現角色名", () => {
  const messages = getSystemMessages();

  const line = messages.hunterShoot(7, "葉小雷", 8, "范蠡");
  assert.equal(line, "7号 葉小雷 开枪带走了 8号 范蠡");
  for (const word of ["猎人", "狼王", "hunter", "wolf"]) {
    assert.doesNotMatch(line, new RegExp(word, "i"), `公告不得出現「${word}」`);
  }
});

test("開槍公告模板本身不得帶 {shooterRole}（三語系）", async () => {
  const [{ default: zhTW }, { default: zhCN }, { default: en }] = await Promise.all([
    import("@/i18n/messages/zh-TW.json"),
    import("@/i18n/messages/zh-CN.json"),
    import("@/i18n/messages/en.json"),
  ]);
  for (const [locale, messages] of [["zh-TW", zhTW], ["zh-CN", zhCN], ["en", en]] as const) {
    const template = (messages as { system: { hunterShoot: string } }).system.hunterShoot;
    assert.doesNotMatch(template, /shooterRole/, `${locale} 的公告模板仍有 {shooterRole}`);
  }
});
