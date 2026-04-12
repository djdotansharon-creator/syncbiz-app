import { createRoot, type Root } from "react-dom/client";
import { PlaybackDockSurface } from "@/components/player-surface/playback-dock-surface";
import type { PlaybackDockSurfaceProps } from "@/lib/player-surface/playback-dock-types";

let root: Root | null = null;

export function mountPlaybackDock(container: HTMLElement): void {
  if (root) return;
  root = createRoot(container);
}

export function renderPlaybackDock(props: PlaybackDockSurfaceProps): void {
  if (!root) throw new Error("mountPlaybackDock must be called first");
  root.render(<PlaybackDockSurface {...props} />);
}
