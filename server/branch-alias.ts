/**
 * CONTROL ROOM PHASE 1 — canonical branch identity: legacy branch ALIAS map for the DB-less WS server.
 *
 * The pilot runtime still uses the legacy branch key "default" (WS rooms, designation, tokens, desktop config,
 * renderer REGISTER). The app owns the canonical `Branch` row (Branch.legacyKey = "default") and syncs
 * `{ workspaceId, legacyKey → canonicalBranchId }` here via an authenticated internal endpoint.
 *
 * GATE 1 = SHADOW ONLY. `BRANCH_ALIAS_RUNTIME_MODE` is a code constant (NOT an env var) so routing can never be
 * switched by configuration: REGISTER keeps joining `ws:<workspace>:<raw branch>` and only LOGS what the room
 * WOULD be. Activation (Gate 2) is a separate, reviewed code change together with the data migration.
 *
 * Persisted next to the designation store (same dir rules), format version 1. Never throws.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export type BranchAliasMode = "off" | "shadow" | "active";

/** GATE 1: explicit shadow. Effective routing is NEVER changed by this build. */
export const BRANCH_ALIAS_RUNTIME_MODE: BranchAliasMode = "shadow";

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
