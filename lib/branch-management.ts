/**
 * Control Room — branch management (owner-approved 2026-10-10, Step A: management side only).
 * Add / edit a branch: name, branch number and a LOCATION picked from Google (Places Autocomplete — a mall / commercial
 * centre without a street number is valid). The server resolves the picked Place ID itself (Google Places API (New),
 * server key) and stores Place ID + formatted address + city + latitude / longitude. Text that was not picked from Google
 * is never saved — no guessed location. Also: the organization's Station ID prefix and one-time activation codes.
 * Never touches stations, designations, the WS server or playback. Every function is scoped to ONE workspace id.
 */
import { prisma } from "./prisma";
import { removeBranchLogo } from "./branch-logo";
import { writeTenantAuditLog } from "./admin/tenant-audit";
import { ensureDefaultBrandId, defaultZoneData } from "./control-room-foundation";
import { enforceCanAddBranch } from "./entitlement-limits";
import { resolveGooglePlace, placeErrorMessage, type PlaceResult } from "./branch-place";
import {
  ACTIVATION_CODE_TTL_MS,
  generateActivationCode,
  hashActivationCode,
  normalizeBranchNumber,
  normalizeStationIdPrefix,
  stationIdFor,
} from "./branch-activation";

export class BranchInputError extends Error {
  /** `code` / `count`: a stable reason the UI can word in its own language (delete refusals) */
  constructor(message: string, readonly status = 400, readonly code?: string, readonly count?: number) {
    super(message);
  }
}

export type BranchInput = {
  name: unknown;
  branchNumber: unknown;
  /** the Google Place ID the owner picked (required on create; on edit only when the location changes) */
  placeId?: unknown;
  /** UI language — Google answers the address in it ("he" / "en") */
  language?: unknown;
  /** Brand of THIS organization (optional; omitted on create → the default Brand; omitted on edit → unchanged) */
  brandId?: unknown;
};

/** A brand id safe to store on a branch of THIS workspace — never another organization's, never archived. */
async function assignableBrandId(workspaceId: string, brandId: unknown): Promise<string> {
  if (typeof brandId !== "string" || !brandId.trim()) throw new BranchInputError("Pick a brand.");
  const b = await prisma.brand.findFirst({ where: { id: brandId.trim(), workspaceId, archivedAt: null }, select: { id: true } });
  if (!b) throw new BranchInputError("Brand not found.", 404);
  return b.id;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanNameNumber(input: BranchInput) {
  const name = str(input.name, 80);
  if (!name) throw new BranchInputError("Branch name is required.");
  const branchNumber = normalizeBranchNumber(input.branchNumber);
  if (!branchNumber) throw new BranchInputError("Branch number is required (letters and digits only, up to 12).");
  return { name, branchNumber };
}

let placeResolver: (placeId: unknown, language: "he" | "en") => Promise<PlaceResult> = resolveGooglePlace;
/** Tests only: replace the Google place lookup (never the network in tests). */
export function setPlaceResolverForTests(fn: ((placeId: unknown, language: "he" | "en") => Promise<PlaceResult>) | null): void {
  placeResolver = fn ?? resolveGooglePlace;
}

async function resolvePlaceOrThrow(input: BranchInput) {
  const r = await placeResolver(input.placeId, input.language === "en" ? "en" : "he");
  if (!r.ok) throw new BranchInputError(placeErrorMessage(r.reason), r.reason === "invalid_id" ? 400 : 422); // never guess
  return r.place;
}

function placeFields(pl: Awaited<ReturnType<typeof resolvePlaceOrThrow>>) {
  return {
    googlePlaceId: pl.placeId,
    formattedAddress: pl.formattedAddress,
    city: pl.city,
    country: pl.country,
    street: pl.street,
    houseNumber: pl.houseNumber,
    latitude: pl.latitude,
    longitude: pl.longitude,
    geocodedAt: new Date(),
  };
}

async function assertNumberFree(workspaceId: string, branchNumber: string, exceptBranchId?: string) {
  const clash = await prisma.branch.findFirst({ where: { workspaceId, locationCode: branchNumber, ...(exceptBranchId ? { NOT: { id: exceptBranchId } } : {}) }, select: { id: true } });
  if (clash) throw new BranchInputError(`Branch number ${branchNumber} is already used in this organization.`, 409);
}

/** Create a branch: name + number + a Google-picked place (resolved on the server) → branch + default Brand + Zone. */
export async function createBranch(workspaceId: string, input: BranchInput) {
  const c = cleanNameNumber(input);
  await enforceCanAddBranch(workspaceId);
  await assertNumberFree(workspaceId, c.branchNumber);
  const place = await resolvePlaceOrThrow(input);
  const pickedBrandId = input.brandId === undefined || input.brandId === null || input.brandId === "" ? null : await assignableBrandId(workspaceId, input.brandId);
  return prisma.$transaction(async (tx) => {
    const brandId = pickedBrandId ?? (await ensureDefaultBrandId(tx, workspaceId));
    const created = await tx.branch.create({
      data: {
        workspaceId,
        name: c.name,
        code: c.branchNumber,
        locationCode: c.branchNumber,
        ...placeFields(place),
        timezone: "Asia/Jerusalem",
        status: "active",
        brandId,
      },
    });
    await tx.zone.create({ data: defaultZoneData(workspaceId, created.id) });
    return created;
  });
}

/** Edit a branch: name / number; the location changes only when a NEW Google place was picked (resolved on the server). */
export async function updateBranch(workspaceId: string, branchId: string, input: BranchInput) {
  const c = cleanNameNumber(input);
  const cur = await prisma.branch.findFirst({ where: { id: branchId, workspaceId } });
  if (!cur) throw new BranchInputError("Branch not found.", 404);
  await assertNumberFree(workspaceId, c.branchNumber, branchId);
  const newPlace = input.placeId !== undefined && input.placeId !== null && input.placeId !== "" && input.placeId !== cur.googlePlaceId;
  const place = newPlace ? await resolvePlaceOrThrow(input) : null;
  const brandId = input.brandId === undefined ? undefined : await assignableBrandId(workspaceId, input.brandId);
  return prisma.branch.update({
    where: { id: branchId },
    data: { name: c.name, locationCode: c.branchNumber, ...(place ? placeFields(place) : {}), ...(brandId ? { brandId } : {}) },
  });
}

export async function getStationIdPrefix(workspaceId: string): Promise<string | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { stationIdPrefix: true } });
  return ws?.stationIdPrefix ?? null;
}

