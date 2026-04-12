/**
 * Ensures placeholder module boundaries participate in the TypeScript graph.
 * MVP wiring lives in `main/` and `device-websocket-client/device-ws-manager.ts`.
 */

export * from "./playback-agent";
export * from "./announcement";
export * from "./watchdog";
export * from "./mpv-bridge";
export type { DesktopRuntimeConfig, MvpConfigPatch } from "./runtime-config";
