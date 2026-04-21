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
    ],
  },
};

export default nextConfig;
