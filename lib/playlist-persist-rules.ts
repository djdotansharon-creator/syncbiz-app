import type { Playlist, PlaylistTrack, PlaylistType, ScheduleContributorBlock } from "./playlist-types";

const VALID_TYPES: PlaylistType[] = [
  "soundcloud",
  "youtube",
  "spotify",
  "winamp",
  "local",
  "stream-url",
];

function isHttpUrl(u: string): boolean {
  const t = u.trim();
  return t.startsWith("http://") || t.startsWith("https://");
}

function trackDisplayName(t: PlaylistTrack): string {
  const n = (t.name ?? "").trim();
  if (n) return n;
  const title = (t as { title?: string }).title;
  return typeof title === "string" ? title.trim() : "";
}

export class PlaylistPersistError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlaylistPersistError";
  }
}

export function isPlaylistPersistError(e: unknown): e is PlaylistPersistError {
  return e instanceof PlaylistPersistError;
}

/**
 * Canonical shape before every disk write: explicit tracks (≥1), valid order for multi-track,
 * no mixed HTTP vs non-HTTP track URLs.
 */
export function normalizePlaylistForPersist(playlist: Playlist): Playlist {
  const id = (playlist.id ?? "").trim();
  if (!id) {
    throw new PlaylistPersistError("MISSING_ID", "Playlist id is required.");
  }

  const name = (playlist.name ?? "").trim() || "Untitled";
  let tracks = playlist.tracks;

  if (!tracks || tracks.length === 0) {
    const url = (playlist.url ?? "").trim();
    if (!url) {
      throw new PlaylistPersistError(
        "NO_TRACKS_NO_URL",
        "Playlist must have at least one track or a non-empty url.",
      );
    }
    const thumb = (playlist.thumbnail ?? playlist.cover ?? "").trim();
    tracks = [
      {
        id,
        name,
        type: playlist.type,
        url,
        cover: thumb || undefined,
      },
    ];
  }

  const seenIds = new Set<string>();
  for (const t of tracks) {
    const tid = (t.id ?? "").trim();
    if (!tid) {
      throw new PlaylistPersistError("TRACK_MISSING_ID", "Each track must have an id.");
    }
    if (seenIds.has(tid)) {
      throw new PlaylistPersistError("DUPLICATE_TRACK_ID", `Duplicate track id: ${tid}`);
    }
    seenIds.add(tid);

    const u = (t.url ?? "").trim();
    if (!u) {
      throw new PlaylistPersistError("TRACK_MISSING_URL", "Each track must have a non-empty url.");
    }
    const disp = trackDisplayName({ ...t, name: t.name ?? "" });
    if (!disp) {
      throw new PlaylistPersistError("TRACK_MISSING_NAME", "Each track must have a name or title.");
    }
    if (!VALID_TYPES.includes(t.type)) {
      throw new PlaylistPersistError("TRACK_INVALID_TYPE", `Invalid track type: ${String(t.type)}`);
    }
  }

  const httpFlags = tracks.map((t) => isHttpUrl(t.url));
  const hasHttp = httpFlags.some(Boolean);
  const hasNonHttp = httpFlags.some((f) => !f);
  if (hasHttp && hasNonHttp) {
    throw new PlaylistPersistError(
      "MIXED_URL_SCHEMES",
      "Tracks cannot mix HTTP(S) URLs with non-HTTP URLs (e.g. local://).",
    );
  }

  let order: string[] | undefined = playlist.order;
  if (tracks.length > 1) {
    if (!order || order.length === 0) {
      order = tracks.map((t) => t.id);
    } else {
      const idSet = new Set(tracks.map((t) => t.id));
      if (order.length !== new Set(order).size) {
        throw new PlaylistPersistError("ORDER_DUPLICATE", "order contains duplicate ids.");
      }
      for (const oid of order) {
        if (!idSet.has(oid)) {
          throw new PlaylistPersistError(
            "ORDER_UNKNOWN_ID",
            `order references unknown track id: ${oid}`,
          );
        }
      }
      for (const tid of idSet) {
        if (!order.includes(tid)) {
          throw new PlaylistPersistError(
            "ORDER_INCOMPLETE",
            "order must list every track id exactly once when order is provided.",
          );
        }
      }
      if (order.length !== tracks.length) {
        throw new PlaylistPersistError("ORDER_LENGTH", "order length must match number of tracks.");
      }
    }
  } else {
    if (order && order.length > 0) {
      if (order.length !== 1 || order[0] !== tracks[0].id) {
        order = [tracks[0].id];
      }
    } else {
      order = undefined;
    }
  }

  const normalizedTracks: PlaylistTrack[] = tracks.map((t) => ({
    ...t,
    id: t.id.trim(),
    name: trackDisplayName(t) || t.id,
    url: t.url.trim(),
    type: t.type,
  }));

  const trackIdSet = new Set(normalizedTracks.map((t) => t.id));
  let scheduleContributorBlocks: ScheduleContributorBlock[] | undefined = playlist.scheduleContributorBlocks;
  if (scheduleContributorBlocks && scheduleContributorBlocks.length > 0) {
    const seenInBlocks = new Set<string>();
    for (const b of scheduleContributorBlocks) {
      for (const tid of b.trackIds) {
        if (!trackIdSet.has(tid)) {
          throw new PlaylistPersistError(
            "SCHEDULE_BLOCK_UNKNOWN_TRACK",
            `scheduleContributorBlocks references unknown track id: ${tid}`,
          );
        }
        if (seenInBlocks.has(tid)) {
          throw new PlaylistPersistError(
            "SCHEDULE_BLOCK_DUP_TRACK",
            "Each track id may appear in at most one scheduleContributorBlocks entry.",
          );
        }
        seenInBlocks.add(tid);
      }
    }
    if (seenInBlocks.size !== trackIdSet.size) {
      throw new PlaylistPersistError(
        "SCHEDULE_BLOCKS_INCOMPLETE",
        "scheduleContributorBlocks must list every track id exactly once.",
      );
    }
  } else {
    scheduleContributorBlocks = undefined;
  }

  return {
    ...playlist,
    id,
    name,
    tracks: normalizedTracks,
    order,
    scheduleContributorBlocks,
  };
}
