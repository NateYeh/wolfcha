import path from "path";
import type { NextConfig } from "next";

// Read version from package.json at build time
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("./package.json") as { version?: string };

const nextConfig: NextConfig = {
  // Note: Removed 'output: "standalone"' - not needed for Vercel deployment
  // standalone mode is for Docker/self-hosted environments and makes deploy much larger
  reactCompiler: true,
  async rewrites() {
    return [
      { source: "/zh", destination: "/" },
      { source: "/zh/", destination: "/" },
      { source: "/zh/:path*", destination: "/:path*" },
      { source: "/zh-CN", destination: "/" },
      { source: "/zh-CN/", destination: "/" },
      { source: "/zh-CN/:path*", destination: "/:path*" },
      { source: "/zh-TW", destination: "/" },
      { source: "/zh-TW/", destination: "/" },
      { source: "/zh-TW/:path*", destination: "/:path*" },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version ?? "0.0.0",
    // 本機／自架模式：不提供帳號登入，玩家在「設定」自帶 gateway 與模型。
    NEXT_PUBLIC_WOLFCHA_LOCAL_NO_AUTH: process.env.WOLFCHA_LOCAL_NO_AUTH ?? "",
  },
  webpack(config) {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      jotai: path.resolve(__dirname, "node_modules/jotai"),
      "jotai/vanilla": path.resolve(__dirname, "node_modules/jotai/vanilla"),
    };
    config.module.rules.push({
      test: /\.mp3$/,
      type: "asset/resource",
      generator: {
        filename: "static/media/[name].[hash][ext]",
      },
    });
    return config;
  },
};

export default nextConfig;
