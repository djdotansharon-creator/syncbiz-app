/**
 * Single long-lived React root for JINGLES CONTROL — mounted once at desktop bootstrap when the feature flag is on.
 * Intentionally separate from hero / dock / branch-library roots so panel visibility does not remount playback UI.
 */
import { createRoot, type Root } from "react-dom/client";
import { JinglesShell } from "@/components/jingles-control/JinglesShell";

let root: Root | null = null;

export function mountJinglesShell(container: HTMLElement): void {
  if (root) return;
  root = createRoot(container);
  root.render(<JinglesShell />);
}
