# SyncBiz Desktop (Electron)

## React runtime boundary (web vs desktop)

- **Web app** (repository root): uses **React 19** from the root `package.json` and Next.js.
- **Desktop renderer bundle** (this package): uses **React 18.3.1** in `desktop/package.json` on purpose. The Electron renderer is bundled with esbuild from `desktop/node_modules`; it does not load the root app’s React tree. Keeping React 18 here avoids known Electron/Chromium instability with the current renderer bootstrap (including avoiding `root.render(null)` on idle paths).

This split is a **stability boundary**, not a feature downgrade. Shared UI under `components/player-surface/` and `lib/player-surface/` is written to the shared types only (no web-only runtime APIs in those modules). When aligning versions later, validate with a full desktop smoke test, not only typecheck.

## Typecheck vs build

- **`npm run typecheck`** uses `tsconfig.typecheck.json`. It typechecks all of `desktop/src` (including `.tsx`), plus the shared player surface modules pulled in from the repo (`components/player-surface/`, `lib/player-surface/`, and `lib/types.ts` / `lib/player-utils.ts` as needed). It sets `jsx: react-jsx` and `paths` so `@/*` resolves to the **repository root**, matching `scripts/bundle-desktop.cjs` (`alias: { "@": repoRoot }`).
- **`npm run build`** runs `tsc` with `tsconfig.json`, which compiles the main-process (and related) TypeScript under `src` **excluding** `src/renderer/**` and `src/preload/**`; preload and renderer are produced by esbuild in `bundle-desktop.cjs`.

## Shared surface imports

Renderer and bridge code should import shared UI via the `@/` alias (same as the web app). The bundler resolves `@` to the repo root; the typechecker must mirror that via `baseUrl` + `paths` in `tsconfig.typecheck.json`.
