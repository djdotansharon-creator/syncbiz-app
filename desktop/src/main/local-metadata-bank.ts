/**
 * Local Metadata Bank — managed folder of Tag&Rename XLSX files (device-only).
 * Never committed, never uploaded. Enriches the local collection snapshot for search + DJ Creator.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { DesktopRuntimeConfig } from "../shared/mvp-types";
import type { RefreshLocalMetadataBankResult } from "../shared/mvp-types";
import { PLAYLISTPRO_METADATA_BANK_ROOT } from "../shared/playlistpro-paths";
import {
  TAG_RENAME_XLSX_DEFAULT_DIR,
  importTagRenameXlsxFiles,
  listTagRenameXlsxFilesInFolder,
} from "./import-tag-rename-xlsx";
import { patchRuntimeConfig } from "./runtime-config-service";

const LOG = "[SyncBiz:local-metadata-bank]";
const STATE_FILENAME = "local-metadata-bank-last-import.json";

export type LocalMetadataBankLastImport = {
  folderPath: string;
  importedAt: string;
  filesScanned: number;
  filesProcessed: number;
  rowsRead: number;
  matched: number;
  updated: number;
  unmatched: number;
  outsideMusicFolder: number;
  missingOnDisk: number;
};

export type LocalMetadataBankStatus = {
  folderPath: string | null;
  lastImport: LocalMetadataBankLastImport | null;
};

export type PickLocalMetadataBankFolderResult =
  | { status: "ok"; path: string }
  | { status: "canceled" }
  | { status: "error"; message: string };

function statePath(userData: string): string {
  return path.join(userData, STATE_FILENAME);
}

export function loadLocalMetadataBankLastImport(userData: string): LocalMetadataBankLastImport | null {
  const p = statePath(userData);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as Partial<LocalMetadataBankLastImport>;
    if (!raw || typeof raw.importedAt !== "string") return null;
    return {
      folderPath: typeof raw.folderPath === "string" ? raw.folderPath : "",
      importedAt: raw.importedAt,
      filesScanned: typeof raw.filesScanned === "number" ? raw.filesScanned : 0,
      filesProcessed: typeof raw.filesProcessed === "number" ? raw.filesProcessed : 0,
      rowsRead: typeof raw.rowsRead === "number" ? raw.rowsRead : 0,
      matched: typeof raw.matched === "number" ? raw.matched : 0,
      updated: typeof raw.updated === "number" ? raw.updated : 0,
      unmatched: typeof raw.unmatched === "number" ? raw.unmatched : 0,
      outsideMusicFolder: typeof raw.outsideMusicFolder === "number" ? raw.outsideMusicFolder : 0,
      missingOnDisk: typeof raw.missingOnDisk === "number" ? raw.missingOnDisk : 0,
    };
  } catch {
    return null;
  }
}

function saveLocalMetadataBankLastImport(userData: string, summary: LocalMetadataBankLastImport): void {
  try {
    mkdirSync(userData, { recursive: true });
    writeFileSync(statePath(userData), JSON.stringify(summary, null, 2), "utf-8");
  } catch (e) {
    console.warn(LOG, "could not write last-import state", e);
  }
}

export function getLocalMetadataBankStatus(
  userData: string,
  config: DesktopRuntimeConfig,
): LocalMetadataBankStatus {
  const folderPath =
    typeof config.localMetadataBankPath === "string" && config.localMetadataBankPath.trim()
      ? config.localMetadataBankPath.trim()
      : null;
  return {
    folderPath,
    lastImport: loadLocalMetadataBankLastImport(userData),
  };
}

export function defaultLocalMetadataBankPickerPath(): string | undefined {
  if (existsSync(PLAYLISTPRO_METADATA_BANK_ROOT)) return PLAYLISTPRO_METADATA_BANK_ROOT;
  if (existsSync(TAG_RENAME_XLSX_DEFAULT_DIR)) return TAG_RENAME_XLSX_DEFAULT_DIR;
  const repoDev = path.resolve(process.cwd(), ".local-imports", "PLP-Playlist");
  if (existsSync(repoDev)) return repoDev;
  return undefined;
}

export function setLocalMetadataBankFolder(
  userData: string,
  config: DesktopRuntimeConfig,
  folderPath: string,
): DesktopRuntimeConfig {
  const trimmed = folderPath.trim();
  return patchRuntimeConfig(userData, config, {
    localMetadataBankPath: trimmed.length > 0 ? trimmed : undefined,
  });
}

/**
 * Scan all .xlsx/.xls under the configured metadata bank folder and merge into the local snapshot.
 */
export async function refreshLocalMetadataBank(
  userData: string,
  config: DesktopRuntimeConfig,
): Promise<RefreshLocalMetadataBankResult> {
  const bankPath =
    typeof config.localMetadataBankPath === "string" ? config.localMetadataBankPath.trim() : "";
  if (!bankPath) {
    return { status: "error", message: "Set a Local Metadata Bank folder first." };
  }
  let bankStat;
  try {
    bankStat = await stat(bankPath);
  } catch {
    return { status: "error", message: `Metadata bank folder not found: ${bankPath}` };
  }
  if (!bankStat.isDirectory()) {
    return { status: "error", message: "Metadata bank path is not a folder." };
  }

  const xlsxFiles = listTagRenameXlsxFilesInFolder(bankPath);
  if (xlsxFiles.length === 0) {
    return {
      status: "error",
      message: `No .xlsx or .xls files found under ${bankPath}`,
    };
  }

  const importResult = await importTagRenameXlsxFiles(userData, config, xlsxFiles);
  if (importResult.status !== "ok") {
    return importResult;
  }

  const importedAt = new Date().toISOString();
  const summary: LocalMetadataBankLastImport = {
    folderPath: bankPath,
    importedAt,
    filesScanned: xlsxFiles.length,
    filesProcessed: importResult.filesProcessed,
    rowsRead: importResult.rowsRead,
    matched: importResult.matched,
    updated: importResult.updated,
    unmatched: importResult.unmatched,
    outsideMusicFolder: importResult.outsideMusicFolder,
    missingOnDisk: importResult.missingOnDisk,
  };
  saveLocalMetadataBankLastImport(userData, summary);

  console.info(LOG, "bank refresh complete", summary);

  return {
    status: "ok",
    folderPath: bankPath,
    importedAt,
    filesScanned: xlsxFiles.length,
    filesProcessed: importResult.filesProcessed,
    rowsRead: importResult.rowsRead,
    matched: importResult.matched,
    updated: importResult.updated,
    unmatched: importResult.unmatched,
    outsideMusicFolder: importResult.outsideMusicFolder,
    missingOnDisk: importResult.missingOnDisk,
    sampleUnmatchedPaths: importResult.sampleUnmatchedPaths,
  };
}