/** Set the organization's Station ID prefix (globally unique). */
export async function setStationIdPrefix(workspaceId: string, raw: unknown): Promise<string> {
  const prefix = normalizeStationIdPrefix(raw);
  if (!prefix) throw new BranchInputError("Network code: 2–12 letters or digits (e.g. AROMA).");
  const taken = await prisma.workspace.findFirst({ where: { stationIdPrefix: prefix, NOT: { id: workspaceId } }, select: { id: true } });
  if (taken) throw new BranchInputError("This network code is already used by another organization.", 409);
  await prisma.workspace.update({ where: { id: workspaceId }, data: { stationIdPrefix: prefix } });
  return prefix;
}

/** Is a main station designated for the branch? (decides "install" vs "replace"; read-only). */
async function branchHasMainStation(workspaceId: string, branchId: string, legacyKey: string | null): Promise<boolean> {
  const keys = [branchId, ...(legacyKey ? [legacyKey] : [])];
  const d = await prisma.branchMasterDesignation.findFirst({ where: { workspaceId, branchId: { in: keys } }, select: { id: true } });
  return !!d;
}

/**
 * New one-time activation code for a branch (revokes the previous active one). Returns the code ONCE — only its hash
 * is stored. Requires the organization's Station ID prefix and the branch number.
 */
export async function createActivationCode(workspaceId: string, branchId: string, userId: string) {
  const branch = await prisma.branch.findFirst({ where: { id: branchId, workspaceId }, select: { id: true, locationCode: true, legacyKey: true } });
  if (!branch) throw new BranchInputError("Branch not found.", 404);
  const prefix = await getStationIdPrefix(workspaceId);
  if (!prefix) throw new BranchInputError("Set the network code first (Station ID prefix).", 409);
  const stationId = stationIdFor(prefix, branch.locationCode);
  if (!stationId) throw new BranchInputError("Set a branch number first.", 409);
  const purpose = (await branchHasMainStation(workspaceId, branchId, branch.legacyKey)) ? "replace" : "install";
  const code = generateActivationCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ACTIVATION_CODE_TTL_MS);
  await prisma.$transaction([
    prisma.branchActivationCode.updateMany({ where: { branchId, usedAt: null, revokedAt: null }, data: { revokedAt: now } }),
    prisma.branchActivationCode.create({
      data: { workspaceId, branchId, codeHash: hashActivationCode(branchId, code), purpose, createdByUserId: userId, expiresAt },
    }),
  ]);
  return { stationId, code, expiresAt: expiresAt.toISOString(), purpose };
}

