/**
 * VONO heartbeat writer (PHASE 1 — heartbeat only).
 *
 * Writes `C:\ProgramData\VONO\state\heartbeat.json` from the desktop MAIN process so a future
 * external Watchdog can tell APP / MPV / PLAYBACK-PROGRESSING apart (RENDERER layer is reserved).
 * Fed by the EXISTING `manager.onStatus(...)` callback in ipc-mvp.ts — no renderer / IPC change.
 *
 * Write policy (keeps disk writes minimal):
 *   - a fixed BEAT every VONO_HEARTBEAT_INTERVAL_MS refreshes `writtenAt` (the liveness signal);
 *   - a meaningful MPV transition (status / engineReady / lastError / attemptId) writes promptly;
 *   - position-only changes ride the next beat (never a per-tick write);
 *   - all writes are coalesced to at most ~1×/s and are atomic (tmp + rename).
 *
 * NO control.json / maintenance / intentional-stop here — that is a separate future phase.
 */

import { writeFileSync, renameSync } from "node:fs";
import { vonoHeartbeatPath } from "./vono-paths";
import {
  VONO_HEARTBEAT_SCHEMA_VERSION,
  VONO_HEARTBEAT_INTERVAL_MS,
  type VonoHeartbeat,
  type VonoPlaybackStatus,
} from "../shared/vono-runtime-state";
import type { MvpStatusSnapshot } from "../shared/mvp-types";

/** Coalesce window — never write more than ~1×/s regardless of transitions. */
const MIN_WRITE_GAP_MS = 1000;

type StartMeta = { appVersion: string; pid: number };

let beatTimer: NodeJS.Timeout | null = null;
let coalesceTimer: NodeJS.Timeout | null = null;
let lastWriteAt = 0;

// Process metadata (set on start).
let appVersion = "";
let pid = 0;
let sessionStartedAt = 0;

// Latest observed fields (updated in-memory from MpvStatusSnapshot; a disk write is separate).
let status: VonoPlaybackStatus = "idle";
let position = 0;
let duration = 0;
let positionAt = 0; // epoch ms when `position` last CHANGED
let attemptId = 0;
let engineReady = false;
let mpvLastError: string | null = null;
let branchId: string | null = null;
let deviceId: string | null = null;

function buildHeartbeat(): VonoHeartbeat {
  return {
    schemaVersion: VONO_HEARTBEAT_SCHEMA_VERSION,
    writtenAt: Date.now(),
    intervalMs: VONO_HEARTBEAT_INTERVAL_MS,
    pid,
    appVersion,
    sessionStartedAt,
    bootId: null, // reserved — no reliable cross-process source in pure Node/Electron (see contract)
    branchId,
    deviceId,
    app: { alive: true },
    renderer: { alive: null, lastSeenAt: null }, // reserved — not implemented in phase 1
    mpv: { engineReady, lastError: mpvLastError },
    playback: { status, position, duration, positionAt, attemptId },
  };
}

function writeNow(): void {
  lastWriteAt = Date.now();
  if (coalesceTimer) {
    clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
  const target = vonoHeartbeatPath();
  const tmp = `${target}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(buildHeartbeat()), "utf8");
    renameSync(tmp, target); // atomic replace (NTFS MoveFileEx REPLACE_EXISTING) — reader never sees a partial file
  } catch {
    // Best-effort: a transient lock / rename failure is retried on the next beat; never throw into the app.
  }
}

/** Immediate write if the coalesce window has elapsed, else schedule a single deferred write. */
function requestWrite(): void {
  const since = Date.now() - lastWriteAt;
  if (since >= MIN_WRITE_GAP_MS) {
    writeNow();
    return;
  }
  if (coalesceTimer) return;
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null;
    writeNow();
  }, MIN_WRITE_GAP_MS - since);
  if (typeof coalesceTimer.unref === "function") coalesceTimer.unref();
}

/** Start the heartbeat lifecycle: initial write + the periodic freshness beat. Idempotent. */
export function startHeartbeat(meta: StartMeta): void {
  if (beatTimer) return;
  appVersion = meta.appVersion;
  pid = meta.pid;
  sessionStartedAt = Date.now();
  positionAt = Date.now();
  writeNow();
  beatTimer = setInterval(writeNow, VONO_HEARTBEAT_INTERVAL_MS);
  if (typeof beatTimer.unref === "function") beatTimer.unref();
}

/** Stop the heartbeat lifecycle (clears timers only — no control-state write). */
export function stopHeartbeat(): void {
  if (beatTimer) {
    clearInterval(beatTimer);
    beatTimer = null;
  }
  if (coalesceTimer) {
    clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
}

/** Feed the latest MPV/device snapshot (from the existing onStatus callback). No renderer/IPC change. */
export function updateFromMpv(s: MvpStatusSnapshot): void {
  if (!beatTimer) return; // not started yet

  const prevStatus = status;
  const prevEngineReady = engineReady;
  const prevError = mpvLastError;
  const prevAttempt = attemptId;

  const nextPosition = Math.max(0, Math.floor(s.mpvPosition));
  if (nextPosition !== position) positionAt = Date.now(); // position CHANGED → stamp for progression detection

  status = s.mockPlaybackStatus;
  position = nextPosition;
  duration = Math.max(0, Math.floor(s.mpvDuration));
  attemptId = s.mpvAttemptId;
  engineReady = s.mpvEngineReady;
  mpvLastError = s.mpvLastError;
  if (s.branchId) branchId = s.branchId;
  if (s.deviceId) deviceId = s.deviceId;

  // Meaningful transition → write promptly (coalesced). Position-only changes ride the periodic beat.
  const transition =
    status !== prevStatus ||
    engineReady !== prevEngineReady ||
    mpvLastError !== prevError ||
    attemptId !== prevAttempt;
  if (transition) requestWrite();
}
