/**
 * Temporary local playback queues for My Music Library (no POST /api/playlists).
 */

import { createPlayNextLocalSource } from "@/lib/play-next";
import type { UnifiedSource } from "@/lib/source-types";

/** One ephemeral source per file path — same semantics as Live Play Next for locals. */
export function buildEphemeralLocalQueueFromPaths(absolutePaths: string[]): UnifiedSource[] {
  return absolutePaths.map((p) => createPlayNextLocalSource(p.trim()));
}

export function ephemeralLocalSourceWithCover(absolutePath: string, cover: string | null): UnifiedSource {
  return createPlayNextLocalSource(absolutePath.trim(), cover);
}
