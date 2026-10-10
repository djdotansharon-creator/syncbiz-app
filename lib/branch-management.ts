/**
 * Control Room — branch management (owner-approved 2026-10-10, Step A: management side only).
 * Add / edit a branch with a real address (geocoded → exact map position), the organization's Station ID prefix, and
 * one-time station activation codes. Never touches stations, designations, the WS server or playback.
 * Every function is scoped to ONE workspace id resolved by the caller from the signed-in user.
 */
import { prisma } from "./prisma";
import { ensureDefaultBrandId, defaultZoneData } from "./control-room-foundation";
import { enforceCanAddBranch } from "./entitlement-limits";
import { geocodeBranchAddress, geocodeErrorMessage, type GeocodeResult, type BranchAddress } from "./branch-geocode";
import {
  ACTIVATION_CODE_TTL_MS,
  generateActivationCode,
  hashActivationCode,
  normalizeBranchNumber,
  normalizeStationIdPrefix,
  stationIdFor,
} from "./branch-activation";

export class BranchInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type BranchInput = {
  name: unknown;
  branchNumber: unknown;
  country: unknown;
  city: unknown;
  street: unknown;
  houseNumber: unknown;
};

type CleanInput = { name: string; branchNumber: string; country: string; city: string; street: string; houseNumber: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function clean(input: BranchInput): CleanInput {
  const name = str(input.name, 80);
  if (!name) throw new BranchInputError("Branch name is required.");
  const branchNumber = normalizeBranchNumber(input.branchNumber);
  if (!branchNumber) throw new BranchInputError("Branch number is required (letters and digits only, up to 12).");
  const city = str(input.city, 80);
  const street = str(input.street, 120);
  const houseNumber = str(input.houseNumber, 12);
  if (!city || !street || !houseNumber) throw new BranchInputError("City, street and house number are required.");
  return { name, branchNumber, country: str(input.country, 60) || "Israel", city, street, houseNumber };
}

let geocoder: (a: BranchAddress) => Promise<GeocodeResult> = geocodeBranchAddress;
/** Tests only: replace the address service (never the network in tests). */
export function setGeocoderForTests(fn: ((a: BranchAddress) => Promise<GeocodeResult>) | null): void {
  geocoder = fn ?? geocodeBranchAddress;
}

async function geocodeOrThrow(c: CleanInput) {
  const g = await geocoder({ country: c.country, city: c.city, street: c.street, houseNumber: c.houseNumber });
  if (!g.ok) throw new BranchInputError(geocodeErrorMessage(g.reason), 422); // never guess a location
  return g;
}

async function assertNumberFree(workspaceId: string, branchNumber: string, exceptBranchId?: string) {
  const clash = await prisma.branch.findFirst({ where: { workspaceId, locationCode: branchNumber, ...(exceptBranchId ? { NOT: { id: exceptBranchId } } : {}) }, select: { id: true } });
  if (clash) throw new BranchInputError(`Branch number ${branchNumber} is already used in this organization.`, 409);
}

/** Create a branch: validate → geocode (exact or error) → branch + default Brand + default Zone in one transaction. */
export async function createBranch(workspaceId: string, input: BranchInput) {
  const c = clean(input);
  await enforceCanAddBranch(workspaceId);
  await assertNumberFree(workspaceId, c.branchNumber);
  const g = await geocodeOrThrow(c);
  return prisma.$transaction(async (tx) => {
    const brandId = await ensureDefaultBrandId(tx, workspaceId);
    const created = await tx.branch.create({
      data: {
        workspaceId,
        name: c.name,
        code: c.branchNumber,
        locationCode: c.branchNumber,
        country: c.country,
        city: c.city,
        street: c.street,
        houseNumber: c.houseNumber,
        latitude: g.latitude,
        longitude: g.longitude,
        geocodedAt: new Date(),
        timezone: "Asia/Jerusalem",
        status: "active",
        brandId,
      },
    });
    await tx.zone.create({ data: defaultZoneData(workspaceId, created.id) });
    return created;
  });
}

/** Edit a branch: same validation; the address is geocoded again only when it changed (exact or error). */
export async function updateBranch(workspaceId: string, branchId: string, input: BranchInput) {
  const c = clean(input);
  const cur = await prisma.branch.findFirst({ where: { id: branchId, workspaceId } });
  if (!cur) throw new BranchInputError("Branch not found.", 404);
  await assertNumberFree(workspaceId, c.branchNumber, branchId);
  const addressChanged =
    cur.city !== c.city || cur.street !== c.street || cur.houseNumber !== c.houseNumber || cur.country !== c.country || cur.latitude === null;
  const g = addressChanged ? await geocodeOrThrow(c) : null;
  return prisma.branch.update({
    where: { id: branchId },
    data: {
      name: c.name,
      locationCode: c.branchNumber,
      country: c.country,
      city: c.city,
      street: c.street,
      houseNumber: c.houseNumber,
      ...(g ? { latitude: g.latitude, longitude: g.longitude, geocodedAt: new Date() } : {}),
    },
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
