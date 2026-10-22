/**
 * CONTROL ROOM F2a — MemberScope sync / check / matrix / fingerprint (TEST-only tooling core; OFFLINE).
 *
 * Used by scripts/control-room/f2-scope.ts (inside the TEST app container via tsx) and by
 * scripts/verify-control-room-f2a.ts (throwaway local Postgres). Never imported by app / route / token / WS code.
 *
 * SYNC (idempotent): for every WorkspaceMember, rows = deriveScopesFromLegacy(member, its assignments) are upserted by
 *   (memberId, source, sourceRef); a changed row is replaced; a stale `migrated:*` row is removed; `admin` rows are
 *   never touched. Members / users / assignments / F1 rows are never written.
 * MATRIX: for every member (+ orphan assignment users) × 9 capabilities × {workspace, every location, the legacy
 *   "default" alias, every zone}: Gate 3A decideCapability (OLD, zone → its location) vs evaluateScope (NEW).
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { decideCapability, loadAuthzInputs, type Capability } from "@/lib/authz";
import {
  ALL_CAPABILITIES, deriveScopesFromLegacy, evaluateScope, loadHierarchy, loadScopeInputs, scopeKey,
  type DerivationNote, type EvalTarget, type ScopeTarget,
} from "@/lib/authz-scope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any; // PrismaClient or an interactive-transaction client

// F3a: REGION / GROUP columns added (no TAG — a Tag is never a permission dimension).
const targetColumn = (t: ScopeTarget) =>
  t.dimension === "BRAND" ? { brandId: t.value } : t.dimension === "LOCATION" ? { branchId: t.value } : t.dimension === "ZONE" ? { zoneId: t.value }
    : t.dimension === "REGION" ? { regionId: t.value } : t.dimension === "GROUP" ? { groupId: t.value } : { zoneTypeCode: t.value };
const storedTargets = (rows: { dimension: string; brandId: string | null; branchId: string | null; zoneId: string | null; zoneTypeCode: string | null; regionId?: string | null; groupId?: string | null }[]): ScopeTarget[] =>
  rows.map((t) => ({ dimension: t.dimension as ScopeTarget["dimension"], value: (t.brandId ?? t.branchId ?? t.zoneId ?? t.zoneTypeCode ?? t.regionId ?? t.groupId) as string }));

async function memberContext(db: Db, workspaceId: string) {
  const [members, assignments, branches] = await Promise.all([
    db.workspaceMember.findMany({ where: { workspaceId }, select: { id: true, userId: true, role: true, status: true }, orderBy: { id: "asc" } }),
    db.userBranchAssignment.findMany({ where: { workspaceId }, select: { id: true, userId: true, branchId: true, role: true }, orderBy: { id: "asc" } }),
    db.branch.findMany({ where: { workspaceId }, select: { id: true, legacyKey: true } }),
  ]);
  const ctx = {
    canonicalLegacyBranchId: (branches as { id: string; legacyKey: string | null }[]).find((b) => b.legacyKey === "default")?.id ?? null,
    workspaceBranchIds: (branches as { id: string }[]).map((b) => b.id),
  };
  return { members, assignments, ctx };
}

export type SyncReport = { dryRun: boolean; created: number; updated: number; removed: number; unchanged: number; notes: Record<string, number>; orphanAssignments: number; noop: boolean };

/** Idempotent sync of migrated scope rows from WorkspaceMember + UserBranchAssignment. */
export async function syncScopes(db: Db, { dryRun }: { dryRun: boolean }): Promise<SyncReport> {
  const rep: SyncReport = { dryRun, created: 0, updated: 0, removed: 0, unchanged: 0, notes: {}, orphanAssignments: 0, noop: false };
  const workspaces: { id: string }[] = await db.workspace.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  for (const ws of workspaces) {
    const { members, assignments, ctx } = await memberContext(db, ws.id);
    const memberUsers = new Set(members.map((m: { userId: string }) => m.userId));
    rep.orphanAssignments += assignments.filter((a: { userId: string }) => !memberUsers.has(a.userId)).length;
    for (const m of members) {
      const mine = assignments.filter((a: { userId: string }) => a.userId === m.userId);
      const { rows, notes } = deriveScopesFromLegacy({ role: String(m.role) }, mine, ctx);
      for (const n of notes) rep.notes[n.note] = (rep.notes[n.note] ?? 0) + 1;
      const existing: { id: string; source: string; sourceRef: string; preset: string; allLocations: boolean; targets: never[] }[] =
        await db.memberScope.findMany({ where: { memberId: m.id }, include: { targets: true } });
      const wanted = new Set(rows.map((r) => `${r.source}\u0000${r.sourceRef}`));
      for (const r of rows) {
        const cur = existing.find((e) => e.source === r.source && e.sourceRef === r.sourceRef);
        if (cur && scopeKey({ preset: cur.preset, allLocations: cur.allLocations, targets: storedTargets(cur.targets) }) === scopeKey(r)) { rep.unchanged++; continue; }
        if (cur) rep.updated++; else rep.created++;
        if (dryRun) continue;
        if (cur) await db.memberScope.delete({ where: { id: cur.id } });
        await db.memberScope.create({
          data: {
            memberId: m.id, workspaceId: ws.id, userId: m.userId, preset: r.preset, allLocations: r.allLocations,
            source: r.source, sourceRef: r.sourceRef, createdBy: "f2a-sync",
            targets: { create: r.targets.map((t) => ({ workspaceId: ws.id, dimension: t.dimension, ...targetColumn(t) })) },
          },
        });
      }
      for (const e of existing) {
        if (e.source.startsWith("migrated:") && !wanted.has(`${e.source}\u0000${e.sourceRef}`)) {
          rep.removed++;
          if (!dryRun) await db.memberScope.delete({ where: { id: e.id } });
        }
      }
    }
  }
  rep.noop = rep.created + rep.updated + rep.removed === 0;
  return rep;
}

