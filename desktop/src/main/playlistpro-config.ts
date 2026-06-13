import { existsSync } from "node:fs";
import type { DesktopRuntimeConfig } from "../shared/mvp-types";
import {
  PLAYLISTPRO_METADATA_BANK_ROOT,
  PLAYLISTPRO_MUSIC_ROOT,
} from "../shared/playlistpro-paths";
import { patchRuntimeConfig } from "./runtime-config-service";

/**
 * Apply fixed PlaylistPro roots when unset and the default folders exist on disk.
 * Operator overrides in runtime config are preserved when already set.
 */
export function resolvePlaylistProDefaultPaths(config: DesktopRuntimeConfig): Partial<DesktopRuntimeConfig> {
  const patch: Partial<DesktopRuntimeConfig> = {};
  if (!config.musicFolderPath?.trim() && existsSync(PLAYLISTPRO_MUSIC_ROOT)) {
    patch.musicFolderPath = PLAYLISTPRO_MUSIC_ROOT;
  }
  if (!config.localMetadataBankPath?.trim() && existsSync(PLAYLISTPRO_METADATA_BANK_ROOT)) {
    patch.localMetadataBankPath = PLAYLISTPRO_METADATA_BANK_ROOT;
  }
  return patch;
}

export function ensurePlaylistProRuntimeConfig(
  userData: string,
  config: DesktopRuntimeConfig,
): DesktopRuntimeConfig {
  const patch = resolvePlaylistProDefaultPaths(config);
  if (Object.keys(patch).length === 0) return config;
  return patchRuntimeConfig(userData, config, patch);
}
