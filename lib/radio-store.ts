/**
 * File-based radio stream storage.
 * Stores each station as a JSON file in radio/ folder.
 */

import { mkdir, readdir, readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import type { RadioStream } from "./source-types";

const RADIO_DIR = join(process.cwd(), "radio");

async function ensureRadioDir(): Promise<void> {
  try {
    await mkdir(RADIO_DIR, { recursive: true });
  } catch (e) {
    console.error("[radio-store] Failed to create radio dir:", e);
    throw e;
  }
}

function radioPath(id: string): string {
  return join(RADIO_DIR, `${id}.json`);
}

function generateId(): string {
  return `radio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export type RadioCreateInput = {
  id?: string;
  name: string;
  url: string;
  genre?: string;
  cover?: string | null;
};

export async function listRadioStations(): Promise<RadioStream[]> {
  await ensureRadioDir();
  const files = await readdir(RADIO_DIR);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const stations: RadioStream[] = [];

  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(RADIO_DIR, file), "utf-8");
      const data = JSON.parse(content) as RadioStream & { title?: string };
      if (data.id && (data.name || data.title) && data.url) {
        stations.push({ ...data, name: data.name || data.title || "Unknown" });
      }
    } catch (e) {
      console.warn("[radio-store] Skipped invalid file:", file, e);
    }
  }

  return stations.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function getRadioStation(id: string): Promise<RadioStream | null> {
  await ensureRadioDir();
  try {
    const content = await readFile(radioPath(id), "utf-8");
    const data = JSON.parse(content) as RadioStream & { title?: string };
    return { ...data, name: data.name || data.title || "Unknown" };
  } catch {
    return null;
  }
}

export async function createRadioStation(input: RadioCreateInput): Promise<RadioStream> {
  await ensureRadioDir();
  const id = input.id ?? generateId();
  const station: RadioStream = {
    id,
    name: input.name.trim(),
    url: input.url.trim(),
    genre: (input.genre ?? "Radio").trim(),
    cover: input.cover ?? null,
    createdAt: new Date().toISOString(),
  };
  const toWrite = { ...station, title: station.name, type: "radio" as const };
  await writeFile(radioPath(id), JSON.stringify(toWrite, null, 2), "utf-8");
  return station;
}

export async function updateRadioStation(id: string, data: Partial<RadioStream>): Promise<RadioStream | null> {
  const existing = await getRadioStation(id);
  if (!existing) return null;
  const updated: RadioStream = { ...existing, ...data, id };
  await writeFile(radioPath(id), JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

export async function deleteRadioStation(id: string): Promise<boolean> {
  await ensureRadioDir();
  try {
    await unlink(radioPath(id));
    return true;
  } catch {
    return false;
  }
}
