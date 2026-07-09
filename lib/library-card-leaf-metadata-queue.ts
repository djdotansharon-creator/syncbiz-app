import {
  fetchLeafDisplayMetadataRefresh,
  type LeafDisplayMetaPatch,
} from "@/lib/library-leaf-display-refresh-client";
import {
  libraryCardEffectiveLikeCount,
  libraryCardEffectivePublishedAt,
  libraryCardEffectiveViewCount,
  type UnifiedSource,
} from "@/lib/source-types";

const COOLDOWN_MS = 5 * 60_000;
const BATCH_DELAY_MS = 900;
const MAX_CONCURRENT = 1;

const lastFetchAt = new Map<string, number>();
const inflightByUrl = new Map<string, Promise<LeafDisplayMetaPatch | null>>();

type QueueJob = {
  url: string;
  resolve: (patch: LeafDisplayMetaPatch | null) => void;
};

const queue: QueueJob[] = [];
let active = 0;

function canonicalQueueKey(url: string): string {
  return url.trim().toLowerCase();
}

/** True when a YouTube leaf card is missing display fields we can enrich in the background. */
export function leafMetadataNeedsEnrichment(source: UnifiedSource): boolean {
  if (source.type !== "youtube") return false;
  const url = source.url?.trim();
  if (!url) return false;

  const hasViews = libraryCardEffectiveViewCount(source) != null;
  const hasLikes = libraryCardEffectiveLikeCount(source) != null;
  const hasPublished = Boolean(libraryCardEffectivePublishedAt(source));
  const durationSec = source.leafDurationSeconds ?? source.playlist?.durationSeconds ?? 0;
  const hasDuration = durationSec > 0;

  return !hasViews || !hasLikes || !hasPublished || !hasDuration;
}

function pumpQueue() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!;
    active += 1;
    void fetchLeafDisplayMetadataRefresh(job.url)
      .then((patch) => {
        job.resolve(patch);
      })
      .catch(() => {
        job.resolve(null);
      })
      .finally(() => {
        active -= 1;
        if (queue.length > 0) {
          setTimeout(pumpQueue, BATCH_DELAY_MS);
        } else {
          pumpQueue();
        }
      });
  }
}

/**
 * Non-blocking, rate-limited background enrichment for visible library leaf cards.
 * Reuses POST /api/library/leaf-display-refresh (yt-dlp / resolver) — never blocks render or play.
 */
export function scheduleLeafMetadataEnrichment(url: string): Promise<LeafDisplayMetaPatch | null> {
  const trimmed = url?.trim();
  if (!trimmed) return Promise.resolve(null);

  const key = canonicalQueueKey(trimmed);
  const now = Date.now();
  const last = lastFetchAt.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return inflightByUrl.get(key) ?? Promise.resolve(null);
  }

  const existing = inflightByUrl.get(key);
  if (existing) return existing;

  lastFetchAt.set(key, now);

  const promise = new Promise<LeafDisplayMetaPatch | null>((resolve) => {
    queue.push({ url: trimmed, resolve });
    pumpQueue();
  }).finally(() => {
    inflightByUrl.delete(key);
  });

  inflightByUrl.set(key, promise);
  return promise;
}
