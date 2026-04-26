/**
 * MpvManager — spawns MPV as a child process and communicates via its
 * JSON IPC socket (Windows named pipe / Unix socket).
 *
 * Only the main process ever instantiates this class.
 *
 * Watchdog (managed engine):
 *  - **IPC-only recovery**: if the child is alive but the socket died, we reconnect
 *    (bounded attempts + backoff) — no process restart.
 *  - **Process recovery**: on child exit, fatal initial IPC, or persistent IPC loss,
 *    we `kill` (if still alive) and respawn the same `mpv` with debounce + a rolling
 *    rate cap to avoid thrash. `app.quit` uses `disposed` to disable all recovery.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { normalizeMpvLoadTarget } from "./mpv-input-normalize";

const PIPELINE = "[SyncBiz:desktop-mpv:bridge]";
const WATCHDOG = "[SyncBiz:desktop-mpv:watchdog]";

const IPC_RECONNECT_MAX = 3;
const IPC_RECONNECT_BACKOFF_MS = 800;
const CONNECT_PIPE_RETRIES = 6;
const CONNECT_PIPE_RETRY_MS = 500;
const POST_SPAWN_IPC_DELAY_MS = 600;
const PROCESS_RESTART_DEBOUNCE_MS = 500;
/** Per rolling window, max automatic process (re)spawns. */
const PROCESS_RESTART_WINDOW_MS = 60_000;
const MAX_RESPAWNS_PER_60S = 3;

