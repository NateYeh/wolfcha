import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // 專案慣例：以 `_` 開頭代表「刻意不使用」的繫結——例如只為維持參數位置而保留的
      // 參數、或物件解構時刻意排除的欄位（`{ voterId: _voterId, ...payload }`）。
      // 這是 TS 社群的通行寫法，不是拿來掩蓋漏用：真的該用而沒用的變數仍會被報出來。
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    rules: {
      // 本專案的圖片幾乎都是「執行期組合出來的 URL」：頭像是 /api/avatar?seed=...
      // 產生的 SVG、模型頭像是 /models/*.svg 小圖；next/image 在這裡只能加
      // unoptimized 並硬寫寬高，換不到任何最佳化，還會打亂既有的自適應版面。
      // 因此明確停用（而不是留著 39 個永遠不會處理的警告）；真的要做最佳化的
      // 靜態大圖仍應主動使用 next/image。
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
