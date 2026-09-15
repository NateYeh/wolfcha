import assert from "node:assert/strict";
import test from "node:test";
import { parseLLMJson } from "./llm-json";

test("parseLLMJson 修復陣列元素漏掉結尾雙引號的情況", () => {
  // 模型被中文引號誤導，漏掉字串結尾的 ASCII 雙引號，接著就是陣列結尾
  const broken = [
    "{",
    '  "voiceRules": [',
    '    "第一句正常",',
    '    "第二句漏了結尾引號，句尾是中文引號“我真的不是”',
    "  ]",
    "}",
  ].join("\n");

  const parsed = parseLLMJson<{ voiceRules: string[] }>(broken);
  assert.ok(parsed, "應該能修復並解析");
  assert.deepEqual(parsed.voiceRules, [
    "第一句正常",
    "第二句漏了結尾引號，句尾是中文引號“我真的不是”",
  ]);
});

test("parseLLMJson 修復漏引號且後面還有元素時補上逗號", () => {
  const broken = ['["第一句",', '"第二句漏引號，句尾是“对吧”', '"第三句"]'].join("\n");

  const parsed = parseLLMJson<string[]>(broken);
  assert.ok(parsed, "應該能修復並解析");
  assert.deepEqual(parsed, ["第一句", "第二句漏引號，句尾是“对吧”", "第三句"]);
});

test("parseLLMJson 不影響正常 JSON", () => {
  const valid = JSON.stringify({ characters: [{ displayName: "张建军", persona: { voiceRules: ["正常"] } }] });
  const parsed = parseLLMJson<{ characters: { displayName: string }[] }>(valid);
  assert.ok(parsed);
  assert.equal(parsed.characters[0].displayName, "张建军");
});

test("parseLLMJson 不會把正常的鍵值行誤判成未收尾字串", () => {
  const valid = ['{', '  "displayName": "张建军",', '  "note": "結尾有中文引號“好”",', '  "seat": 3', "}"].join("\n");
  const parsed = parseLLMJson<{ displayName: string; note: string; seat: number }>(valid);
  assert.ok(parsed);
  assert.equal(parsed.displayName, "张建军");
  assert.equal(parsed.note, "結尾有中文引號“好”");
  assert.equal(parsed.seat, 3);
});
