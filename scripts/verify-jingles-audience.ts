/**
 * Jingles Stage 1 — origin + audience (owner 2026-10-12). Run: npx tsx scripts/verify-jingles-audience.ts
 *  Part 1 (no DB): the eligibility / permission rules (lib/jingles/audience.ts) — every audience, two brands, two
 *    regions, a branch with no location, branch user vs HQ, brand safety, region = the map's resolver.
 *  Part 2 (THROWAWAY localhost DB via CR_VERIFY_DATABASE_URL, all migrations applied): the real routes
 *    (GET / POST /api/jingles/library, PATCH /api/jingles/library/<id>) with real users + the existing permission
 *    mechanism (WorkspaceMember role → OWNER / BRANCH_USER, UserBranchAssignment). Only the session lookup is stubbed.
 */
import Module from "node:module";
import path from "node:path";

const VERIFY_URL = process.env.CR_VERIFY_DATABASE_URL ?? "";
const VERIFY_SAFE = !!VERIFY_URL && ["localhost", "127.0.0.1"].includes(new URL(VERIFY_URL).hostname) && !/syncbiz_dev|railway|rlwy|production/i.test(VERIFY_URL);
process.env.DATABASE_URL = VERIFY_SAFE ? VERIFY_URL : "postgresql://nobody:none@127.0.0.1:1/none";

let sessionUser: { id: string; tenantId: string } | null = null;
{
  const Mo = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
  const stub = (id: string, exports: unknown) => { const m = new Module(id) as unknown as { loaded: boolean; exports: unknown }; m.loaded = true; m.exports = exports; Mo._cache[id] = m; };
  stub("stub:server-only", {});
  stub("stub:auth-helpers", { getCurrentUserFromApiRequest: async () => sessionUser, getCurrentUserFromCookies: async () => sessionUser });
  const authHelpersFile = path.resolve(__dirname, "../lib/auth-helpers.ts");
  const orig = Mo._resolveFilename;
  Mo._resolveFilename = function (r: string, ...rest: unknown[]) {
    if (r === "server-only") return "stub:server-only";
    if (r === "@/lib/auth-helpers") return "stub:auth-helpers";
    const res = orig.call(this, r, ...rest);
    return res === authHelpersFile ? "stub:auth-helpers" : res;
  };
}

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

