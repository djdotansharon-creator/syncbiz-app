import { createRoot, type Root } from "react-dom/client";
import { PlayerDeckTransportStripSurface } from "@/components/player-surface/player-deck-transport-strip-surface";
import type { PlayerDeckTransportStripSurfaceProps } from "@/lib/player-surface/player-deck-transport-strip-types";

let root: Root | null = null;

export function mountPlayerDeckTransportStrip(container: HTMLElement): void {
  if (root) return;
  root = createRoot(container);
}

export function renderPlayerDeckTransportStrip(props: PlayerDeckTransportStripSurfaceProps): void {
  if (!root) throw new Error("mountPlayerDeckTransportStrip must be called first");
  root.render(<PlayerDeckTransportStripSurface {...props} />);
}
