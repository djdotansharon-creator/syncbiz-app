/**
 * P0 Video V1 (owner-approved 2026-10-09) — the picture comes from the SAME MPV player as the sound (one decoder, one
 * clock → same song, same position, same play/pause, same transition). Opt-in per station, OFF by default.
 *
 * Each music deck renders into its own borderless, focus-less MPV window. This module only places / fades / hides those
 * windows over IPC — it never loads, pauses, seeks or changes volume, so the audio path is untouched:
 *  - placement: over the renderer's video slot (CSS rect → screen pixels), hidden off-screen otherwise; the base for a
 *    future external-screen output (same windows, full screen on another display);
 *  - transition: fade-through-black locked to the audio crossfade ramp (outgoing picture fades out over the first half,
 *    incoming fades in over the second half — the picture changes exactly with the sound);
 *  - Auto quality: 1080p when the station and network allow it, lower when needed; a buffering stall drops the picture
 *    for the rest of THAT song (audio continues — proven in V0) and lowers the next loads; clean songs step back up.
 *    The picture never returns mid-song (re-enabling video mid-song stalls the audio — proven in V0).
 */
import type { BrowserWindow } from "electron";
import type { MpvManager, MpvVideoSignal } from "./mpv-manager";
import type { VideoMixEvent } from "./playback-orchestrator";
import { fileLog } from "./file-logger";

type DeckId = "A" | "B";
export type CssRect = { x: number; y: number; width: number; height: number };
export type ScreenRect = { x: number; y: number; width: number; height: number };

/** Quality ladder (picture height). Index 0 = best. */
export const VIDEO_CAPS = [1080, 720, 480, 360] as const;

/** yt-dlp format for a cap: H.264 first (hardware decoding on practically every Windows PC — V0: d3d11va), then any
 *  non-AV1 codec, then a combined stream, and finally AUDIO ONLY — a missing picture never fails the song. */
export function videoFormatForCap(h: number): string {
  return `bestvideo[height<=?${h}][vcodec^=avc1]+bestaudio/bestvideo[height<=?${h}][vcodec!^=av01]+bestaudio/best[height<=?${h}]/bestaudio/best`;
}

/** Fade-through-black frame for crossfade progress `frac` (0..1): brightness -100 = black, 0 = normal. */
export function mixFrame(frac: number): { showIncoming: boolean; outBrightness: number; inBrightness: number } {
  const f = Math.max(0, Math.min(1, frac));
  if (f < 0.5) return { showIncoming: false, outBrightness: Math.round(-100 * f * 2), inBrightness: -100 };
  return { showIncoming: true, outBrightness: -100, inBrightness: Math.round(-100 * (1 - (f - 0.5) * 2)) };
}

/** Auto quality: pure, event-driven (no timers). Starts at 1080p. */
export class VideoQuality {
  private idx = 0;
  private clean = 0;
  private songDrops = 0;
  private songIssue = false;
  static readonly DROPS_PER_SONG_LIMIT = 60;
  static readonly CLEAN_SONGS_TO_STEP_UP = 3;

  cap(): number { return VIDEO_CAPS[this.idx]; }

  /** A buffering stall while the picture was on → step down now (applies to the next loads). */
  onStall(): boolean {
    this.songIssue = true;
    this.clean = 0;
    return this.stepDown();
  }

  /** Dropped frames of the song now showing (delta). Too many → step down once for the next loads. */
  onDrops(delta: number): boolean {
    if (delta <= 0) return false;
    this.songDrops += delta;
    if (this.songIssue || this.songDrops <= VideoQuality.DROPS_PER_SONG_LIMIT) return false;
    this.songIssue = true;
    this.clean = 0;
    return this.stepDown();
  }

  /** A new song took over the screen: a clean previous song counts toward stepping back up. */
  onSongBoundary(): boolean {
    let changed = false;
    if (!this.songIssue) {
      this.clean += 1;
      if (this.clean >= VideoQuality.CLEAN_SONGS_TO_STEP_UP && this.idx > 0) { this.idx -= 1; this.clean = 0; changed = true; }
    }
    this.songDrops = 0;
    this.songIssue = false;
    return changed;
  }

  private stepDown(): boolean {
    if (this.idx >= VIDEO_CAPS.length - 1) return false;
    this.idx += 1;
    return true;
  }
}

const HIDDEN_GEOMETRY = "16x9+-32000+-32000";

export type VideoOutputEnv = {
  /** CSS rect (renderer viewport) → screen pixels for MPV's geometry; null when it cannot be placed. */
  toScreen: (rect: CssRect) => ScreenRect | null;
};

export class VideoOutput {
  private readonly decks: Record<DeckId, MpvManager>;
  private readonly quality = new VideoQuality();
  private env: VideoOutputEnv | null = null;
  private dock: CssRect | null = null;
  private appVisible = true;
  /** whose picture is on screen (the audible deck; the incoming one from the crossfade midpoint) */
  private display: DeckId | null = null;
  private hasPicture: Record<DeckId, boolean> = { A: false, B: false };
  private lastDrops: Record<DeckId, number> = { A: 0, B: 0 };
  private applied: Record<DeckId, { geometry: string; brightness: number }> = {
    A: { geometry: HIDDEN_GEOMETRY, brightness: 0 },
    B: { geometry: HIDDEN_GEOMETRY, brightness: 0 },
  };
  private brightness: Record<DeckId, number> = { A: 0, B: 0 };

