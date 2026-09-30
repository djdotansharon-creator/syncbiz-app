/**
 * VONO runtime-state contract — the shared, versioned schema between the VONO desktop app (the
 * WRITER) and the future external VONO Watchdog (the READER).
 *
 * The heartbeat (heartbeat-writer.ts) is the liveness signal. `VonoControlState` (control.json) is the
 * recovery-suppression directive: as of Phase B1 the app WRITES `intentional_stop` on an explicit "Exit VONO"
 * while Protection is ON (protection-service.ts), and the external Watchdog READS it. `maintenance` remains
 * reserved for installer/update windows. See VonoControlState below for the two lifetimes.
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
  /**
   * Absolute path to the VONO executable (`process.execPath`). LOCAL ONLY — used by the external
   * Watchdog to relaunch/restart THIS install. It is NEVER sent to Fleet telemetry / Cloud (a path
   * can leak the machine/user layout). Optional so older heartbeats without it still parse.
   */
  execPath?: string;
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
 * Control state (`control.json`) — read by the external Watchdog to suppress recovery.
 *
 * Two active modes, with DIFFERENT lifetimes (Phase B1):
 *   - `maintenance`     — BOUNDED: active only while now < expiresAt (anti-stale so it can't keep a branch
 *                         down forever). Used for installer/update windows.
 *   - `intentional_stop`— PERSISTENT: `expiresAt: null`, active INDEFINITELY until the marker is explicitly
 *                         cleared (a manual VONO start clears it). An explicit "Exit VONO" must keep VONO
 *                         closed until the operator starts it again — it must NEVER wake itself on a timer.
 * `none` means no active directive.
 */
export type VonoControlMode = "none" | "maintenance" | "intentional_stop";
export type VonoControlSource = "installer" | "app" | "protect" | "admin";

export type VonoControlState =
  | {
      schemaVersion: number;
      mode: "maintenance";
      reason: string;
      source: VonoControlSource;
      createdAt: number;
      /** epoch ms — the directive is IGNORED once now >= expiresAt (anti-stale). */
      expiresAt: number;
      bootId: number | null;
    }
  | {
      schemaVersion: number;
      mode: "intentional_stop";
      reason: string;
      source: VonoControlSource;
      createdAt: number;
      /** null — persistent until the marker is explicitly cleared (never expires on a timer). */
      expiresAt: null;
      bootId: number | null;
    }
  | {
      schemaVersion: number;
      mode: "none";
      reason: string;
      source: VonoControlSource;
      createdAt: number;
      expiresAt: number | null;
      bootId: number | null;
    };

/**
 * Health states derived by the external Watchdog from the heartbeat + control contract above. Declared
 * HERE (the single contract) so the watchdog, the future Fleet Protect telemetry, and any UI all use
 * ONE definition — no duplicate/drift. The watchdog owns the detection thresholds + recovery actions;
 * this file owns only the shared vocabulary. Exactly the 7 canonical states.
 */
export type WatchdogState =
  | "HEALTHY"
  | "APP_MISSING"
  | "RENDERER_STALE"
  | "MPV_DOWN"
  | "PLAYBACK_STALLED"
  | "RECOVERING"
  | "MAINTENANCE";

/** Recovery actions a (future) active watchdog may take. In the READ-ONLY observer these are only
 *  COMPUTED + logged as "would do", never executed. */
export type RecoveryAction =
  | "none"
  | "launch_app"
  | "reload_renderer"
  | "restart_app"
  | "await_recovery";
