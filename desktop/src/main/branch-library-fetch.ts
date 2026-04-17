/**
 * Read-only branch library for the configured branchId (not owner_personal).
 * Calls Next.js GET /api/sources/unified?scope=branch with Bearer token.
 */

import type { BranchLibraryItem, BranchLibrarySummary, DesktopRuntimeConfig } from "../shared/mvp-types";

/** Subset of server `UnifiedSource` JSON — keep loose for forward compatibility. */
type UnifiedApiItem = {
  id?: string;
  title?: string;
  genre?: string;
  type?: string;
  cover?: string | null;
  origin?: string;
  /** Direct playback URL (stream URL, YouTube URL, etc.) — present on all source types from /api/sources/unified. */
  url?: string;
  playlist?: {
    branchId?: string;
    name?: string;
    playlistOwnershipScope?: "branch" | "owner_personal";
  };
  radio?: { branchId?: string; name?: string };
  source?: { id?: string; branchId?: string; name?: string };
};

function resolveItemBranchId(item: UnifiedApiItem): string {
  if (item.origin === "playlist" && item.playlist) {
    return item.playlist.branchId?.trim() || "default";
  }
  if (item.origin === "radio" && item.radio) {
    return item.radio.branchId?.trim() || "default";
  }
  if (item.origin === "source" && item.source) {
    return item.source.branchId?.trim() || "default";
  }
  return "default";
}

function toBranchLibraryItem(raw: UnifiedApiItem): BranchLibraryItem | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;
  const origin = raw.origin;
  if (origin !== "playlist" && origin !== "radio" && origin !== "source") return null;

  const title =
    (typeof raw.title === "string" && raw.title.trim()) ||
    (origin === "playlist" ? raw.playlist?.name : undefined) ||
    (origin === "radio" ? raw.radio?.name : undefined) ||
    (origin === "source" ? raw.source?.name : undefined) ||
    "Untitled";

  const type = typeof raw.type === "string" && raw.type.trim() ? raw.type.trim() : "unknown";
  const genre = typeof raw.genre === "string" && raw.genre.trim() ? raw.genre.trim() : "—";
  const cover = raw.cover === null || raw.cover === undefined ? null : String(raw.cover);

  if (origin === "playlist" && raw.playlist?.playlistOwnershipScope === "owner_personal") {
    return null;
  }

  return {
    id,
    title,
    origin,
    type,
    branchId: resolveItemBranchId(raw),
    genre,
    cover,
    url: typeof raw.url === "string" ? raw.url.trim() : "",
  };
}

export async function fetchBranchLibrarySummary(config: DesktopRuntimeConfig): Promise<BranchLibrarySummary> {
  const base = (config.apiBaseUrl ?? "").trim().replace(/\/$/, "");
  const token = (config.wsToken ?? "").trim();
  const branchId = (config.branchId ?? "default").trim() || "default";

  if (!base) {
    return { status: "error", errorMessage: "Set API base URL (Next.js app origin, e.g. http://localhost:3000)." };
  }
  if (!token) {
    return { status: "error", errorMessage: "Sign in or paste a token — it is used for read-only API calls." };
  }

  const url = `${base}/api/sources/unified?scope=branch`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (res.status === 401) {
      return {
        status: "error",
        errorMessage: "Unauthorized — token missing or expired. Sign in again or paste a fresh token.",
      };
    }
    if (!res.ok) {
      return { status: "error", errorMessage: `API error HTTP ${res.status}` };
    }
    const rawItems = (await res.json()) as unknown;
    if (!Array.isArray(rawItems)) {
      return { status: "error", errorMessage: "Invalid API response" };
    }

    const mapped: BranchLibraryItem[] = [];
    for (const row of rawItems) {
      const item = toBranchLibraryItem(row as UnifiedApiItem);
      if (item && item.branchId === branchId) {
        mapped.push(item);
      }
    }
    mapped.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

    const playlists = mapped.filter((s) => s.origin === "playlist");
    const radios = mapped.filter((s) => s.origin === "radio");
    const sources = mapped.filter((s) => s.origin === "source");
    const samplePlaylistNames = playlists
      .slice(0, 8)
      .map((s) => s.title)
      .filter(Boolean);

    return {
      status: "ok",
      branchId,
      playlistCount: playlists.length,
      radioCount: radios.length,
      sourceCount: sources.length,
      samplePlaylistNames,
      items: mapped,
      loadedAtIso: new Date().toISOString(),
      errorMessage: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "error", errorMessage: msg };
  }
}
