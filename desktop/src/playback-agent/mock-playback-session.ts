/**
 * Mock playback session — local state holder.
 * Real playback is handled by MpvManager; this class tracks the authoritative
 * in-memory state that is broadcast in STATE_UPDATE messages.
 */
import { createInitialStationState, type StationPlaybackState } from "../shared/station-state";
import type { MpvStatus } from "../main/mpv-manager";

const MVP_COMMANDS = new Set(["PLAY", "PAUSE", "STOP", "SET_VOLUME"]);

export class MockPlaybackSession {
  private state: StationPlaybackState;

  constructor() {
    this.state = createInitialStationState();
  }

  reset(): void {
    this.state = createInitialStationState();
  }

  /** Local-only: branch library row chosen as the station context (no engine yet). */
  setStationSelection(sel: {
    id: string;
    title: string;
    cover: string | null;
    origin: "playlist" | "radio" | "source";
    sourceType?: string;
    url?: string;
  }): void {
    const now = Date.now();
    const st = typeof sel.sourceType === "string" && sel.sourceType.trim() ? sel.sourceType.trim() : undefined;
    const u = typeof sel.url === "string" ? sel.url.trim() : undefined;
    this.state.currentSource = {
      id: sel.id.trim(),
      title: sel.title.trim() || "Untitled",
      cover: sel.cover,
      origin: sel.origin,
      ...(st ? { sourceType: st } : {}),
      ...(u ? { url: u } : {}),
    };
    this.state.positionAt = now;
  }

  getState(): StationPlaybackState {
    return this.state;
  }

  get status(): StationPlaybackState["status"] {
    return this.state.status;
  }

  get volume(): number {
    return this.state.volume ?? 0;
  }

  get sourceLabel(): string {
    return this.state.currentSource?.title ?? "—";
  }

  /**
   * Sync real MPV playback state into the tracked state.
   * Called whenever MpvManager fires a status event.
   */
  syncMpvStatus(mpv: MpvStatus): void {
    this.state.status = mpv.status;
    this.state.volume = mpv.volume;
    this.state.position = mpv.position;
    this.state.duration = mpv.duration;
    this.state.positionAt = Date.now();
    this.state.mpvEngineReady = mpv.engineReady;
    this.state.mpvEngineError = mpv.lastError ?? null;
  }

  /**
   * Optimistic transport updates when **no** `PlaybackOrchestrator`/MPV is attached (e.g. tests).
   * With a real desktop engine, `DeviceWsManager` skips this for PLAY/PAUSE/STOP/SET_VOLUME and
   * uses `syncMpvStatus` from MPV events instead (playback truth).
   */
  applyCommand(command: string, payload: unknown): boolean {
    if (!MVP_COMMANDS.has(command)) return false;
    const p = payload as { volume?: number } | undefined;
    const vol =
      p && typeof p.volume === "number" && Number.isFinite(p.volume)
        ? Math.max(0, Math.min(100, Math.round(p.volume)))
        : undefined;
    const now = Date.now();

    switch (command) {
      case "PLAY":
        this.state.status = "playing";
        this.state.positionAt = now;
        break;
      case "PAUSE":
        this.state.status = "paused";
        this.state.positionAt = now;
        break;
      case "STOP":
        this.state.status = "stopped";
        this.state.positionAt = now;
        break;
      case "SET_VOLUME":
        if (vol !== undefined) this.state.volume = vol;
        this.state.positionAt = now;
        break;
      default:
        break;
    }
    return true;
  }
}
