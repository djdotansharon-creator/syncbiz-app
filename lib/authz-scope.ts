/**
 * CONTROL ROOM F2a — composite permission scopes: PURE evaluator + legacy translation + read-only loader.
 *
 * SHADOW / OFFLINE ONLY. NOTHING ENFORCES THIS. Current authorization (legacy helpers + the Gate 3A shadow engine in
 * lib/authz.ts) stays authoritative. This module is imported ONLY by the offline TEST tooling
 * (scripts/control-room/f2-*.ts) and tests — never by a route, token, WS, playback or enforcement path (a static test
 * pins that). It has no side effects: the loader takes the DB client as a parameter.
 *
 * LOCKED SEMANTICS (docs/CONTROL_ROOM_BLUEPRINT.md §2d, owner-approved 2026-10-07):
 *  - within ONE row: values of the same dimension = OR; different dimensions = AND
 *  - across rows: UNION — a target is allowed iff SOME row both contains it AND its OWN preset has the capability
 *    (a capability of row A is never combined with the scope of row B); no deny rules
 *  - a row with allLocations=false and no targets MATCHES NOTHING (fail closed)
 *  - a WORKSPACE-level target needs an allLocations row; a zone-limited row never covers a whole LOCATION
 *  - NULL Branch.brandId = the workspace default Brand (F1 compatibility); legacy "default" = the canonical branch
 *    (legacyKey alias, same workspace only); NULL zone = the location's default Zone
 *  - no membership / SUSPENDED membership = DENY
 */
import { CAPABILITIES, PRESET_CAPABILITIES, type Capability, type Preset } from "@/lib/authz";
import { matchLocation } from "@/lib/location-filter";

export const LEGACY_DEFAULT_KEY = "default";
export const LEGACY_ALL_SENTINEL = "*";
export const SCOPE_PRESETS: readonly Preset[] = ["ADMIN", "HQ_CONTROL", "REGIONAL_MANAGER", "BRANCH_MANAGER", "VIEW_ONLY"];

/** Location-level PERMISSION dimensions. F3a adds REGION + GROUP. A Tag is NEVER a permission dimension
 *  (owner-locked 2026-10-07): tags exist only in operational filtering (lib/location-filter.ts). */
export const LOCATION_DIMENSIONS = ["BRAND", "LOCATION", "REGION", "GROUP"] as const;
/** Zone-level dimensions. */
export const ZONE_DIMENSIONS = ["ZONE", "ZONE_TYPE"] as const;
export type ScopeDimension = (typeof LOCATION_DIMENSIONS)[number] | (typeof ZONE_DIMENSIONS)[number];
/** Every permission dimension the evaluator understands (anything else fails closed). */
export const KNOWN_SCOPE_DIMENSIONS: readonly ScopeDimension[] = [...LOCATION_DIMENSIONS, ...ZONE_DIMENSIONS];

export type ScopeTarget = { dimension: ScopeDimension; value: string };
export type ScopeRow = { id: string; preset: Preset; allLocations: boolean; status: string; targets: ScopeTarget[] };

export type HierarchyIndex = {
  workspaceId: string;
  defaultBrandId: string | null;
  canonicalLegacyBranchId: string | null;
  locations: {
    id: string; brandId: string | null; status: string;
    /** F3a classification (optional so pre-F3 indexes stay valid; missing = none). */
    regionId?: string | null; groupIds?: string[]; tagIds?: string[];
  }[];
  zones: { id: string; branchId: string; zoneTypeCode: string; isDefault: boolean; status: string }[];
  /** F3a: classification rows (status "archived" never matches). Missing = none known. */
  regions?: { id: string; status: string }[];
  groups?: { id: string; status: string }[];
  tags?: { id: string; status: string }[];
};

export type ScopeEvalInputs = {
  workspaceId: string | null;
  membership: { role: string; status: string } | null;
  rows: ScopeRow[];
  hierarchy: HierarchyIndex | null;
};

export type EvalTarget = { kind: "WORKSPACE" } | { kind: "LOCATION"; branchId: string } | { kind: "ZONE"; zoneId: string };

