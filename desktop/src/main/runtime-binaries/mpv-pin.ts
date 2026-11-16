/**
 * C4 (2026-11-14) — RUNTIME mirror of the owner-vetted mpv pin in `desktop/mpv-pin.json` (win_x64).
 *
 * The build script (`scripts/fetch-mpv.cjs`, CommonJS) reads the JSON; this module is the TypeScript value the
 * runtime resolver uses — the desktop tsconfig `rootDir` is `src`, so it cannot import the JSON that lives at the
 * desktop root. The two are kept identical by `scripts/verify-mpv-pin.ts` (parity), the same anti-drift approach
 * used for the duplicated C1/C2 URL policy.
 */
export const MPV_WIN_PIN = {
  releaseTag: "20261111",
  assetPattern: "^mpv-x86_64-v3-\\d+-git-[a-f0-9]+\\.7z$",
  exeSha256: "db6a1659fcf3dc0dcb77256b905c0db181518eb36b94313e08d8f815fcc4d932",
} as const;
