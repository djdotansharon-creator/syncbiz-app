/**
 * Read/write the per-user manifest at `userData/bin/manifest.json`.
 *
 * The manifest is the source of truth for "what binaries do we have installed
 * and at what version?". If it's missing/corrupt we recover by re-running the
 * resolver, which treats a missing entry as a cache miss.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { app } from "electron";

import type { BinaryName, Manifest, ManifestEntry } from "./types";

const MANIFEST_VERSION = 1 as const;

export function binDir(): string {
  return path.join(app.getPath("userData"), "bin");
}

function manifestPath(): string {
  return path.join(binDir(), "manifest.json");
}

export async function readManifest(): Promise<Manifest> {
  try {
    const buf = await fs.readFile(manifestPath(), "utf-8");
    const parsed = JSON.parse(buf) as Manifest;
    if (parsed.version !== MANIFEST_VERSION || typeof parsed.entries !== "object") {
      // Schema drift — start fresh. We never silently migrate; a clean re-
      // resolve is cheap (two small HTTP calls) and avoids subtle bugs.
      return emptyManifest();
    }
    return parsed;
  } catch {
    return emptyManifest();
  }
}

export async function writeManifest(m: Manifest): Promise<void> {
  await fs.mkdir(binDir(), { recursive: true });
  // Write via tmp+rename to avoid a half-written manifest after a crash.
  const tmp = manifestPath() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(m, null, 2), "utf-8");
  await fs.rename(tmp, manifestPath());
}

export async function updateEntry(name: BinaryName, entry: ManifestEntry): Promise<void> {
  const m = await readManifest();
  m.entries[name] = entry;
  await writeManifest(m);
}

export async function getEntry(name: BinaryName): Promise<ManifestEntry | null> {
  const m = await readManifest();
  return m.entries[name] ?? null;
}

export async function touchLastChecked(name: BinaryName): Promise<void> {
  const m = await readManifest();
  const e = m.entries[name];
  if (!e) return;
  e.lastCheckedAt = new Date().toISOString();
  await writeManifest(m);
}

function emptyManifest(): Manifest {
  return { version: MANIFEST_VERSION, entries: {} };
}
