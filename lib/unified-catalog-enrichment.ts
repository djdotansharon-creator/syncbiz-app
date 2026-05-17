/**
 * Attaches catalog + latest snapshot display fields to in-memory Playlist / tracks for GET /api/sources/unified.
 * Does not persist; safe no-ops when ids missing or rows not found.
 */

import { prisma } from "@/lib/prisma";
import type { UnifiedSource } from "@/lib/source-types";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";

type Snapshot = {
  viewCount: number | null;
  likeCount: number | null;
  publishedAt: Date | null;
};

function applyItemToTrack(track: PlaylistTrack, curationRating: number, snap: Snapshot | null) {
  const t = track as PlaylistTrack & {
    viewCount?: number;
    likeCount?: number;
    publishedAt?: string;
    curationRating?: number | null;
  };
  if (typeof t.viewCount !== "number" || !Number.isFinite(t.viewCount)) {
    if (snap?.viewCount != null) t.viewCount = snap.viewCount;
  }
  if (snap?.likeCount != null) t.likeCount = snap.likeCount;
  if (snap?.publishedAt) t.publishedAt = snap.publishedAt.toISOString();
  t.curationRating = curationRating;
}

function applyItemToPlaylistShell(p: Playlist, curationRating: number, snap: Snapshot | null) {
  const pl = p as Playlist & {
    likeCount?: number;
    publishedAt?: string;
    curationRating?: number | null;
  };
  if (snap?.likeCount != null) pl.likeCount = snap.likeCount;
  if (snap?.publishedAt) pl.publishedAt = snap.publishedAt.toISOString();
  pl.curationRating = curationRating;
  if (typeof pl.viewCount !== "number" || !Number.isFinite(pl.viewCount)) {
    if (snap?.viewCount != null) pl.viewCount = snap.viewCount;
  }
}

export async function enrichPlaylistsWithCatalogForUnified(playlists: Playlist[]): Promise<void> {
  const ids = new Set<string>();
  for (const p of playlists) {
    const cid = (p.catalogItemId ?? "").trim();
    if (cid) ids.add(cid);
    for (const t of getPlaylistTracks(p)) {
      const tid = (t.catalogItemId ?? "").trim();
      if (tid) ids.add(tid);
    }
  }
  if (ids.size === 0) return;

  const rows = await prisma.catalogItem.findMany({
    where: { id: { in: [...ids] }, archivedAt: null },
    select: {
      id: true,
      curationRating: true,
      durationSec: true,
      catalogSourceSnapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 1,
        select: { viewCount: true, likeCount: true, publishedAt: true },
      },
    },
  });

  const byId = new Map<
    string,
    { curationRating: number; snap: Snapshot | null; durationSec: number | null }
  >();
  for (const r of rows) {
    const s0 = r.catalogSourceSnapshots[0];
    byId.set(r.id, {
      curationRating: r.curationRating ?? 0,
      durationSec: r.durationSec,
      snap: s0
        ? {
            viewCount: s0.viewCount ?? null,
            likeCount: s0.likeCount ?? null,
            publishedAt: s0.publishedAt,
          }
        : null,
    });
  }

  for (const p of playlists) {
    const shellId = (p.catalogItemId ?? "").trim();
    if (shellId) {
      const row = byId.get(shellId);
      if (row) applyItemToPlaylistShell(p, row.curationRating, row.snap);
    }
    const tracks = p.tracks;
    if (!tracks?.length) continue;
    for (const t of tracks) {
      const tid = (t.catalogItemId ?? "").trim();
      if (!tid) continue;
      const row = byId.get(tid);
      if (!row) continue;
      applyItemToTrack(t, row.curationRating, row.snap);
      if ((t.durationSeconds == null || t.durationSeconds <= 0) && row.durationSec != null && row.durationSec > 0) {
        t.durationSeconds = row.durationSec;
      }
    }
  }
}

