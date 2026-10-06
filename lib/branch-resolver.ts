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
