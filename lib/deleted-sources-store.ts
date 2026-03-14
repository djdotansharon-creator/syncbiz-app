/**
 * Persists deleted source IDs so they stay hidden across server restarts.
 * Sources from mock-data that the user deletes are added here.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getDataDir } from "./data-path";

function getFilePath(): string {
  return join(getDataDir(), "deleted-sources.json");
}

async function ensureDir(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}

export async function getDeletedSourceIds(): Promise<Set<string>> {
  try {
    await ensureDir();
    const raw = await readFile(getFilePath(), "utf-8");
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export async function addDeletedSourceId(id: string): Promise<void> {
  const set = await getDeletedSourceIds();
  set.add(id);
  await ensureDir();
  await writeFile(getFilePath(), JSON.stringify([...set], null, 2), "utf-8");
}
