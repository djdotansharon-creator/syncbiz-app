/**
 * MpvManager — spawns MPV as a child process and communicates via its
 * JSON IPC socket (Windows named pipe / Unix socket).
 *
 * Only the main process ever instantiates this class.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { app } from "electron";

function resolvePipePath(pipeName: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\${pipeName}`
    : `/tmp/${pipeName}.sock`;
}

export type MpvPlaybackStatus = "idle" | "playing" | "paused" | "stopped";

export type MpvStatus = {
  status: MpvPlaybackStatus;
  position: number; // seconds, floored
  duration: number; // seconds, floored
  volume: number;   // 0–100
};

type MpvStatusCallback = (status: MpvStatus) => void;

function getMpvBinaryPath(): string {
  const exe = process.platform === "win32" ? "mpv.exe" : "mpv";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "mpv", exe);
  }
  // Dev: compiled to desktop/dist/main/ — walk up two dirs to desktop/resources/mpv/
  return path.join(__dirname, "../../resources/mpv", exe);
}

export class MpvManager {
  private readonly pipePath: string;
  private child: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private buffer = "";
  private statusCb: MpvStatusCallback | null = null;
  /** Commands queued while the IPC socket is not yet connected. Flushed on connect. */
  private cmdQueue: string[] = [];

  private st: MpvStatus = {
    status: "idle",
    position: 0,
    duration: 0,
    volume: 80,
  };

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

  start(): void {
    const bin = getMpvBinaryPath();
    if (!existsSync(bin)) {
      console.warn(
        "[MpvManager] binary not found at",
        bin,
        "— audio commands will be no-ops. Place mpv.exe in desktop/resources/mpv/",
      );
      return;
    }

    // yt-dlp: if present alongside mpv.exe, tell MPV's ytdl_hook.lua where to
    // find it via --script-opts (no env override — env override breaks MPV on Windows).
    const mpvDir = path.dirname(bin);
    const ytDlpExe = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    const ytDlpBin = path.join(mpvDir, ytDlpExe);
    const hasYtDlp = existsSync(ytDlpBin);
    // Forward slashes: MPV script-opts path must use / not \ on Windows
    const ytDlpFwdSlash = ytDlpBin.replace(/\\/g, "/");
    const ytDlpArgs = hasYtDlp ? [`--script-opts=ytdl_hook-ytdl_path=${ytDlpFwdSlash}`] : [];
    if (hasYtDlp) {
      console.log("[MpvManager]", this.pipePath, "yt-dlp found →", ytDlpBin, "— YouTube playback enabled");
    } else {
      console.log("[MpvManager]", this.pipePath, "yt-dlp NOT found in", mpvDir, "— YouTube URLs will fail; place yt-dlp.exe there to enable");
    }

    // stdio: stderr piped so MPV errors are visible in main-process console.
    // Do NOT pass env — explicit env override breaks MPV audio on Windows.
    this.child = spawn(
      bin,
      ["--no-video", "--idle", `--input-ipc-server=${this.pipePath}`, ...ytDlpArgs],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    this.child.stderr?.on("data", (d: Buffer) => {
      const msg = d.toString("utf-8").trim();
      if (msg) console.log("[MpvManager]", this.pipePath, "mpv:", msg.slice(0, 400));
    });

    this.child.on("error", (err) => {
      console.error("[MpvManager] spawn error:", err.message);
    });

    this.child.on("exit", (code) => {
      console.log("[MpvManager] process exited, code =", code);
      this.child = null;
      this.socket = null;
      if (this.st.status !== "idle") {
        this.st.status = "idle";
        this.push();
      }
    });

    // MPV needs a moment to create the named pipe after spawn.
    setTimeout(() => this.connectPipe(6), 600);
  }

  kill(): void {
    try { this.socket?.destroy(); } catch { /* ignore */ }
    this.socket = null;
    try { this.child?.kill(); } catch { /* ignore */ }
    this.child = null;
  }

  // ─── IPC pipe ───────────────────────────────────────────────────────────────

  private connectPipe(retries: number): void {
    if (!this.child) return;

    const sock = net.connect(this.pipePath);

    sock.once("connect", () => {
      this.socket = sock;
      this.buffer = "";

      // Observe the properties needed for real-time status.
      this.raw(JSON.stringify({ command: ["observe_property", 1, "pause"] }));
      this.raw(JSON.stringify({ command: ["observe_property", 2, "time-pos"] }));
      this.raw(JSON.stringify({ command: ["observe_property", 3, "duration"] }));
      this.raw(JSON.stringify({ command: ["observe_property", 4, "volume"] }));

      // Flush any commands that arrived before the pipe was ready.
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
      sock.on("close", () => { this.socket = null; });
      sock.on("error", (err) => {
        console.error("[MpvManager] socket error:", err.message);
        this.socket = null;
      });
    });

    sock.once("error", () => {
      sock.destroy();
      if (retries > 0 && this.child) {
        setTimeout(() => this.connectPipe(retries - 1), 500);
      } else {
        console.error("[MpvManager] could not connect to IPC pipe — audio will be silent");
      }
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        this.handleEvent(JSON.parse(t) as Record<string, unknown>);
      } catch {
        // Malformed JSON line from MPV — ignore.
      }
    }
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
      this.st.status = "playing";
      this.st.position = 0;
      this.push();
    } else if (ev === "end-file") {
      const reason = msg["reason"] as string | undefined;
      this.st.status = reason === "stop" ? "stopped" : "idle";
      this.st.position = 0;
      this.push();
    }
  }

  // ─── Command helpers ─────────────────────────────────────────────────────────

  private raw(json: string): void {
    if (!this.socket || this.socket.destroyed) {
      console.log("[MpvManager]", this.pipePath, "socket not ready — queuing:", json.slice(0, 120));
      this.cmdQueue.push(json);
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
    // A new loadfile replaces everything — drop any stale queued commands first.
    this.cmdQueue = [];
    console.log("[MpvManager]", this.pipePath, "loadfile →", u.slice(0, 120));
    this.cmd(["loadfile", u, "replace"]);
  }

  /** Explicitly pause playback. */
  pause(): void {
    this.cmd(["set_property", "pause", true]);
  }

  /** Resume paused playback. */
  resume(): void {
    this.cmd(["set_property", "pause", false]);
  }

  /** Stop playback and unload the current file. */
  stop(): void {
    this.cmdQueue = []; // cancel any pending play
    this.cmd(["stop"]);
    // Pre-update local state; MPV will also emit end-file shortly after.
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
    this.cmd(["set_property", "volume", v]);
    this.st.volume = v;
    this.push();
  }

  getStatus(): MpvStatus {
    return { ...this.st };
  }
}
