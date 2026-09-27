/**
 * Machine-wide VONO runtime directory resolver.
 *
 * On Windows this is `C:\ProgramData\VONO` so both the user-session app (the heartbeat WRITER) and a
 * future LocalSystem service (the READER) can share it. On non-Windows (dev / mac / linux, not the
 * pilot) we fall back to an OS temp location so nothing crashes during development.
 *
 * NOTE (future, not phase 1): when the LocalSystem Watchdog is added, the `VONO` folder ACL must let
 * the user-session app write and LocalSystem read. Creating the folder as the user under ProgramData
 * works today; SYSTEM can already read anything under ProgramData.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

function vonoRootDir(): string {
  if (process.platform === "win32") {
    const programData = process.env.ProgramData || "C:\\ProgramData";
    return path.join(programData, "VONO");
  }
  return path.join(os.tmpdir(), "VONO");
}

/** `…\VONO\state` — created if missing. Holds heartbeat.json (and, in future, control.json). */
export function vonoStateDir(): string {
  const dir = path.join(vonoRootDir(), "state");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort; the writer tolerates a missing dir and retries next beat */
  }
  return dir;
}

/** Absolute path to the heartbeat file. */
export function vonoHeartbeatPath(): string {
  return path.join(vonoStateDir(), "heartbeat.json");
}
