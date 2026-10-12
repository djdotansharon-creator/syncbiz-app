/**
 * JINGLES LIBRARY SERVICE (server) — list / create / change-audience for the ONE jingle library (Announcement rows,
 * announcementType = "jingle"). Every decision goes through lib/jingles/audience.ts (eligibility + permissions).
 * Permissions = the EXISTING mechanism in force: access type OWNER (TENANT_OWNER / TENANT_ADMIN) = HQ,
 * BRANCH_USER = branch user with its assigned branches (lib/user-store). No new role.
 * The workspace is always the caller's session workspace (never from the client). The legacy `branchId` column keeps
 * its old meaning for old code and is never used for origin / audience decisions here.
 */
import { prisma } from "@/lib/prisma";
import { getAccessType, getAssignedBranchIds } from "@/lib/user-store";
import {
  branchFacts,
  canChangeAudience,
  canCreate,
  isEligibleForBranch,
  isPlayable,
  isVisibleTo,
  rowAudience,
  validateAudience,
  type AudienceInput,
  type BranchFacts,
  type JingleActor,
  type JingleAudience,
} from "@/lib/jingles/audience";

export const JINGLE_TYPE = "jingle";

export type WorkspaceFacts = {
  workspaceId: string;
  defaultBrandId: string | null;
  branchIds: Set<string>;
  brandIds: Set<string>;
  factsById: Map<string, BranchFacts>;
};

export async function loadWorkspaceFacts(workspaceId: string): Promise<WorkspaceFacts> {
  const [branches, brands] = await Promise.all([
    prisma.branch.findMany({ where: { workspaceId }, select: { id: true, brandId: true, latitude: true, longitude: true } }),
    prisma.brand.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, isDefault: true } }),
  ]);
  const defaultBrandId = brands.find((b) => b.isDefault)?.id ?? null;
  const factsById = new Map<string, BranchFacts>();
  for (const b of branches) factsById.set(b.id, branchFacts(b, defaultBrandId));
  return { workspaceId, defaultBrandId, branchIds: new Set(branches.map((b) => b.id)), brandIds: new Set(brands.map((b) => b.id)), factsById };
}

/** the actor from the existing permission mechanism, in the explicit (session) workspace */
export async function actorFor(userId: string, facts: WorkspaceFacts): Promise<JingleActor> {
  const access = await getAccessType(userId, facts.workspaceId);
  if (access === "OWNER") return { kind: "HQ" };
  // assigned ids may carry the legacy "default" alias next to the canonical id — keep only real branches of the workspace
  const assigned = await getAssignedBranchIds(userId, facts.workspaceId);
  return { kind: "BRANCH", branchIds: assigned.filter((id) => facts.branchIds.has(id)) };
}

type Row = {
  id: string; name: string; audioUrl: string | null; text: string; voiceId: string | null; durationSec: number | null; createdAt: Date;
  originBranchId: string | null; audience: string | null; audienceBranchId: string | null; audienceBrandId: string | null; audienceRegion: string | null;
};

export type JingleItem = {
  id: string; title: string; url: string; script: string; voiceId: string; durationSec: number | null; createdAt: string;
  originBranchId: string | null;
  audience: JingleAudience["audience"]; audienceBranchId: string | null; audienceBrandId: string | null; audienceRegion: string | null;
  /** UNASSIGNED → false: never played / broadcast to a branch */
  playable: boolean;
};

export function rowToItem(r: Row): JingleItem {
  const a = rowAudience(r);
  return {
    id: r.id, title: r.name, url: r.audioUrl ?? "", script: r.text ?? "", voiceId: r.voiceId ?? "", durationSec: r.durationSec ?? null,
    createdAt: r.createdAt.toISOString(), originBranchId: r.originBranchId,
    audience: a.audience, audienceBranchId: a.audienceBranchId, audienceBrandId: a.audienceBrandId, audienceRegion: a.audienceRegion,
    playable: isPlayable(a),
  };
}

export type ListResult = { ok: true; items: JingleItem[] } | { ok: false; status: 403; error: string };

