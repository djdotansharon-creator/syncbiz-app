# electron-builder resources

This folder is referenced by `desktop/package.json`'s `build.directories.buildResources`.
Drop platform icons here before running `npm run dist` so they get baked into the installers.

## Expected files

| File            | Platform | Notes                                                                                   |
| --------------- | -------- | --------------------------------------------------------------------------------------- |
| `icon.svg`      | source   | Brand source-of-truth — SyncBiz "SB" tile. Edit this; `build-icons` rasterizes the rest. |
| `icon.ico`      | Windows  | Multi-resolution Windows icon. 256x256 recommended as the largest embedded frame.       |
| `icon.icns`     | macOS    | Apple icon bundle. Use `iconutil` or `png2icns` from a 1024x1024 master.                |
| `icon.png`      | Linux    | 512x512 PNG for AppImage/deb.                                                           |
| `background.png`| macOS    | Optional DMG background (540x380). Ignored if absent.                                   |

Pipeline: `npm run build-icons` in `desktop/` rasterizes `icon.svg` (if present) to
`icon.png` at 1024×1024, then derives `icon.ico` (Windows) and `icon.icns` (macOS).
If `icon.svg` is absent, the existing `icon.png` is used as-is.

## Where installers land

Build output is written to `desktop/dist-installer/` (gitignored). The GitHub Actions
workflow in `.github/workflows/desktop-release.yml` uploads the same artifacts to the
matching GitHub Release.
