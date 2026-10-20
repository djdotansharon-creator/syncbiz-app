/**
 * CONTROL ROOM GATE 3A — centralized capability engine (SHADOW).
 *
 * ONE place that answers: may this session user perform <capability> on <branches>?
 *   authorize(subject, capability, branchIds) → { decision: ALLOW | DENY, preset, source, reason }
 *
 * Resolution is ALWAYS against the ACTIVE SESSION WORKSPACE (`subject.workspaceId`, i.e. the session user's
 * `tenantId` from the active-workspace cookie). There is NO fallback to the user's primary workspace: no membership
 * row in the active workspace = DENY; a SUSPENDED membership = DENY (fail closed).
 *
 * Presets are code constants (owner decisions 2026-10-06); no schema. Inputs are the existing rows:
 *   WorkspaceMember.role  SUPER_ADMIN / WORKSPACE_ADMIN → ADMIN (all capabilities, scope ALL)
 *                         MANAGER                       → HQ_CONTROL (scope ALL)
 *                         VIEWER                        → VIEW_ONLY on its branch assignments
 *                         CONTROLLER                    → per UserBranchAssignment.role preset
 *   UserBranchAssignment.role (free string): BRANCH_MANAGER / BRANCH_CONTROLLER → BRANCH_MANAGER,
 *                         VIEW_ONLY, REGIONAL_MANAGER (branch-scoped until a region model exists), HQ_CONTROL.
 *   No assignment rows → the implicit legacy "default" branch (same as getAssignedBranchIds today).
 * Branch scope honors the legacy alias ("default" ≡ the workspace's canonical branch) ONLY inside that workspace.
 *
 * MODE (code constant, never env): OFF | SHADOW | ENFORCE. GATE 3A = SHADOW: decisions are computed and logged,
 * NEVER enforced — `shadowAuthorize` is fire-and-forget, never throws, never blocks or delays a request.
 */
import { prisma } from "@/lib/prisma";
import { getCanonicalLegacyBranchId, legacyBranchEquivalents, LEGACY_DEFAULT_BRANCH_KEY } from "@/lib/branch-resolver";

export type AuthzMode = "off" | "shadow" | "enforce";
/** GATE 3A: SHADOW only. */
export const AUTHZ_RUNTIME_MODE: AuthzMode = "shadow";

