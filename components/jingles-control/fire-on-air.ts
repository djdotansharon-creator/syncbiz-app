/**
 * Fire a jingle / announcement ON AIR from a surface other than the Jingles console (the queue panel's Jingles tab).
 * Same routing rule as JinglesShell.fireOnAir — IRON RULE: only the branch MASTER executes playback. This desktop plays
 * through its local MPV interrupt ONLY when it is itself the MASTER; every other device sends PLAY_INTERRUPT to the
 * MASTER over the existing device→MASTER command path. Nothing here touches the playback chain itself.
 */
import type { RemoteCommand } from "@/lib/remote-control/types";

type Sender = { deviceMode?: string; sendCommandToMaster?: (command: RemoteCommand, payload?: { url?: string }) => unknown } | null | undefined;

export function fireJingleOnAir(devicePlayer: Sender, url: string): void {
  if (!url) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = typeof window !== "undefined" ? (window as any).syncbizDesktop : null;
  if (api?.mpvPlayInterrupt && devicePlayer?.deviceMode === "MASTER") {
    // MPV needs an absolute URL — resolve relative paths (/api/jingles/audio/…) against this origin.
    api.mpvPlayInterrupt(url.startsWith("/") ? `${window.location.origin}${url}` : url);
    return;
  }
  devicePlayer?.sendCommandToMaster?.("PLAY_INTERRUPT", { url });
}

/** Synthesized pre-roll bell presets served from /api/jingles/bell/[style]; "off" → none. */
export function bellUrl(style: string | null | undefined): string | null {
  return !style || style === "off" ? null : `/api/jingles/bell/${style}`;
}
