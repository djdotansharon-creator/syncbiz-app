/**
 * USER-FACING station status (DISPLAY ONLY). Product meaning:
 *   MASTER  = THIS physical computer is the designated station that outputs the store audio.
 *   CONTROL = this device only controls another station.
 * The embedded Electron renderer stays CONTROL at the WS protocol level by design — that internal socket role is
 * NOT what the user sees on the designated station. Pure + deterministic (tested by scripts/verify-station-badge.ts).
 */
export type StationBadge =
  | { kind: "hidden" }
  /** GREEN — designated audio station (this machine plays the store audio). */
  | { kind: "station-master"; subline: "Playing store audio" | "Store audio station" }
  /** RED — legacy non-designated branch: this device's own socket holds the MASTER lease (unchanged behavior). */
  | { kind: "ws-master" }
  /** BLUE — controls another station. */
  | { kind: "control"; subline: "Controlling: Branch Master" | null }
  /** GREY — not connected and not the designated station. */
  | { kind: "standalone" };

export function resolveStationBadge(s: {
  isActive: boolean;
  isElectronShell: boolean;
  isDesignatedAudioStation: boolean;
  mainSnapResolved: boolean;
  isBranchConnected: boolean;
  isObserverOnlyBrowser: boolean;
  deviceMode: string;
  hasExistingMaster: boolean;
  isPlaying: boolean;
}): StationBadge {
  // The designated audio station is ALWAYS shown as MASTER (never CONTROL, never Standalone) — once the
  // co-located MAIN has reported, so a cold start cannot flash a wrong badge.
  if (s.isDesignatedAudioStation && s.mainSnapResolved) {
    return { kind: "station-master", subline: s.isPlaying ? "Playing store audio" : "Store audio station" };
  }
  // Electron before its MAIN status arrived: we don't know yet whether this is the station → show nothing.
  if (s.isElectronShell && !s.mainSnapResolved) return { kind: "hidden" };
  // Non-designated devices: exactly the previous behavior (StandaloneIndicator + DeviceModeIndicator).
  if (!s.isActive) return { kind: "hidden" };
  if (!s.isBranchConnected) return { kind: "standalone" };
  if (s.isObserverOnlyBrowser) return { kind: "hidden" };
  if (s.deviceMode === "MASTER") return { kind: "ws-master" };
  return { kind: "control", subline: s.hasExistingMaster ? "Controlling: Branch Master" : null };
}
