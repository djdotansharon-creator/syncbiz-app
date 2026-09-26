/**
 * VONO runtime-state contract — the shared, versioned schema between the VONO desktop app (the
 * WRITER) and the future external VONO Watchdog (the READER).
 *
 * PHASE 1 implements the HEARTBEAT only (see heartbeat-writer.ts). `VonoControlState` is declared
 * here for the FUTURE maintenance / intentional-stop feature so the contract is stable — but there
 * is NO writer and NO consumer for it yet. Do not write control state in phase 1.
 */

export const VONO_HEARTBEAT_SCHEMA_VERSION = 1;

/**
 * Default heartbeat beat cadence (ms). Also written INTO the file as `intervalMs`, so the reader can
 * derive its staleness threshold as k × intervalMs rather than hardcoding it.
 */
export const VONO_HEARTBEAT_INTERVAL_MS = 5000;

export type VonoPlaybackStatus = "idle" | "playing" | "paused" | "stopped";

/**
 * heartbeat.json — written atomically by the VONO main process to
 * `C:\ProgramData\VONO\state\heartbeat.json`.
 *
 * The four watchdog signals are DERIVED by the reader from raw facts here (the contract is designed
 * to separate all four, even though phase 1 does not yet feed the renderer layer):
 *   - APP ALIVE            = `writtenAt` fresh (now − writtenAt < k × intervalMs)
 *   - RENDERER ALIVE       = renderer.alive === true && renderer.lastSeenAt fresh  (reserved; null now)
 *   - MPV ALIVE            = mpv.engineReady === true
 *   - PLAYBACK PROGRESSING = playback.status === "playing" && position advancing (positionAt moving)
 */
export interface VonoHeartbeat {
  schemaVersion: number;
  /** epoch ms (wall clock) — the freshness signal; bumped on every write. */
  writtenAt: number;
  /** the beat cadence in ms — reader derives staleness = k × intervalMs. */
  intervalMs: number;
  pid: number;
  appVersion: string;
  /** epoch ms when THIS app process started (distinguishes a relaunch from a long-lived process). */
  sessionStartedAt: number;
  /**
   * Machine boot identifier — RESERVED, `null` in phase 1. No simple/reliable source that is
   * identical across processes for a whole boot exists in pure Node/Electron on Windows
   * (`os.uptime()`-derived values drift by ~1s between calls/processes). The canonical future source
   * is WMI `Win32_OperatingSystem.LastBootUpTime`; only needed once control-state anti-stale is built.
   */
  bootId: number | null;
  /** Org→Branch→Device identity — populated from the WS registration when available, else null. */
  branchId: string | null;
  deviceId: string | null;

  /** Main process is running and writing this file. */
  app: { alive: boolean };
  /** RESERVED for a future renderer→main ping. `null` until implemented (needs a renderer change). */
  renderer: { alive: boolean | null; lastSeenAt: number | null };
  mpv: { engineReady: boolean; lastError: string | null };
  playback: {
    status: VonoPlaybackStatus;
    /** seconds, floored. */
    position: number;
    /** seconds, floored (0 = live / radio). */
    duration: number;
    /** epoch ms when `position` last CHANGED — lets the reader detect a stall while status==="playing". */
    positionAt: number;
    attemptId: number;
  };
}

/**
 * FUTURE — NOT implemented in phase 1 (no writer, no consumer). Maintenance / intentional-stop
 * state, always bounded by `expiresAt` (+ `bootId` once available) so a stale value can never keep a
 * branch down after a reboot. Declared now only to keep the contract stable for the Watchdog.
 */
export type VonoControlMode = "none" | "maintenance" | "intentional_stop";
export interface VonoControlState {
  schemaVersion: number;
  mode: VonoControlMode;
  reason: string;
  source: "installer" | "app" | "protect" | "admin";
  createdAt: number;
  /** epoch ms — the state is IGNORED once now >= expiresAt (anti-stale). */
  expiresAt: number;
  /** the boot the state was created in — voided after a reboot once a real bootId source exists. */
  bootId: number | null;
}
