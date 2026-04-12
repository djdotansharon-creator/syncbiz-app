/**
 * Electron preload only: forwards product play intent to the desktop mock transport
 * (`localMockTransport` → main `DeviceWsManager.applyLocalMockTransport`). No-op in the browser.
 */
export function invokeDesktopLocalMockPlay(): void {
  if (typeof window === "undefined") return;
  const api = window.syncbizDesktop;
  if (!api?.localMockTransport) return;
  void api.localMockTransport({ command: "PLAY" }).catch(() => {});
}
