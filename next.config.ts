import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["youtube-search-without-api-key", "jsonpath", "got", "yt-dlp-wrap", "@prisma/client"],
  /**
   * Prevent Next's file tracer from pulling these paths into `.next/standalone/`.
   * Without this we get a recursion (`desktop/staged-web/desktop/staged-web/...`)
   * and a huge yt-dlp.exe (~18MB) cached by the library-search route bloats the
   * desktop installer. The runtime-binaries module owns yt-dlp/mpv delivery for
   * Desktop — the server-side cached binary is a separate concern, not something
   * to ship inside the Electron bundle.
   */
  outputFileTracingExcludes: {
    "*": [
      "**/desktop/staged-web/**",
      "**/desktop/dist-installer/**",
      "**/desktop/resources/**",
      "**/desktop/node_modules/**",
      "**/desktop/dist/**",
      "**/node_modules/.cache/**",
      "**/node_modules/yt-dlp-wrap/bin/**",
      "**/.next/cache/**",
      "**/*.map",
      // Test artifacts and dev-only files that NFT keeps pulling into
      // .next/standalone — these inflate the desktop installer by ~700MB.
      "**/test-results/**",
      "**/playwright-report/**",
      "**/e2e/**",
      "**/playwright.config.*",
      "**/backups/**",
      "**/docs/**",
      "**/*.md",
      "**/agent.py",
      "**/eslint.config.*",
      "**/postcss.config.*",
      "**/nixpacks.toml",
      "**/tsconfig*.json",
      "**/tsconfig.tsbuildinfo",
      // Prisma's atomic engine writes leave query_engine-*.tmpNNNN behind on
      // Windows when the rename is blocked; each one is ~18MB and they
      // accumulate across rebuilds.
      "**/node_modules/.prisma/**/*.tmp*",
      "**/node_modules/typescript/**",
    ],
  },
};

export default nextConfig;
