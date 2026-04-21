# electron-builder resources

This folder is referenced by `desktop/package.json`'s `build.directories.buildResources`.
Drop platform icons here before running `npm run dist` so they get baked into the installers.

## Expected files

| File            | Platform | Notes                                                                                   |
| --------------- | -------- | --------------------------------------------------------------------------------------- |
| `icon.ico`      | Windows  | Multi-resolution Windows icon. 256x256 recommended as the largest embedded frame.       |
| `icon.icns`     | macOS    | Apple icon bundle. Use `iconutil` or `png2icns` from a 1024x1024 master.                |
| `icon.png`      | Linux    | 512x512 PNG for AppImage/deb.                                                           |
| `background.png`| macOS    | Optional DMG background (540x380). Ignored if absent.                                   |

Until real artwork lands, electron-builder falls back to its generic Electron icon —
the installer still builds, it just isn't branded.

## Where installers land

Build output is written to `desktop/dist-installer/` (gitignored). The GitHub Actions
workflow in `.github/workflows/desktop-release.yml` uploads the same artifacts to the
matching GitHub Release.
