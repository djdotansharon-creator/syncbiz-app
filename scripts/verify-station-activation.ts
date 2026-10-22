/**
 * Station activation — Step B1 (owner-approved 2026-10-11) — tests.
 *  Part 1 (pure): Station ID parsing, device id shape, the renderer station-branch fallback ("default" off-desktop).
 *  Part 2 (real DB, only when CR_VERIFY_DATABASE_URL points at a THROWAWAY database with all migrations):
 *    wrong / expired / used / locked codes; binds ONLY to its own branch; never moves another branch's main station
 *    (the Lenovo); "install" never replaces, "replace" does; a non-designated computer moves from "default"; other
 *    organizations refused; single use.
 * Run: npx tsx scripts/verify-station-activation.ts
 */
import Module from "node:module";

// DB safety FIRST (before any lib import creates a Prisma client): only a throwaway localhost DB; otherwise an
// unreachable URL so nothing can ever touch syncbiz_dev or a cloud database.
const VERIFY_URL = process.env.CR_VERIFY_DATABASE_URL ?? "";
const VERIFY_SAFE = !!VERIFY_URL && ["localhost", "127.0.0.1"].includes(new URL(VERIFY_URL).hostname) && !/syncbiz_dev|railway|rlwy|production/i.test(VERIFY_URL);
process.env.DATABASE_URL = VERIFY_SAFE ? VERIFY_URL : "postgresql://nobody:none@127.0.0.1:1/none";

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

async function pure(): Promise<void> {
  const { parseStationId, isPlausibleDurableDeviceId } = await import("../lib/station-activation");
  assert("S1 Station ID parsed at the last dash, upper-cased", JSON.stringify(parseStationId(" unv-094 ")) === JSON.stringify({ prefix: "UNV", number: "094" }));
  assert("S2 malformed Station IDs refused", parseStationId("UNV") === null && parseStationId("-094") === null && parseStationId("UNV-") === null && parseStationId(42) === null);
  assert("S3 device id shape", isPlausibleDurableDeviceId("dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f") && !isPlausibleDurableDeviceId("x") && !isPlausibleDurableDeviceId("a b c d e f g h"));
  const sb = await import("../lib/station-branch");
  assert("S4 no desktop bridge (browser / phone / server) → \"default\" exactly as before", sb.stationBranchIdNow() === "default");
  assert("S5 resolve without a bridge → \"default\"", (await sb.resolveStationBranchId()) === "default");
}

