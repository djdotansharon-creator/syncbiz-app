import type { PlaylistType } from "./playlist-types";

/** Phase 1 catalog row: durable identity for a normalized URL within a tenant. Playback does not depend on this yet. */
export type CatalogItem = {
  id: string;
  tenantId: string;
  urlKey: string;
  type: PlaylistType;
  title: string;
  thumbnailUrl: string;
  createdAt: string;
  updatedAt: string;
};