export const CAPABILITIES = [
  "playback.control",
  "announcement.send",
  "schedule.edit",
  "users.manage",
  "master.designate",
  "monitoring.view",
  "campaign.manage",
  "branches.manage",
  "content.manage",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type Preset = "ADMIN" | "HQ_CONTROL" | "REGIONAL_MANAGER" | "BRANCH_MANAGER" | "VIEW_ONLY";

const OPERATIONAL: Capability[] = [
  "playback.control",
  "announcement.send",
  "schedule.edit",
  "monitoring.view",
  "campaign.manage",
  "content.manage",
];
/** Locked presets (owner decisions 2026-10-06). */
export const PRESET_CAPABILITIES: Record<Preset, ReadonlySet<Capability>> = {
  ADMIN: new Set(CAPABILITIES),
  HQ_CONTROL: new Set(OPERATIONAL),
  REGIONAL_MANAGER: new Set(OPERATIONAL),
  BRANCH_MANAGER: new Set<Capability>(["playback.control", "announcement.send", "monitoring.view"]),
  VIEW_ONLY: new Set<Capability>(["monitoring.view"]),
};

/** A resolved grant: a preset over a scope (ALL branches of the workspace, or an explicit branch set). */
export type Grant = { preset: Preset; scope: "ALL" | "BRANCHES"; branchIds: string[]; source: string };

export type AuthzInputs = {
  workspaceId: string | null;
  membership: { role: string; status: string } | null;
  assignments: { branchId: string; role: string }[];
  /** Canonical branch id for the workspace's legacy "default" (null when none). */
  canonicalLegacyBranchId: string | null;
  /** Branch ids that belong to the workspace (Branch rows). */
  workspaceBranchIds: string[];
};

export type AuthzDecision = {
  decision: "ALLOW" | "DENY";
  capability: Capability;
  workspaceId: string | null;
  branchIds: string[];
  preset: Preset | null;
  source: string;
  reason: string;
};

function assignmentPreset(role: string): Preset {
  const r = (role ?? "").trim().toUpperCase();
  if (r === "VIEW_ONLY" || r === "VIEWER") return "VIEW_ONLY";
  if (r === "REGIONAL_MANAGER") return "REGIONAL_MANAGER";
  if (r === "HQ_CONTROL") return "HQ_CONTROL";
  return "BRANCH_MANAGER"; // BRANCH_MANAGER, BRANCH_CONTROLLER (all API-created rows), unknown legacy strings
}

/** PURE: resolve the session user's grants in the active workspace. Empty = no rights (fail closed). */
export function resolveGrants(inputs: AuthzInputs): Grant[] {
  const m = inputs.membership;
  if (!inputs.workspaceId || !m || m.status === "SUSPENDED") return [];
  const role = (m.role ?? "").trim().toUpperCase();
  if (role === "SUPER_ADMIN" || role === "WORKSPACE_ADMIN") {
    return [{ preset: "ADMIN", scope: "ALL", branchIds: [], source: `member:${role}` }];
  }
  if (role === "MANAGER") return [{ preset: "HQ_CONTROL", scope: "ALL", branchIds: [], source: "member:MANAGER" }];
  const expand = (id: string) => legacyBranchEquivalents(id, inputs.canonicalLegacyBranchId);
  const rows = inputs.assignments.length > 0
    ? inputs.assignments
    : [{ branchId: LEGACY_DEFAULT_BRANCH_KEY, role: "BRANCH_CONTROLLER", implicit: true } as { branchId: string; role: string; implicit?: boolean }];
  return rows.map((a) => {
    const preset = role === "VIEWER" ? "VIEW_ONLY" : assignmentPreset(a.role);
    const implicit = (a as { implicit?: boolean }).implicit === true;
    return {
      preset,
      scope: "BRANCHES" as const,
      branchIds: expand((a.branchId ?? "").trim() || LEGACY_DEFAULT_BRANCH_KEY),
      source: implicit ? `member:${role || "?"}/implicit-default` : `member:${role || "?"}/assignment:${(a.role ?? "").trim() || "?"}`,
    };
  });
}

/**
 * PURE: decide one capability over the requested branches. Empty `branchIds` = a workspace-level action (users,
 * branches, MASTER without a branch) → requires an ALL-scope grant. Every requested branch must be covered by a
 * grant that has the capability; an ALL grant only covers branches that belong to THIS workspace (its Branch rows or
 * its legacy key).
 */
export function decideCapability(inputs: AuthzInputs, capability: Capability, branchIds: string[]): AuthzDecision {
  const grants = resolveGrants(inputs);
  const requested = [...new Set(branchIds.map((b) => (b ?? "").trim() || LEGACY_DEFAULT_BRANCH_KEY))];
  const base = { capability, workspaceId: inputs.workspaceId, branchIds: requested };
  if (grants.length === 0) {
    const reason = !inputs.workspaceId ? "no-active-workspace" : !inputs.membership ? "no-membership-in-active-workspace" : "membership-suspended";
    return { ...base, decision: "DENY", preset: null, source: "none", reason };
  }
  const capable = grants.filter((g) => PRESET_CAPABILITIES[g.preset].has(capability));
  const presetLabel = grants[0].preset;
  if (capable.length === 0) {
    return { ...base, decision: "DENY", preset: presetLabel, source: grants.map((g) => g.source).join(","), reason: "capability-not-in-preset" };
  }
  const inWorkspace = (b: string) =>
    b === LEGACY_DEFAULT_BRANCH_KEY || inputs.workspaceBranchIds.includes(b);
  if (requested.length === 0) {
    const all = capable.find((g) => g.scope === "ALL");
    return all
      ? { ...base, decision: "ALLOW", preset: all.preset, source: all.source, reason: "workspace-scope" }
      : { ...base, decision: "DENY", preset: capable[0].preset, source: capable.map((g) => g.source).join(","), reason: "workspace-level-requires-all-scope" };
  }
  const used = new Set<Grant>();
  for (const b of requested) {
    const g = capable.find((x) => (x.scope === "ALL" ? inWorkspace(b) : x.branchIds.includes(b)));
    if (!g) {
      return {
        ...base, decision: "DENY", preset: capable[0].preset, source: capable.map((x) => x.source).join(","),
        reason: inWorkspace(b) ? "branch-not-in-scope" : "branch-not-in-workspace",
      };
    }
    used.add(g);
  }
  const first = [...used][0];
  return { ...base, decision: "ALLOW", preset: first.preset, source: [...used].map((g) => g.source).join(","), reason: "in-scope" };
}

/** Subject = the SESSION user + its ACTIVE workspace (the session user's tenantId). */
export type AuthzSubject = { userId: string; workspaceId: string | null | undefined };

/** Load the authz inputs for the active workspace (never the primary workspace). */
export async function loadAuthzInputs(subject: AuthzSubject): Promise<AuthzInputs> {
  const workspaceId = (subject.workspaceId ?? "").trim() || null;
  if (!workspaceId) return { workspaceId: null, membership: null, assignments: [], canonicalLegacyBranchId: null, workspaceBranchIds: [] };
  const [membership, assignments, branches, canonical] = await Promise.all([
    prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: subject.userId } },
      select: { role: true, status: true },
    }),
    prisma.userBranchAssignment.findMany({ where: { workspaceId, userId: subject.userId }, select: { branchId: true, role: true } }),
    prisma.branch.findMany({ where: { workspaceId }, select: { id: true } }),
    getCanonicalLegacyBranchId(workspaceId),
  ]);
  return {
    workspaceId,
    membership: membership ? { role: String(membership.role), status: String(membership.status) } : null,
    assignments: assignments.map((a) => ({ branchId: a.branchId, role: a.role })),
    canonicalLegacyBranchId: canonical,
    workspaceBranchIds: branches.map((b) => b.id),
  };
}

