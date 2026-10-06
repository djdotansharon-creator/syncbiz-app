/**
 * CONTROL ROOM GATE 2B-1 — content compatibility (legacy "default" ≡ workspace canonical branch). NO data change.
 *
 * Runs the REAL helpers / pad flows / library notification against an in-memory fake Prisma (installed on
 * globalThis BEFORE the modules load) and a stubbed fetch — no database, no network.
 *   - jingle pads: legacy read, canonical read, legacy update (no duplicate), canonical update, conflict fail-safe,
 *     new pad canonical, unrelated branches isolated, concurrent-create race
 *   - canonical writes: legacy key → canonical (same workspace only); other branches unchanged
 *   - zero-assignment fallback / reads accept both aliases; schedule validator equivalence
 *   - LIBRARY_UPDATED still reaches legacy clients (canonical → "default")
 *   - static wiring of every changed write/read path + scope guards
 * Run: npx tsx scripts/verify-gate2b1-content-compat.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf-8").replace(/\r\n/g, "\n");

const WS = "31d30e23-8f4a-4bf2-a1df-c707b69b5673";
const CANON = "90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2";
const WS2 = "ws-two-0000";
const CANON2 = "c2c2c2c2-0000-4000-8000-000000000002";
const WS_NO_CANON = "ws-without-canonical";

// ── fake Prisma: only the Branch lookups the resolver performs ───────────────────────────────────────────────────
const branches = [
  { id: CANON, workspaceId: WS, legacyKey: "default" },
  { id: CANON2, workspaceId: WS2, legacyKey: "default" },
  { id: "branch-other", workspaceId: WS, legacyKey: null },
];
let branchFindFails = false;
(globalThis as unknown as { prisma: unknown }).prisma = {
  branch: {
    findUnique: async ({ where }: { where: { id?: string; workspaceId_legacyKey?: { workspaceId: string; legacyKey: string } } }) => {
      if (branchFindFails) throw new Error("db down");
      if (where.id) return branches.find((b) => b.id === where.id) ?? null;
      const k = where.workspaceId_legacyKey!;
      return branches.find((b) => b.workspaceId === k.workspaceId && b.legacyKey === k.legacyKey) ?? null;
    },
  },
};

type Row = { id: string; workspaceId: string; branchId: string; padId: string; label: string; url: string; color: string | null; bellStyle: string | null; preRoll: boolean };
function padRepo(rows: Row[], opts: { raceOnce?: Row } = {}) {
  let n = 0;
  let race = opts.raceOnce;
  return {
    rows,
    findMany: async (w: { workspaceId: string; branchIds: string[]; padId?: string }) =>
      rows.filter((r) => r.workspaceId === w.workspaceId && w.branchIds.includes(r.branchId) && (!w.padId || r.padId === w.padId)),
    update: async (id: string, data: Partial<Row>) => { const r = rows.find((x) => x.id === id)!; Object.assign(r, data); return r; },
    create: async (data: Omit<Row, "id">) => {
      if (race) { rows.push(race); race = undefined; throw Object.assign(new Error("unique"), { code: "P2002" }); }
      if (rows.some((r) => r.workspaceId === data.workspaceId && r.branchId === data.branchId && r.padId === data.padId)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const r = { id: `new-${++n}`, ...data }; rows.push(r); return r;
    },
  };
}
const pad = (id: string, branchId: string, padId: string, url = "/a", ws = WS): Row =>
  ({ id, workspaceId: ws, branchId, padId, label: padId, url, color: null, bellStyle: null, preRoll: false });
const data = { label: "L", url: "/api/jingles/audio/x", color: null, bellStyle: null, preRoll: false };

(async () => {
  const R = await import("../lib/branch-resolver");
  const P = await import("../lib/jingle-pad-compat");

  // ── canonical write / equivalence helpers ─────────────────────────────────────────────────────────────────
  assert("write: 'default' → canonical (migrated workspace)", (await R.canonicalContentBranchForWrite(WS, "default")) === CANON);
  assert("write: empty → canonical", (await R.canonicalContentBranchForWrite(WS, "")) === CANON);
  assert("write: canonical stays canonical", (await R.canonicalContentBranchForWrite(WS, CANON)) === CANON);
  assert("write: unrelated branch unchanged", (await R.canonicalContentBranchForWrite(WS, "branch-other")) === "branch-other");
  assert("write: workspace without canonical keeps 'default'", (await R.canonicalContentBranchForWrite(WS_NO_CANON, "default")) === "default");
  assert("write: never another workspace's canonical", (await R.canonicalContentBranchForWrite(WS2, "default")) === CANON2);
  assert("equivalent: default ≡ canonical (same workspace)", (await R.contentBranchesEquivalent(WS, "default", CANON)) && (await R.contentBranchesEquivalent(WS, CANON, "default")));
  assert("equivalent: other workspace's canonical is NOT equivalent", !(await R.contentBranchesEquivalent(WS, "default", CANON2)));
  assert("equivalent: unrelated branches isolated", !(await R.contentBranchesEquivalent(WS, "branch-other", "default")) && !(await R.contentBranchesEquivalent(WS, "branch-other", CANON)));
  assert("equivalent: no workspace → exact match only", !(await R.contentBranchesEquivalent(null, "default", CANON)) && (await R.contentBranchesEquivalent(null, CANON, CANON)));
  const zero = await R.expandLegacyBranchEquivalents(WS, ["default"]);
  assert("zero-assignment fallback set = {default, canonical} only", zero.length === 2 && zero.includes("default") && zero.includes(CANON));
  assert("read set for an unrelated branch stays isolated", JSON.stringify(await R.expandLegacyBranchEquivalents(WS, ["branch-other"])) === JSON.stringify(["branch-other"]));

  // ── jingle pads ────────────────────────────────────────────────────────────────────────────────────────────
  const ids = await R.expandLegacyBranchEquivalents(WS, ["default"]);
  const writeBranchId = await R.canonicalContentBranchForWrite(WS, "default");
  {
    const repo = padRepo([pad("p1", "default", "pad-promo"), pad("p2", "default", "pad-closing"), pad("p3", "default", "pad-birthday")]);
    const r = await P.readPads(repo, WS, ids);
    assert("pads: all 3 legacy pads read (today's TEST state)", r.pads.length === 3 && r.conflicts.length === 0);
  }
  {
    const repo = padRepo([pad("c1", CANON, "pad-promo"), pad("l1", "default", "pad-closing")]);
    const r = await P.readPads(repo, WS, ids);
    assert("pads: canonical + legacy rows read together, no duplicates", r.pads.length === 2 && r.pads.map((x) => x.id).sort().join() === "c1,l1");
  }
  {
    const repo = padRepo([pad("p1", "default", "pad-promo")]);
    const w = await P.writePad(repo, { workspaceId: WS, padId: "pad-promo", data, branchIds: ids, writeBranchId });
    assert("pads: legacy pad update edits the SAME row (no canonical duplicate)", w.ok && w.row.id === "p1" && repo.rows.length === 1 && repo.rows[0].branchId === "default" && repo.rows[0].url === data.url);
  }
  {
    const repo = padRepo([pad("c1", CANON, "pad-promo")]);
    const w = await P.writePad(repo, { workspaceId: WS, padId: "pad-promo", data, branchIds: ids, writeBranchId });
    assert("pads: canonical pad update works", w.ok && w.row.id === "c1" && repo.rows.length === 1);
  }
  {
    const repo = padRepo([pad("l1", "default", "pad-promo"), pad("c1", CANON, "pad-promo"), pad("x", "default", "pad-closing")]);
    const r = await P.readPads(repo, WS, ids);
    assert("pads: same pad under BOTH aliases → reported conflict, not guessed (other pads still returned)", r.conflicts.join() === "pad-promo" && r.pads.length === 1 && r.pads[0].padId === "pad-closing");
    const w = await P.writePad(repo, { workspaceId: WS, padId: "pad-promo", data, branchIds: ids, writeBranchId });
    assert("pads: write on conflicting pad fails safe (no write)", !w.ok && repo.rows.length === 3 && repo.rows.every((x) => x.url !== data.url));
  }
  {
    const repo = padRepo([pad("p1", "default", "pad-promo")]);
    const w = await P.writePad(repo, { workspaceId: WS, padId: "pad-birthday", data, branchIds: ids, writeBranchId });
    assert("pads: new pad (no equivalent) is created CANONICAL", w.ok && w.row.branchId === CANON && repo.rows.length === 2);
  }
  {
    const nids = await R.expandLegacyBranchEquivalents(WS_NO_CANON, ["default"]);
    const repo = padRepo([]);
    const w = await P.writePad(repo, { workspaceId: WS_NO_CANON, padId: "pad-promo", data, branchIds: nids, writeBranchId: await R.canonicalContentBranchForWrite(WS_NO_CANON, "default") });
    assert("pads: workspace without canonical keeps legacy behavior ('default')", w.ok && w.row.branchId === "default");
  }
  {
    const repo = padRepo([pad("o1", "branch-other", "pad-promo"), pad("w2", CANON2, "pad-promo", "/a", WS2)]);
    const r = await P.readPads(repo, WS, ids);
    assert("pads: unrelated branch + other workspace isolated", r.pads.length === 0);
  }
  {
    const repo = padRepo([], { raceOnce: pad("race", CANON, "pad-promo") });
    const w = await P.writePad(repo, { workspaceId: WS, padId: "pad-promo", data, branchIds: ids, writeBranchId });
    assert("pads: concurrent first-create race → re-planned as update (single row)", w.ok && w.row.id === "race" && repo.rows.length === 1);
  }

  // ── library notification keeps reaching legacy (beta.10) clients ───────────────────────────────────────────
  process.env.SYNCBIZ_WS_SECRET = "test-secret-not-real-0123456789";
  process.env.NEXT_PUBLIC_WS_URL = "ws://ws.invalid";
  const sent: { url: string; body: { branchId?: string } }[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => "" };
  };
  const { notifyLibraryUpdated } = await import("../lib/broadcast-library-updated");
  await notifyLibraryUpdated("user-1", { branchId: CANON, entityType: "playlist", action: "updated" });
  await notifyLibraryUpdated("user-1", { branchId: "default", entityType: "playlist", action: "created" });
  await notifyLibraryUpdated("user-1", { branchId: "branch-other", entityType: "playlist", action: "created" });
  await notifyLibraryUpdated("user-1", {});
  assert("library-updated: canonical row → sent as legacy 'default' (reaches beta.10 / renderer)", sent[0]?.body.branchId === "default" && sent[0]?.url.endsWith("/internal/library-updated"));
  assert("library-updated: 'default' / unrelated / missing unchanged", sent[1]?.body.branchId === "default" && sent[2]?.body.branchId === "branch-other" && sent[3]?.body.branchId === "default");
  branchFindFails = true;
  await notifyLibraryUpdated("user-1", { branchId: "uncached-branch-id", entityType: "playlist" });
  assert("library-updated: DB error never blocks the notification (falls back to the id)", sent[4]?.body.branchId === "uncached-branch-id");
  branchFindFails = false;

  // ── static wiring ──────────────────────────────────────────────────────────────────────────────────────────
  const route = read("app", "api", "jingles", "pads", "route.ts");
  assert("pads route: no literal-'default' Prisma filter/upsert left", !/branchId: DEFAULT_BRANCH_ID/.test(route) && !/upsert\(/.test(route));
  assert("pads route: reads alias set + writes via writePad + 409 on conflict",
    /expandLegacyBranchEquivalents\(user\.tenantId, \[DEFAULT_BRANCH_ID\]\)/.test(route) && /readPads\(padRepo/.test(route) && /writePad\(padRepo/.test(route) && /status: 409/.test(route));
  assert("playlists: createPlaylist canonicalizes (null stays null)", /branchId: normalized\.branchId \? await canonicalContentBranchForWrite\(wsId, normalized\.branchId\) : null/.test(read("lib", "playlist-store.ts")));
  assert("sources: addSource canonicalizes", /branchId: await canonicalContentBranchForWrite\(wsId, input\.branchId \?\? "default"\)/.test(read("lib", "store.ts")));
  assert("radio: canonicalized BEFORE the Branch upsert (no stub for migrated workspace)",
    /const branchId = await canonicalContentBranchForWrite\(wsId,[^\n]*\n\n  \/\/ Ensure branch stub exists/.test(read("lib", "radio-store.ts")));
  assert("jingle library: new jingles canonical", /branchId: await canonicalContentBranchForWrite\(user\.tenantId, "default"\)/.test(read("app", "api", "jingles", "library", "route.ts")));
  assert("playlist-access: zero-assignment fallback expanded (alias only)",
    /: new Set\(await expandLegacyBranchEquivalents\(workspaceId, \[DEFAULT_BRANCH_ID\]\)\)/.test(read("lib", "playlist-access.ts")));
  const val = read("lib", "schedule-target-validator.ts");
  assert("schedule validator: all 3 target types alias-aware (no exact !==)", (val.match(/contentBranchesEquivalent\(workspaceId, /g) ?? []).length === 3 && !/Branch !== bid/.test(val));
  assert("schedule routes pass the caller workspace", /validateScheduleTarget\([^\n]*, user\.tenantId\);/.test(read("app", "api", "schedules", "route.ts")) &&
    /validateScheduleTarget\([^\n]*, user\.tenantId\);/.test(read("app", "api", "schedules", "[id]", "route.ts")));

  // ── scope guards ───────────────────────────────────────────────────────────────────────────────────────────
  assert("content resolver mode unchanged (shadow)", /export const BRANCH_RESOLUTION_RUNTIME_MODE: BranchResolutionMode = "shadow";/.test(read("lib", "branch-resolver.ts")));
  assert("WS server not touched by 2B-1 (no content-compat helpers there)", !/legacyClientBranchKey|canonicalContentBranchForWrite/.test(read("server", "index.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
})();
