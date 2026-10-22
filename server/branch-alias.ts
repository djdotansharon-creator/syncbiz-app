/**
 * CONTROL ROOM PHASE 1 — canonical branch identity: legacy branch ALIAS map for the DB-less WS server.
 *
 * The pilot runtime still uses the legacy branch key "default" (WS rooms, designation, tokens, desktop config,
 * renderer REGISTER). The app owns the canonical `Branch` row (Branch.legacyKey = "default") and syncs
 * `{ workspaceId, legacyKey → canonicalBranchId }` here via an authenticated internal endpoint.
 *
 * `BRANCH_ALIAS_RUNTIME_MODE` is a code constant (NOT an env var) so routing can never be switched by configuration.
 * GATE 1 = shadow (log only). GATE 2A-3 = ACTIVE: a raw legacy key (e.g. "default") from an old client resolves to
 * the workspace's canonical branch for ROOM routing only — but ONLY for workspaces whose persisted room state was
 * re-keyed successfully at boot (see rekeyRoomStateForAliases); any conflict keeps that workspace on its raw room.
 *
 * Persisted next to the designation store (same dir rules), format version 1. Never throws.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export type BranchAliasMode = "off" | "shadow" | "active";

/** GATE 2A-3: active (room routing resolves legacy keys for boot-activated workspaces only). */
export const BRANCH_ALIAS_RUNTIME_MODE: BranchAliasMode = "active";

export const LEGACY_DEFAULT_BRANCH_KEY = "default";

/** workspaceId → { legacyKey → canonicalBranchId } */
export type BranchAliases = Record<string, Record<string, string>>;

