/**
 * Persists deleted source IDs so they stay hidden across server restarts.
 * Sources from mock-data that the user deletes are added here.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const FILE_PATH = join(DATA_DIR, "deleted-sources.json");

async function ensureDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function getDeletedSourceIds(): Promise<Set<string>> {
  try {
    await ensureDir();
    const raw = await readFile(FILE_PATH, "utf-8");
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
  await writeFile(FILE_PATH, JSON.stringify([...set], null, 2), "utf-8");
}
