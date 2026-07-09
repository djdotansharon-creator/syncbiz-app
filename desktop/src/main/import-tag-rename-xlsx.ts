/**
 * Tag&Rename / PLP-Playlist XLSX import helpers.
 * Stub: XLSX tag import is not implemented in this build.
 */
import type {
  DesktopRuntimeConfig,
  ImportTagRenameXlsxFilesResult,
} from "../shared/mvp-types";

export function defaultTagRenameXlsxPickerPath(): string | null {
  return null;
}

export async function importTagRenameXlsxFiles(
  _userData: string,
  _cfg: DesktopRuntimeConfig,
  _filePaths: string[],
): Promise<ImportTagRenameXlsxFilesResult> {
  return { status: "error", message: "Tag&Rename XLSX import is not available in this build." };
}
