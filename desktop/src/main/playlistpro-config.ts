/**
 * PlaylistPro runtime config helpers.
 * Stub implementation — PlaylistPro integration is not active in this build.
 * Returns the config unchanged (no PlaylistPro path injection needed).
 */
import type { DesktopRuntimeConfig } from "../shared/mvp-types";

export function ensurePlaylistProRuntimeConfig(
  _userData: string,
  config: DesktopRuntimeConfig,
): DesktopRuntimeConfig {
  return config;
}