/** Read-only invariants: CHECK constraint present, no drift, every target inside its own workspace. */
export async function checkScopes(db: Db): Promise<{ ok: boolean; violations: string[]; facts: Record<string, unknown> }> {
  const v: string[] = [];
  const con: { n: bigint | number }[] = await db.$queryRawUnsafe(
    `select count(*)::int as n from pg_constraint where conname = 'MemberScopeTarget_one_value_matches_dimension'`,
  );
  if (Number(con[0]?.n ?? 0) !== 1) v.push("CHECK constraint MemberScopeTarget_one_value_matches_dimension missing");
  const workspaces: { id: string }[] = await db.workspace.findMany({ select: { id: true } });
  let rows = 0, targets = 0;
  const byPreset: Record<string, number> = {};
  for (const ws of workspaces) {
    const { members, assignments, ctx } = await memberContext(db, ws.id);
    const [brands, branches, zones, regions, groups] = await Promise.all([
      db.brand.findMany({ where: { workspaceId: ws.id }, select: { id: true } }),
      db.branch.findMany({ where: { workspaceId: ws.id }, select: { id: true } }),
      db.zone.findMany({ where: { workspaceId: ws.id }, select: { id: true } }),
      db.region ? db.region.findMany({ where: { workspaceId: ws.id }, select: { id: true } }) : [],
      db.locationGroup ? db.locationGroup.findMany({ where: { workspaceId: ws.id }, select: { id: true } }) : [],
    ]);
    const ids = (a: { id: string }[]) => new Set(a.map((x) => x.id));
    const ok = { BRAND: ids(brands), LOCATION: ids(branches), ZONE: ids(zones), REGION: ids(regions), GROUP: ids(groups) } as Record<string, Set<string>>;
    for (const m of members) {
      const derived = deriveScopesFromLegacy({ role: String(m.role) }, assignments.filter((a: { userId: string }) => a.userId === m.userId), ctx).rows;
      const stored: { id: string; workspaceId: string; userId: string; source: string; preset: string; allLocations: boolean; targets: { dimension: string; workspaceId: string; brandId: string | null; branchId: string | null; zoneId: string | null; zoneTypeCode: string | null; regionId?: string | null; groupId?: string | null }[] }[] =
        await db.memberScope.findMany({ where: { memberId: m.id }, include: { targets: true } });
      rows += stored.length;
      for (const s of stored) {
        byPreset[s.preset] = (byPreset[s.preset] ?? 0) + 1;
        targets += s.targets.length;
        if (s.workspaceId !== ws.id || s.userId !== m.userId) v.push(`scope ${s.id}: workspace/user mismatch with its member`);
        for (const t of s.targets) {
          const val = (t.brandId ?? t.branchId ?? t.zoneId ?? t.regionId ?? t.groupId) as string | null;
          if (t.workspaceId !== ws.id) v.push(`scope ${s.id}: target in another workspace`);
          if (val && ok[t.dimension] && !ok[t.dimension].has(val)) v.push(`scope ${s.id}: ${t.dimension} target outside its workspace`);
        }
      }
      const a = stored.filter((s) => s.source.startsWith("migrated:")).map((s) => scopeKey({ preset: s.preset, allLocations: s.allLocations, targets: storedTargets(s.targets) })).sort();
      const b = derived.map((d) => scopeKey(d)).sort();
      if (JSON.stringify(a) !== JSON.stringify(b)) v.push(`member ${m.id}: stored scopes drift from legacy derivation`);
    }
  }
  return { ok: v.length === 0, violations: v, facts: { scopeRows: rows, targets, byPreset } };
}

export type MatrixReport = {
  subjects: number; cells: number; agree: number;
  expected: Record<string, number>; unexpected: number; unexpectedSamples: string[];
  byDecision: { allowAllow: number; denyDeny: number };
};

