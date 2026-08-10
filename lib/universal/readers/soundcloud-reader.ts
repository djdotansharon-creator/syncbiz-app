/**
 * Phase A2 — SoundCloud PlatformReader adapter (honest partial).
 *
 * SyncBiz plays a pasted SoundCloud URL via the SC widget (native playback), but it
 * does NOT extract a /sets/ tracklist today. So this reader declares readPlaylist as
 * FALSE — no facade. detect() recognizes the URL; readTrack is left unimplemented
 * until a real single-track metadata path is wired through the universal layer.
 */

import type { PlatformDetection, PlatformReader, ReaderCapabilities } from "@/lib/universal/platform-reader";
import type { NormalizedTrack } from "@/lib/universal/universal-track";

const CAPABILITIES: ReaderCapabilities = {
  detect: true,
  readPlaylist: false, // SyncBiz does not build a tracklist from a SoundCloud /sets/ URL.
  readAlbum: false,
  readTrack: false, // single-track metadata (noembed) is not yet routed through this layer.
  nativePlayback: true,
  note: "Real native playback of a pasted URL; /sets/ tracklist extraction not implemented.",
};

export const soundcloudReader: PlatformReader = {
  id: "soundcloud",
  capabilities: CAPABILITIES,

  detect(url: string): PlatformDetection | null {
    if (!/soundcloud\.com/i.test(url)) return null;
    const isSet = /\/sets\//i.test(url);
    return { provider: "soundcloud", kind: isSet ? "playlist" : "track", supported: false };
  },

  normalize(raw: unknown): NormalizedTrack {
    const r = (raw ?? {}) as { title?: string; url?: string };
    return {
      displayTitle: r.title ?? r.url ?? "SoundCloud track",
      artists: [],
      providerRef: r.url ? { provider: "soundcloud", externalId: r.url, externalUrl: r.url } : undefined,
      raw,
    };
  },
};