export type ScopeDecision = {
  decision: "ALLOW" | "DENY";
  capability: Capability;
  preset: Preset | null;
  rowIds: string[];
  reason: string;
};

const ARCHIVED = "archived";

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
function resolveLocationId(h: HierarchyIndex, raw: string): string | null {
  const id = (raw ?? "").trim() || LEGACY_DEFAULT_KEY;
  const effective = id === LEGACY_DEFAULT_KEY ? h.canonicalLegacyBranchId : id;
  if (!effective) return null;
  return h.locations.some((l) => l.id === effective) ? effective : null;
}

function valuesOf(row: ScopeRow, d: ScopeDimension): string[] {
  return row.targets.filter((t) => t.dimension === d).map((t) => t.value);
}

/** Does a row's LOCATION-level filter accept location L? (every present location dimension must contain L's value) */
function rowAcceptsLocation(row: ScopeRow, h: HierarchyIndex, locId: string): boolean {
  // The SAME matcher as operational filtering — but tagIds are NEVER passed: a Tag can never grant / restrict access.
  return matchLocation(
    { brandIds: valuesOf(row, "BRAND"), locationIds: valuesOf(row, "LOCATION"), regionIds: valuesOf(row, "REGION"), groupIds: valuesOf(row, "GROUP") },
    h,
    locId,
  );
}

function rowHasZoneDimension(row: ScopeRow): boolean {
  return row.targets.some((t) => (ZONE_DIMENSIONS as readonly string[]).includes(t.dimension));
}

/** PURE: does ONE row contain the (already resolved) target? Capability is NOT considered here. */
export function rowContainsTarget(row: ScopeRow, h: HierarchyIndex, t: EvalTarget): boolean {
  if (row.status !== "active") return false;
  // Fail closed: a row carrying ANY unknown dimension (e.g. a "TAG" — never a permission dimension) matches nothing,
  // so an unrecognised constraint can never be silently ignored and widen the row.
  if (row.targets.some((x) => !(KNOWN_SCOPE_DIMENSIONS as readonly string[]).includes(x.dimension))) return false;
  if (t.kind === "WORKSPACE") return row.allLocations;
  if (t.kind === "LOCATION") {
    const loc = h.locations.find((l) => l.id === t.branchId);
    if (!loc || loc.status === ARCHIVED) return false;
    if (row.allLocations) return true;
    if (row.targets.length === 0) return false; // fail closed
    if (rowHasZoneDimension(row)) return false; // a zone-limited row never covers a whole location
    return rowAcceptsLocation(row, h, t.branchId);
  }
  const zone = h.zones.find((z) => z.id === t.zoneId);
  if (!zone || zone.status === ARCHIVED) return false;
  const loc = h.locations.find((l) => l.id === zone.branchId);
  if (!loc || loc.status === ARCHIVED) return false;
  if (row.allLocations) return true;
  if (row.targets.length === 0) return false; // fail closed
  if (!rowAcceptsLocation(row, h, zone.branchId)) return false;
  const zs = valuesOf(row, "ZONE");
  if (zs.length > 0 && !zs.includes(zone.id)) return false;
  const types = valuesOf(row, "ZONE_TYPE");
  if (types.length > 0 && !types.includes(zone.zoneTypeCode)) return false;
  return true;
}

/**
 * PURE: decide one capability over targets. Empty `targets` = a WORKSPACE-level action. Every target must be covered by
 * some active row that contains it AND whose own preset has the capability.
 */