async function dbPart(): Promise<void> {
  if (!VERIFY_URL) { console.log("SKIP  Part 2 (set CR_VERIFY_DATABASE_URL to a THROWAWAY database with all migrations)"); return; }
  if (!VERIFY_SAFE) { assert("Part 2 refuses a non-throwaway database", false, "refused"); return; }
  const { prisma } = await import("../lib/prisma");
  const m = await import("../lib/branch-management");
  const a = await import("../lib/station-activation");
  m.setPlaceResolverForTests(async (id) => ({ ok: true, place: { placeId: String(id), formattedAddress: "x", city: "Tel Aviv", country: "Israel", street: "", houseNumber: "", latitude: 32, longitude: 34.8 } }));
  const t = Date.now();
  const ws = await prisma.workspace.create({ data: { name: "B1 verify", slug: `b1-verify-${t}`, owner: { create: { email: `b1-verify-${t}@example.test` } } } as never });
  const other = await prisma.workspace.create({ data: { name: "B1 other", slug: `b1-other-${t}`, owner: { create: { email: `b1-other-${t}@example.test` } } } as never });
  await m.setStationIdPrefix(ws.id, "UNV");
  await m.setStationIdPrefix(other.id, "OTH");
  // the legacy branch (= the Lenovo's) with its designated main station
  const legacy = await prisma.branch.create({ data: { workspaceId: ws.id, name: "Legacy", legacyKey: "default", locationCode: "T001" } as never });
  const LENOVO = "dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f";
  await prisma.stationDevice.create({ data: { durableDeviceId: LENOVO, workspaceId: ws.id, branchId: legacy.id, platform: "desktop", appVersion: "beta.21" } });
  await prisma.branchMasterDesignation.create({ data: { workspaceId: ws.id, branchId: legacy.id, durableDeviceId: LENOVO, designatedBy: "test" } as never });
  const b94 = await m.createBranch(ws.id, { name: "Elad", branchNumber: "094", placeId: "ChIJelad_place_00001" });
  const b92 = await m.createBranch(ws.id, { name: "Ashdod", branchNumber: "092", placeId: "ChIJashd_place_00001" });
  const NEWPC = "dsk-11111111-2222-3333-4444-555555555555";
  // the new computer signed in once → registered (NOT designated) under the legacy branch
  await prisma.stationDevice.create({ data: { durableDeviceId: NEWPC, workspaceId: ws.id, branchId: legacy.id, platform: "desktop", appVersion: "beta.21" } });
  const red = (stationId: string, code: string, dev = NEWPC, wsId = ws.id) =>
    a.redeemStationActivation({ workspaceId: wsId, userId: "owner", stationId, code, durableDeviceId: dev }).then((r) => ({ ok: true as const, r }), (e: Error & { status?: number }) => ({ ok: false as const, msg: e.message, status: e.status }));

  const none = await red("UNV-094", "123456");
  assert("R1 no code created yet → clear refusal", !none.ok && /no valid activation code/i.test(none.msg));
  const c = await m.createActivationCode(ws.id, b94.id, "owner");
  const wrongCode = c.code === "000000" ? "000001" : "000000";
  const w1 = await red("UNV-094", wrongCode);
  assert("R2 wrong code → refused, tries left shown, nothing bound", !w1.ok && /4 tries left/.test(w1.msg) && !(await prisma.branchMasterDesignation.findFirst({ where: { branchId: b94.id } })));
  const wrongBranch = await red("UNV-092", c.code);
  assert("R3 the code of branch 094 never opens branch 092", !wrongBranch.ok);
  const foreign = await red("OTH-094", c.code);
  assert("R4 a Station ID of another network → refused", !foreign.ok && /does not belong/i.test(foreign.msg));
  const lenovo = await red("UNV-094", c.code, LENOVO);
  assert("R5 the Lenovo (main station of ANOTHER branch) can never be moved", !lenovo.ok && /another branch/i.test(lenovo.msg));
  const lenovoDes = await prisma.branchMasterDesignation.findFirst({ where: { branchId: legacy.id } });
  const lenovoDev = await prisma.stationDevice.findUnique({ where: { durableDeviceId: LENOVO } });
  assert("R5b the Lenovo's designation and registration are unchanged", lenovoDes?.durableDeviceId === LENOVO && lenovoDev?.branchId === legacy.id);

  const ok = await red("unv-094", c.code);
  const des = await prisma.branchMasterDesignation.findFirst({ where: { workspaceId: ws.id, branchId: b94.id } });
  const dev = await prisma.stationDevice.findUnique({ where: { durableDeviceId: NEWPC } });
  const used = await prisma.branchActivationCode.findFirst({ where: { branchId: b94.id }, orderBy: { createdAt: "desc" } });
  assert("R6 correct code → this computer is the main station of 094 ONLY", ok.ok && ok.r.branchId === b94.id && ok.r.stationId === "UNV-094" && des?.durableDeviceId === NEWPC && dev?.branchId === b94.id, JSON.stringify(ok));
  assert("R7 the code is burned (usedAt + device)", !!used?.usedAt && used.usedByDurableDeviceId === NEWPC);
  assert("R8 the Lenovo's branch keeps the Lenovo as main station", (await prisma.branchMasterDesignation.findFirst({ where: { branchId: legacy.id } }))?.durableDeviceId === LENOVO);
  const again = await red("UNV-094", c.code);
  assert("R9 single use: the same code again → refused", !again.ok);
  const state = await a.getStationActivationState(ws.id, NEWPC);
  assert("R10 activation state: designated, branch name + Station ID", state.designated && state.branchName === "Elad" && state.stationId === "UNV-094");
  assert("R11 the Lenovo reads as designated (never sees the activation screen)", (await a.getStationActivationState(ws.id, LENOVO)).designated);

  // install vs replace on 094 (it now has a main station)
  const OTHERPC = "dsk-99999999-8888-7777-6666-555555555555";
  await prisma.branchActivationCode.create({ data: { workspaceId: ws.id, branchId: b94.id, codeHash: (await import("../lib/branch-activation")).hashActivationCode(b94.id, "424242"), purpose: "install", createdByUserId: "owner", expiresAt: new Date(Date.now() + 600_000) } });
  const inst = await red("UNV-094", "424242", OTHERPC);
  assert("R12 an 'install' code never replaces an existing main station", !inst.ok && /already has a main station/i.test(inst.msg) && (await prisma.branchMasterDesignation.findFirst({ where: { branchId: b94.id } }))?.durableDeviceId === NEWPC);
  const rc = await m.createActivationCode(ws.id, b94.id, "owner");
  assert("R13 the Control Room creates a 'replace' code once a main station exists", rc.purpose === "replace");
  const rep = await red("UNV-094", rc.code, OTHERPC);
  assert("R14 a 'replace' code → the new computer becomes 094's main station", rep.ok && rep.r.replaced && (await prisma.branchMasterDesignation.findFirst({ where: { branchId: b94.id } }))?.durableDeviceId === OTHERPC);
  assert("R14b still exactly ONE main station for 094", (await prisma.branchMasterDesignation.count({ where: { branchId: b94.id } })) === 1);

  // expired + lock-out on 092
  const c92 = await m.createActivationCode(ws.id, b92.id, "owner");
  await prisma.branchActivationCode.updateMany({ where: { branchId: b92.id, usedAt: null, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const exp = await red("UNV-092", c92.code, "dsk-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert("R15 expired code → refused", !exp.ok && /no valid activation code/i.test(exp.msg));
  const c92b = await m.createActivationCode(ws.id, b92.id, "owner");
  const bad = c92b.code === "111111" ? "222222" : "111111";
  for (let i = 0; i < 5; i++) await red("UNV-092", bad, "dsk-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  const locked = await red("UNV-092", c92b.code, "dsk-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert("R16 after 5 wrong tries the code is locked (even the right code)", !locked.ok && /too many/i.test(locked.msg));
  const otherOrg = await red("UNV-092", c92b.code, "dsk-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", other.id);
  assert("R17 another organization's session cannot use this network's Station ID", !otherOrg.ok);
  const noDev = await red("UNV-092", c92b.code, "");
  assert("R18 no device identity → refused", !noDev.ok);

  m.setPlaceResolverForTests(null);
  await prisma.$disconnect();
}

pure()
  .then(dbPart)
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(process.exitCode ?? 0); });
