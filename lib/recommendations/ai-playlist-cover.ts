/**
 * AI-generated playlist cover selection — avoid reusing the same unrelated YouTube still.
 */

import { createHash } from "crypto";
import type { PlaylistTrack } from "@/lib/playlist-types";
import { derivePlaylistTrackCoverArt } from "@/lib/playlist-utils";

function hashHue(input: string): number {
  const digest = createHash("sha256").update(input.trim()).digest();
  return digest[0]! % 360;
}

/** Deterministic SVG cover from playlist title/intent (stable per name). */
export function buildDeterministicAiPlaylistCover(playlistName: string): string {
  const name = (playlistName ?? "").trim() || "AI playlist";
  const hue = hashHue(name);
  const hue2 = (hue + 42) % 360;
  const initials = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 1))
    .filter(Boolean)
    .slice(0, 3)
    .join("")
    .toUpperCase() || "AI";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" role="img" aria-label="${name.replace(/"/g, "")}">
<defs>
<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" style="stop-color:hsl(${hue},58%,38%)"/>
<stop offset="100%" style="stop-color:hsl(${hue2},52%,28%)"/>
</linearGradient>
</defs>
<rect width="320" height="320" rx="28" fill="url(#g)"/>
<text x="160" y="172" text-anchor="middle" fill="#f8fafc" font-family="system-ui,Segoe UI,sans-serif" font-size="56" font-weight="700" opacity="0.95">${initials}</text>
<text x="160" y="248" text-anchor="middle" fill="#e2e8f0" font-family="system-ui,Segoe UI,sans-serif" font-size="16" font-weight="600" opacity="0.85">SyncBiz AI</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, " "))}`;
}

/** Pick cover from selected tracks in playlist order; fallback to deterministic intent cover. */
export function pickAiPlaylistThumbnail(tracks: PlaylistTrack[], playlistName: string): string {
  for (const track of tracks) {
    const art = derivePlaylistTrackCoverArt(track);
    if (art && art.trim().length > 0) return art.trim();
  }
  return buildDeterministicAiPlaylistCover(playlistName);
}
