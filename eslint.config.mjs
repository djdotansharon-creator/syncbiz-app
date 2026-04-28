import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // SyncBiz Player Desktop (Electron) — separate package under desktop/
    "desktop/**",
    // WS server compiled output (`tsc` from `server/`) — generated, tracked
    // for deploys that skip a build step but must not be linted.
    "server/dist/**",
  ]),
]);

export default eslintConfig;
