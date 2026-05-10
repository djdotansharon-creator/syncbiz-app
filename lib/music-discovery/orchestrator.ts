/**
 * Read-only Music Discovery orchestrator — wraps existing internal + HTTP search paths.
 * Does not fetch unified sources (caller supplies tenant-scoped data).
 * Does not call smart-catalog-search or DJ Creator APIs (Phase 2).
 */

import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { searchExternal, searchInternal, type ExternalSearchResults } from "@/lib/search-service";
import type { UnifiedSource } from "@/lib/source-types";
import type {
  MusicDiscoveryCandidate,
  MusicDiscoveryCandidateOrigin,
  MusicDiscoveryInput,
  MusicDiscoveryProviderRunMeta,
  MusicDiscoveryResult,
  MusicDiscoveryRunOptions,
} from "./types";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_PER_ORIGIN = 25;
const DEFAULT_TOTAL_CAP = 80;

function resolveRunOptions(opts?: MusicDiscoveryRunOptions): {
  providerTimeoutMs: number;
  maxPerOrigin: number;
  totalCap: number;
  includeWorkspace: boolean;
  includeExternal: boolean;
} {
  return {
    providerTimeoutMs: opts?.providerTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxPerOrigin: opts?.maxPerOrigin ?? DEFAULT_MAX_PER_ORIGIN,
    totalCap: opts?.totalCap ?? DEFAULT_TOTAL_CAP,
    includeWorkspace: opts?.includeWorkspace !== false,
    includeExternal: opts?.includeExternal !== false,
  };
}

function externalStreamDedupeKey(url: string): string {
  const u = url.trim();
  const yt = getYouTubeVideoId(u);
  if (yt) return `yt:${yt}`;
  return `url:${u.toLowerCase()}`;
}

function unifiedLibraryOrigin(s: UnifiedSource): MusicDiscoveryCandidateOrigin {
  if (s.origin === "radio") return "radio";
  if (s.origin === "source") return "workspace_source";
  if (s.origin === "playlist") {
    if (s.playlist?.libraryPlacement === "ready_external" || s.contentNodeKind === "external_playlist") {
      return "ready_pack";
    }
    return "workspace_playlist";
  }
  return "workspace_playlist";
}

function unifiedToCandidate(s: UnifiedSource, score: number): MusicDiscoveryCandidate {
  const catalogItemId =
    (s.catalogItemId ?? "").trim() || (s.playlist?.catalogItemId ?? "").trim() || undefined;
  return {
    origin: unifiedLibraryOrigin(s),
    dedupeKey: `unified:${s.id}`,
    title: s.title,
    subtitle: s.genre,
    artworkUrl: s.cover,
    playbackUrl: s.url,
    catalogItemId,
    playlistId: s.playlist?.id,
    unifiedSourceId: s.id,
    score,
    signals: {
      curationRating: s.curationRating ?? s.playlist?.curationRating,
      viewCount: s.viewCount ?? s.playlist?.viewCount,
      likeCount: s.likeCount ?? s.playlist?.likeCount,
    },
  };
}

function mapExternalResults(ext: ExternalSearchResults): MusicDiscoveryCandidate[] {
  const out: MusicDiscoveryCandidate[] = [];
  let base = 600;
  ext.youtube.forEach((r, i) => {
    const url = (r.url ?? "").trim();
    if (!url) return;
    out.push({
      origin: "external_web",
      dedupeKey: externalStreamDedupeKey(url),
      title: r.title,
      artworkUrl: r.cover,
      playbackUrl: url,
      score: base - i,
      signals: { viewCount: r.viewCount },
    });
  });
  base = 550;
  ext.radio.forEach((r, i) => {
    const url = (r.url ?? "").trim();
    if (!url) return;
    out.push({
      origin: "radio",
      dedupeKey: `radio:${url.toLowerCase()}`,
      title: r.title,
      subtitle: r.genre,
      artworkUrl: r.cover,
      playbackUrl: url,
      score: base - i,
    });
  });
  base = 580;
  ext.catalog.forEach((r, i) => {
    const url = (r.url ?? "").trim();
    if (!url) return;
    out.push({
      origin: "syncbiz_catalog",
      dedupeKey: `catalog:${r.id}`,
      catalogItemId: r.id,
      title: r.title,
      subtitle: r.genres?.length ? r.genres.join(", ") : undefined,
      artworkUrl: r.thumbnail,
      playbackUrl: url,
      score: base - i,
    });
  });
  return out;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false; reason: "timeout" | "error"; error?: string }> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const winner = await Promise.race([
      promise.then((value) => {
        if (timeoutId) clearTimeout(timeoutId);
        return { kind: "done" as const, value };
      }),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeoutId = setTimeout(() => resolve({ kind: "timeout" }), ms);
      }),
    ]);
    if (winner.kind === "timeout") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: true, value: winner.value };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "error", error: msg };
  }
}