async function main() {
  const A = await import("../lib/jingles/audience");
  const { branchRegion } = await import("../lib/control-room-regions");

  // ── Part 1: rules ────────────────────────────────────────────────────────────────────────────────────────────
  // two brands (A, B), two regions (south: Beersheba, north: Haifa area), a branch with no location
  const facts = {
    aSouth: A.branchFacts({ id: "aS", brandId: "A", latitude: 31.2518, longitude: 34.7913 }, "DEF"),
    aNorth: A.branchFacts({ id: "aN", brandId: "A", latitude: 32.794, longitude: 34.9896 }, "DEF"),
    bSouth: A.branchFacts({ id: "bS", brandId: "B", latitude: 31.2518, longitude: 34.7913 }, "DEF"),
    aNoLoc: A.branchFacts({ id: "aX", brandId: "A", latitude: null, longitude: null }, "DEF"),
    defSouth: A.branchFacts({ id: "dS", brandId: null, latitude: 31.2518, longitude: 34.7913 }, "DEF"),
  };
  const all = Object.values(facts);
  const J = (audience: string, x: Partial<{ b: string; br: string; r: string }> = {}) =>
    A.rowAudience({ audience, audienceBranchId: x.b ?? null, audienceBrandId: x.br ?? null, audienceRegion: x.r ?? null });
  const who = (j: ReturnType<typeof J>) => all.filter((b) => A.isEligibleForBranch(j, b)).map((b) => b.id).join(",");

  assert("R1 region of a branch = the MAP's resolver (same lat / lng → same key)",
    facts.aSouth.regionId === branchRegion(31.2518, 34.7913).regionId && facts.aSouth.regionId === "south" && facts.aNorth.regionId === "haifa" && facts.aNoLoc.regionId === null);
  assert("R2 NETWORK → every branch", who(J("NETWORK")) === "aS,aN,bS,aX,dS");
  assert("R3 UNASSIGNED → no branch, not playable", who(J("UNASSIGNED")) === "" && !A.isPlayable(J("UNASSIGNED")) && A.isPlayable(J("NETWORK")));
  assert("R4 LOCAL → exactly its branch", who(J("LOCAL", { b: "aN" })) === "aN");
  assert("R5 BRAND A → only brand-A branches (incl. the one without location)", who(J("BRAND", { br: "A" })) === "aS,aN,aX");
  assert("R6 REGION south → every brand in the south, never a branch without location", who(J("REGION", { r: "south" })) === "aS,bS,dS");
  assert("R7 BRAND_REGION A · south → brand AND region must match", who(J("BRAND_REGION", { br: "A", r: "south" })) === "aS");
  assert("R8 a branch with no brand counts as the DEFAULT brand", who(J("BRAND", { br: "DEF" })) === "dS");
  // brand safety: across every audience shape, a B-brand jingle never reaches an A branch and vice versa
  const brandShaped = [J("BRAND", { br: "B" }), J("BRAND_REGION", { br: "B", r: "south" }), J("BRAND_REGION", { br: "B", r: "haifa" })];
  const aBranches = all.filter((b) => b.brandId === "A");
  assert("R9 BRAND SAFETY: no Brand-B jingle is ever eligible for a Brand-A branch (and A → B)",
    brandShaped.every((j) => aBranches.every((b) => !A.isEligibleForBranch(j, b))) &&
    [J("BRAND", { br: "A" }), J("BRAND_REGION", { br: "A", r: "south" })].every((j) => !A.isEligibleForBranch(j, facts.bSouth)));
  assert("R10 a legacy row without an audience reads as UNASSIGNED (never NETWORK)", A.rowAudience({ audience: null, audienceBranchId: null, audienceBrandId: null, audienceRegion: null }).audience === "UNASSIGNED");

  const ctx = { branchIds: new Set(["aS", "aN", "bS", "aX", "dS"]), brandIds: new Set(["A", "B", "DEF"]) };
  const v = (x: Record<string, unknown>) => A.validateAudience(x, ctx);
  assert("R11 validation: each audience needs its fields; foreign / unknown ids and display text refused; stray fields dropped",
    !v({ audience: "BRAND" }).ok && !v({ audience: "BRAND", audienceBrandId: "Z" }).ok && !v({ audience: "LOCAL", audienceBranchId: "zz" }).ok &&
    !v({ audience: "REGION", audienceRegion: "דרום" }).ok && !v({ audience: "REGION", audienceRegion: "South" }).ok && !v({ audience: "GLOBAL" }).ok &&
    (() => { const r = v({ audience: "NETWORK", audienceBrandId: "A", audienceRegion: "south", audienceBranchId: "aS" }); return r.ok && r.value.audienceBrandId === null && r.value.audienceRegion === null && r.value.audienceBranchId === null; })());
  const HQ = { kind: "HQ" as const }, BM = { kind: "BRANCH" as const, branchIds: ["aS"] };
  const ok = (x: Record<string, unknown>) => { const r = v(x); if (!r.ok) throw new Error(r.error); return r.value; };
  assert("R12 branch user: LOCAL for ITS branch only; never another branch / BRAND / REGION / BRAND_REGION / NETWORK",
    A.canCreate(BM, ok({ audience: "LOCAL", audienceBranchId: "aS" })) && !A.canCreate(BM, ok({ audience: "LOCAL", audienceBranchId: "aN" })) &&
    !A.canCreate(BM, ok({ audience: "BRAND", audienceBrandId: "A" })) && !A.canCreate(BM, ok({ audience: "REGION", audienceRegion: "south" })) &&
    !A.canCreate(BM, ok({ audience: "BRAND_REGION", audienceBrandId: "A", audienceRegion: "south" })) && !A.canCreate(BM, ok({ audience: "NETWORK" })));
  assert("R13 HQ may create every audience; only HQ may change audience / promote",
    (["UNASSIGNED", "NETWORK"] as const).every((a) => A.canCreate(HQ, ok({ audience: a }))) && A.canCreate(HQ, ok({ audience: "REGION", audienceRegion: "south" })) &&
    A.canChangeAudience(HQ) && !A.canChangeAudience(BM));

  // ── Part 2: real routes on a throwaway DB ────────────────────────────────────────────────────────────────────
  if (!VERIFY_SAFE) {
    console.log("SKIP  Part 2 (set CR_VERIFY_DATABASE_URL to a THROWAWAY localhost database with all migrations)");
    console.log(`\n${pass} passed, ${fail} failed`);
    return;
  }
  const { prisma } = await import("../lib/prisma");
  const lib = await import("../app/api/jingles/library/route");
  const one = await import("../app/api/jingles/library/[id]/route");
  const run = Date.now().toString(36);
  const owner = await prisma.user.create({ data: { email: `owner-${run}@verify.local`, role: "CONTROLLER" } });
  const ws = await prisma.workspace.create({ data: { name: "JA " + run, slug: "ja-" + run, ownerId: owner.id } });
  const bA = await prisma.brand.create({ data: { workspaceId: ws.id, name: "Brand A", code: "A" + run, isDefault: true } });
  const bB = await prisma.brand.create({ data: { workspaceId: ws.id, name: "Brand B", code: "B" + run } });
  const mk = (name: string, brandId: string | null, lat: number | null, lng: number | null) =>
    prisma.branch.create({ data: { workspaceId: ws.id, name, brandId, latitude: lat, longitude: lng } });
  const aS = await mk("A south", bA.id, 31.2518, 34.7913), aN = await mk("A north", bA.id, 32.794, 34.9896);
  const bS = await mk("B south", bB.id, 31.2518, 34.7913), aX = await mk("A no location", bA.id, null, null);
  const user = async (email: string, role: "WORKSPACE_ADMIN" | "CONTROLLER", branchIds: string[]) => {
    const u = await prisma.user.create({ data: { email: `${email}-${run}@verify.local`, role: "CONTROLLER" } });
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: u.id, role } });
    for (const b of branchIds) await prisma.userBranchAssignment.create({ data: { workspaceId: ws.id, userId: u.id, branchId: b } });
    return { id: u.id, tenantId: ws.id };
  };
  const hq = await user("hq", "WORKSPACE_ADMIN", []);
  const mgrA = await user("mgr-a-south", "CONTROLLER", [aS.id]);
  const mgrB = await user("mgr-b-south", "CONTROLLER", [bS.id]);

  const url = () => `/api/jingles/audio/${crypto.randomUUID()}`;
  const req = (method: string, path: string, body?: unknown) =>
    new Request("http://localhost:3000" + path, { method, headers: { "content-type": "application/json", host: "localhost:3000" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const post = async (who: typeof hq, body: Record<string, unknown>) => { sessionUser = who; const r = await lib.POST(req("POST", "/api/jingles/library", { title: "t", url: url(), ...body })); return { status: r.status, j: await r.json() }; };
  const get = async (who: typeof hq, branchId?: string) => { sessionUser = who; const r = await lib.GET(req("GET", "/api/jingles/library" + (branchId ? `?branchId=${branchId}` : ""))); return { status: r.status, j: await r.json() }; };
  const patch = async (who: typeof hq, id: string, body: Record<string, unknown>) => { sessionUser = who; const r = await one.PATCH(req("PATCH", `/api/jingles/library/${id}`, body), { params: Promise.resolve({ id }) }); return { status: r.status, j: await r.json() }; };

  // HQ creates all 6 audiences
  const net = await post(hq, { audience: "NETWORK" });
  const una = await post(hq, {}); // no audience → UNASSIGNED
  const brA = await post(hq, { audience: "BRAND", audienceBrandId: bA.id });
  const brB = await post(hq, { audience: "BRAND", audienceBrandId: bB.id });
  const regS = await post(hq, { audience: "REGION", audienceRegion: "south" });
  const brrAS = await post(hq, { audience: "BRAND_REGION", audienceBrandId: bA.id, audienceRegion: "south" });
  const brrBS = await post(hq, { audience: "BRAND_REGION", audienceBrandId: bB.id, audienceRegion: "south" });
  const locAN = await post(hq, { audience: "LOCAL", audienceBranchId: aN.id });
  assert("D1 HQ creates all 6 audiences; no audience → UNASSIGNED; HQ origin = NULL",
    [net, una, brA, brB, regS, brrAS, brrBS, locAN].every((x) => x.status === 201) && una.j.item.audience === "UNASSIGNED" && net.j.item.originBranchId === null && net.j.item.audience === "NETWORK");

  // branch manager (A south)
  const mLocal = await post(mgrA, {}); // no audience, one branch → LOCAL to it
  const mOther = await post(mgrA, { audience: "LOCAL", audienceBranchId: aN.id });
  const mBrand = await post(mgrA, { audience: "BRAND", audienceBrandId: bA.id });
  const mNet = await post(mgrA, { audience: "NETWORK" });
  const mRegion = await post(mgrA, { audience: "REGION", audienceRegion: "south" });
  assert("D2 branch manager: LOCAL to ITS branch (origin = that branch); other branch / BRAND / NETWORK / REGION → 403",
    mLocal.status === 201 && mLocal.j.item.audience === "LOCAL" && mLocal.j.item.audienceBranchId === aS.id && mLocal.j.item.originBranchId === aS.id &&
    mOther.status === 403 && mBrand.status === 403 && mNet.status === 403 && mRegion.status === 403);

  const ids = (x: { j: { items: { id: string }[] } }) => new Set(x.j.items.map((i) => i.id));
  const gAS = ids(await get(hq, aS.id)), gBS = ids(await get(hq, bS.id)), gAX = ids(await get(hq, aX.id)), gAN = ids(await get(hq, aN.id));
  const has = (s: Set<string>, x: { j: { item: { id: string } } }) => s.has(x.j.item.id);
  assert("D3 A-south gets NETWORK + BRAND A + REGION south + BRAND_REGION A·south + its LOCAL; never UNASSIGNED / Brand B",
    has(gAS, net) && has(gAS, brA) && has(gAS, regS) && has(gAS, brrAS) && has(gAS, mLocal) && !has(gAS, una) && !has(gAS, brB) && !has(gAS, brrBS) && !has(gAS, locAN));
  assert("D4 BRAND SAFETY: B-south never gets a Brand-A jingle; A branches never get a Brand-B jingle",
    !has(gBS, brA) && !has(gBS, brrAS) && !has(gBS, mLocal) && has(gBS, brB) && has(gBS, brrBS) && has(gBS, regS) &&
    [gAS, gAN, gAX].every((s) => !has(s, brB) && !has(s, brrBS)));
  assert("D5 a branch with no location: NETWORK / BRAND / LOCAL only — never REGION / BRAND_REGION",
    has(gAX, net) && has(gAX, brA) && !has(gAX, regS) && !has(gAX, brrAS));
  assert("D6 A-north (Haifa) is not in the south: no REGION south / BRAND_REGION A·south; gets its LOCAL",
    !has(gAN, regS) && !has(gAN, brrAS) && has(gAN, locAN) && has(gAN, brA));

  const hqAll = await get(hq), mgrAll = await get(mgrA), mgrBAll = await get(mgrB), mgrForeign = await get(mgrA, bS.id);
  assert("D7 HQ sees the whole library incl. UNASSIGNED (playable:false); a manager never sees UNASSIGNED or another brand's jingles",
    has(ids(hqAll), una) && hqAll.j.items.find((i: { id: string }) => i.id === una.j.item.id).playable === false &&
    !has(ids(mgrAll), una) && !has(ids(mgrAll), brB) && !has(ids(mgrBAll), brA) && !has(ids(mgrBAll), mLocal) && mgrForeign.status === 403);

  // promote: same row, same id, HQ only
  const denied = await patch(mgrA, mLocal.j.item.id, { audience: "NETWORK" });
  const promoted = await patch(hq, mLocal.j.item.id, { audience: "BRAND", audienceBrandId: bA.id });
  const count = await prisma.announcement.count({ where: { workspaceId: ws.id, announcementType: "jingle" } });
  const gAN2 = ids(await get(hq, aN.id)), gBS2 = ids(await get(hq, bS.id));
  assert("D8 promote LOCAL → BRAND: branch manager 403; HQ OK — SAME id, no copy, origin kept, now reaches brand-A branches only",
    denied.status === 403 && promoted.status === 200 && promoted.j.item.id === mLocal.j.item.id && promoted.j.item.originBranchId === aS.id &&
    count === 9 && gAN2.has(mLocal.j.item.id) && !gBS2.has(mLocal.j.item.id));
  const toRegion = await patch(hq, mLocal.j.item.id, { audience: "BRAND_REGION", audienceBrandId: bA.id, audienceRegion: "south" });
  const toNet = await patch(hq, una.j.item.id, { audience: "NETWORK" });
  const bad = await patch(hq, una.j.item.id, { audience: "REGION", audienceRegion: "South" });
  const audit = await prisma.auditLog.count({ where: { workspaceId: ws.id, action: "jingle.audience_change" } });
  assert("D9 promote to BRAND_REGION / UNASSIGNED → NETWORK work; a display-text region is refused; every change audited",
    toRegion.status === 200 && toRegion.j.item.audienceRegion === "south" && toNet.status === 200 && toNet.j.item.playable === true && bad.status === 400 && audit === 3);
  const legacy = await prisma.announcement.findMany({ where: { workspaceId: ws.id, announcementType: "jingle" }, select: { branchId: true } });
  assert("D10 legacy branchId still written as before (canonical / 'default'), untouched by audience / origin", legacy.every((r) => typeof r.branchId === "string" && r.branchId.length > 0));
  sessionUser = null;
  const anon = await lib.GET(req("GET", "/api/jingles/library"));
  assert("D11 unauthenticated → 401", anon.status === 401);
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