export function evaluateScope(inputs: ScopeEvalInputs, capability: Capability, targets: EvalTarget[]): ScopeDecision {
  const base = { capability };
  if (!inputs.workspaceId) return { ...base, decision: "DENY", preset: null, rowIds: [], reason: "no-active-workspace" };
  if (!inputs.membership) return { ...base, decision: "DENY", preset: null, rowIds: [], reason: "no-membership-in-active-workspace" };
  if (inputs.membership.status === "SUSPENDED") return { ...base, decision: "DENY", preset: null, rowIds: [], reason: "membership-suspended" };
  const h = inputs.hierarchy;
  if (!h || h.workspaceId !== inputs.workspaceId) return { ...base, decision: "DENY", preset: null, rowIds: [], reason: "no-hierarchy" };
  const capable = inputs.rows.filter((r) => r.status === "active" && PRESET_CAPABILITIES[r.preset]?.has(capability));
  if (capable.length === 0) {
    return { ...base, decision: "DENY", preset: inputs.rows[0]?.preset ?? null, rowIds: [], reason: inputs.rows.length === 0 ? "no-scope-rows" : "capability-not-in-any-row-preset" };
  }
  const list: EvalTarget[] = targets.length === 0 ? [{ kind: "WORKSPACE" }] : targets;
  const used: ScopeRow[] = [];
  for (const raw of list) {
    let t: EvalTarget = raw;
    if (raw.kind === "LOCATION") {
      const id = resolveLocationId(h, raw.branchId);
      if (!id) return { ...base, decision: "DENY", preset: capable[0].preset, rowIds: [], reason: "location-not-in-workspace" };
      t = { kind: "LOCATION", branchId: id };
    } else if (raw.kind === "ZONE" && !h.zones.some((z) => z.id === raw.zoneId)) {
      return { ...base, decision: "DENY", preset: capable[0].preset, rowIds: [], reason: "zone-not-in-workspace" };
    }
    const row = capable.find((r) => rowContainsTarget(r, h, t));
    if (!row) {
      return { ...base, decision: "DENY", preset: capable[0].preset, rowIds: [], reason: t.kind === "WORKSPACE" ? "workspace-level-requires-all-locations" : "target-not-in-scope" };
    }
    if (!used.includes(row)) used.push(row);
  }
  return { ...base, decision: "ALLOW", preset: used[0].preset, rowIds: used.map((r) => r.id), reason: "in-scope" };
}

// ── legacy → scope translation (pure) ────────────────────────────────────────────────────────────────────────────
/** Same mapping as Gate 3A `assignmentPreset` (lib/authz.ts; parity pinned by test). */
export function legacyAssignmentPreset(role: string): Preset {
  const r = (role ?? "").trim().toUpperCase();
  if (r === "VIEW_ONLY" || r === "VIEWER") return "VIEW_ONLY";
  if (r === "REGIONAL_MANAGER") return "REGIONAL_MANAGER";
  if (r === "HQ_CONTROL") return "HQ_CONTROL";
  return "BRANCH_MANAGER";
}

export type DerivedScope = { source: string; sourceRef: string; preset: Preset; allLocations: boolean; targets: ScopeTarget[] };
export type DerivationNote =
  | "superseded-by-role"
  | "star-assignment"
  | "implicit-default"
  | "implicit-default-unresolvable"
  | "assignment-default-unresolvable"
  | "assignment-branch-not-in-workspace";

/**
 * PURE: today's effective access of ONE workspace member, as scope rows — never broader, never narrower.
 * SUPER_ADMIN / WORKSPACE_ADMIN → ADMIN + all; MANAGER → HQ_CONTROL + all; CONTROLLER / VIEWER → one row per assignment
 * ("*" → allLocations, classified); no assignment → an explicit implicit-default row on the canonical legacy branch.
 */
