/**
 * Local metadata bank helpers (device-local Tag&Rename folder, never uploaded).
 * Stub: metadata bank is not implemented in this build.
 */
import type {
  DesktopRuntimeConfig,
  LocalMetadataBankStatusResult,
  RefreshLocalMetadataBankResult,
} from "../shared/mvp-types";

export function defaultLocalMetadataBankPickerPath(): string | null {
  return null;
}

export function getLocalMetadataBankStatus(
  _userData: string,
  cfg: DesktopRuntimeConfig,
): LocalMetadataBankStatusResult {
  return {
    folderPath: cfg.localMetadataBankPath?.trim() || null,
    lastImport: null,
  };
}

export function setLocalMetadataBankFolder(
  _userData: string,
  _cfg: DesktopRuntimeConfig,
  _folderPath: string,
): void {
  // Not implemented in this build
}

export async function refreshLocalMetadataBank(
  _userData: string,
  _cfg: DesktopRuntimeConfig,
): Promise<RefreshLocalMetadataBankResult> {
  return { status: "error", message: "Local metadata bank is not available in this build." };
}
