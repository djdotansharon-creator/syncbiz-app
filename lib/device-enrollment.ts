/**
 * Device enrollment — the PURE rules (docs/DEVICE_ENROLLMENT_DESIGN.md; owner 2026-10-27). No database, no network, no clock of its own: everything that can be decided
 * from the inputs is decided here, so it can be tested without a browser or a server.
 *
 * The idea: a computer / phone that signs in to an account is not automatically part of it. When the workspace has enrollment on, an unknown device asks the manager for a role —
 * PLAYER (it plays the music; counted in the paid allocation) or REMOTE (it only controls; never counted, never plays) — and a manager approves it within their reach.
 * Off by default: needs the env flag SYNCBIZ_DEVICE_ENROLLMENT=1 AND the workspace switch (`WorkspaceEnrollmentSetting.enabled`); with either off, every device is "legacy" and nothing changes.
 */

export const ENROLLMENT_STATUSES = ["pending", "approved", "rejected", "revoked", "expired"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ENROLLMENT_ROLES = ["PLAYER", "REMOTE"] as const;
export type EnrollmentRole = (typeof ENROLLMENT_ROLES)[number];

export const ENROLLMENT_PLATFORMS = ["browser", "desktop", "android", "ios", "streamer"] as const;
export type EnrollmentPlatform = (typeof ENROLLMENT_PLATFORMS)[number];

/** a station is the desktop app / streamer; a browser player plays only while its tab is open (design doc D-B1); "owner" is the main admin's own computer — since 2026-10-31 a REMOTE label: it controls, never plays, takes no seat (owner: only the phone plays free; a computer that plays is a numbered Player) */
export type PlayerClass = "station" | "browser" | "owner";

export const DEFAULT_TTL_DAYS = 7;
export const MIN_TTL_DAYS = 1;
export const MAX_TTL_DAYS = 30;
/** a user may have at most this many open (pending) requests in a workspace — a guard against a flood of requests */
export const MAX_PENDING_PER_USER = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isEnrollmentEnvEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SYNCBIZ_DEVICE_ENROLLMENT === "1";
}

export function clampTtlDays(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : DEFAULT_TTL_DAYS;
  return Math.min(MAX_TTL_DAYS, Math.max(MIN_TTL_DAYS, v));
}

export function computeExpiresAt(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + clampTtlDays(ttlDays) * DAY_MS);
}

