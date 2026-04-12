import { createRoot, type Root } from "react-dom/client";
import { PlayerDeckMetaStripSurface } from "@/components/player-surface/player-deck-meta-strip-surface";
import type { PlayerDeckMetaStripSurfaceProps } from "@/lib/player-surface/player-deck-meta-strip-types";

let root: Root | null = null;

export function mountPlayerDeckMetaStrip(container: HTMLElement): void {
  if (root) return;
  root = createRoot(container);
}

export function renderPlayerDeckMetaStrip(props: PlayerDeckMetaStripSurfaceProps): void {
  if (!root) throw new Error("mountPlayerDeckMetaStrip must be called first");
  root.render(<PlayerDeckMetaStripSurface {...props} />);
}
