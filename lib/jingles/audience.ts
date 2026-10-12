/**
 * JINGLES AUDIENCE — the ONE eligibility + permission rule set (owner decisions 2026-10-12). Pure: no DB, no I/O, so
 * the exact behaviour is unit-tested and the SAME functions serve every list / play / broadcast path.
 *
 *  ORIGIN   = who really created the jingle in a branch (`originBranchId`; NULL = HQ). Never used for eligibility.
 *  AUDIENCE = who may receive it:
 *    UNASSIGNED   — HQ only; never playable / broadcastable; never reaches a branch
 *    LOCAL        — exactly `audienceBranchId`
 *    BRAND        — branches whose (effective) brand = `audienceBrandId`
 *    REGION       — branches in `audienceRegion` (crosses brands on purpose → HQ only may create it)
 *    BRAND_REGION — both brand AND region must match
 *    NETWORK      — every branch
 *  A branch's region comes from its lat / lng through the MAP's resolver (lib/control-room-regions → branchRegion):
 *  one source of truth. A branch with no location (or outside Israel) has no region → never a REGION / BRAND_REGION
 *  target. A branch with no brand counts as the workspace's DEFAULT brand (same rule as the Control Room).
 *  Brand safety: a BRAND / BRAND_REGION jingle can never be eligible for a branch of another brand.
 *  The legacy `Announcement.branchId` is never read by these rules.
 */
import { branchRegion, REGIONS, type RegionId } from "@/lib/control-room-regions";

export const AUDIENCES = ["UNASSIGNED", "LOCAL", "BRAND", "REGION", "BRAND_REGION", "NETWORK"] as const;
export type Audience = (typeof AUDIENCES)[number];

export type JingleAudience = {
  audience: Audience;
  audienceBranchId: string | null;
  audienceBrandId: string | null;
  audienceRegion: RegionId | null;
};

/** what eligibility needs to know about a branch */
export type BranchFacts = { id: string; brandId: string | null; regionId: RegionId | null };

/** HQ = an OWNER-access member (TENANT_OWNER / TENANT_ADMIN); BRANCH = a branch user with its assigned branches */
export type JingleActor = { kind: "HQ" } | { kind: "BRANCH"; branchIds: string[] };

const REGION_IDS = new Set<string>(REGIONS.map((r) => r.id));
export function isRegionId(v: unknown): v is RegionId {
  return typeof v === "string" && REGION_IDS.has(v);
}
export function isAudience(v: unknown): v is Audience {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}

/** the branch facts for eligibility: effective brand (default when unassigned) + region from lat / lng (the map's code) */
export function branchFacts(
  b: { id: string; brandId: string | null; latitude: number | null; longitude: number | null },
  defaultBrandId: string | null,
): BranchFacts {
  return { id: b.id, brandId: b.brandId ?? defaultBrandId, regionId: branchRegion(b.latitude, b.longitude).regionId };
}

/** may this jingle be heard / listed / played in this branch? (UNASSIGNED never) */
export function isEligibleForBranch(j: JingleAudience, b: BranchFacts): boolean {
  switch (j.audience) {
    case "NETWORK":
      return true;
    case "LOCAL":
      return !!j.audienceBranchId && j.audienceBranchId === b.id;
    case "BRAND":
      return !!j.audienceBrandId && j.audienceBrandId === b.brandId;
    case "REGION":
      return !!j.audienceRegion && j.audienceRegion === b.regionId;
    case "BRAND_REGION":
      return !!j.audienceBrandId && !!j.audienceRegion && j.audienceBrandId === b.brandId && j.audienceRegion === b.regionId;
    case "UNASSIGNED":
    default:
      return false;
  }
}

/** UNASSIGNED is HQ-only content: never played / broadcast to a branch */
export function isPlayable(j: Pick<JingleAudience, "audience">): boolean {
  return j.audience !== "UNASSIGNED";
}

/** the workspace's facts the validator checks ids against */
export type AudienceContext = { branchIds: ReadonlySet<string>; brandIds: ReadonlySet<string> };

export type AudienceInput = { audience?: unknown; audienceBranchId?: unknown; audienceBrandId?: unknown; audienceRegion?: unknown };
export type Validated = { ok: true; value: JingleAudience } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** shape + ids check: each audience carries exactly the fields it needs (no stray fields kept) */
export function validateAudience(input: AudienceInput, ctx: AudienceContext): Validated {
  if (!isAudience(input.audience)) return { ok: false, error: "audience must be one of " + AUDIENCES.join(" / ") };
  const a = input.audience;
  const branchId = str(input.audienceBranchId);
  const brandId = str(input.audienceBrandId);
  const region = input.audienceRegion == null || input.audienceRegion === "" ? null : input.audienceRegion;
  const needBranch = a === "LOCAL";
  const needBrand = a === "BRAND" || a === "BRAND_REGION";
  const needRegion = a === "REGION" || a === "BRAND_REGION";
  if (needBranch && (!branchId || !ctx.branchIds.has(branchId))) return { ok: false, error: "LOCAL needs a branch of this workspace" };
  if (needBrand && (!brandId || !ctx.brandIds.has(brandId))) return { ok: false, error: `${a} needs a brand of this workspace` };
  if (needRegion && !isRegionId(region)) return { ok: false, error: `${a} needs an operational region key` };
  return {
    ok: true,
    value: {
      audience: a,
      audienceBranchId: needBranch ? branchId : null,
      audienceBrandId: needBrand ? brandId : null,
      audienceRegion: needRegion ? (region as RegionId) : null,
    },
  };
}

/** create: HQ any audience; a branch user only LOCAL to a branch it is allowed (never brand / region / network) */
export function canCreate(actor: JingleActor, a: JingleAudience): boolean {
  if (actor.kind === "HQ") return true;
  return a.audience === "LOCAL" && !!a.audienceBranchId && actor.branchIds.includes(a.audienceBranchId);
}

/** change audience / promote (LOCAL → BRAND / REGION / BRAND_REGION / NETWORK): HQ only */
export function canChangeAudience(actor: JingleActor): boolean {
  return actor.kind === "HQ";
}

/** which jingles an actor may SEE in a list: HQ everything (incl. UNASSIGNED); a branch user only what one of its
 *  branches is eligible for */
export function isVisibleTo(actor: JingleActor, j: JingleAudience, branchesOfActor: readonly BranchFacts[]): boolean {
  if (actor.kind === "HQ") return true;
  return branchesOfActor.some((b) => isEligibleForBranch(j, b));
}

/** the stored audience of a row (legacy rows without one read as UNASSIGNED — never as NETWORK) */
export function rowAudience(r: { audience: string | null; audienceBranchId: string | null; audienceBrandId: string | null; audienceRegion: string | null }): JingleAudience {
  return {
    audience: isAudience(r.audience) ? r.audience : "UNASSIGNED",
    audienceBranchId: r.audienceBranchId,
    audienceBrandId: r.audienceBrandId,
    audienceRegion: isRegionId(r.audienceRegion) ? r.audienceRegion : null,
  };
}
