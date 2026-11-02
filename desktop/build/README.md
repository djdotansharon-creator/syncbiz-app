# electron-builder resources

This folder is referenced by `desktop/package.json`'s `build.directories.buildResources`.
Drop platform icons here before running `npm run dist` so they get baked into the installers.

## Expected files

| File            | Platform | Notes                                                                                   |
| --------------- | -------- | --------------------------------------------------------------------------------------- |
| `icon.ico`      | Windows  | Multi-resolution Windows icon. 256x256 recommended as the largest embedded frame.       |
| `icon.icns`     | macOS    | Apple icon bundle. Use `iconutil` or `png2icns` from a 1024x1024 master.                |
| `icon.png`      | source   | The VONO app icon, 1024x1024 — the same file as `public/brand/vono-app-icon-1024.png`. Edit THIS; `build-icons` derives the rest. |
| `background.png`| macOS    | Optional DMG background (540x380). Ignored if absent.                                   |

Pipeline: `npm run build-icons` in `desktop/` derives `icon.ico` (Windows) and `icon.icns` (macOS) from `icon.png`.
**There is deliberately NO `icon.svg`**: `build-icons` rasterizes an `icon.svg` over `icon.png` on every build, and the old one
was the SyncBiz "SB" tile — it silently brought the old logo back into every clean build (2.3.0 shipped with it, 2026-11-02).
Do not add an `icon.svg` unless it is the VONO icon.

## Where installers land

Build output is written to `desktop/dist-installer/` (gitignored). The GitHub Actions
workflow in `.github/workflows/desktop-release.yml` uploads the same artifacts to the
matching GitHub Release.