export function deriveScopesFromLegacy(
  member: { role: string },
  assignments: { id: string; branchId: string; role: string }[],
  ctx: { canonicalLegacyBranchId: string | null; workspaceBranchIds: string[] },
): { rows: DerivedScope[]; notes: { note: DerivationNote; ref: string }[] } {
  const role = (member.role ?? "").trim().toUpperCase();
  const notes: { note: DerivationNote; ref: string }[] = [];
  if (role === "SUPER_ADMIN" || role === "WORKSPACE_ADMIN" || role === "MANAGER") {
    for (const a of assignments) notes.push({ note: "superseded-by-role", ref: a.id });
    return { rows: [{ source: "migrated:role", sourceRef: "", preset: role === "MANAGER" ? "HQ_CONTROL" : "ADMIN", allLocations: true, targets: [] }], notes };
  }
  const presetFor = (assignmentRole: string): Preset => (role === "VIEWER" ? "VIEW_ONLY" : legacyAssignmentPreset(assignmentRole));
  if (assignments.length === 0) {
    if (!ctx.canonicalLegacyBranchId) {
      notes.push({ note: "implicit-default-unresolvable", ref: "" });
      return { rows: [], notes };
    }
    notes.push({ note: "implicit-default", ref: "" });
    return {
      rows: [{ source: "migrated:implicit-default", sourceRef: "", preset: presetFor("BRANCH_CONTROLLER"), allLocations: false, targets: [{ dimension: "LOCATION", value: ctx.canonicalLegacyBranchId }] }],
      notes,
    };
  }
  const rows: DerivedScope[] = [];
  for (const a of [...assignments].sort((x, y) => x.id.localeCompare(y.id))) {
    const b = (a.branchId ?? "").trim() || LEGACY_DEFAULT_KEY;
    if (b === LEGACY_ALL_SENTINEL) {
      notes.push({ note: "star-assignment", ref: a.id });
      rows.push({ source: "migrated:assignment", sourceRef: a.id, preset: presetFor(a.role), allLocations: true, targets: [] });
      continue;
    }
    const loc = b === LEGACY_DEFAULT_KEY ? ctx.canonicalLegacyBranchId : b;
    if (!loc) { notes.push({ note: "assignment-default-unresolvable", ref: a.id }); continue; }
    if (!ctx.workspaceBranchIds.includes(loc)) { notes.push({ note: "assignment-branch-not-in-workspace", ref: a.id }); continue; }
    rows.push({ source: "migrated:assignment", sourceRef: a.id, preset: presetFor(a.role), allLocations: false, targets: [{ dimension: "LOCATION", value: loc }] });
  }
  return { rows, notes };
}

/** Canonical comparable form of a scope row (for drift / idempotency checks). */
export function scopeKey(r: { preset: string; allLocations: boolean; targets: ScopeTarget[] }): string {
  const t = [...r.targets].map((x) => `${x.dimension}=${x.value}`).sort().join("|");
  return `${r.preset}|${r.allLocations ? "ALL" : "-"}|${t}`;
}

export function isScopePreset(p: string): p is Preset {
  return (SCOPE_PRESETS as readonly string[]).includes(p);
}

export const ALL_CAPABILITIES: readonly Capability[] = CAPABILITIES;

// ── read-only loader (DB client injected; no side effects) ───────────────────────────────────────────────────────
type ReadDb = {
  branch: { findMany: (a: unknown) => Promise<{ id: string; brandId: string | null; status: string; legacyKey: string | null }[]> };
  zone: { findMany: (a: unknown) => Promise<{ id: string; branchId: string; zoneTypeCode: string; isDefault: boolean; status: string }[]> };
  brand: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
  workspaceMember: { findUnique: (a: unknown) => Promise<{ role: unknown; status: unknown } | null> };
  memberScope: { findMany: (a: unknown) => Promise<{ id: string; preset: string; allLocations: boolean; status: string; targets: { dimension: string; brandId: string | null; branchId: string | null; zoneId: string | null; zoneTypeCode: string | null; regionId?: string | null; groupId?: string | null }[] }[]> };
  region?: { findMany: (a: unknown) => Promise<{ id: string; status: string }[]> };
  locationGroup?: { findMany: (a: unknown) => Promise<{ id: string; status: string }[]> };
  locationGroupMember?: { findMany: (a: unknown) => Promise<{ groupId: string; branchId: string }[]> };
  locationTag?: { findMany: (a: unknown) => Promise<{ id: string; status: string }[]> };
  locationTagAssignment?: { findMany: (a: unknown) => Promise<{ tagId: string; branchId: string }[]> };
};