  constructor(decks: { A: MpvManager; B: MpvManager }) {
    this.decks = decks;
    for (const id of ["A", "B"] as const) this.decks[id].onVideoSignal((sig) => this.onSignal(id, sig));
  }

  initialFormat(): string {
    return videoFormatForCap(this.quality.cap());
  }

  /** Main window wiring: follow move / resize / minimize so the picture stays on the slot. The picture window is
   *  always-on-top while VONO is visible (a station boots unattended — focus cannot be relied on) and hidden while
   *  VONO is minimized / hidden. */
  attachWindow(win: BrowserWindow, env: VideoOutputEnv): void {
    this.env = env;
    const update = () => this.apply();
    win.on("move", update);
    win.on("resize", update);
    win.on("minimize", () => { this.appVisible = false; this.apply(); });
    win.on("restore", () => { this.appVisible = true; this.apply(); });
    win.on("hide", () => { this.appVisible = false; this.apply(); });
    win.on("show", () => { this.appVisible = true; this.apply(); });
    win.on("closed", () => { this.env = null; this.appVisible = false; this.apply(); });
    this.apply();
  }

  /** The renderer's video slot (CSS px in its viewport), or null when no picture should show. */
  setDockRect(rect: CssRect | null): void {
    this.dock = rect && rect.width > 1 && rect.height > 1 ? rect : null;
    this.apply();
  }

  /** Orchestrator mix events (the picture follows the audio decks). */
  onMix(ev: VideoMixEvent): void {
    if (ev.kind === "ramp") {
      const f = mixFrame(ev.frac);
      this.brightness[ev.from] = f.outBrightness;
      this.brightness[ev.to] = f.inBrightness;
      this.display = f.showIncoming ? ev.to : ev.from;
      this.apply();
      return;
    }
    // a new song took over the screen (cold start / completed crossfade) — an abort keeps the same song
    if ((ev.reason === "cold" || ev.reason === "swap") && this.quality.onSongBoundary()) this.applyCap("clean songs");
    if (ev.deck) this.brightness[ev.deck] = 0;
    this.display = ev.deck;
    this.apply();
  }

  private onSignal(deck: DeckId, sig: MpvVideoSignal): void {
    switch (sig.kind) {
      case "engine":
        // (re)spawned MPV: its window starts hidden at the default geometry — re-apply ours
        this.applied[deck] = { geometry: HIDDEN_GEOMETRY, brightness: 0 };
        this.hasPicture[deck] = false;
        this.lastDrops[deck] = 0;
        this.apply();
        return;
      case "picture":
        this.hasPicture[deck] = sig.present;
        this.apply();
        return;
      case "stall":
        // network can't keep up while the picture is showing → picture off for the rest of this song, audio untouched
        if (deck === this.display && this.hasPicture[deck]) {
          this.decks[deck].dropVideoForCurrentFile();
          fileLog("WARN", "VIDEO_STALL_DROP", { deck, cap: this.quality.cap() });
          if (this.quality.onStall()) this.applyCap("stall");
        }
        return;
      case "drops": {
        const prev = this.lastDrops[deck];
        this.lastDrops[deck] = sig.count;
        const delta = sig.count >= prev ? sig.count - prev : sig.count; // the counter restarts per file
        if (deck === this.display && this.quality.onDrops(delta)) this.applyCap("dropped frames");
        return;
      }
    }
  }

  private applyCap(why: string): void {
    const fmt = videoFormatForCap(this.quality.cap());
    this.decks.A.setVideoFormat(fmt);
    this.decks.B.setVideoFormat(fmt);
    fileLog("INFO", "VIDEO_QUALITY", { cap: this.quality.cap(), why });
  }

  /** Push the wanted window state to both decks (only what changed — a few small IPC writes). */
  private apply(): void {
    const target = this.dock && this.env && this.appVisible ? this.env.toScreen(this.dock) : null;
    for (const id of ["A", "B"] as const) {
      const visible = target !== null && this.display === id && this.hasPicture[id];
      const geometry = visible && target ? `${Math.max(2, Math.round(target.width))}x${Math.max(2, Math.round(target.height))}+${Math.round(target.x)}+${Math.round(target.y)}` : HIDDEN_GEOMETRY;
      const a = this.applied[id];
      const deck = this.decks[id];
      if (a.brightness !== this.brightness[id]) { deck.setVideoProperty("brightness", this.brightness[id]); a.brightness = this.brightness[id]; }
      if (a.geometry !== geometry) { deck.setVideoProperty("geometry", geometry); a.geometry = geometry; }
    }
  }
}

let instance: VideoOutput | null = null;
let activeThisSession = false;
/** index.ts: the instance for this session (null = video mode off). */
export function setVideoOutputInstance(v: VideoOutput | null): void {
  instance = v;
  activeThisSession = v !== null;
}
export function getVideoOutputInstance(): VideoOutput | null {
  return instance;
}
export function isVideoOutputActive(): boolean {
  return activeThisSession;
}
