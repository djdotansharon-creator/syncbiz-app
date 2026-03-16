/**
 * Convert PlaySourcePayload back to UnifiedSource for playback.
 */

import type { PlaySourcePayload } from "./types";
import type { UnifiedSource, SourceProviderType } from "@/lib/source-types";

export function payloadToUnifiedSource(payload: PlaySourcePayload): UnifiedSource {
  return {
    id: payload.id,
    title: payload.title,
    genre: payload.genre ?? "Mixed",
    cover: payload.cover ?? null,
    type: payload.type as SourceProviderType,
    url: payload.url,
    origin: payload.origin,
  };
}