function scoreOf(c: MusicDiscoveryCandidate): number {
  return typeof c.score === "number" && Number.isFinite(c.score) ? c.score : 0;
}

/** Dedupe by dedupeKey (keep best score), sort by score descending. */
function dedupeAndSortCandidates(candidates: MusicDiscoveryCandidate[]): MusicDiscoveryCandidate[] {
  const best = new Map<string, MusicDiscoveryCandidate>();
  for (const c of candidates) {
    const key = c.dedupeKey.trim();
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || scoreOf(c) > scoreOf(prev)) {
      best.set(key, c);
    }
  }
  return [...best.values()].sort((a, b) => scoreOf(b) - scoreOf(a));
}

/**
 * Apply per-origin caps and global totalCap (walk merged list in score order).
 */
function applyOriginAndTotalCap(
  merged: MusicDiscoveryCandidate[],
  maxPerOrigin: number,
  totalCap: number
): MusicDiscoveryCandidate[] {
  const originCount = new Map<MusicDiscoveryCandidateOrigin, number>();
  const limited: MusicDiscoveryCandidate[] = [];
  for (const c of merged) {
    const n = originCount.get(c.origin) ?? 0;
    if (n >= maxPerOrigin) continue;
    originCount.set(c.origin, n + 1);
    limited.push(c);
    if (limited.length >= totalCap) break;
  }
  return limited;
}

/**
 * Global score ordering + totalCap can exhaust the budget on workspace + external_web before any
 * syncbiz_catalog row is reached, even when /api/catalog/search returned items. Ensure catalog hits
 * from the deduped merge appear (evict lowest-scoring workspace first, then radio, then Discover).
 */
function ensureCatalogCandidatesSurface(
  merged: MusicDiscoveryCandidate[],
  limited: MusicDiscoveryCandidate[],
  maxPerOrigin: number,
  totalCap: number
): MusicDiscoveryCandidate[] {
  const catalogMerged = merged.filter(
    (c) => c.origin === "syncbiz_catalog" && c.dedupeKey.trim() && (c.playbackUrl ?? "").trim()
  );
  if (catalogMerged.length === 0) return limited;

  const limKeys = new Set(limited.map((c) => c.dedupeKey));
  const missing = catalogMerged.filter((c) => !limKeys.has(c.dedupeKey)).slice(0, maxPerOrigin);
  if (missing.length === 0) return limited;

  const evictRank = (o: MusicDiscoveryCandidateOrigin): number => {
    if (o === "workspace_playlist" || o === "workspace_source" || o === "ready_pack") return 0;
    if (o === "music_bank_local") return 0;
    if (o === "radio") return 1;
    if (o === "external_web") return 2;
    return 3;
  };

  const out = [...limited];
  const keys = new Set(out.map((c) => c.dedupeKey));

  for (const cat of missing) {
    if (keys.has(cat.dedupeKey)) continue;
    if (out.length < totalCap) {
      out.push(cat);
      keys.add(cat.dedupeKey);
      continue;
    }
    let evict = -1;
    let bestRank = Infinity;
    let worstScore = Infinity;
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      if (c.origin === "syncbiz_catalog") continue;
      const r = evictRank(c.origin);
      const s = scoreOf(c);
      if (evict < 0 || r < bestRank || (r === bestRank && s < worstScore)) {
        evict = i;
        bestRank = r;
        worstScore = s;
      }
    }
    if (evict < 0) break;
    keys.delete(out[evict].dedupeKey);
    out.splice(evict, 1);
    out.push(cat);
    keys.add(cat.dedupeKey);
  }
  return out;
}

