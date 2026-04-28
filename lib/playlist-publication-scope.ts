/**
 * Stage 2 — Playlist publication / visibility contract (product-facing discovery scope).
 * Separate from `playlistOwnershipScope` (branch vs owner_personal library placement).
 *
 * Values mirror `PlaylistPublicationScope` in prisma/schema.prisma.
 */

export type PlaylistPublicationScope =
  | "PRIVATE"
  | "LINK_SHARED"
  | "COMMUNITY_PUBLISHED"
  | "TEMPLATE"
  | "OFFICIAL_SYNCBIZ"
  | "FORK_REMIX";

export const PLAYLIST_PUBLICATION_SCOPES: PlaylistPublicationScope[] = [
  "PRIVATE",
  "LINK_SHARED",
  "COMMUNITY_PUBLISHED",
  "TEMPLATE",
  "OFFICIAL_SYNCBIZ",
  "FORK_REMIX",
];

const SCOPE_SET = new Set<string>(PLAYLIST_PUBLICATION_SCOPES);

/** Scopes only assignable by platform SUPER_ADMIN (official catalogue / templates). */
export function publicationScopeRequiresPlatformAdmin(scope: PlaylistPublicationScope): boolean {
  return scope === "OFFICIAL_SYNCBIZ" || scope === "TEMPLATE";
}

export function parsePublicationScope(raw: unknown): PlaylistPublicationScope | null {
  if (typeof raw !== "string" || !SCOPE_SET.has(raw)) return null;
  return raw as PlaylistPublicationScope;
}

export const PLAYLIST_PUBLICATION_SCOPE_UI: Record<
  PlaylistPublicationScope,
  { label: string; description: string }
> = {
  PRIVATE: {
    label: "Private",
    description: "Only your workspace. Default — not listed in public discovery.",
  },
  LINK_SHARED: {
    label: "Share by link",
    description: "Unlisted; anyone with the link can view (when link sharing ships).",
  },
  COMMUNITY_PUBLISHED: {
    label: "Published to community",
    description: "Eligible for SyncBiz community discovery (when publishing ships).",
  },
  TEMPLATE: {
    label: "Business template",
    description: "Curated reusable template — platform-managed.",
  },
  OFFICIAL_SYNCBIZ: {
    label: "Official SyncBiz",
    description: "Official curated playlist — platform-managed.",
  },
  FORK_REMIX: {
    label: "Fork / remix",
    description: "Derived from a published list — lineage tracked when fork flows ship.",
  },
};