/** Compute a decision (no side effects). */
export async function authorize(subject: AuthzSubject, capability: Capability, branchIds: string[] = []): Promise<AuthzDecision> {
  return decideCapability(await loadAuthzInputs(subject), capability, branchIds);
}

/** Structured shadow log line — safe identifiers only (no user id / email / token / path). */
export function formatShadowDecision(site: string, d: AuthzDecision): string {
  return `[VONO authz] ${AUTHZ_RUNTIME_MODE} ${JSON.stringify({
    site, capability: d.capability, decision: d.decision, workspaceId: d.workspaceId, branchIds: d.branchIds,
    preset: d.preset, source: d.source, reason: d.reason,
  })}`;
}

/**
 * GATE 3A SHADOW hook. Fire-and-forget: returns immediately, computes + logs the decision asynchronously, never
 * throws, never blocks or alters the request. A no-op in OFF mode. (ENFORCE is a later gate.)
 */
export function shadowAuthorize(
  site: string,
  subject: AuthzSubject | null | undefined,
  capability: Capability,
  branchIds: (string | null | undefined)[] = [],
): void {
  if (AUTHZ_RUNTIME_MODE === "off" || !subject?.userId) return;
  const ids = branchIds.filter((b): b is string => typeof b === "string");
  void authorize(subject, capability, ids)
    .then((d) => console.log(formatShadowDecision(site, d)))
    .catch(() => {
      /* shadow only — never affects the request */
    });
}

/** Shadow summary at token mint: which capabilities a token for these branches WOULD carry (logged only). */
export function shadowTokenCapabilities(site: string, subject: AuthzSubject | null | undefined, branchIds: string[]): void {
  if (AUTHZ_RUNTIME_MODE === "off" || !subject?.userId) return;
  void loadAuthzInputs(subject)
    .then((inputs) => {
      const summary: Record<string, string> = {};
      for (const c of ["playback.control", "announcement.send", "monitoring.view", "master.designate"] as Capability[]) {
        summary[c] = decideCapability(inputs, c, branchIds).decision;
      }
      const grants = resolveGrants(inputs);
      console.log(`[VONO authz] ${AUTHZ_RUNTIME_MODE} ${JSON.stringify({
        site, kind: "token-claims", workspaceId: inputs.workspaceId, branchIds,
        preset: grants[0]?.preset ?? null, source: grants.map((g) => g.source).join(",") || "none", wouldGrant: summary,
      })}`);
    })
    .catch(() => {
      /* shadow only */
    });
}