/**
 * Dedupe by `dedupeKey` (keep best score), apply per-origin caps, then global cap.
 * Guarantees syncbiz_catalog rows from the merge are not silently dropped when the API returned them.
 *
 * Catalog rows are deliberately NOT removed when their playbackUrl matches a workspace row: catalog
 * is the curated SyncBiz source (tags/curation/snapshots) and the AI search bar surfaces it ahead
 * of "In your library" so the user can see the catalog edition even for content they have imported.
 */
function dedupeSortAndCap(candidates: MusicDiscoveryCandidate[], maxPerOrigin: number, totalCap: number): MusicDiscoveryCandidate[] {
  const merged = dedupeAndSortCandidates(candidates);
  const limited = applyOriginAndTotalCap(merged, maxPerOrigin, totalCap);
  return ensureCatalogCandidatesSurface(merged, limited, maxPerOrigin, totalCap);
}

/**
 * Tenant-safe discovery: merges workspace-internal matches with external HTTP results.
 * No uploads, no local disk scan, no smart-catalog server pipeline (Phase 2).
 */
export async function runMusicDiscovery(input: MusicDiscoveryInput): Promise<MusicDiscoveryResult> {
  const q = input.query.rawText.trim();
  const runs: MusicDiscoveryProviderRunMeta[] = [];
  if (q.length < 2) {
    return { candidates: [], providerRuns: runs };
  }

  const opt = resolveRunOptions(input.options);
  const batch: MusicDiscoveryCandidate[] = [];

  if (opt.includeWorkspace) {
    const t0 = Date.now();
    try {
      const ranked = searchInternal(input.unifiedSources, q);
      const mapped = ranked.map((s, i) => unifiedToCandidate(s, 1000 - i));
      batch.push(...mapped);
      runs.push({
        providerId: "workspace_internal",
        ok: true,
        durationMs: Date.now() - t0,
        candidateCount: mapped.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      runs.push({
        providerId: "workspace_internal",
        ok: false,
        durationMs: Date.now() - t0,
        candidateCount: 0,
        error: msg,
      });
    }
  }

  if (input.deps?.searchMusicBankLocal) {
    const t0 = Date.now();
    try {
      const mapped = await input.deps.searchMusicBankLocal(q, opt.maxPerOrigin);
      batch.push(...mapped);
      runs.push({
        providerId: "music_bank_local",
        ok: true,
        durationMs: Date.now() - t0,
        candidateCount: mapped.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      runs.push({
        providerId: "music_bank_local",
        ok: false,
        durationMs: Date.now() - t0,
        candidateCount: 0,
        error: msg,
      });
    }
  }

  if (opt.includeExternal) {
    const searchExt = input.deps?.searchExternal ?? searchExternal;
    const genre = input.query.filters?.genre;
    const t0 = Date.now();
    const timed = await withTimeout(searchExt(q, genre), opt.providerTimeoutMs);
    if (!timed.ok) {
      runs.push({
        providerId: "external_http",
        ok: false,
        durationMs: Date.now() - t0,
        candidateCount: 0,
        error: timed.reason === "timeout" ? "timeout" : timed.error ?? "error",
      });
    } else {
      try {
        const mapped = mapExternalResults(timed.value);
        batch.push(...mapped);
        runs.push({
          providerId: "external_http",
          ok: true,
          durationMs: Date.now() - t0,
          candidateCount: mapped.length,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        runs.push({
          providerId: "external_http",
          ok: false,
          durationMs: Date.now() - t0,
          candidateCount: 0,
          error: msg,
        });
      }
    }
  }

  const candidates = dedupeSortAndCap(batch, opt.maxPerOrigin, opt.totalCap);
  return { candidates, providerRuns: runs };
}