/** a pending request past its expiry reads as expired (nothing has to run to make that true) */
export function effectiveStatus(row: { status: string; expiresAt: Date }, now: Date): EnrollmentStatus {
  const s = (ENROLLMENT_STATUSES as readonly string[]).includes(row.status) ? (row.status as EnrollmentStatus) : "rejected";
  if (s === "pending" && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return s;
}

/** phones are remotes only (a mobile device can never be a player — the WS server already refuses a mobile MASTER) */
export function canRequestRole(platform: EnrollmentPlatform, role: EnrollmentRole): boolean {
  if (role === "REMOTE") return true;
  return platform === "browser" || platform === "desktop" || platform === "streamer";
}

export function playerClassFor(platform: EnrollmentPlatform): PlayerClass | null {
  if (platform === "browser") return "browser";
  if (platform === "desktop" || platform === "streamer") return "station";
  return null;
}

// ───────────────────────────────────────────────── input validation ─────────────────────────────

const DEVICE_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const stripControl = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const clip = (v: unknown, max: number): string => (typeof v === "string" ? stripControl(v).slice(0, max) : "");

export type RequestInput = {
  durableDeviceId: string;
  role: EnrollmentRole;
  platform: EnrollmentPlatform;
  /** an EXISTING branch the device picked from the suggestions (a Remote must have one) */
  branchId: string | null;
  /** a branch name the device typed that matched nothing — only a Player may ask for a branch that does not exist yet */
  branchName: string;
  /** only with a typed (new) branch: where it is and which brand it belongs to — the manager creates / connects the branch from them */
  branchAddress: string;
  brandName: string;
  /** who is at the device — so the manager knows who is asking (owner 2026-10-28). Required for a Remote; a Player is a branch computer — its asker is the signed-in account, so these are optional there. */
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  label: string;
  note: string;
  appVersion: string;
};

/** a simple, forgiving e-mail shape check (the manager sees it and may write to it; this only stops obvious typos) */
export function isPlausibleEmail(v: string): boolean {
  return v.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/** a phone number: digits with an optional leading +, spaces, dashes, brackets — at least 7 digits */
export function isPlausiblePhone(v: string): boolean {
  return v.length <= 24 && /^[+]?[0-9 ()-]+$/.test(v) && v.replace(/\D/g, "").length >= 7;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateRequestInput(raw: unknown): Validated<RequestInput> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "invalid_body" };
  const b = raw as Record<string, unknown>;
  const id = typeof b.durableDeviceId === "string" ? b.durableDeviceId.trim() : "";
  if (!DEVICE_ID.test(id)) return { ok: false, error: "invalid_device_id" };
  const role = b.role;
  if (typeof role !== "string" || !(ENROLLMENT_ROLES as readonly string[]).includes(role)) return { ok: false, error: "invalid_role" };
  const platformRaw = typeof b.platform === "string" ? b.platform : "browser";
  if (!(ENROLLMENT_PLATFORMS as readonly string[]).includes(platformRaw)) return { ok: false, error: "invalid_platform" };
  const platform = platformRaw as EnrollmentPlatform;
  if (!canRequestRole(platform, role as EnrollmentRole)) return { ok: false, error: "role_not_allowed_for_platform" };
  const firstName = clip(b.firstName, 60);
  const lastName = clip(b.lastName, 60);
  const phone = clip(b.phone, 24);
  const email = clip(b.email, 120).toLowerCase();
  if (role === "REMOTE") {
    if (!firstName) return { ok: false, error: "first_name_required" };
    if (!lastName) return { ok: false, error: "last_name_required" };
    if (!isPlausiblePhone(phone)) return { ok: false, error: "phone_invalid" };
    if (!isPlausibleEmail(email)) return { ok: false, error: "email_invalid" };
  } else {
    // a Player may leave the person out, but what it does give must be sane
    if (phone && !isPlausiblePhone(phone)) return { ok: false, error: "phone_invalid" };
    if (email && !isPlausibleEmail(email)) return { ok: false, error: "email_invalid" };
  }
  const branchId = typeof b.branchId === "string" && b.branchId.trim() ? b.branchId.trim().slice(0, 128) : null;
  // a typed name is only used when nothing was picked; a Remote can only be tied to a branch that exists
  const branchName = branchId ? "" : clip(b.branchName, 80);
  const branchAddress = branchId || role !== "PLAYER" ? "" : clip(b.branchAddress, 160);
  const brandName = branchId || role !== "PLAYER" ? "" : clip(b.brandName, 80);
  if (role === "REMOTE" && !branchId) return { ok: false, error: "branch_required_for_remote" };
  if (role === "PLAYER" && !branchId) {
    if (branchName.length < 2) return { ok: false, error: "branch_required_for_player" };
    if (branchAddress.length < 3) return { ok: false, error: "branch_address_required" };
  }
  return {
    ok: true,
    value: { durableDeviceId: id, role: role as EnrollmentRole, platform, branchId, branchName, branchAddress, brandName, firstName, lastName, phone, email, label: clip(b.label, 80), note: clip(b.note, 300), appVersion: clip(b.appVersion, 40) },
  };
}

export type ApproveInput = {
  role: EnrollmentRole;
  branchIds: string[];
  /** only for a PLAYER into a branch that already has a designated player: keep it as a standby, or replace the current one (explicit) */
  mode: "standby" | "replace";
  note: string;
};

export function validateApproveInput(raw: unknown): Validated<ApproveInput> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "invalid_body" };
  const b = raw as Record<string, unknown>;
  const role = b.role;
  if (typeof role !== "string" || !(ENROLLMENT_ROLES as readonly string[]).includes(role)) return { ok: false, error: "invalid_role" };
  const branchIds = Array.isArray(b.branchIds)
    ? Array.from(new Set(b.branchIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 128)))).slice(0, 200)
    : [];
  if (role === "PLAYER" && branchIds.length !== 1) return { ok: false, error: "player_needs_exactly_one_branch" };
  const mode = b.mode === "replace" ? "replace" : "standby";
  return { ok: true, value: { role: role as EnrollmentRole, branchIds, mode, note: clip(b.note, 300) } };
}

// ───────────────────────────────────────────────── who may decide ───────────────────────────────

export type Actor = {
  userId: string;
  /** workspace owner / admin (WORKSPACE_ADMIN, SUPER_ADMIN membership): everything, everywhere */
  isAdmin: boolean;
  /** MANAGER membership: only inside the branches assigned to them */
  isManager: boolean;
  /** the branches the actor is assigned (without the legacy "default" key) */
  branchIds: string[];
};

/**
 * May this actor decide about a request / device whose branches are `branchIds`?
 * Admin: always. Manager: only when there is at least one branch and ALL of them are the manager's own. Everyone else: never.
 * A device with no branch at all (a Remote asking for "my account") can only be decided by an admin.
 */
export function actorCanDecide(actor: Actor, branchIds: readonly string[]): boolean {
  if (actor.isAdmin) return true;
  if (!actor.isManager) return false;
  if (branchIds.length === 0) return false;
  const own = new Set(actor.branchIds);
  return branchIds.every((b) => own.has(b));
}

/** the branches a request concerns: the approved scope once decided, the requested branch while pending */
export function rowBranchIds(row: { approvedBranchIds: readonly string[]; requestedBranchId: string | null }): string[] {
  if (row.approvedBranchIds.length > 0) return [...row.approvedBranchIds];
  return row.requestedBranchId ? [row.requestedBranchId] : [];
}

// ───────────────────────────────────────────────── allocation ───────────────────────────────────

