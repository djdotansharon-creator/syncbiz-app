/**
 * Local storage / config — MVP persistence implemented in main via `runtime-config-service.ts`.
 * @see docs/PLAYER-DESKTOP-INTERNAL-STRUCTURE-v1.md (§7)
 */

export type { DesktopRuntimeConfig, MvpConfigPatch } from "../shared/mvp-types";
export { RUNTIME_CONFIG_BOUNDARY } from "./constants";
