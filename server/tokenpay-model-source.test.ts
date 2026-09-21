import assert from "node:assert/strict";
import test from "node:test";

import {
  getGeneratorModel,
  resolveAiVoiceAvailability,
  resolveModelSource,
  setGeneratorModel,
  setModelSource,
} from "@/lib/api-keys";
import { AVAILABLE_MODELS, MODEL_IDS, SUMMARY_MODEL, REVIEW_MODEL } from "@/types/game";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "test-publishable-key";

test("model source keeps an explicit selection authoritative", () => {
  assert.equal(
    resolveModelSource({
      storedSource: "project",
      storedSourceExplicit: true,
      legacyCustomEnabled: true,
      hasLocalKey: true,
      tokenPayConnected: true,
    }),
    "project",
  );
  assert.equal(
    resolveModelSource({
      storedSource: "tokenpay",
      storedSourceExplicit: true,
      tokenPayConnected: false,
    }),
    "tokenpay",
  );
  assert.equal(
    resolveModelSource({
      storedSource: "custom",
      storedSourceExplicit: true,
      hasLocalKey: false,
    }),
    "custom",
  );
});

test("旧版本自动写入的 project 不会覆盖已连接的 TokenPay", () => {
  assert.equal(
    resolveModelSource({
      storedSource: "project",
      storedSourceExplicit: false,
      tokenPayConnected: true,
    }),
    "tokenpay",
  );
});

test("TokenPay 不会在没有用户 MiniMax Key 时调用项目语音", () => {
  assert.equal(resolveAiVoiceAvailability("project", false), true);
  assert.equal(resolveAiVoiceAvailability("tokenpay", false), false);
  assert.equal(resolveAiVoiceAvailability("tokenpay", true), true);
  assert.equal(resolveAiVoiceAvailability("custom", false), false);
  assert.equal(resolveAiVoiceAvailability("custom", true), true);
});

test("TokenPay 无 MiniMax Key 时 AudioManager 不会发起 TTS 请求", async () => {
  const { audioManager } = await import("@/lib/audio-manager");
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>();
  const fakeWindow = new EventTarget() as EventTarget & {
    localStorage: Storage;
  };
  Object.defineProperty(fakeWindow, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  });

  let fetchCalls = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 500 });
  };

  try {
    setModelSource("tokenpay");
    audioManager.setEnabled(true);
    assert.equal(audioManager.isEnabled(), false);
    await audioManager.ensureReady({
      id: "tokenpay-no-tts",
      text: "测试",
      voiceId: "voice",
      playerId: "player",
    });
    assert.equal(fetchCalls, 0);
  } finally {
    audioManager.setEnabled(false);
    globalThis.fetch = originalFetch;
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("legacy key settings migrate to exactly one model source", () => {
  assert.equal(
    resolveModelSource({
      legacyCustomEnabled: true,
      hasLocalKey: true,
      tokenPayConnected: true,
    }),
    "custom",
  );
  assert.equal(
    resolveModelSource({
      legacyCustomEnabled: true,
      hasLocalKey: false,
      tokenPayConnected: true,
    }),
    "tokenpay",
  );
  assert.equal(resolveModelSource({}), "project");
});

test("内置默认：总结与复盘复用同一个内置模型", () => {
  const builtInModel = AVAILABLE_MODELS[0];

  assert.equal(SUMMARY_MODEL, builtInModel.model);
  assert.equal(REVIEW_MODEL, builtInModel.model);
  assert.deepEqual(builtInModel.reasoning, { enabled: false });
});

test("TokenPay 尊重已选模型，旧存档的非法模型回退内置默认", async () => {
  const { resolveRequestModelForSource } = await import("@/lib/llm");
  // 合法的内置模型 → 原样保留（使用者可在 UI 选定）
  assert.deepEqual(
    resolveRequestModelForSource(
      "tokenpay",
      MODEL_IDS.tokendance.glm53Flash,
      "tokendance",
    ),
    {
      model: MODEL_IDS.tokendance.glm53Flash,
      provider: "tokendance",
    },
  );
  // 旧存档里的非内置、非闸道器模型 → 回退到内置默认，Provider 跟随最终模型
  assert.deepEqual(
    resolveRequestModelForSource(
      "tokenpay",
      MODEL_IDS.zenmux.deepseek,
      "zenmux",
    ),
    {
      model: AVAILABLE_MODELS[0]?.model,
      provider: "tokendance",
    },
  );
});

test("项目／TokenPay 模式下，UI 選定的產生模型會被記住並生效", () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const fakeWindow = new EventTarget() as EventTarget & { localStorage: Storage };
  Object.defineProperty(fakeWindow, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });

  try {
    // 沒選過 → 回內建預設
    setModelSource("project");
    assert.equal(getGeneratorModel(), AVAILABLE_MODELS[0]?.model);

    // 使用者選定 glm → 記住並回傳 glm
    setGeneratorModel(MODEL_IDS.tokendance.glm53Flash);
    assert.equal(getGeneratorModel(), MODEL_IDS.tokendance.glm53Flash);

    // 切到 TokenPay 仍尊重已選模型，不再硬性歸一化
    setModelSource("tokenpay");
    assert.equal(getGeneratorModel(), MODEL_IDS.tokendance.glm53Flash);
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("自定义 Key 仍保留用户显式选择的 Provider", async () => {
  const { resolveRequestModelForSource } = await import("@/lib/llm");
  assert.deepEqual(
    resolveRequestModelForSource(
      "custom",
      MODEL_IDS.zenmux.geminiFlashLite,
      "zenmux",
    ),
    {
      model: MODEL_IDS.zenmux.geminiFlashLite,
      provider: "zenmux",
    },
  );
});