export type Allocation = { used: number; max: number; remaining: number; full: boolean };

export function allocationState(maxPlayers: number, approvedPlayers: number): Allocation {
  const max = Math.max(0, Math.floor(maxPlayers));
  const used = Math.max(0, Math.floor(approvedPlayers));
  return { used, max, remaining: Math.max(0, max - used), full: used >= max };
}

/** may one more PLAYER be approved? A device that already counts as a PLAYER does not take a second seat. */
export function canApproveAnotherPlayer(a: Allocation, deviceAlreadyCounts: boolean): boolean {
  return deviceAlreadyCounts || !a.full;
}

// ───────────────────────────────────────────────── what the device is told ──────────────────────

export type PublicStatus =
  | { enforced: false; status: "disabled" }
  | { enforced: true; status: "unknown" }
  | { enforced: true; status: Exclude<EnrollmentStatus, "approved">; requestedAt: string; expiresAt: string; decisionNote?: string }
  | { enforced: true; status: "approved"; role: EnrollmentRole; playerClass: PlayerClass | null; branchIds: string[] };

type StatusRow = {
  status: string;
  expiresAt: Date;
  requestedAt: Date;
  approvedRole: string | null;
  playerClass: string | null;
  approvedBranchIds: readonly string[];
  decisionNote: string;
};

export function toPublicStatus(row: StatusRow | null, now: Date): PublicStatus {
  if (!row) return { enforced: true, status: "unknown" };
  const status = effectiveStatus(row, now);
  if (status === "approved" && (row.approvedRole === "PLAYER" || row.approvedRole === "REMOTE")) {
    return { enforced: true, status: "approved", role: row.approvedRole, playerClass: row.playerClass === "station" || row.playerClass === "browser" || row.playerClass === "owner" ? row.playerClass : null, branchIds: [...row.approvedBranchIds] };
  }
  if (status === "approved") return { enforced: true, status: "unknown" };
  return { enforced: true, status, requestedAt: row.requestedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), ...(row.decisionNote ? { decisionNote: row.decisionNote } : {}) };
}

/** the signed-token claim for an APPROVED device (null for anything else) — the WS server trusts this, never the client's own message */
export function enrollmentClaimFor(row: Pick<StatusRow, "status" | "expiresAt" | "approvedRole"> | null, now: Date): EnrollmentRole | null {
  if (!row) return null;
  if (effectiveStatus(row, now) !== "approved") return null;
  return row.approvedRole === "PLAYER" || row.approvedRole === "REMOTE" ? row.approvedRole : null;
}

// ───────────────────────────────────────────────── the token gate (pure decision) ───────────────

/** The desktop app's own screen is governed by the activation code / grandfathering, not by this gate (v1; an insider could imitate the user agent — the revocable device credential of Phase 5 closes that). */
export function isDesktopShellUserAgent(ua: string | null | undefined): boolean {
  return /\bElectron\//.test(ua ?? "");
}

export type MintDecision =
  | { kind: "off" }
  | { kind: "exempt" }
  | { kind: "blocked"; status: Exclude<EnrollmentStatus, "approved"> | "unknown" }
  /** `owner` = the owner's own computer (playerClass "owner"): since 2026-10-31 approved as a REMOTE, so the WS server holds it to CONTROL; the flag is kept for older rows that were approved as PLAYER, which are still never elected or promoted automatically. */
  | { kind: "approved"; role: EnrollmentRole; branchIds: string[]; owner: boolean };

/**
 * Should the WS-token route hand a token to this device? `enabled` = enrollment is on for the workspace. A device that is not approved gets NO token (so it can neither play nor control);
 * an approved one gets a token carrying its signed role and (when the manager scoped it) only its approved branches.
 */
export function decideMint(args: {
  enabled: boolean;
  userAgent: string | null | undefined;
  durableDeviceId: string | null | undefined;
  row: StatusRow | null;
  now: Date;
}): MintDecision {
  if (!args.enabled) return { kind: "off" };
  if (isDesktopShellUserAgent(args.userAgent)) return { kind: "exempt" };
  const id = (args.durableDeviceId ?? "").trim();
  if (!DEVICE_ID.test(id) || !args.row) return { kind: "blocked", status: "unknown" };
  const status = effectiveStatus(args.row, args.now);
  if (status === "approved" && (args.row.approvedRole === "PLAYER" || args.row.approvedRole === "REMOTE")) {
    return { kind: "approved", role: args.row.approvedRole, branchIds: [...args.row.approvedBranchIds], owner: args.row.playerClass === "owner" };
  }
  return { kind: "blocked", status: status === "approved" ? "unknown" : status };
}

/** the branches a token may carry: what the user is authorized for, narrowed to what the manager approved for the device (an empty approval = no extra narrowing) */
export function restrictBranches(authorized: readonly string[], approved: readonly string[]): string[] {
  if (approved.length === 0) return [...authorized];
  const ok = new Set(approved);
  return authorized.filter((b) => ok.has(b));
}
