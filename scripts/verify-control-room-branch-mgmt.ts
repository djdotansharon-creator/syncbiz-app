/**
 * Control Room branch management (Step A, owner-approved 2026-10-10) — tests.
 *  Part 1 (pure): activation code format / hash bound to the branch / constant-time match; Station ID + prefix rules;
 *                 strict geocode matching (same house number AND same city — a district name is never accepted).
 *  Part 2 (real DB, only when CR_VERIFY_DATABASE_URL points at a THROWAWAY database with all migrations):
 *                 create / edit branch, duplicate number, address not found → nothing saved, network code uniqueness,
 *                 activation code lifecycle (hash only, 60 min, new code revokes the old, revoke, install vs replace).
 * Run: npx tsx scripts/verify-control-room-branch-mgmt.ts
 */
import {
  ACTIVATION_CODE_TTL_MS, activationCodeMatches, generateActivationCode, hashActivationCode,
  normalizeBranchNumber, normalizeStationIdPrefix, stationIdFor,
} from "../lib/branch-activation";
import { cityMatches, normalizeHouseNumber, pickExactAddressMatch } from "../lib/branch-geocode";
import Module from "node:module";

// test-process stub: server-only (lib/branch-management → entitlement-limits) — same pattern as verify-control-room-f1.ts
{
  const Mo = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
  const m = new Module("stub:server-only") as unknown as { loaded: boolean; exports: unknown };
  m.loaded = true; m.exports = {}; Mo._cache["stub:server-only"] = m;
  const orig = Mo._resolveFilename;
  Mo._resolveFilename = function (r: string, ...rest: unknown[]) { return r === "server-only" ? "stub:server-only" : orig.call(this, r, ...rest); };
}

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
process.env.SYNCBIZ_ACTIVATION_SECRET = process.env.SYNCBIZ_ACTIVATION_SECRET || "test-activation-secret-0123456789";

// ── Part 1: pure ──
{
  const codes = Array.from({ length: 200 }, () => generateActivationCode());
  assert("A1 code = exactly 6 digits (leading zeros kept)", codes.every((c) => /^\d{6}$/.test(c)));
  assert("A2 codes are random (≥ 190 distinct of 200)", new Set(codes).size >= 190);
  const h = hashActivationCode("branch-1", "123456");
  assert("A3 only a hash: 64 hex chars, never the code", /^[0-9a-f]{64}$/.test(h) && !h.includes("123456"));
  assert("A4 the same code for ANOTHER branch does not match", hashActivationCode("branch-2", "123456") !== h && !activationCodeMatches("branch-2", "123456", h));
  assert("A5 correct code matches; wrong / malformed do not", activationCodeMatches("branch-1", "123456", h) && !activationCodeMatches("branch-1", "123457", h) && !activationCodeMatches("branch-1", "12345", h));
  assert("A6 code lifetime = 60 minutes", ACTIVATION_CODE_TTL_MS === 3_600_000);
  assert("A7 network code: 2–12 letters/digits, upper-cased", normalizeStationIdPrefix("aroma") === "AROMA" && normalizeStationIdPrefix("A") === null && normalizeStationIdPrefix("AROMA-1") === null);
  assert("A8 branch number upper-cased, letters/digits only", normalizeBranchNumber(" t001 ") === "T001" && normalizeBranchNumber("19 2") === null);
  assert("A9 Station ID = <network code>-<branch number>", stationIdFor("aroma", "192") === "AROMA-192" && stationIdFor(null, "192") === null);
}
{
  const item = (house: string, road: string, city: Record<string, string>, lat = "32.1", lon = "34.8") => ({ lat, lon, display_name: "x", address: { house_number: house, road, ...city } });
  const want = { country: "ישראל", city: "חיפה", street: "הרצל", houseNumber: "10" };
  assert("G1 exact house number + same city → accepted", pickExactAddressMatch([item("10", "הרצל", { city: "חיפה" })], want).ok);
  assert("G2 the Hadera case: same street / number but city Hadera (district 'מחוז חיפה') → REJECTED",
    !pickExactAddressMatch([item("10", "הרצל", { city: "חדרה", state: "מחוז חיפה" })], want).ok);
  assert("G3 street-only result (no house number) → rejected, never a guess", !pickExactAddressMatch([{ lat: "32", lon: "34", address: { road: "הרצל", city: "חיפה" } }], want).ok);
  assert("G4 other house number → rejected", !pickExactAddressMatch([item("12", "הרצל", { city: "חיפה" })], want).ok);
  assert("G5 no results → not_found", (() => { const r = pickExactAddressMatch([], want); return !r.ok && r.reason === "not_found"; })());
  assert("G6 'Tel Aviv' matches 'Tel Aviv-Yafo'; 'תל אביב' matches 'תל־אביב–יפו'",
    cityMatches({ city: "Tel Aviv-Yafo" }, "Tel Aviv") && cityMatches({ city: "תל־אביב–יפו" }, "תל אביב"));
  assert("G7 house number '12 א' equals '12א'", normalizeHouseNumber("12 א") === normalizeHouseNumber("12א"));
}