/** OFFLINE comparison: Gate 3A (OLD) vs MemberScope evaluator (NEW). */
export async function runMatrix(db: Db): Promise<MatrixReport> {
  const rep: MatrixReport = { subjects: 0, cells: 0, agree: 0, expected: {}, unexpected: 0, unexpectedSamples: [], byDecision: { allowAllow: 0, denyDeny: 0 } };
  const workspaces: { id: string }[] = await db.workspace.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  for (const ws of workspaces) {
    const h = await loadHierarchy(db, ws.id);
    const { members, assignments, ctx } = await memberContext(db, ws.id);
    const users = [...new Set<string>([...members.map((m: { userId: string }) => m.userId), ...assignments.map((a: { userId: string }) => a.userId)])].sort();
    const targets: { label: string; old: string[]; neu: EvalTarget[] }[] = [
      { label: "workspace", old: [], neu: [] },
      ...h.locations.map((l) => ({ label: `location:${l.id}`, old: [l.id], neu: [{ kind: "LOCATION" as const, branchId: l.id }] })),
      { label: "location:default-alias", old: ["default"], neu: [{ kind: "LOCATION" as const, branchId: "default" }] },
      ...h.zones.map((z) => ({ label: `zone:${z.id}`, old: [z.branchId], neu: [{ kind: "ZONE" as const, zoneId: z.id }] })),
    ];
    for (const userId of users) {
      rep.subjects++;
      const member = members.find((m: { userId: string }) => m.userId === userId);
      const notes: DerivationNote[] = member
        ? deriveScopesFromLegacy({ role: String(member.role) }, assignments.filter((a: { userId: string }) => a.userId === userId), ctx).notes.map((n) => n.note)
        : [];
      const oldIn = await loadAuthzInputs({ userId, workspaceId: ws.id });
      const newIn = await loadScopeInputs(db, ws.id, userId, h);
      for (const cap of ALL_CAPABILITIES) {
        for (const t of targets) {
          rep.cells++;
          const o = decideCapability(oldIn, cap as Capability, t.old).decision;
          const n = evaluateScope(newIn, cap as Capability, t.neu).decision;
          if (o === n) { rep.agree++; if (o === "ALLOW") rep.byDecision.allowAllow++; else rep.byDecision.denyDeny++; continue; }
          const cls = classify(notes, o, n, t.label, h.canonicalLegacyBranchId);
          if (cls) { rep.expected[cls] = (rep.expected[cls] ?? 0) + 1; continue; }
          rep.unexpected++;
          if (rep.unexpectedSamples.length < 20) {
            const subj = createHash("sha256").update(userId).digest("hex").slice(0, 8);
            rep.unexpectedSamples.push(`subject:${subj} cap:${cap} target:${t.label} old:${o} new:${n}`);
          }
        }
      }
    }
  }
  return rep;
}

/** Expected (documented) differences only; everything else is UNEXPECTED. */
function classify(notes: DerivationNote[], old: string, neu: string, target: string, canonical: string | null): string | null {
  // Legacy "*" = ALL (authoritative legacy); Gate 3A treats "*" as a literal branch → OLD DENY / NEW ALLOW.
  if (notes.includes("star-assignment") && old === "DENY" && neu === "ALLOW") return "known-star (legacy * = ALL; Gate 3A literal)";
  // Workspace without a canonical legacy branch: Gate 3A accepts the bare "default" key; NEW never invents a location.
  if (!canonical && target === "location:default-alias" && old === "ALLOW" && neu === "DENY") return "legacy-default-unresolvable";
  return null;
}

/** Fingerprint of everything F2a must never change (incl. F1 rows) + the new tables' counts. No secrets. */
export async function fingerprintF2(db: Db): Promise<Record<string, { count: number; hash: string }>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const f1 = require("./f1-foundation.cjs");
  const base = await f1.fingerprint(db);
  const h = (rows: unknown[]) => createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  const pick = async (model: string, select: Record<string, true>) => (await db[model].findMany({ select, orderBy: { id: "asc" } })) as unknown[];
  const extra: Record<string, unknown[]> = {
    workspaceMember: await pick("workspaceMember", { id: true, workspaceId: true, userId: true, role: true, status: true }),
    userBranchAssignmentRoles: await pick("userBranchAssignment", { id: true, role: true }),
    f1Brand: await pick("brand", { id: true, workspaceId: true, code: true, name: true, isDefault: true }),
    f1Zone: await pick("zone", { id: true, workspaceId: true, branchId: true, code: true, zoneTypeCode: true, isDefault: true }),
    f1BranchBrand: await pick("branch", { id: true, brandId: true }),
    f1StationZone: await pick("stationDevice", { id: true, zoneId: true }),
    f1DesignationZone: await pick("branchMasterDesignation", { id: true, zoneId: true }),
    user: await pick("user", { id: true, status: true }),
  };
  const out: Record<string, { count: number; hash: string }> = { ...base };
  for (const [k, rows] of Object.entries(extra)) out[k] = { count: rows.length, hash: h(rows) };
  return out;
}

export type { PrismaClient };
