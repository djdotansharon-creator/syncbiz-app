/**
 * Mock playback session — local state only until MPV is integrated.
 */
import { createInitialStationState, type StationPlaybackState } from "../shared/station-state";

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
  }): void {
    const now = Date.now();
    const st = typeof sel.sourceType === "string" && sel.sourceType.trim() ? sel.sourceType.trim() : undefined;
    this.state.currentSource = {
      id: sel.id.trim(),
      title: sel.title.trim() || "Untitled",
      cover: sel.cover,
      origin: sel.origin,
      ...(st ? { sourceType: st } : {}),
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
   * Apply a remote command from WS. Unknown commands are ignored (MVP).
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