// ── Part 2: real DB (throwaway only) ──
async function dbPart(): Promise<void> {
  const url = process.env.CR_VERIFY_DATABASE_URL;
  if (!url) { console.log("SKIP  Part 2 (set CR_VERIFY_DATABASE_URL to a THROWAWAY database with all migrations)"); return; }
  const host = new URL(url).hostname;
  if ((host !== "localhost" && host !== "127.0.0.1") || /syncbiz_dev|railway|rlwy|production/i.test(url)) { assert("Part 2 refuses a non-throwaway database", false, "refused"); return; }
  process.env.DATABASE_URL = url;
  const { prisma } = await import("../lib/prisma");
  const m = await import("../lib/branch-management");
  const ws = await prisma.workspace.create({ data: { name: "CR verify", slug: `cr-verify-${Date.now()}`, owner: { create: { email: `cr-verify-${Date.now()}@example.test` } } } as never });
  const other = await prisma.workspace.create({ data: { name: "CR other", slug: `cr-other-${Date.now()}`, owner: { create: { email: `cr-other-${Date.now()}@example.test` } } } as never });
  m.setGeocoderForTests(async (a) => a.street === "Nowhere" ? { ok: false, reason: "not_found" } : { ok: true, latitude: 31.8, longitude: 34.65, displayName: "test" });
  const base = { name: "Aroma Ashdod", branchNumber: "192", country: "Israel", city: "Ashdod", street: "Herzl", houseNumber: "10" };

  const b = await m.createBranch(ws.id, base);
  const zones = await prisma.zone.count({ where: { branchId: b.id, isDefault: true } });
  assert("D1 create → saved with exact coordinates + default zone + brand", b.latitude === 31.8 && b.longitude === 34.65 && !!b.geocodedAt && zones === 1 && !!b.brandId && b.locationCode === "192");
  const dup = await m.createBranch(ws.id, { ...base, name: "Other" }).then(() => null, (e: Error) => e.message);
  assert("D2 duplicate branch number in the same organization → refused", !!dup && /already used/.test(dup), String(dup));
  const before = await prisma.branch.count({ where: { workspaceId: ws.id } });
  const nf = await m.createBranch(ws.id, { ...base, branchNumber: "193", street: "Nowhere" }).then(() => null, (e: Error) => e.message);
  assert("D3 address not found → clear error and NOTHING saved", !!nf && /not found/i.test(nf) && (await prisma.branch.count({ where: { workspaceId: ws.id } })) === before, String(nf));
  await m.updateBranch(ws.id, b.id, { ...base, name: "Aroma Ashdod Port" });
  const nameOnly = await prisma.branch.findUniqueOrThrow({ where: { id: b.id } });
  assert("D4 edit name only → saved, location kept", nameOnly.name === "Aroma Ashdod Port" && nameOnly.latitude === 31.8);
  const badEdit = await m.updateBranch(ws.id, b.id, { ...base, street: "Nowhere" }).then(() => null, (e: Error) => e.message);
  const afterBad = await prisma.branch.findUniqueOrThrow({ where: { id: b.id } });
  assert("D5 edit to an address that is not found → refused, old address + location kept", !!badEdit && afterBad.street === "Herzl" && afterBad.latitude === 31.8);
  const cross = await m.updateBranch(other.id, b.id, base).then(() => null, (e: Error) => e.message);
  assert("D6 another organization cannot edit this branch", !!cross && /not found/i.test(cross));

  const noPrefix = await m.createActivationCode(ws.id, b.id, "u1").then(() => null, (e: Error) => e.message);
  assert("C1 no network code yet → refused with a clear message", !!noPrefix && /network code/i.test(noPrefix));
  await m.setStationIdPrefix(ws.id, "aroma");
  const taken = await m.setStationIdPrefix(other.id, "AROMA").then(() => null, (e: Error) => e.message);
  assert("C2 network code is unique across organizations", !!taken && /already used/i.test(taken));
  const c1 = await m.createActivationCode(ws.id, b.id, "u1");
  const rows1 = await prisma.branchActivationCode.findMany({ where: { branchId: b.id } });
  assert("C3 code: Station ID AROMA-192, 6 digits, purpose install (no main station)", c1.stationId === "AROMA-192" && /^\d{6}$/.test(c1.code) && c1.purpose === "install");
  assert("C4 stored = hash only (the code is not in the DB)", rows1.length === 1 && rows1[0].codeHash !== c1.code && !JSON.stringify(rows1).includes(c1.code) && activationCodeMatches(b.id, c1.code, rows1[0].codeHash));
  const ttl = new Date(c1.expiresAt).getTime() - Date.now();
  assert("C5 valid ~60 minutes", ttl > 59 * 60_000 && ttl <= 60 * 60_000 + 1000);
  const st1 = await m.getActivationStatus(ws.id, b.id);
  assert("C6 status shows an active code — never the code itself", !!st1.active && !JSON.stringify(st1).includes(c1.code));
  const c2 = await m.createActivationCode(ws.id, b.id, "u1");
  const live = await prisma.branchActivationCode.findMany({ where: { branchId: b.id, revokedAt: null, usedAt: null } });
  assert("C7 a new code revokes the previous one (one active code per branch)", live.length === 1 && activationCodeMatches(b.id, c2.code, live[0].codeHash));
  await m.revokeActivationCode(ws.id, b.id);
  assert("C8 cancel → no active code", !(await m.getActivationStatus(ws.id, b.id)).active);
  await prisma.branchMasterDesignation.create({ data: { workspaceId: ws.id, branchId: b.id, durableDeviceId: "dsk-test-main", designatedBy: "test" } as never });
  const c3 = await m.createActivationCode(ws.id, b.id, "u1");
  assert("C9 branch with a main station → purpose 'replace'", c3.purpose === "replace");
  const crossCode = await m.createActivationCode(other.id, b.id, "u2").then(() => null, (e: Error) => e.message);
  assert("C10 another organization cannot create codes for this branch", !!crossCode && /not found/i.test(crossCode));

  m.setGeocoderForTests(null);
  await prisma.$disconnect();
}

dbPart()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(process.exitCode ?? 0); });
