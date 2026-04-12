import { createRoot, type Root } from "react-dom/client";
import type { MvpStatusSnapshot } from "../shared/mvp-types";
import { DesktopDebugPanel } from "./debug-panel";

let root: Root | null = null;

export function mountDesktopDebugPanel(container: HTMLElement | null): void {
  if (typeof __DESKTOP_DEV_DEBUG_PANEL__ === "undefined" || !__DESKTOP_DEV_DEBUG_PANEL__) {
    if (container) container.style.display = "none";
    return;
  }
  if (!container) return;
  root = createRoot(container);
}

export function renderDesktopDebugPanel(snapshot: MvpStatusSnapshot, pageHref: string): void {
  if (typeof __DESKTOP_DEV_DEBUG_PANEL__ === "undefined" || !__DESKTOP_DEV_DEBUG_PANEL__ || !root) return;
  root.render(<DesktopDebugPanel snapshot={snapshot} pageHref={pageHref} />);
}