export type BranchAliasDecision = {
  mode: BranchAliasMode;
  rawBranchId: string;
  /** Canonical branch the raw key maps to (null when no alias exists). */
  candidateBranchId: string | null;
  /** Branch actually used for routing. In off/shadow this is ALWAYS the raw branch. */
  effectiveBranchId: string;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** PURE: decide routing for a REGISTER branch. off/shadow never change the effective branch. */
export function decideBranchAlias(args: {
  mode: BranchAliasMode;
  workspaceId: string | null | undefined;
  rawBranchId: string;
  aliases: BranchAliases;
}): BranchAliasDecision {
  const raw = (args.rawBranchId ?? "").trim() || LEGACY_DEFAULT_BRANCH_KEY;
  const ws = (args.workspaceId ?? "").trim();
  const candidate = args.mode !== "off" && ws ? args.aliases[ws]?.[raw] ?? null : null;
  const effective = args.mode === "active" && candidate ? candidate : raw;
  return { mode: args.mode, rawBranchId: raw, candidateBranchId: candidate, effectiveBranchId: effective };
}

/** PURE: validate an internal alias-sync body. Returns null when invalid. canonicalBranchId null = remove. */
export function parseAliasSyncBody(body: unknown): { workspaceId: string; legacyKey: string; canonicalBranchId: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { workspaceId?: unknown; legacyKey?: unknown; canonicalBranchId?: unknown };
  const workspaceId = typeof b.workspaceId === "string" ? b.workspaceId.trim() : "";
  const legacyKey = typeof b.legacyKey === "string" ? b.legacyKey.trim() : "";
  if (!SAFE_ID.test(workspaceId) || !SAFE_ID.test(legacyKey)) return null;
  if (b.canonicalBranchId === null) return { workspaceId, legacyKey, canonicalBranchId: null };
  const canonical = typeof b.canonicalBranchId === "string" ? b.canonicalBranchId.trim() : "";
  if (!SAFE_ID.test(canonical) || canonical === legacyKey) return null;
  return { workspaceId, legacyKey, canonicalBranchId: canonical };
}

/** PURE: apply a validated sync to an alias map (returns a new map). */
export function applyAliasSync(
  aliases: BranchAliases,
  s: { workspaceId: string; legacyKey: string; canonicalBranchId: string | null },
): BranchAliases {
  const next: BranchAliases = { ...aliases, [s.workspaceId]: { ...(aliases[s.workspaceId] ?? {}) } };
  if (s.canonicalBranchId) next[s.workspaceId][s.legacyKey] = s.canonicalBranchId;
  else delete next[s.workspaceId][s.legacyKey];
  if (Object.keys(next[s.workspaceId]).length === 0) delete next[s.workspaceId];
  return next;
}

// ── GATE 2A-3: boot re-key of persisted room state (PURE) ──────────────────────────────────────────────────────
export type RoomState = {
  designations: Record<string, string>;
  cleared: string[];
  masterByBranch: Record<string, string>;
  masterDisconnectedAt: Record<string, number>;
  primaryMasterByBranch: Record<string, string>;
};
export type RekeyResult = {
  workspaceId: string;
  legacyKey: string;
  from: string;
  to: string;
  outcome: "rekeyed" | "already" | "nothing" | "conflict";
  detail?: string;
};

/**
 * PURE. For each alias (workspace, legacyKey → canonical), move persisted room state from
 * `ws:<workspace>:<legacyKey>` to `ws:<workspace>:<canonical>`: designation, cleared tombstone, lease maps.
 * Same values are carried over unchanged (same durable MASTER id; nothing is revoked, added or duplicated).
 * FAIL SAFE: if the canonical key is already occupied in any map (or a designation and a tombstone would collide),
 * that workspace's state is left exactly as-is and the workspace is NOT activated (keeps routing by raw key).
 */
export function rekeyRoomStateForAliases(aliases: BranchAliases, state: RoomState): {
  state: RoomState;
  activeWorkspaces: string[];
  results: RekeyResult[];
  changed: boolean;
} {
  const next: RoomState = {
    designations: { ...state.designations },
    cleared: [...state.cleared],
    masterByBranch: { ...state.masterByBranch },
    masterDisconnectedAt: { ...state.masterDisconnectedAt },
    primaryMasterByBranch: { ...state.primaryMasterByBranch },
  };
  const maps = ["designations", "masterByBranch", "masterDisconnectedAt", "primaryMasterByBranch"] as const;
  const results: RekeyResult[] = [];
  const conflictWorkspaces = new Set<string>();
  const okWorkspaces = new Set<string>();
  let changed = false;
  for (const [workspaceId, byKey] of Object.entries(aliases)) {
    for (const [legacyKey, canonical] of Object.entries(byKey)) {
      const from = `ws:${workspaceId}:${legacyKey}`;
      const to = `ws:${workspaceId}:${canonical}`;
      const base = { workspaceId, legacyKey, from, to };
      if (!SAFE_ID.test(workspaceId) || !SAFE_ID.test(legacyKey) || !SAFE_ID.test(canonical) || canonical === legacyKey) {
        results.push({ ...base, outcome: "conflict", detail: "invalid alias" });
        conflictWorkspaces.add(workspaceId);
        continue;
      }
      const hasFrom = maps.some((m) => from in next[m]) || next.cleared.includes(from);
      const hasTo = maps.some((m) => to in next[m]) || next.cleared.includes(to);
      if (hasFrom && hasTo) {
        results.push({ ...base, outcome: "conflict", detail: "both legacy and canonical keys present" });
        conflictWorkspaces.add(workspaceId);
        continue;
      }
      if (from in next.designations && next.cleared.includes(from)) {
        results.push({ ...base, outcome: "conflict", detail: "designation and tombstone on legacy key" });
        conflictWorkspaces.add(workspaceId);
        continue;
      }
      if (!hasFrom) {
        results.push({ ...base, outcome: hasTo ? "already" : "nothing" });
        okWorkspaces.add(workspaceId);
        continue;
      }
      results.push({ ...base, outcome: "rekeyed" });
      okWorkspaces.add(workspaceId);
    }
  }
  // Apply moves only for workspaces with no conflict in ANY of their aliases.
  for (const r of results) {
    if (r.outcome !== "rekeyed" || conflictWorkspaces.has(r.workspaceId)) continue;
    for (const m of maps) {
      const rec = next[m] as Record<string, string | number>;
      if (r.from in rec) {
        rec[r.to] = rec[r.from];
        delete rec[r.from];
        changed = true;
      }
    }
    const i = next.cleared.indexOf(r.from);
    if (i >= 0) {
      next.cleared[i] = r.to;
      changed = true;
    }
  }
  const activeWorkspaces = [...okWorkspaces].filter((w) => !conflictWorkspaces.has(w));
  if (conflictWorkspaces.size > 0) {
    // Report rekeyed-but-blocked entries honestly as not applied.
    for (const r of results) if (r.outcome === "rekeyed" && conflictWorkspaces.has(r.workspaceId)) r.detail = "not applied: workspace has a conflict";
  }
  return { state: changed ? next : state, activeWorkspaces, results, changed };
}

/** PURE: the routing branch for a raw REGISTER/target branch — canonical only for an ACTIVE workspace. */
export function resolveRoutingBranch(args: {
  mode: BranchAliasMode;
  workspaceId: string | null | undefined;
  rawBranchId: string;
  aliases: BranchAliases;
  activeWorkspaces: ReadonlySet<string>;
}): string {
  const ws = (args.workspaceId ?? "").trim();
  const raw = (args.rawBranchId ?? "").trim() || LEGACY_DEFAULT_BRANCH_KEY;
  if (!ws || !args.activeWorkspaces.has(ws)) return raw;
  return decideBranchAlias({ mode: args.mode, workspaceId: ws, rawBranchId: raw, aliases: args.aliases }).effectiveBranchId;
}

// ── persistence (same directory rules as branch-designation-store.ts) ─────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const railwayVolumePath =
  typeof process.env.RAILWAY_VOLUME_MOUNT_PATH === "string" && process.env.RAILWAY_VOLUME_MOUNT_PATH.trim()
    ? process.env.RAILWAY_VOLUME_MOUNT_PATH.trim().replace(/\/$/, "")
    : "";
const DATA_DIR = railwayVolumePath ? join(railwayVolumePath, "ws-lease") : join(__dirname, "data");
const FILE = join(DATA_DIR, "branch-aliases.json");
export const BRANCH_ALIAS_FORMAT_VERSION = 1;

export function loadBranchAliases(): BranchAliases {
  try {
    if (!existsSync(FILE)) return {};
    const data = JSON.parse(readFileSync(FILE, "utf-8")) as { version?: number; aliases?: BranchAliases };
    if (data.version !== BRANCH_ALIAS_FORMAT_VERSION || !data.aliases || typeof data.aliases !== "object") return {};
    return data.aliases;
  } catch {
    return {};
  }
}

export function saveBranchAliases(aliases: BranchAliases): boolean {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify({ version: BRANCH_ALIAS_FORMAT_VERSION, aliases }, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.warn("[SyncBiz WS] Failed to persist branch aliases:", err);
    return false;
  }
}
