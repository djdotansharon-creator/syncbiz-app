/**
 * CONTROL ROOM PHASE 1 — canonical branch identity resolver (app side).
 *
 * The pilot runtime still uses the legacy branch key "default". The canonical identity is the `Branch` row whose
 * `legacyKey = "default"` in that workspace. This module computes that mapping.
 *
 * GATE 1 = SHADOW ONLY. `BRANCH_RESOLUTION_RUNTIME_MODE` is a code constant (NOT an env var), so nothing can turn
 * routing on by configuration. In shadow the EFFECTIVE branch is always the raw input; the canonical candidate is
 * only logged. Activation (Gate 2) is a separate reviewed change together with the data migration.
 */
import { prisma } from "@/lib/prisma";

export type BranchResolutionMode = "off" | "shadow" | "active";

/** GATE 1: explicit shadow. Effective branch ids are NEVER changed by this build. */
export const BRANCH_RESOLUTION_RUNTIME_MODE: BranchResolutionMode = "shadow";

export const LEGACY_DEFAULT_BRANCH_KEY = "default";

export type BranchResolution = {
  mode: BranchResolutionMode;
  raw: string;
  candidate: string | null;
  effective: string;
};

/** True for the legacy key (empty input normalizes to it, exactly like today's fallbacks). */
export function isLegacyBranchKey(raw: string | null | undefined): boolean {
  return ((raw ?? "").trim() || LEGACY_DEFAULT_BRANCH_KEY) === LEGACY_DEFAULT_BRANCH_KEY;
}

/** PURE: decide the effective branch. off/shadow ALWAYS return the raw (normalized) branch. */
export function decideBranchResolution(args: {
  mode: BranchResolutionMode;
  raw: string | null | undefined;
  candidate: string | null;
}): BranchResolution {
  const raw = (args.raw ?? "").trim() || LEGACY_DEFAULT_BRANCH_KEY;
  const candidate = args.mode === "off" || !isLegacyBranchKey(raw) ? null : args.candidate;
  const effective = args.mode === "active" && candidate ? candidate : raw;
  return { mode: args.mode, raw, candidate, effective };
}

/** Canonical Branch id for a workspace's legacy "default" key, or null. Never throws. */
export async function findCanonicalLegacyBranchId(workspaceId: string): Promise<string | null> {
  try {
    const row = await prisma.branch.findUnique({
      where: { workspaceId_legacyKey: { workspaceId, legacyKey: LEGACY_DEFAULT_BRANCH_KEY } },
      select: { id: true },
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

// ── GATE 2A-1: IDENTITY / AUTHORIZATION compatibility (NOT content normalization) ──────────────────────────────
// During the canonical-branch transition the legacy key "default" and the workspace's canonical Branch (the row
// with legacyKey="default") are the SAME branch — but ONLY within that workspace's own alias mapping. Used by
// station bind/register comparisons, token claims and branch-authorization comparisons. Content write paths do
// NOT use this (BRANCH_RESOLUTION_RUNTIME_MODE stays "shadow" until Gate 2B).

/** PURE: are two branch ids the same branch given this workspace's canonical id for "default"? */
export function legacyBranchEquivalent(a: string | null | undefined, b: string | null | undefined, canonical: string | null): boolean {
  const x = (a ?? "").trim() || LEGACY_DEFAULT_BRANCH_KEY;
  const y = (b ?? "").trim() || LEGACY_DEFAULT_BRANCH_KEY;
  if (x === y) return true;
  if (!canonical) return false;
  return (x === LEGACY_DEFAULT_BRANCH_KEY && y === canonical) || (x === canonical && y === LEGACY_DEFAULT_BRANCH_KEY);
}

/** PURE: the id plus its legacy equivalent (if any) within this workspace. */
export function legacyBranchEquivalents(id: string | null | undefined, canonical: string | null): string[] {
  const x = (id ?? "").trim() || LEGACY_DEFAULT_BRANCH_KEY;
  if (!canonical) return [x];
  if (x === LEGACY_DEFAULT_BRANCH_KEY) return [x, canonical];
  if (x === canonical) return [x, LEGACY_DEFAULT_BRANCH_KEY];
  return [x];
}

/** PURE: canonical form of a branch id ("default" → canonical when the workspace has one). */
export function canonicalizeLegacyBranch(id: string | null | undefined, canonical: string | null): string {
  const x = (id ?? "").trim() || LEGACY_DEFAULT_BRANCH_KEY;
  return x === LEGACY_DEFAULT_BRANCH_KEY && canonical ? canonical : x;
}

// Tiny per-process cache (the canonical row is created once per workspace and never moves).
const canonicalCache = new Map<string, { id: string | null; at: number }>();
const CANONICAL_CACHE_MS = 60_000;
/** Cached canonical id for a workspace's legacy "default" (null when the workspace has none). Never throws. */
export async function getCanonicalLegacyBranchId(workspaceId: string | null | undefined): Promise<string | null> {
  const ws = (workspaceId ?? "").trim();
  if (!ws) return null;
  const hit = canonicalCache.get(ws);
  if (hit && Date.now() - hit.at < CANONICAL_CACHE_MS) return hit.id;
  const id = await findCanonicalLegacyBranchId(ws);
  canonicalCache.set(ws, { id, at: Date.now() });
  return id;
}

/** Expand a set of branch ids with their legacy equivalents within the workspace (authorization comparisons). */
export async function expandLegacyBranchEquivalents(workspaceId: string | null | undefined, ids: string[]): Promise<string[]> {
  const canonical = await getCanonicalLegacyBranchId(workspaceId);
  if (!canonical) return ids;
  return [...new Set(ids.flatMap((id) => legacyBranchEquivalents(id, canonical)))];
}

const loggedShadow = new Set<string>();

/**
 * SHADOW observation for a boundary that consumes a raw branch id. Logs (once per process per workspace+raw+site)
 * what the canonical branch WOULD be. Returns nothing and never throws — callers keep using their raw branch.
 */
export async function observeBranchResolutionShadow(site: string, workspaceId: string | null | undefined, raw: string | null | undefined): Promise<void> {
  try {
    const ws = (workspaceId ?? "").trim();
    if (!ws || BRANCH_RESOLUTION_RUNTIME_MODE === "off" || !isLegacyBranchKey(raw)) return;
    const candidate = await findCanonicalLegacyBranchId(ws);
    const d = decideBranchResolution({ mode: BRANCH_RESOLUTION_RUNTIME_MODE, raw, candidate });
    const key = `${site}|${ws}|${d.raw}|${d.candidate ?? ""}`;
    if (loggedShadow.has(key)) return;
    loggedShadow.add(key);
    console.log("[VONO branch-resolver] shadow", JSON.stringify({ site, workspaceId: ws, raw: d.raw, candidate: d.candidate, effective: d.effective, mode: d.mode }));
  } catch {
    /* observation only */
  }
}
