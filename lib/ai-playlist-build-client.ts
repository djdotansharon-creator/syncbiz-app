/**
 * Client helper for POST /api/playlists/ai-build (prompt mode).
 * Desktop shell forwards PlaylistPro local snapshot candidates when the bridge is available.
 * Multi-lane prompts search each recipe lane separately (never one mega-query).
 * Merge order on the server: per-lane catalog + local selection, then round-robin interleave.
 */

import { parseDjPlaylistRecipe } from "@/lib/dj-intent-parse";
import { storeAiPlaylistTracksMeta } from "@/lib/ai-playlist-track-meta-cache";

export const AI_PLAYLIST_COUNT_OPTIONS = [25, 50, 75, 100] as const;
export type AiPlaylistCountOption = (typeof AI_PLAYLIST_COUNT_OPTIONS)[number];
export const DEFAULT_AI_PLAYLIST_COUNT: AiPlaylistCountOption = 50;

export type AiPlaylistLocalMatchDebugRow = {
  title: string;
  score: number;
  fullMatch: boolean;
  groupsMatched: number;
  groupsTotal: number;
  reason: string;
  groups: Array<{ label: string; matched: boolean; fields: string[]; terms: string[] }>;
};

/**
 * Structured shortfall hint from the server build step. When present, the renderer
 * should render a localized "short accurate" message in Hebrew or English instead
 * of the English `shortfallExplanation` fallback.
 */
export type AiPlaylistShortfallHintClient = {
  kind: "short_accurate";
  matchedCount: number;
  intentLabel: string;
};

/**
 * Thrown by `requestAiPlaylistBuild` when the server reports a strict-relevance
 * shortfall of zero playable rows (HTTP 422 with `kind: "no_strong_matches"`).
 *
 * Renderers should `catch (e) { if (e instanceof AiPlaylistNoStrongMatchesClientError) ... }`
 * to show a localized "no strong matches" hint rather than the raw message.
 */
export class AiPlaylistNoStrongMatchesClientError extends Error {
  readonly kind = "no_strong_matches" as const;
  readonly intentLabel: string;
  readonly matchedCount: number;
  constructor(message: string, args: { intentLabel: string; matchedCount: number }) {
    super(message);
    this.name = "AiPlaylistNoStrongMatchesClientError";
    this.intentLabel = args.intentLabel;
    this.matchedCount = args.matchedCount;
  }
}

export type AiPlaylistBuildClientResult = {
  playlistId: string;
  title: string;
  count: number;
  requestedCount: number;
  shortfallExplanation: string | null;
  /** Structured hint so the renderer can localize the shortfall message. */
  shortfallHint: AiPlaylistShortfallHintClient | null;
  /** How many local snapshot rows were attached (0 if none or browser). */
  localCandidatesCount: number;
  /** True when `window.syncbizDesktop.searchLocalForAiPlaylist` exists (Desktop shell). */
  localBridgeAvailable: boolean;
  catalogCandidatesPooled: number;
  localTracksInPlaylist: number;
  catalogTracksInPlaylist: number;
  /** Dev: top local snapshot match explanations (Desktop only). */
  localMatchDebugTop?: AiPlaylistLocalMatchDebugRow[];
  /** Dev: true when multi-intent query had no full local matches. */
  localPartialFallback?: boolean;
};

function parseShortfallHint(raw: unknown): AiPlaylistShortfallHintClient | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "short_accurate") return null;
  const matchedCount =
    typeof r.matchedCount === "number" && Number.isFinite(r.matchedCount)
      ? Math.max(0, Math.trunc(r.matchedCount))
      : 0;
  const intentLabel = typeof r.intentLabel === "string" ? r.intentLabel.trim() : "";
  if (intentLabel.length === 0) return null;
  return { kind: "short_accurate", matchedCount, intentLabel };
}

export function isAiPlaylistCountOption(n: number): n is AiPlaylistCountOption {
  return (AI_PLAYLIST_COUNT_OPTIONS as readonly number[]).includes(n);
}

export function clampAiPlaylistCount(raw: number): AiPlaylistCountOption {
  const n = Math.round(raw);
  if (isAiPlaylistCountOption(n)) return n;
  return DEFAULT_AI_PLAYLIST_COUNT;
}

