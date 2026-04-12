import type { SyncBizDesktopMvp } from "../shared/mvp-desktop-api";

declare global {
  interface Window {
    syncbizDesktop: SyncBizDesktopMvp;
  }
}

export {};
