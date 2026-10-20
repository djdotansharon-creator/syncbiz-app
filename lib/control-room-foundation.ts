/**
 * CONTROL ROOM F1 — Brand + Zone foundation (SHADOW).
 *
 * Hierarchy (CLAUDE.md §11, docs/CONTROL_ROOM_BLUEPRINT.md): Organization (= Workspace) → Brand → Location (= Branch)
 * → Zone → Station. Zone is the final playback destination.
 *
 * F1 = SHADOW ONLY. Nothing here makes a runtime decision: no authz, token, WS room, designation-store, station
 * registration or playback path reads Brand / Zone. The only write path is legitimate Location creation
 * (`store.addBranch`), which attaches the default Brand and creates the default Zone in the same transaction.
 *
 * NULL-ZONE COMPATIBILITY (F1): `StationDevice.zoneId` / `BranchMasterDesignation.zoneId` NULL means "the Location's
 * default Zone". This is compatibility semantics only — a later hardening gate makes zoneId mandatory.
 *
 * DEFAULT UNIQUENESS: partial unique indexes guarantee AT MOST ONE default Brand per Workspace and AT MOST ONE
 * default Zone per Location. EXACTLY ONE is guaranteed by the idempotent backfill + this transactional creation + the
 * F1 check script (scripts/control-room/f1-foundation.cjs, which mirrors the constants below).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { LEGACY_DEFAULT_BRANCH_KEY } from "@/lib/branch-resolver";

export const DEFAULT_BRAND_CODE = "MAIN";
export const DEFAULT_ZONE_CODE = "MAIN";
export const DEFAULT_ZONE_NAME = "Main";
export const DEFAULT_ZONE_TYPE_CODE = "MAIN";

// ── Zone type: flexible canonical CODE (not a DB enum) ─────────────────────────────────────────────────────────
// Any code matching ZONE_TYPE_CODE_PATTERN is valid — new verticals never need a migration. The catalog below only
// gives known codes a display label; unknown-but-valid codes are accepted (custom types) and labelled from the code.
export const ZONE_TYPE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,39}$/;

export const KNOWN_ZONE_TYPES: Readonly<Record<string, string>> = {
  MAIN: "Main area",
  LOBBY: "Lobby",
  POOL: "Pool",
  SPA: "Spa",
  RESTAURANT: "Restaurant",
  BAR: "Bar",
  GYM: "Gym",
  ROOFTOP: "Rooftop",
  RETAIL: "Retail floor",
  OUTDOOR: "Outdoor",
  BALLROOM: "Ballroom",
  BEACH: "Beach",
  KIDS_CLUB: "Kids club",
  TERRACE: "Terrace",
  OTHER: "Other",
};

/** Canonical zone-type code: trimmed, upper-cased, spaces / hyphens → "_". Returns null when not a valid code. */
export function normalizeZoneTypeCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return ZONE_TYPE_CODE_PATTERN.test(code) ? code : null;
}

/** Display label for a zone-type code (catalog label, else a readable form of the code). */
export function zoneTypeLabel(code: string): string {
  return KNOWN_ZONE_TYPES[code] ?? code.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// ── Pure compatibility resolution ───────────────────────────────────────────────────────────────────────────────
export type ZoneRow = { id: string; workspaceId: string; branchId: string; isDefault: boolean };

export type ZoneResolution =
  | { ok: true; zoneId: string; viaDefault: boolean }
  | { ok: false; reason: "no-default-zone" | "zone-not-found" | "zone-outside-location" };

/**
 * PURE: resolve the effective Zone of a station / designation within its own Location.
 * zoneId set → that zone, only if it belongs to the same workspace + location; NULL → the Location's default zone.
 */
export function decideZoneResolution(
  input: { workspaceId: string; branchId: string; zoneId: string | null | undefined },
  zonesOfLocation: ZoneRow[],
  zoneById?: ZoneRow | null,
): ZoneResolution {
  if (input.zoneId) {
    const z = zoneById ?? zonesOfLocation.find((r) => r.id === input.zoneId) ?? null;
    if (!z) return { ok: false, reason: "zone-not-found" };
    if (z.workspaceId !== input.workspaceId || z.branchId !== input.branchId) return { ok: false, reason: "zone-outside-location" };
    return { ok: true, zoneId: z.id, viaDefault: false };
  }
  const defaults = zonesOfLocation.filter((r) => r.isDefault && r.workspaceId === input.workspaceId && r.branchId === input.branchId);
  return defaults.length === 1 ? { ok: true, zoneId: defaults[0].id, viaDefault: true } : { ok: false, reason: "no-default-zone" };
}

// ── Read-only helpers (SHADOW — not used by any runtime decision in F1) ────────────────────────────────────────
/** The Location row for a (workspace, branch) pair; the legacy key "default" resolves via the workspace alias. */
async function findLocation(workspaceId: string, branchId: string) {
  const b = (branchId ?? "").trim() || LEGACY_DEFAULT_BRANCH_KEY;
  return prisma.branch.findFirst({
    where: { workspaceId, OR: [{ id: b }, { legacyKey: b }] },
    select: { id: true, workspaceId: true, brandId: true },
  });
}

/** Read-only: the Location's Brand id (its brandId, else the workspace default brand). Never throws. */
export async function resolveBrand(workspaceId: string, branchId: string): Promise<string | null> {
  try {
    const loc = await findLocation(workspaceId, branchId);
    if (!loc) return null;
    if (loc.brandId) return loc.brandId;
    const def = await prisma.brand.findFirst({ where: { workspaceId, isDefault: true }, select: { id: true } });
    return def?.id ?? null;
  } catch {
    return null;
  }
}

/** Read-only: the effective Zone of (workspace, branch, zoneId?) with NULL-zone compatibility semantics. Never throws. */
export async function resolveZone(workspaceId: string, branchId: string, zoneId?: string | null): Promise<ZoneResolution> {
  try {
    const loc = await findLocation(workspaceId, branchId);
    if (!loc) return { ok: false, reason: "zone-outside-location" };
    const zones = await prisma.zone.findMany({
      where: { branchId: loc.id },
      select: { id: true, workspaceId: true, branchId: true, isDefault: true },
    });
    const byId = zoneId
      ? await prisma.zone.findUnique({ where: { id: zoneId }, select: { id: true, workspaceId: true, branchId: true, isDefault: true } })
      : null;
    return decideZoneResolution({ workspaceId, branchId: loc.id, zoneId }, zones, byId);
  } catch {
    return { ok: false, reason: "no-default-zone" };
  }
}

// ── Transactional Location creation support ────────────────────────────────────────────────────────────────────
/** Inside a transaction: the workspace's default Brand id, creating it when missing (race-safe via the partial index). */
export async function ensureDefaultBrandId(tx: Prisma.TransactionClient, workspaceId: string): Promise<string> {
  const existing = await tx.brand.findFirst({ where: { workspaceId, isDefault: true }, select: { id: true } });
  if (existing) return existing.id;
  const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
  const created = await tx.brand.create({
    data: { workspaceId, name: (ws?.name ?? "").trim() || "Main", code: DEFAULT_BRAND_CODE, isDefault: true },
    select: { id: true },
  });
  return created.id;
}

/** Data for a Location's default Zone. */
export function defaultZoneData(workspaceId: string, branchId: string) {
  return {
    workspaceId,
    branchId,
    name: DEFAULT_ZONE_NAME,
    code: DEFAULT_ZONE_CODE,
    zoneTypeCode: DEFAULT_ZONE_TYPE_CODE,
    isDefault: true,
  };
}