function canonicalizeUrlForCatalogLookup(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    const u = new URL(t);
    u.hash = "";
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if ((host === "youtube.com" || host === "m.youtube.com") && u.pathname === "/watch") {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/watch?v=${v}`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    return u.toString();
  } catch {
    return t;
  }
}

function catalogKeyVariants(raw: string): string[] {
  const c = canonicalizeUrlForCatalogLookup(raw);
  if (!c) return [];
  return c === c.toLowerCase() ? [c] : [c, c.toLowerCase()];
}

type CatalogRowLite = {
  curationRating: number;
  durationSec: number | null;
  snap: Snapshot | null;
};

/** Fills missing view/like/publish/curation/duration on unified rows from CatalogItem.url / canonicalUrl. */
export async function enrichUnifiedSourcesByCatalogUrl(unified: UnifiedSource[]): Promise<void> {
  const keySet = new Set<string>();
  for (const us of unified) {
    for (const k of catalogKeyVariants(us.url ?? "")) keySet.add(k);
    if (us.playlist) {
      for (const tr of getPlaylistTracks(us.playlist)) {
        for (const k of catalogKeyVariants(tr.url ?? "")) keySet.add(k);
      }
    }
  }
  const keys = [...keySet].filter(Boolean);
  if (keys.length === 0) return;

  const rows = await prisma.catalogItem.findMany({
    where: {
      archivedAt: null,
      OR: [{ url: { in: keys } }, { canonicalUrl: { in: keys } }],
    },
    select: {
      url: true,
      canonicalUrl: true,
      curationRating: true,
      durationSec: true,
      catalogSourceSnapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 1,
        select: { viewCount: true, likeCount: true, publishedAt: true },
      },
    },
  });

  const byKey = new Map<string, CatalogRowLite>();
  for (const r of rows) {
    const s0 = r.catalogSourceSnapshots[0];
    const lite: CatalogRowLite = {
      curationRating: r.curationRating ?? 0,
      durationSec: r.durationSec,
      snap: s0
        ? {
            viewCount: s0.viewCount ?? null,
            likeCount: s0.likeCount ?? null,
            publishedAt: s0.publishedAt,
          }
        : null,
    };
    for (const key of [r.url, r.canonicalUrl].filter(Boolean) as string[]) {
      for (const k of catalogKeyVariants(key)) {
        if (!byKey.has(k)) byKey.set(k, lite);
      }
    }
  }

  function fillUnified(us: UnifiedSource, row: CatalogRowLite) {
    const snap = row.snap;
    if (us.viewCount == null || !Number.isFinite(us.viewCount)) {
      if (snap?.viewCount != null) us.viewCount = snap.viewCount;
    }
    if (us.likeCount == null || !Number.isFinite(us.likeCount)) {
      if (snap?.likeCount != null) us.likeCount = snap.likeCount;
    }
    if (!us.publishedAt?.trim()) {
      if (snap?.publishedAt) us.publishedAt = snap.publishedAt.toISOString();
    }
    const cur = us.curationRating;
    if (cur == null || cur === 0) {
      if (row.curationRating > 0) us.curationRating = row.curationRating;
    }
    if ((us.leafDurationSeconds == null || us.leafDurationSeconds <= 0) && row.durationSec != null && row.durationSec > 0) {
      us.leafDurationSeconds = row.durationSec;
    }
    if (us.playlist && (us.playlist.durationSeconds == null || us.playlist.durationSeconds <= 0)) {
      if (row.durationSec != null && row.durationSec > 0) {
        us.playlist.durationSeconds = row.durationSec;
      }
    }
  }

  for (const us of unified) {
    let row: CatalogRowLite | undefined;
    for (const k of catalogKeyVariants(us.url ?? "")) {
      row = byKey.get(k);
      if (row) break;
    }
    if (row) fillUnified(us, row);

    const tracks = us.playlist?.tracks;
    if (!tracks?.length) continue;
    for (const tr of tracks) {
      let trRow: CatalogRowLite | undefined;
      for (const k of catalogKeyVariants(tr.url)) {
        trRow = byKey.get(k);
        if (trRow) break;
      }
      if (!trRow) continue;
      applyItemToTrack(tr, trRow.curationRating, trRow.snap);
      if ((tr.durationSeconds == null || tr.durationSeconds <= 0) && trRow.durationSec != null && trRow.durationSec > 0) {
        tr.durationSeconds = trRow.durationSec;
      }
    }
  }
}