/** Read-only: the workspace hierarchy index (locations, zones, default brand, canonical legacy branch). */
export async function loadHierarchy(db: ReadDb, workspaceId: string): Promise<HierarchyIndex> {
  const none = async () => [] as never[];
  const [branches, zones, defBrand, regions, groups, members, tags, tagAs] = await Promise.all([
    db.branch.findMany({ where: { workspaceId }, select: { id: true, brandId: true, status: true, legacyKey: true, regionId: true } }) as Promise<{ id: string; brandId: string | null; status: string; legacyKey: string | null; regionId?: string | null }[]>,
    db.zone.findMany({ where: { workspaceId }, select: { id: true, branchId: true, zoneTypeCode: true, isDefault: true, status: true } }),
    db.brand.findFirst({ where: { workspaceId, isDefault: true }, select: { id: true } }),
    db.region ? db.region.findMany({ where: { workspaceId }, select: { id: true, status: true } }) : none(),
    db.locationGroup ? db.locationGroup.findMany({ where: { workspaceId }, select: { id: true, status: true } }) : none(),
    db.locationGroupMember ? db.locationGroupMember.findMany({ where: { workspaceId }, select: { groupId: true, branchId: true } }) : none(),
    db.locationTag ? db.locationTag.findMany({ where: { workspaceId }, select: { id: true, status: true } }) : none(),
    db.locationTagAssignment ? db.locationTagAssignment.findMany({ where: { workspaceId }, select: { tagId: true, branchId: true } }) : none(),
  ]);
  const groupsOf = (b: string) => (members as { groupId: string; branchId: string }[]).filter((m) => m.branchId === b).map((m) => m.groupId);
  const tagsOf = (b: string) => (tagAs as { tagId: string; branchId: string }[]).filter((t) => t.branchId === b).map((t) => t.tagId);
  return {
    workspaceId,
    defaultBrandId: defBrand?.id ?? null,
    canonicalLegacyBranchId: branches.find((b) => b.legacyKey === LEGACY_DEFAULT_KEY)?.id ?? null,
    locations: branches.map((b) => ({ id: b.id, brandId: b.brandId, status: b.status, regionId: b.regionId ?? null, groupIds: groupsOf(b.id), tagIds: tagsOf(b.id) })),
    zones,
    regions, groups, tags,
  };
}

/** Read-only: evaluator inputs for (workspace, user). Unknown presets / dimensions are dropped (fail closed). */
export async function loadScopeInputs(db: ReadDb, workspaceId: string | null, userId: string, hierarchy?: HierarchyIndex): Promise<ScopeEvalInputs> {
  const ws = (workspaceId ?? "").trim() || null;
  if (!ws) return { workspaceId: null, membership: null, rows: [], hierarchy: null };
  const [membership, rows, h] = await Promise.all([
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws, userId } }, select: { role: true, status: true } }),
    db.memberScope.findMany({
      where: { workspaceId: ws, userId },
      select: { id: true, preset: true, allLocations: true, status: true, targets: { select: { dimension: true, brandId: true, branchId: true, zoneId: true, zoneTypeCode: true, regionId: true, groupId: true } } },
      orderBy: { id: "asc" },
    }),
    hierarchy ? Promise.resolve(hierarchy) : loadHierarchy(db, ws),
  ]);
  const dims = new Set<string>([...LOCATION_DIMENSIONS, ...ZONE_DIMENSIONS]);
  return {
    workspaceId: ws,
    membership: membership ? { role: String(membership.role), status: String(membership.status) } : null,
    rows: rows.filter((r) => isScopePreset(r.preset)).map((r) => {
      const targets: ScopeTarget[] = [];
      let invalid = false;
      for (const t of r.targets) {
        const value = t.brandId ?? t.branchId ?? t.zoneId ?? t.zoneTypeCode ?? t.regionId ?? t.groupId;
        if (!dims.has(t.dimension) || !value) { invalid = true; continue; }
        targets.push({ dimension: t.dimension as ScopeDimension, value });
      }
      // a row with an unknown/invalid target is NOT silently widened: it is disabled (fail closed)
      return { id: r.id, preset: r.preset as Preset, allLocations: r.allLocations, status: invalid ? "invalid" : r.status, targets };
    }),
    hierarchy: h,
  };
}
