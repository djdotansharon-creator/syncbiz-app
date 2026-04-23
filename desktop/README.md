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

## Packaging / distribution

The desktop app is packaged with **electron-builder** (configured in the `build` block of `desktop/package.json`). Installers are written to `desktop/dist-installer/` (gitignored).

### Local build

```bash
# First build the Next.js standalone and stage it into desktop/staged-web/
npm run build:electron-web        # (repo root)

# Windows (.exe NSIS installer) — fastest path on a Windows dev box:
cd desktop
npm run dist:win
```

`npm run dist:win` runs `npm run build` (tsc + bundle-desktop.cjs) then `electron-builder --win`. macOS and Linux targets are produced on their respective runners in CI.

### CI release (recommended)

The workflow `.github/workflows/desktop-release.yml` builds Windows/macOS/Linux installers in parallel and attaches them to the matching GitHub Release. To publish a new desktop version:

```bash
# Bump desktop/package.json "version" first, then:
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

The workflow downloads platform MPV + yt-dlp binaries during the run (they are not checked in), then calls `electron-builder --publish always`. The in-app `Desktop` button in the top-right nav (see `components/desktop-download-button.tsx`) reads the latest release via `/api/desktop/download`.

### First release checklist

- Drop `icon.ico` / `icon.icns` / `icon.png` into `desktop/build/` (see `desktop/build/README.md`).
- Bump `desktop/package.json` version.
- Create the matching `desktop-v*` tag.

### Web app download button (browser) — “הורדה” ל־.exe

The Next route `GET /api/desktop/download` picks a **direct** installer URL. Best option: a **public GitHub Release** whose tag starts with `desktop-v` and includes the Windows `.exe` as an upload.

1. In GitHub: **Releases** → **Create a new release**.
2. **Tag**: `desktop-v0.1.0` (must match `TAG_PREFIX` + SemVer, same as `desktop/package.json` version).
3. **Attach** the file built locally:  
   `desktop/dist-installer/SyncBiz-Player-Setup-0.1.0-x64.exe` (name must match `artifactName` in `package.json` for that version).
4. Publish the release.  
   The API will return `browser_download_url` from the GitHub API — **no extra env** is required for that path.

**Stable direct link format** (for docs or for `DESKTOP_WIN_INSTALLER_URL` on Railway if you want a fixed URL without relying on the API):

`https://github.com/djdotansharon-creator/syncbiz-app/releases/download/desktop-v0.1.0/SyncBiz-Player-Setup-0.1.0-x64.exe`

**GitHub `DESKTOP_GITHUB_*` (optional):** use the full user/org name `djdotansharon-creator` — not `creator` alone, or all `github.com/.../releases` links 404.

**On Railway (optional):** if you set these, they act as a fallback when there is no matching release yet, or in addition to your deploy workflow:

- `DESKTOP_WIN_INSTALLER_URL` — the `https://github.com/.../releases/download/.../....exe` URL above
- `DESKTOP_WIN_INSTALLER_FILE_NAME=SyncBiz-Player-Setup-0.1.0-x64.exe`
- `DESKTOP_WIN_INSTALLER_VERSION=0.1.0`

**Do not set** `DESKTOP_INSTALLER_BUNDLE_PATH` in production (that is only for the same server streaming the file from disk — local dev or a volume path).

### Upload via CLI (optional)

With [GitHub CLI](https://cli.github.com/) and the installer already built:

```bash
gh release create desktop-v0.1.0 ^
  "desktop/dist-installer/SyncBiz-Player-Setup-0.1.0-x64.exe" ^
  --repo djdotansharon-creator/syncbiz-app ^
  --title "SyncBiz Player 0.1.0" ^
  --notes "Windows x64 NSIS installer."
```

(Use `^` line continuation on Windows `cmd`, or a single line in PowerShell.)
