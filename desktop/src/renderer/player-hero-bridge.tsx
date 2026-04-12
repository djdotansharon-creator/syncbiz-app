import { createRoot, type Root } from "react-dom/client";
import { PlayerHeroSurface } from "@/components/player-surface/player-hero-surface";
import type { PlayerHeroSurfaceProps } from "@/lib/player-surface/player-hero-types";

let root: Root | null = null;

export function mountPlayerHero(container: HTMLElement): void {
  if (root) return;
  root = createRoot(container);
}

export function renderPlayerHero(props: PlayerHeroSurfaceProps): void {
  if (!root) throw new Error("mountPlayerHero must be called first");
  root.render(<PlayerHeroSurface {...props} />);
}