/**
 * List. Without `branchId`: HQ sees the whole library (incl. UNASSIGNED); a branch user sees what its branches are
 * eligible for. With `branchId`: exactly what THAT branch is eligible for (never UNASSIGNED); a branch user may only
 * ask for its own branches.
 */
export async function listJingles(actor: JingleActor, facts: WorkspaceFacts, opts: { branchId?: string | null } = {}): Promise<ListResult> {
  const rows: Row[] = await prisma.announcement.findMany({
    where: { workspaceId: facts.workspaceId, announcementType: JINGLE_TYPE, audioUrl: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const branchId = (opts.branchId ?? "").trim();
  if (branchId) {
    if (actor.kind === "BRANCH" && !actor.branchIds.includes(branchId)) return { ok: false, status: 403, error: "No access to this branch" };
    const b = facts.factsById.get(branchId);
    if (!b) return { ok: true, items: [] };
    return { ok: true, items: rows.filter((r) => isEligibleForBranch(rowAudience(r), b)).map(rowToItem) };
  }
  const own = actor.kind === "BRANCH" ? actor.branchIds.map((id) => facts.factsById.get(id)).filter((b): b is BranchFacts => !!b) : [];
  return { ok: true, items: rows.filter((r) => isVisibleTo(actor, rowAudience(r), own)).map(rowToItem) };
}

export type CreateInput = AudienceInput & { originBranchId?: unknown };
export type ResolveResult = { ok: true; audience: JingleAudience; originBranchId: string | null } | { ok: false; status: 400 | 403; error: string };

/**
 * The audience + origin of a NEW jingle.
 *  - no audience given: HQ → UNASSIGNED (never NETWORK by default); a branch user with exactly one branch → LOCAL to it
 *  - a branch user may only create LOCAL for a branch it is allowed; origin = that branch
 *  - HQ: origin = the given originBranchId if it is a branch of the workspace, else NULL (HQ-created)
 */
export function resolveCreate(actor: JingleActor, facts: WorkspaceFacts, input: CreateInput): ResolveResult {
  const ctx = { branchIds: facts.branchIds, brandIds: facts.brandIds };
  let raw: AudienceInput = input;
  if (input.audience == null || input.audience === "") {
    if (actor.kind === "HQ") raw = { audience: "UNASSIGNED" };
    else if (actor.branchIds.length === 1) raw = { audience: "LOCAL", audienceBranchId: actor.branchIds[0] };
    else return { ok: false, status: 400, error: "Choose the branch for this jingle" };
  }
  const v = validateAudience(raw, ctx);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  if (!canCreate(actor, v.value)) return { ok: false, status: 403, error: "A branch user can create only a LOCAL jingle for its own branch" };
  let origin: string | null = null;
  if (actor.kind === "BRANCH") origin = v.value.audienceBranchId;
  else if (typeof input.originBranchId === "string" && facts.branchIds.has(input.originBranchId.trim())) origin = input.originBranchId.trim();
  return { ok: true, audience: v.value, originBranchId: origin };
}

export type UpdateResult = { ok: true; item: JingleItem; before: JingleAudience } | { ok: false; status: 400 | 403 | 404; error: string };

/** change audience / promote — HQ only; the SAME row (same id, same audio), never a copy */
export async function updateJingleAudience(actor: JingleActor, facts: WorkspaceFacts, id: string, input: AudienceInput): Promise<UpdateResult> {
  if (!canChangeAudience(actor)) return { ok: false, status: 403, error: "Only HQ can change a jingle's audience" };
  const row = await prisma.announcement.findFirst({ where: { id, workspaceId: facts.workspaceId, announcementType: JINGLE_TYPE } });
  if (!row) return { ok: false, status: 404, error: "Jingle not found" };
  const v = validateAudience(input, { branchIds: facts.branchIds, brandIds: facts.brandIds });
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const before = rowAudience(row);
  const updated = await prisma.announcement.update({
    where: { id: row.id },
    data: { audience: v.value.audience, audienceBranchId: v.value.audienceBranchId, audienceBrandId: v.value.audienceBrandId, audienceRegion: v.value.audienceRegion },
  });
  return { ok: true, item: rowToItem(updated), before };
}
