/**
 * P0 Video V1 (owner-approved 2026-10-09) — per-station switch for MPV-rendered video (picture + sound from the SAME
 * player). OFF by default: with no file / unreadable file / enabled=false the music decks run today's audio-only engine
 * with byte-identical arguments. The switch is read ONCE at startup (MPV is spawned with or without video), so a change
 * applies at the next VONO start — never by restarting MPV under playing audio.
 *
 * Stored in `C:\ProgramData\VONO\state\video-output.json` (atomic tmp + rename). Machine-local only.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { vonoStateDir } from "./vono-paths";

export type VideoOutputConfig = { enabled: boolean };

let pathOverride: string | null = null;
/** Tests only: redirect to a temp file. */
export function setVideoOutputConfigPathForTests(p: string | null): void {
  pathOverride = p;
}

function configPath(): string {
  return pathOverride ?? path.join(vonoStateDir(), "video-output.json");
}

export function readVideoOutputConfig(): VideoOutputConfig {
  try {
    const p = configPath();
    if (!existsSync(p)) return { enabled: false };
    const raw = JSON.parse(readFileSync(p, "utf-8")) as { enabled?: unknown };
    return { enabled: raw?.enabled === true };
  } catch {
    return { enabled: false };
  }
}

export function writeVideoOutputConfig(cfg: VideoOutputConfig): boolean {
  const p = configPath();
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, JSON.stringify({ enabled: cfg.enabled === true, updatedAt: Date.now() }), "utf-8");
    renameSync(tmp, p);
    return true;
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return false;
  }
}