/** Status of the branch's current code — NEVER the code itself. */
export async function getActivationStatus(workspaceId: string, branchId: string) {
  const branch = await prisma.branch.findFirst({ where: { id: branchId, workspaceId }, select: { locationCode: true } });
  if (!branch) throw new BranchInputError("Branch not found.", 404);
  const prefix = await getStationIdPrefix(workspaceId);
  const active = await prisma.branchActivationCode.findFirst({
    where: { branchId, workspaceId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { expiresAt: true, purpose: true },
  });
  return {
    stationId: stationIdFor(prefix, branch.locationCode),
    networkCodeSet: !!prefix,
    active: active ? { expiresAt: active.expiresAt.toISOString(), purpose: active.purpose } : null,
  };
}

export async function revokeActivationCode(workspaceId: string, branchId: string) {
  const branch = await prisma.branch.findFirst({ where: { id: branchId, workspaceId }, select: { id: true } });
  if (!branch) throw new BranchInputError("Branch not found.", 404);
  await prisma.branchActivationCode.updateMany({ where: { branchId, workspaceId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Who is deleting, what they typed to confirm, and from where (for the audit row). */
export type DeleteBranchContext = { userId: string; /** must equal the branch's name (the server checks it — the screen cannot skip it) */ confirmName: unknown; ipAddress?: string | null };

/**
 * Delete a branch of THIS workspace (owner 2026-10-22: "an option to delete a branch from its settings"; hardened after the PR #61 review, 2026-10-23).
 * Never forced — it is REFUSED (409 + `code`) while the branch still carries something that must not vanish silently:
 *   default  the legacy default branch (the accepted pilot's branch)
 *   station  a station bound to it (a registered StationDevice / a designated MASTER — an unattended machine must never be orphaned)
 *   assignment  users are assigned to it. Deleting the assignments would NOT be harmless: `getAssignedBranchIds` falls back to the pilot's default branch for a user with
 *               no assignments, so the branch's employees would silently gain access to the pilot branch — they must be moved first
 *   scope    a member's access scope points at it (removing it could broaden someone's access)
 * and the caller must type the branch's name (`confirmName`, 400 + code `confirm` otherwise).
 * Everything — the lock, every check, the AuditLog row (who / when) and the delete — happens in ONE transaction. A station activation (`redeemStationActivation`) flips an activation
 * code's `usedAt` BEFORE it binds the station, so the transaction first takes `FOR UPDATE` locks on the branch row and its activation codes: an activation that is already running makes
 * the delete wait and then SEE its station (→ refused); one that starts after the lock waits and then finds its code gone (→ it fails, no station is bound to a deleted branch).
 * What goes with the branch: its zones, activation codes, group / tag links, schedules and registered devices (FK cascade), and its logo file.
 */
export async function deleteBranch(workspaceId: string, branchId: string, ctx: DeleteBranchContext): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        // 1. LOCK (branch row, then its activation codes) before reading anything
        const rows = await tx.$queryRaw<Array<{ id: string; name: string; legacyKey: string | null; locationCode: string | null; brandId: string | null }>>`
          SELECT "id", "name", "legacyKey", "locationCode", "brandId" FROM "Branch" WHERE "id" = ${branchId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
        const cur = rows[0];
        if (!cur) throw new BranchInputError("Branch not found.", 404, "not_found");
        await tx.$queryRaw`SELECT "id" FROM "BranchActivationCode" WHERE "branchId" = ${cur.id} FOR UPDATE`;
        // 2. the checks (each statement sees everything committed up to now, including an activation that just finished)
        if (cur.legacyKey) throw new BranchInputError("The default branch cannot be deleted.", 409, "default");
        if (typeof ctx.confirmName !== "string" || ctx.confirmName.trim() !== cur.name.trim()) throw new BranchInputError("Type the branch's name exactly to confirm the deletion.", 400, "confirm");
        const stations = await tx.stationDevice.count({ where: { workspaceId, branchId: cur.id } });
        const designations = await tx.branchMasterDesignation.count({ where: { workspaceId, branchId: cur.id } });
        if (stations > 0 || designations > 0) throw new BranchInputError("This branch has a station installed.", 409, "station");
        const assignments = await tx.userBranchAssignment.count({ where: { workspaceId, branchId: cur.id } });
        if (assignments > 0) throw new BranchInputError("Users are assigned to this branch — move them to another branch first.", 409, "assignment", assignments);
        const scopes = await tx.memberScopeTarget.count({ where: { branchId: cur.id } });
        if (scopes > 0) throw new BranchInputError("This branch is used in a member's access scope.", 409, "scope");
        // 3. the audit row and the delete — same transaction (no delete without its audit row)
        await writeTenantAuditLog(tx, {
          action: "branch.delete",
          entity: "branch",
          actorUserId: ctx.userId,
          workspaceId,
          targetUserId: cur.id, // = the entity id (same convention as the jingle audit rows)
          ipAddress: ctx.ipAddress ?? null,
          metadata: { branchName: cur.name, branchNumber: cur.locationCode, brandId: cur.brandId, deletedAt: new Date().toISOString() },
        });
        await tx.branch.delete({ where: { id: cur.id } });
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
  } catch (e) {
    if (e instanceof BranchInputError) throw e;
    if (/lock timeout|55P03/i.test(e instanceof Error ? e.message : String(e))) throw new BranchInputError("The branch is being changed at this moment — try again in a few seconds.", 409, "busy");
    throw e;
  }
  try { removeBranchLogo(branchId); } catch { /* no logo file */ }
}
