/**
 * Convert UnifiedSource to PlaySourcePayload for PLAY_SOURCE command.
 */

import type { PlaySourcePayload } from "./types";
import type { UnifiedSource } from "@/lib/source-types";

export function unifiedSourceToPayload(source: UnifiedSource): PlaySourcePayload {
  return {
    id: source.id,
    title: source.title,
    genre: source.genre ?? "Mixed",
    cover: source.cover ?? null,
    type: source.type,
    url: source.url,
    origin: source.origin,
  };
}