export async function requestAiPlaylistBuild(args: {
  prompt: string;
  count?: number;
  branchId?: string;
}): Promise<AiPlaylistBuildClientResult> {
  const prompt = args.prompt.trim();
  if (prompt.length < 2) {
    throw new Error("Prompt is too short");
  }
  const count = clampAiPlaylistCount(args.count ?? DEFAULT_AI_PLAYLIST_COUNT);
  const body: Record<string, unknown> = {
    mode: "prompt",
    prompt,
    branchId: (args.branchId ?? "default").trim() || "default",
    count,
  };

  const desktop = typeof window !== "undefined" ? window.syncbizDesktop : undefined;
  const localFetch = desktop?.searchLocalForAiPlaylist;
  const localBridgeAvailable = typeof localFetch === "function";
  let localCandidatesCount = 0;
  let localMatchDebugTop: AiPlaylistLocalMatchDebugRow[] | undefined;
  let localPartialFallback = false;
  if (localBridgeAvailable) {
    try {
      const recipe = parseDjPlaylistRecipe(prompt);
      const laneQueries =
        recipe.mode === "multi" && recipe.lanes.length >= 2
          ? recipe.lanes.map((lane) => lane.rawPhrase)
          : [prompt];
      type LocalCandidateRow = Extract<
        Awaited<ReturnType<NonNullable<typeof localFetch>>>,
        { status: "ok" }
      >["candidates"][number];
      const byLocalId = new Map<string, LocalCandidateRow>();
      for (const laneQuery of laneQueries) {
        const localRes = await localFetch!(laneQuery, 80);
        if (localRes.status !== "ok" || !Array.isArray(localRes.candidates)) continue;
        for (const c of localRes.candidates) {
          const prev = byLocalId.get(c.localId);
          if (!prev || c.score > prev.score) byLocalId.set(c.localId, c);
        }
      }
      const mergedCandidates = [...byLocalId.values()].sort((a, b) => b.score - a.score);
      localCandidatesCount = mergedCandidates.length;
      if (localCandidatesCount > 0) {
        body.additionalCandidates = { localTracks: mergedCandidates };
        const multi = mergedCandidates.some((c) => (c.matchDebug?.groupsTotal ?? 0) >= 2);
        const hasFull = mergedCandidates.some((c) => c.matchDebug?.fullMatch);
        localPartialFallback = multi && !hasFull;
        localMatchDebugTop = mergedCandidates.slice(0, 8).map((c) => ({
          title: [c.artist, c.title].filter(Boolean).join(" — ") || c.relativePathFromRoot || c.localId,
          score: c.score,
          fullMatch: c.matchDebug?.fullMatch ?? false,
          groupsMatched: c.matchDebug?.groupsMatched ?? 0,
          groupsTotal: c.matchDebug?.groupsTotal ?? 0,
          reason: c.matchDebug?.reason ?? "",
          groups: c.matchDebug?.groups ?? [],
        }));
      }
      if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
        if (localCandidatesCount === 0) {
          console.warn(
            "[ai-playlist-build] Desktop local library returned 0 candidates for this prompt.",
            { query: prompt, laneQueries },
          );
        } else {
          console.info("[ai-playlist-build] Local candidates:", localCandidatesCount, {
            query: prompt,
            laneQueries,
          });
          if (localPartialFallback) {
            console.warn("[ai-playlist-build] No full local match; showing partial matches.");
          }
          console.table(
            (localMatchDebugTop ?? []).map((r) => ({
              title: r.title.slice(0, 60),
              score: r.score,
              full: r.fullMatch,
              groups: `${r.groupsMatched}/${r.groupsTotal}`,
              reason: r.reason.slice(0, 120),
            })),
          );
        }
      }
    } catch (e) {
      if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
        console.warn("[ai-playlist-build] searchLocalForAiPlaylist failed:", e);
      }
    }
  }

  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    console.info("[ai-playlist-build] bridge", {
      localBridgeAvailable,
      searchLocalForAiPlaylistCalled: localBridgeAvailable,
      localCandidatesCount,
      sentInAdditionalCandidates: Boolean(body.additionalCandidates),
    });
    console.info("[ai-playlist-build] POST /api/playlists/ai-build", body);
  }

  const res = await fetch("/api/playlists/ai-build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // Pilot Blocker — graceful "no strong matches" handling. The server returns
    // a structured 422 payload with `kind: "no_strong_matches"` rather than an
    // opaque 500 when strict relevance leaves zero playable rows. We surface
    // that as a typed error the renderer can localize.
    if (res.status === 422 && data.kind === "no_strong_matches") {
      const intentLabel =
        typeof data.intentLabel === "string" ? data.intentLabel.trim() : prompt;
      const err = new AiPlaylistNoStrongMatchesClientError(
        typeof data.error === "string" && data.error.trim()
          ? data.error.trim()
          : `No strong matches for "${intentLabel}".`,
        { intentLabel, matchedCount: 0 },
      );
      if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
        console.warn("[ai-playlist-build] no strong matches", { intentLabel, data });
      }
      throw err;
    }
    const err =
      typeof data.error === "string" && data.error.trim()
        ? data.error.trim()
        : `AI playlist build failed (${res.status})`;
    if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
      console.error("[ai-playlist-build] failed", res.status, data);
    }
    throw new Error(err);
  }
  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    console.info("[ai-playlist-build] ok", data);
    if (data.buildDiagnostics && typeof data.buildDiagnostics === "object") {
      console.info("[ai-playlist-build] buildDiagnostics", data.buildDiagnostics);
      const diag = data.buildDiagnostics as { topCandidates?: unknown[] };
      if (Array.isArray(diag.topCandidates)) {
        console.table(
          diag.topCandidates.map((row) => {
            const r = row as Record<string, unknown>;
            return {
              source: r.source,
              title: String(r.title ?? "").slice(0, 50),
              full: r.fullMatch,
              groups: `${r.groupsMatched}/${r.groupsTotal}`,
              score: r.score,
              reason: String(r.reason ?? "").slice(0, 100),
            };
          }),
        );
      }
    }
  }
  const playlistId = typeof data.playlistId === "string" ? data.playlistId.trim() : "";
  if (!playlistId) {
    throw new Error("AI playlist build returned no playlist id");
  }
  const trackCount = typeof data.count === "number" ? data.count : Number(data.count) || 0;
  if (trackCount < 1) {
    throw new Error("AI playlist build returned zero tracks");
  }

  // Cache per-track display chips for this session. `PlaylistItem` has no JSON
  // column for taxonomy, so without this cache the chips would only show on
  // the playlist that just came back — we'd lose them on the very next
  // navigation. The cache is sessionStorage-scoped + capped at 32 playlists.
  if (data.tracksMeta) {
    try {
      storeAiPlaylistTracksMeta(playlistId, data.tracksMeta);
    } catch (e) {
      if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
        console.warn("[ai-playlist-build] storeAiPlaylistTracksMeta failed:", e);
      }
    }
  }
  const catalogCandidatesPooled =
    typeof data.catalogCandidatesPooled === "number" ? data.catalogCandidatesPooled : 0;
  const localTracksInPlaylist =
    typeof data.localTracksInPlaylist === "number" ? data.localTracksInPlaylist : 0;
  const catalogTracksInPlaylist =
    typeof data.catalogTracksInPlaylist === "number" ? data.catalogTracksInPlaylist : 0;

  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    console.info("[ai-playlist-build] merge", {
      catalogCandidatesPooled,
      localCandidatesCount,
      catalogTracksInPlaylist,
      localTracksInPlaylist,
    });
  }

  return {
    playlistId,
    title: String(data.title ?? "").trim() || "AI playlist",
    count: trackCount,
    requestedCount:
      typeof data.requestedCount === "number" ? data.requestedCount : count,
    shortfallExplanation:
      data.shortfallExplanation != null ? String(data.shortfallExplanation) : null,
    shortfallHint: parseShortfallHint(data.shortfallHint),
    localCandidatesCount,
    localBridgeAvailable,
    catalogCandidatesPooled,
    localTracksInPlaylist,
    catalogTracksInPlaylist,
    ...(localMatchDebugTop ? { localMatchDebugTop } : {}),
    ...(localPartialFallback ? { localPartialFallback: true } : {}),
  };
}
