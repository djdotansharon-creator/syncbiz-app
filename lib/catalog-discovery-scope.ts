import type { Prisma } from "@prisma/client";

/** Rows eligible for discovery, smart-search, DJ Creator API, and similar surfaces. */
export const catalogDiscoveryActiveWhere: Prisma.CatalogItemWhereInput = {
  archivedAt: null,
};
