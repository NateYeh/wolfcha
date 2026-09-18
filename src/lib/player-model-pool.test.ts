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
