/**
 * C4 (2026-11-14) — RUNTIME mirror of the owner-vetted mpv pin in `desktop/mpv-pin.json` (win_x64).
 *
 * The build script (`scripts/fetch-mpv.cjs`, CommonJS) reads the JSON; this module is the TypeScript value the
 * runtime resolver uses — the desktop tsconfig `rootDir` is `src`, so it cannot import the JSON that lives at the
 * desktop root. The two are kept identical by `scripts/verify-mpv-pin.ts` (parity), the same anti-drift approach
 * used for the duplicated C1/C2 URL policy.
 */
export const MPV_WIN_PIN = {
  releaseTag: "20260421",
  assetPattern: "^mpv-x86_64-v3-\\d+-git-[a-f0-9]+\\.7z$",
  exeSha256: "df5c50556c10450101eecd76c5c77a1ae256eaaec83b496596bb3495d459a23c",
} as const;
