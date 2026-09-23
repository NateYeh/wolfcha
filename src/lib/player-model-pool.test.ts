import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||= "test-publishable-key";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

/** 建立 window / localStorage 測試環境（api-keys 的儲存層需要）。 */
function setupBrowserEnv() {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    },
  });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  return async () => {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    if (originalLocalStorage === undefined) Reflect.deleteProperty(globalThis, "localStorage");
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  };
}

test("玩家模型池：儲存讀回、去重、空集合代表全部", async () => {
  const restore = setupBrowserEnv();
  try {
    const { getPlayerModelPool, setPlayerModelPool } = await import("@/lib/api-keys");
    assert.deepEqual(getPlayerModelPool(), []);

    setPlayerModelPool(["glm-5.3-flash:cloud", " glm-5.3-flash:cloud ", "gemma4:31b-cloud"]);
    assert.deepEqual(getPlayerModelPool(), ["glm-5.3-flash:cloud", "gemma4:31b-cloud"]);

    setPlayerModelPool([]);
    assert.deepEqual(getPlayerModelPool(), []);
  } finally {
    await restore();
  }
});

test("玩家模型池：內建模式只抽被勾選的模型，勾選全失效時退回全部", async () => {
  const restore = setupBrowserEnv();
  try {
    const { setPlayerModelPool } = await import("@/lib/api-keys");
    const { sampleModelRefs } = await import("@/lib/character-generator");

    // 未勾選＝全部可用（沿用舊行為）
    const all = sampleModelRefs(6).map((ref) => ref.model);
    assert.ok(all.length === 6);
    assert.ok(all.every((model) => model === "glm-5.3-flash:cloud" || model === "gemma4:31b-cloud"));

    // 只勾 gemma4：抽出來的玩家模型不得出現 glm
    setPlayerModelPool(["gemma4:31b-cloud"]);
    const onlyGemma = sampleModelRefs(6).map((ref) => ref.model);
    assert.deepEqual(Array.from(new Set(onlyGemma)), ["gemma4:31b-cloud"]);

    // 勾到池子裡沒有的模型（例如上游已下架）→ 退回全部並留 warning，不得產生空池
    setPlayerModelPool(["deepseek-v4.1-flash:cloud"]);
    const fallback = sampleModelRefs(6).map((ref) => ref.model);
    assert.ok(fallback.length === 6);
    assert.ok(fallback.every((model) => model === "glm-5.3-flash:cloud" || model === "gemma4:31b-cloud"));
  } finally {
    await restore();
  }
});

test("玩家模型池：抓過 gateway 清單後，抽模型改以該清單為準（含未內建模型）", async () => {
  const restore = setupBrowserEnv();
  try {
    const { setGatewayModels, setPlayerModelPool } = await import("@/lib/api-keys");
    const { sampleModelRefs } = await import("@/lib/character-generator");

    // gateway 只提供兩個模型，其中一個未內建（模擬上游新增模型，不需改程式碼）
    setGatewayModels(["glm-5.2:cloud", "brand-new-model:v3"]);
    setPlayerModelPool([]);
    const refs = sampleModelRefs(4);
    assert.deepEqual(
      Array.from(new Set(refs.map((ref) => ref.model))).sort(),
      ["brand-new-model:v3", "glm-5.2:cloud"],
    );
    // 未內建的模型必須走自帶 gateway 通道，否則會被送到 zenmux
    assert.ok(refs.every((ref) => ref.provider === "tokendance"));

    // 只勾 gateway 上的某一個模型
    setPlayerModelPool(["brand-new-model:v3"]);
    assert.deepEqual(Array.from(new Set(sampleModelRefs(4).map((ref) => ref.model))), ["brand-new-model:v3"]);

    // 勾了 gateway 沒有的模型 → 不會被抽到（退回全部 gateway 模型並留 warning）
    setPlayerModelPool(["gemma4:31b-cloud"]);
    const fallback = sampleModelRefs(4).map((ref) => ref.model);
    assert.ok(fallback.length === 4);
    assert.ok(fallback.every((m) => m === "glm-5.2:cloud" || m === "brand-new-model:v3"));
  } finally {
    await restore();
  }
});

test("未設定 gateway 位址時回預設（Ollama Cloud），設定了就以使用者填的為準", async () => {
  // 這個函式讀 window.localStorage，node 測試環境要先鋪一層假的。
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { localStorage: storage };

  try {
    const { getTokendanceBaseUrl, setTokendanceBaseUrl } = await import("@/lib/api-keys");
    const { DEFAULT_GATEWAY_BASE_URL } = await import("@/lib/gateway-url");
    setTokendanceBaseUrl("");
    assert.equal(getTokendanceBaseUrl(), DEFAULT_GATEWAY_BASE_URL);
    setTokendanceBaseUrl("https://gpt-load.example.idv.tw:8443/v1");
    assert.equal(getTokendanceBaseUrl(), "https://gpt-load.example.idv.tw:8443/v1");
  } finally {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else (globalThis as { window?: unknown }).window = originalWindow;
  }
});
