/**
 * Control Room — brands (owner-approved 2026-10-11) — tests. Organization → Brand → Branch on the existing Brand table.
 *  Part 1 (pure): color #RRGGBB only; code normalisation; broadcast recipients per mode (All / Brand = every branch of the
 *                 scope, offline → Not delivered without a command; Selected = checked online ones).
 *  Part 2 (real DB, only a THROWAWAY localhost DB via CR_VERIFY_DATABASE_URL): add / edit brand, duplicate code, bad color,
 *                 assign on add / edit branch, another organization's brand NEVER assignable, archived brand refused,
 *                 default Brand fallback (NULL brandId) — no branch ever disappears, brand edit scoped to the workspace.
 * Run: npx tsx scripts/verify-control-room-brands.ts
 */
import Module from "node:module";

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

async function pure(): Promise<void> {
  const b = await import("../lib/brand-management");
  assert("P1 color: only #RRGGBB (lower-cased); CSS / names / short forms refused",
    b.normalizeBrandColor("#FF375F") === "#ff375f" && b.normalizeBrandColor("red") === null && b.normalizeBrandColor("#fff") === null &&
    b.normalizeBrandColor("#ff375f;background:url(x)") === null && b.normalizeBrandColor(42) === null);
  assert("P2 code: upper-cased letters / digits / - _ (1–24)", b.normalizeBrandCode(" be ") === "BE" && b.normalizeBrandCode("yesh-hesed") === "YESH-HESED" && b.normalizeBrandCode("") === null && b.normalizeBrandCode("a b") === null && b.normalizeBrandCode("x".repeat(25)) === null);
  // broadcast recipients: the brand chosen at the top scopes the list (view: visibleRows), the panel sends to it
  type T = { id: string; brandId: string; liveBranchId: string | null };
  const rows: T[] = [{ id: "1", brandId: "BE", liveBranchId: "r1" }, { id: "2", brandId: "BE", liveBranchId: null }, { id: "3", brandId: "YH", liveBranchId: "r3" }];
  const scoped = (brand: string) => (brand === "all" ? rows : rows.filter((r) => r.brandId === brand));
  const chosen = (targets: T[], mode: "all" | "selected", selected: Set<string>) => (mode === "all" ? targets : targets.filter((t) => !!t.liveBranchId && selected.has(t.id)));
  const plan = (ts: T[]) => ts.map((t) => (t.liveBranchId ? `send:${t.id}` : `not_delivered:${t.id}`)).join(",");
  assert("P3 brand at the top → every branch of that brand: online → command, offline → Not delivered (no command)", plan(chosen(scoped("BE"), "all", new Set())) === "send:1,not_delivered:2");
  assert("P4 a brand scope never includes another brand's branch", !chosen(scoped("BE"), "all", new Set()).some((t) => t.brandId !== "BE"));
  assert("P5 All brands = every branch; Selected = only checked online ones of the scope", chosen(scoped("all"), "all", new Set()).length === 3 && plan(chosen(scoped("BE"), "selected", new Set(["1", "3"]))) === "send:1");
  const src = (await import("node:fs")).readFileSync("components/control-room/broadcast-panel.tsx", "utf8");
  const view = (await import("node:fs")).readFileSync("components/control-room/all-branches-view.tsx", "utf8");
  assert("P6 panel rule + the existing per-branch send; the view passes the brand-scoped rows and remounts per brand",
    src.includes(`const chosen = mode === "all" ? targets : online.filter((t) => selected.has(t.id));`) &&
    src.includes(`t.liveBranchId ? await sendCommandWithAck(t.liveBranchId, "PLAY_INTERRUPT", { url: jingle.url }) : { delivered: false, reason: "no_station" }`) &&
    view.includes(`const visibleRows = activeFilter === "all" ? rows : rows.filter((r) => r.brandId === activeFilter);`) &&
    /key=\{activeFilter\}\s*\n\s*targets=\{visibleRows\.map/.test(view));
}

async function dbPart(): Promise<void> {
  if (!VERIFY_URL) { console.log("SKIP  Part 2 (set CR_VERIFY_DATABASE_URL to a THROWAWAY database with all migrations)"); return; }
  if (!VERIFY_SAFE) { assert("Part 2 refuses a non-throwaway database", false, "refused"); return; }
  const { prisma } = await import("../lib/prisma");
  const m = await import("../lib/branch-management");
  const b = await import("../lib/brand-management");
  m.setPlaceResolverForTests(async (id) => ({ ok: true, place: { placeId: String(id), formattedAddress: "x", city: "Tel Aviv", country: "Israel", street: "", houseNumber: "", latitude: 32, longitude: 34.8 } }));
  const t = Date.now();
  const ws = await prisma.workspace.create({ data: { name: "Universe", slug: `br-${t}`, owner: { create: { email: `br-${t}@example.test` } } } as never });
  const other = await prisma.workspace.create({ data: { name: "Other", slug: `br-o-${t}`, owner: { create: { email: `br-o-${t}@example.test` } } } as never });
  const err = (p: Promise<unknown>) => p.then(() => null, (e: Error & { status?: number }) => ({ msg: e.message, status: e.status }));

  // a legacy branch with NULL brandId (pre-F1 row) + a branch created the normal way (default brand)
  const legacy = await prisma.branch.create({ data: { workspaceId: ws.id, name: "Legacy", locationCode: "001", brandId: null } as never });
  const plain = await m.createBranch(ws.id, { name: "Plain", branchNumber: "002", placeId: "ChIJplain_place_0001" });
  const l0 = await b.listBrands(ws.id);
  assert("D1 default Brand exists; every branch maps to a brand (NULL → default) — none disappears",
    l0.brands.length === 1 && l0.brands[0].isDefault && l0.branchBrand[legacy.id] === l0.defaultBrandId && l0.branchBrand[plain.id] === l0.defaultBrandId && l0.brands[0].branchCount === 2);

  const be = await b.createBrand(ws.id, { name: "BE", code: "be", color: "#0A84FF" });
  const yh = await b.createBrand(ws.id, { name: "יש חסד", code: "YH", color: "#ff375f" });
  const row = await prisma.brand.findUniqueOrThrow({ where: { id: be.id } });
  assert("D2 add brand: name / code (upper) / color (lower) / not default", row.code === "BE" && row.color === "#0a84ff" && !row.isDefault && row.workspaceId === ws.id);
  const dup = await err(b.createBrand(ws.id, { name: "Be again", code: "BE", color: "#000000" }));
  assert("D3 duplicate code in the same organization → refused (409)", dup?.status === 409);
  const sameCodeOtherOrg = await b.createBrand(other.id, { name: "BE other", code: "BE", color: "#111111" });
  assert("D4 the same code is allowed in ANOTHER organization (codes are per organization)", !!sameCodeOtherOrg.id);
  assert("D5 bad color / missing name refused", !!(await err(b.createBrand(ws.id, { name: "X", code: "X1", color: "blue" }))) && !!(await err(b.createBrand(ws.id, { name: " ", code: "X2", color: "#123456" }))));

  await b.updateBrand(ws.id, be.id, { name: "BE Fashion", code: "BEF", color: "#30d158" });
  const be2 = await prisma.brand.findUniqueOrThrow({ where: { id: be.id } });
  assert("D6 edit brand: name / code / color updated", be2.name === "BE Fashion" && be2.code === "BEF" && be2.color === "#30d158");
  const crossEdit = await err(b.updateBrand(other.id, be.id, { name: "hijack", code: "HJ", color: "#000000" }));
  assert("D7 another organization cannot edit this brand (404) and nothing changed", crossEdit?.status === 404 && (await prisma.brand.findUniqueOrThrow({ where: { id: be.id } })).name === "BE Fashion");

  const nb = await m.createBranch(ws.id, { name: "BE Ashdod", branchNumber: "010", placeId: "ChIJbe_ashdod_00001", brandId: be.id });
  assert("D8 add branch WITH a brand → stored", (await prisma.branch.findUniqueOrThrow({ where: { id: nb.id } })).brandId === be.id);
  await m.updateBranch(ws.id, plain.id, { name: "Plain", branchNumber: "002", brandId: yh.id });
  assert("D9 edit branch → brand changed", (await prisma.branch.findUniqueOrThrow({ where: { id: plain.id } })).brandId === yh.id);
  await m.updateBranch(ws.id, plain.id, { name: "Plain renamed", branchNumber: "002" });
  assert("D10 edit without brandId keeps the brand", (await prisma.branch.findUniqueOrThrow({ where: { id: plain.id } })).brandId === yh.id);

  const foreignOnCreate = await err(m.createBranch(ws.id, { name: "Bad", branchNumber: "011", placeId: "ChIJbad_place_00001", brandId: sameCodeOtherOrg.id }));
  assert("D11 another organization's brand is NEVER assignable on add (404) — nothing created", foreignOnCreate?.status === 404 && !(await prisma.branch.findFirst({ where: { workspaceId: ws.id, locationCode: "011" } })));
  const foreignOnEdit = await err(m.updateBranch(ws.id, plain.id, { name: "Plain renamed", branchNumber: "002", brandId: sameCodeOtherOrg.id }));
  assert("D12 … nor on edit (404) — brand unchanged", foreignOnEdit?.status === 404 && (await prisma.branch.findUniqueOrThrow({ where: { id: plain.id } })).brandId === yh.id);
  const garbage = await err(m.updateBranch(ws.id, plain.id, { name: "Plain renamed", branchNumber: "002", brandId: "not-a-brand" }));
  assert("D13 unknown brand id refused", garbage?.status === 404);
  await prisma.brand.update({ where: { id: yh.id }, data: { archivedAt: new Date() } });
  const archived = await err(m.updateBranch(ws.id, legacy.id, { name: "Legacy", branchNumber: "001", brandId: yh.id }));
  const l1 = await b.listBrands(ws.id);
  assert("D14 archived brand not assignable; its branch falls back to the default Brand in the list (never disappears)",
    archived?.status === 404 && l1.branchBrand[plain.id] === l1.defaultBrandId && Object.keys(l1.branchBrand).length === 3);
  assert("D15 listBrands is scoped: no brand of another organization", !l1.brands.some((x) => x.id === sameCodeOtherOrg.id));

  m.setPlaceResolverForTests(null);
  await prisma.$disconnect();
}

pure().then(dbPart).catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(process.exitCode ?? 0); });
