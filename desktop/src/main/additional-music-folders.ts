/**
 * Additional music folders management (beyond the single primary PlaylistPro/music folder).
 * Reads and writes additionalMusicFolders[] in DesktopRuntimeConfig.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { patchRuntimeConfig } from "./runtime-config-service";
import type {
  AddAdditionalMusicFolderResult,
  DesktopRuntimeConfig,
  MusicLibrarySource,
  MusicLibrarySourcesResult,
  RemoveAdditionalMusicFolderResult,
  ScanMusicLibraryResult,
} from "../shared/mvp-types";

function makeMusicLibrarySource(
  folderPath: string,
  kind: "playlistpro" | "additional",
  removable: boolean,
): MusicLibrarySource {
  return {
    id: folderPath,
    kind,
    path: folderPath,
    displayLabel: path.basename(folderPath) || folderPath,
    status: folderPath ? (existsSync(folderPath) ? "ready" : "missing") : "unconfigured",
    trackCount: null,
    lastScanIso: null,
    removable,
  };
}

export function listMusicLibrarySources(
  _userData: string,
  cfg: DesktopRuntimeConfig,
): MusicLibrarySourcesResult {
  const mainPath = cfg.musicFolderPath?.trim() || "";
  const additional = (cfg.additionalMusicFolders ?? [])
    .filter(Boolean)
    .map((p) => makeMusicLibrarySource(p, "additional", true));

  return {
    playlistPro: mainPath
      ? makeMusicLibrarySource(mainPath, "playlistpro", false)
      : {
          id: "__unconfigured__",
          kind: "playlistpro",
          path: "",
          displayLabel: "Not configured",
          status: "unconfigured",
          trackCount: null,
          lastScanIso: null,
          removable: false,
        },
    additional,
  };
}

export function addAdditionalMusicFolder(
  userData: string,
  cfg: DesktopRuntimeConfig,
  folderPath: string,
): { result: AddAdditionalMusicFolderResult; config: DesktopRuntimeConfig } {
  const existing = cfg.additionalMusicFolders ?? [];
  if (existing.includes(folderPath) || folderPath === cfg.musicFolderPath?.trim()) {
    return {
      result: { status: "already_added", path: folderPath },
      config: cfg,
    };
  }
  const patched = patchRuntimeConfig(userData, cfg, {
    additionalMusicFolders: [...existing, folderPath],
  });
  return {
    result: {
      status: "ok",
      source: makeMusicLibrarySource(folderPath, "additional", true),
    },
    config: patched,
  };
}

export function removeAdditionalMusicFolder(
  userData: string,
  cfg: DesktopRuntimeConfig,
  folderPath: string,
): { result: RemoveAdditionalMusicFolderResult; config: DesktopRuntimeConfig } {
  const existing = cfg.additionalMusicFolders ?? [];
  if (!existing.includes(folderPath)) {
    return { result: { status: "not_found" }, config: cfg };
  }
  const patched = patchRuntimeConfig(userData, cfg, {
    additionalMusicFolders: existing.filter((p) => p !== folderPath),
  });
  return { result: { status: "ok" }, config: patched };
}

export async function scanMusicLibrary(
  _userData: string,
  _cfg: DesktopRuntimeConfig,
): Promise<ScanMusicLibraryResult> {
  return {
    status: "ok",
    scannedAtIso: new Date().toISOString(),
    sources: [],
  };
}
