/**
 * Fire a jingle / announcement ON AIR from a surface other than the Jingles console (the queue panel's Jingles tab).
 * Same routing rule as JinglesShell.fireOnAir — IRON RULE: only the branch MASTER executes playback. This desktop plays
 * through its local MPV interrupt ONLY when it is itself the MASTER; every other device sends PLAY_INTERRUPT to the
 * MASTER over the existing device→MASTER command path. Nothing here touches the playback chain itself.
 */
import type { RemoteCommand } from "@/lib/remote-control/types";
import { appendJingleToken } from "@/lib/jingles/jingle-session";

type Sender = { deviceMode?: string; sendCommandToMaster?: (command: RemoteCommand, payload?: { url?: string }) => unknown } | null | undefined;

export function fireJingleOnAir(devicePlayer: Sender, url: string): void {
  if (!url) return;
  // F3: append the workspace-scoped jingle token so the MASTER's MPV can authenticate the audio read
  // (MPV cannot send the session cookie). Only /api/jingles/audio/* URLs are tokenized; a bell URL
  // passes through unchanged.
  const tokenized = appendJingleToken(url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = typeof window !== "undefined" ? (window as any).syncbizDesktop : null;
  if (api?.mpvPlayInterrupt && devicePlayer?.deviceMode === "MASTER") {
    // MPV needs an absolute URL — resolve relative paths (/api/jingles/audio/…) against this origin.
    api.mpvPlayInterrupt(tokenized.startsWith("/") ? `${window.location.origin}${tokenized}` : tokenized);
    return;
  }
  devicePlayer?.sendCommandToMaster?.("PLAY_INTERRUPT", { url: tokenized });
}

/** Synthesized pre-roll bell presets served from /api/jingles/bell/[style]; "off" → none. */
export function bellUrl(style: string | null | undefined): string | null {
  return !style || style === "off" ? null : `/api/jingles/bell/${style}`;
}