function resolvePipePath(pipeName: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\${pipeName}`
    : `/tmp/${pipeName}.sock`;
}

/**
 * Absolute binary paths provided by the runtime-binaries layer.
 * MpvManager does NOT look up binaries itself any more — the runtime-binaries
 * module is the single place that knows how to find/install mpv + yt-dlp.
 */
export type MpvBinaries = {
  /** Absolute path to `mpv` / `mpv.exe`. */
  mpvBin: string;
  /** Absolute path to `yt-dlp` / `yt-dlp.exe`, or `null` if not available. */
  ytDlpBin: string | null;
};

export type MpvPlaybackStatus = "idle" | "playing" | "paused" | "stopped";

export type MpvStatus = {
  status: MpvPlaybackStatus;
  position: number; // seconds, floored
  duration: number; // seconds, floored
  volume: number;   // 0–100
  /**
   * true when the mpv process is running and JSON IPC is connected. Commands that change output
   * are only possible when this is true (or while IPC is still connecting, commands may be queued).
   * false after crash, process exit, or IPC loss until reconnected.
   */
  engineReady: boolean;
  /**
   * Last user-visible engine issue (load failure, missing binary, IPC drop, process exit, IPC command error).
   * Cleared on successful start-file or successful IPC reconnect handshake.
   */
  lastError: string | null;
};

export function createInitialMpvStatus(): MpvStatus {
  return {
    status: "idle",
    position: 0,
    duration: 0,
    volume: 80,
    engineReady: false,
    lastError: null,
  };
}

type MpvStatusCallback = (status: MpvStatus) => void;

export class MpvManager {
  private readonly pipePath: string;
  private child: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private buffer = "";
  private statusCb: MpvStatusCallback | null = null;
  /** Commands queued while the IPC socket is not yet connected. Flushed on connect. */
  private cmdQueue: string[] = [];

  private st: MpvStatus = createInitialMpvStatus();
  private disposed = false;
  private ipcReconnectAttempt = 0;
  private ipcReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private processRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private processRespawnTimestamps: number[] = [];
  /**
   * Last `start()` binaries for watchdog respawn. Not cleared on process exit
   * so we can relaunch the same engine without restarting Electron.
   */
  private lastBinaries: MpvBinaries | null = null;
  private ytDlpArgFragment: string[] = [];
  /** If we kill the process because IPC recovery failed, exit handler uses a clearer `lastError`. */
  private pendingExitDetail: string | null = null;

  /** @param pipeName Unique name for this instance's IPC socket (e.g. "syncbiz-music"). */
  constructor(pipeName = "syncbiz-mpv") {
    this.pipePath = resolvePipePath(pipeName);
  }

  /** Register a listener that fires on every MPV status change. */
  onStatus(cb: MpvStatusCallback): void {
    this.statusCb = cb;
  }

  private push(): void {
    this.statusCb?.({ ...this.st });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start MPV. Binary paths must be resolved and passed in by the caller
   * (`PlaybackOrchestrator`, which obtains them from
   * `runtime-binaries/ensureRuntimeBinaries`).
   */
  start(binaries: MpvBinaries): void {
    this.lastBinaries = binaries;
    const bin = binaries.mpvBin;
    if (!existsSync(bin)) {
      this.st.lastError = `mpv binary not found at ${bin} (check runtime-binaries / userData bin)`;
      this.st.engineReady = false;
      this.st.status = "idle";
      this.push();
      console.warn(PIPELINE, "binary not found —", this.st.lastError);
      return;
    }

    const hasYtDlp = !!binaries.ytDlpBin && existsSync(binaries.ytDlpBin!);
    const ytDlpFwdSlash = hasYtDlp ? binaries.ytDlpBin!.replace(/\\/g, "/") : "";
    this.ytDlpArgFragment = hasYtDlp ? [`--script-opts=ytdl_hook-ytdl_path=${ytDlpFwdSlash}`] : [];
    if (hasYtDlp) {
      console.log("[MpvManager]", this.pipePath, "yt-dlp resolved →", binaries.ytDlpBin, "— YouTube playback enabled");
    } else {
      console.log("[MpvManager]", this.pipePath, "yt-dlp unavailable — YouTube URLs will fail");
    }

    this.spawnMpvChild("initial start");
  }

  private spawnMpvChild(why: string): void {
    if (this.disposed) return;
    const b = this.lastBinaries;
    if (!b) {
      console.error(WATCHDOG, "no lastBinaries — cannot spawn", { pipe: this.pipePath, why });
      return;
    }
    const bin = b.mpvBin;
    if (!existsSync(bin)) {
      this.st.lastError = `mpv binary not found at ${bin} (check runtime-binaries / userData bin)`;
      this.st.engineReady = false;
      this.st.status = "idle";
      this.push();
      return;
    }

    if (this.child) {
      console.warn(WATCHDOG, "spawnMpvChild ignored — process still running", { pipe: this.pipePath, why });
      return;
    }

    try {
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
    this.socket = null;
    this.buffer = "";
    this.ipcReconnectAttempt = 0;
    this.clearIpcReconnectTimer();

    console.log(WATCHDOG, "spawning mpv", { pipe: this.pipePath, why, bin });

    this.child = spawn(
      bin,
      ["--no-video", "--idle", `--input-ipc-server=${this.pipePath}`, ...this.ytDlpArgFragment],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    this.child.stderr?.on("data", (d: Buffer) => {
      const msg = d.toString("utf-8").trim();
      if (msg) console.log("[MpvManager]", this.pipePath, "mpv:", msg.slice(0, 400));
    });

    this.child.on("error", (err) => {
      this.st.lastError = `mpv spawn error: ${err.message}`;
      this.st.engineReady = false;
      this.st.status = "idle";
      this.push();
      console.error(PIPELINE, "spawn error:", err.message);
      this.child = null;
      this.scheduleProcessRestart("spawn error — will retry if allowed", `spawn: ${err.message}`);
    });

    this.child.on("exit", (code) => {
      this.onMpvProcessExit(code);
    });

    // MPV needs a moment to create the named pipe after spawn.
    setTimeout(() => this.connectPipe(CONNECT_PIPE_RETRIES), POST_SPAWN_IPC_DELAY_MS);
  }

  kill(): void {
    this.disposed = true;
    this.clearIpcReconnectTimer();
    this.clearProcessRestartTimer();
    try {
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
    this.socket = null;
    this.pendingExitDetail = null;
    try {
      this.child?.removeAllListeners("exit");
      this.child?.kill();
    } catch {
      /* ignore */
    }
    this.child = null;
  }

  // ─── Watchdog: process autorestart ──────────────────────────────────────────

  private onMpvProcessExit(code: number | null | undefined): void {
    if (this.disposed) return;
    this.socket = null;
    this.child = null;
    this.st.engineReady = false;
    const fromIpc = this.pendingExitDetail;
    this.pendingExitDetail = null;
    if (fromIpc) {
      this.st.lastError = `[watchdog] ${fromIpc} — process stopped (code ${code ?? "?"})`;
    } else {
      this.st.lastError = `mpv process exited (code: ${code ?? "?"})`;
    }
    this.st.status = "idle";
    this.st.position = 0;
    this.push();
    console.log(PIPELINE, "process exit — scheduling watchdog", { code, pipe: this.pipePath, fromIpc: !!fromIpc });
    this.scheduleProcessRestart(
      "process_exit",
      fromIpc ? `relaunch after: ${fromIpc}` : `relaunch after exit (code ${code})`,
    );
  }

  private scheduleProcessRestart(phase: string, detail: string): void {
    if (this.disposed) return;
    if (this.processRestartTimer) {
      console.log(WATCHDOG, "process restart already scheduled — coalescing", { pipe: this.pipePath, phase });
      return;
    }
    this.processRestartTimer = setTimeout(() => {
      this.processRestartTimer = null;
      this.executeProcessRespawn(phase, detail);
    }, PROCESS_RESTART_DEBOUNCE_MS);
  }

  private executeProcessRespawn(phase: string, detail: string): void {
    if (this.disposed) return;
    const now = Date.now();
    this.processRespawnTimestamps = this.processRespawnTimestamps.filter((t) => now - t < PROCESS_RESTART_WINDOW_MS);
    if (this.processRespawnTimestamps.length >= MAX_RESPAWNS_PER_60S) {
      this.st.lastError = `mpv watchdog: too many process restarts in ${PROCESS_RESTART_WINDOW_MS / 1000}s — check mpv/IPC logs or restart SyncBiz (pipe: ${this.pipePath})`;
      this.st.engineReady = false;
      this.st.status = "idle";
      this.push();
      console.error(WATCHDOG, "rate cap hit — not respawning", { pipe: this.pipePath, detail, phase });
      return;
    }
    this.processRespawnTimestamps.push(now);
    this.st.lastError = `[watchdog] restarting mpv (${detail})…`;
    this.st.engineReady = false;
    this.st.status = "idle";
    this.push();
    console.log(WATCHDOG, "process respawn", { pipe: this.pipePath, phase, detail });
    this.spawnMpvChild(detail);
  }

  private clearIpcReconnectTimer(): void {
    if (this.ipcReconnectTimer) {
      clearTimeout(this.ipcReconnectTimer);
      this.ipcReconnectTimer = null;
    }
  }

  private clearProcessRestartTimer(): void {
    if (this.processRestartTimer) {
      clearTimeout(this.processRestartTimer);
      this.processRestartTimer = null;
    }
  }

  /** IPC-only recovery while `child` is still alive. Does not respawn. */
  private handlePersistentIpcFailure(reason: string): void {
    this.clearIpcReconnectTimer();
    this.st.engineReady = false;
    this.st.status = "idle";
    this.st.lastError = `[watchdog] ${reason} — will restart process`;
    this.push();
    console.error(PIPELINE, "persistent IPC failure — killing child for respawn", { reason, pipe: this.pipePath });
    if (!this.child) {
      this.scheduleProcessRestart("ipc_stale_no_child", reason);
      return;
    }
    this.pendingExitDetail = reason;
    try {
      this.child.removeAllListeners("exit");
      this.child.once("exit", (code) => {
        this.onMpvProcessExit(code);
      });
      this.child.kill();
    } catch (e) {
      console.error(PIPELINE, "failed to kill child after IPC failure", e);
      this.child = null;
      this.onMpvProcessExit(-1);
    }
  }

  // ─── IPC pipe ───────────────────────────────────────────────────────────────

  private connectPipe(retries: number): void {
    if (!this.child || this.disposed) return;

    const sock = net.connect(this.pipePath);

    sock.once("connect", () => {
      this.clearIpcReconnectTimer();
      this.ipcReconnectAttempt = 0;
      this.socket = sock;
      this.buffer = "";
      this.st.engineReady = true;
      this.st.lastError = null;
      this.processRespawnTimestamps = [];
      console.log(PIPELINE, "IPC ready — engineReady=true", { pipe: this.pipePath });
      this.push();

      // Observe the properties needed for real-time status.
      this.raw(JSON.stringify({ command: ["observe_property", 1, "pause"] }));
      this.raw(JSON.stringify({ command: ["observe_property", 2, "time-pos"] }));
      this.raw(JSON.stringify({ command: ["observe_property", 3, "duration"] }));
      this.raw(JSON.stringify({ command: ["observe_property", 4, "volume"] }));

      if (this.cmdQueue.length > 0) {
        console.log("[MpvManager]", this.pipePath, "IPC connected — flushing", this.cmdQueue.length, "queued command(s)");
        for (const q of this.cmdQueue) {
          sock.write(q + "\n", "utf-8");
        }
        this.cmdQueue = [];
      } else {
        console.log("[MpvManager]", this.pipePath, "IPC connected");
      }

      sock.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf-8")));
      sock.on("close", () => {
        this.socket = null;
        this.st.engineReady = false;
        this.st.lastError = "MPV IPC socket closed";
        this.st.status = "idle";
        this.push();
        console.error(PIPELINE, "IPC socket closed", { pipe: this.pipePath });
        this.scheduleIpcOnlyReconnect("socket closed");
      });
      sock.on("error", (err) => {
        this.socket = null;
        this.st.engineReady = false;
        this.st.lastError = `MPV IPC socket error: ${err.message}`;
        this.st.status = "idle";
        this.push();
        console.error(PIPELINE, "socket error:", err.message, { pipe: this.pipePath });
        this.scheduleIpcOnlyReconnect(`socket error: ${err.message}`);
      });
    });

    sock.once("error", () => {
      sock.destroy();
      if (retries > 0 && this.child && !this.disposed) {
        setTimeout(() => this.connectPipe(retries - 1), CONNECT_PIPE_RETRY_MS);
      } else {
        this.st.engineReady = false;
        this.st.lastError = "could not connect to MPV IPC (pipe) — is mpv using this instance?";
        this.st.status = "idle";
        this.push();
        console.error(PIPELINE, "IPC connect failed (no more retries in this call)", { pipe: this.pipePath });
        this.handlePersistentIpcFailure("could not open IPC to mpv (initial connect budget exhausted)");
      }
    });
  }

  private scheduleIpcOnlyReconnect(failureHint: string): void {
    if (this.disposed) return;
    if (!this.child) {
      console.warn(PIPELINE, "IPC loss but no child — watchdog will not IPC-reconnect", { pipe: this.pipePath });
      return;
    }
    this.clearIpcReconnectTimer();
    if (this.ipcReconnectAttempt >= IPC_RECONNECT_MAX) {
      this.handlePersistentIpcFailure(`IPC reconnect failed after ${IPC_RECONNECT_MAX} attempts (${failureHint})`);
      return;
    }
    this.ipcReconnectAttempt += 1;
    console.log(PIPELINE, "scheduling IPC-only reconnect", {
      attempt: this.ipcReconnectAttempt,
      max: IPC_RECONNECT_MAX,
      pipe: this.pipePath,
    });
    this.st.lastError = `[watchdog] reconnecting IPC (${this.ipcReconnectAttempt}/${IPC_RECONNECT_MAX}) — ${failureHint}`;
    this.push();
    this.ipcReconnectTimer = setTimeout(() => {
      this.ipcReconnectTimer = null;
      if (this.disposed || !this.child) return;
      this.connectPipe(CONNECT_PIPE_RETRIES);
    }, IPC_RECONNECT_BACKOFF_MS);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t) as Record<string, unknown>;
        this.handleCommandResponseLine(obj, t);
        this.handleEvent(obj);
      } catch {
        // Malformed JSON line from MPV — ignore.
      }
    }
  }

  /** MPV command replies: `{"error":"success",...}` or `{"error":"...failure..."}` (no `event` field on replies). */
  private handleCommandResponseLine(msg: Record<string, unknown>, rawLine: string): void {
    if (msg["event"] !== undefined) return;
    const err = msg["error"];
    if (typeof err !== "string" || err === "success") return;
    this.st.lastError = `mpv IPC: ${err}`;
    this.push();
    console.error(PIPELINE, "IPC command failed", { pipe: this.pipePath, error: err, raw: rawLine.slice(0, 500) });
  }

  private handleEvent(msg: Record<string, unknown>): void {
    const ev = msg["event"] as string | undefined;
    if (!ev) return;

    if (ev === "property-change") {
      const name = msg["name"] as string;
      const data = msg["data"];
      switch (name) {
        case "pause":
          this.st.status = data === true ? "paused" : "playing";
          this.push();
          break;
        case "time-pos":
          if (typeof data === "number") {
            this.st.position = Math.floor(data);
            this.push();
          }
          break;
        case "duration":
          if (typeof data === "number") {
            this.st.duration = Math.floor(data);
            this.push();
          }
          break;
        case "volume":
          if (typeof data === "number") {
            this.st.volume = Math.round(data);
            this.push();
          }
          break;
      }
    } else if (ev === "start-file") {
      this.st.lastError = null;
      console.log(PIPELINE, "event start-file (decoding/playback line active)", { pipe: this.pipePath });
      this.st.status = "playing";
      this.st.position = 0;
      this.push();
    } else if (ev === "end-file") {
      const reason = msg["reason"] as string | undefined;
      if (reason === "error") {
        const fe =
          (typeof msg["file_error"] === "string" && msg["file_error"]) ||
          (typeof msg["error"] === "string" && msg["error"]) ||
          null;
        this.st.status = "idle";
        this.st.lastError = (fe && fe.length > 0 ? fe : "load/playback error (end-file reason=error)") as string;
        this.st.position = 0;
        this.push();
        console.error(PIPELINE, "end-file error", { pipe: this.pipePath, file_error: this.st.lastError });
        return;
      }
      this.st.status = reason === "stop" ? "stopped" : "idle";
      this.st.lastError = null;
      this.st.position = 0;
      this.push();
    }
  }

  // ─── Command helpers ─────────────────────────────────────────────────────────

  private raw(json: string): void {
    if (this.disposed) return;
    if (!this.socket || this.socket.destroyed) {
      if (this.child) {
        console.log(PIPELINE, "socket not ready — queuing (IPC may still connect)", { pipe: this.pipePath, preview: json.slice(0, 120) });
        this.cmdQueue.push(json);
      }
      return;
    }
    this.socket.write(json + "\n", "utf-8");
  }

  private cmd(args: unknown[]): void {
    this.raw(JSON.stringify({ command: args }));
  }

  // ─── Public playback API ─────────────────────────────────────────────────────

  /** Load and immediately play a URL or local file path. */
  play(url: string): void {
    const u = url.trim();
    if (!u) return;
    if (!this.child) {
      this.st.lastError = "play(): mpv is not running (binary missing, process exiting, or watchdog restarting)";
      this.st.status = "idle";
      this.push();
      console.error(PIPELINE, "play() rejected — no process", { pipe: this.pipePath });
      return;
    }
    const { target, kind } = normalizeMpvLoadTarget(u);
    if (!target) return;
    this.cmdQueue = [];
    console.log(PIPELINE, "loadfile request", { pipe: this.pipePath, kind, preview: target.slice(0, 160) });
    this.cmd(["loadfile", target, "replace"]);
  }

  /** Explicitly pause playback. */
  pause(): void {
    console.log(PIPELINE, "pause", { pipe: this.pipePath });
    this.cmd(["set_property", "pause", true]);
  }

  /** Resume paused playback. */
  resume(): void {
    console.log(PIPELINE, "resume", { pipe: this.pipePath });
    this.cmd(["set_property", "pause", false]);
  }

  /** Stop playback and unload the current file. */
  stop(): void {
    console.log(PIPELINE, "stop", { pipe: this.pipePath });
    this.cmdQueue = [];
    this.cmd(["stop"]);
    this.st.status = "stopped";
    this.st.position = 0;
    this.push();
  }

  /** Seek to absolute position in seconds. */
  seek(seconds: number): void {
    this.cmd(["seek", Math.max(0, seconds), "absolute"]);
  }

  /** Set volume 0–100. */
  setVolume(vol: number): void {
    const v = Math.max(0, Math.min(100, Math.round(vol)));
    console.log(PIPELINE, "set volume", { pipe: this.pipePath, volume: v });
    this.cmd(["set_property", "volume", v]);
    this.st.volume = v;
    this.push();
  }

  getStatus(): MpvStatus {
    return { ...this.st };
  }
}
