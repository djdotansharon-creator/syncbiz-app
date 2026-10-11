/**
 * Security hotfix 2026-10-11 — /api/announcements + /api/logs. Run: npx tsx scripts/verify-announcements-security.ts
 *  Part 1 (no DB): unauthenticated GET announcements → 401; unauthenticated GET logs → 401; POST announcements → 405;
 *                  store.getAnnouncements without / with an unknown workspace → [] (never "every workspace").
 *  Part 2 (THROWAWAY localhost DB via CR_VERIFY_DATABASE_URL): workspace A never sees workspace B and vice versa; a signed-in
 *                  user still gets their own announcements (jingle rows stay excluded); signed-in GET logs → 200.
 * The session is simulated by stubbing @/lib/auth-helpers (getCurrentUserFromCookies) — nothing else is mocked.
 */
import Module from "node:module";
import path from "node:path";

const VERIFY_URL = process.env.CR_VERIFY_DATABASE_URL ?? "";
const VERIFY_SAFE = !!VERIFY_URL && ["localhost", "127.0.0.1"].includes(new URL(VERIFY_URL).hostname) && !/syncbiz_dev|railway|rlwy|production/i.test(VERIFY_URL);
process.env.DATABASE_URL = VERIFY_SAFE ? VERIFY_URL : "postgresql://nobody:none@127.0.0.1:1/none";

// simulated session: the test sets `sessionUser` before each request
let sessionUser: { id: string; tenantId: string } | null = null;
{
  const Mo = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
  const stub = (id: string, exports: unknown) => { const m = new Module(id) as unknown as { loaded: boolean; exports: unknown }; m.loaded = true; m.exports = exports; Mo._cache[id] = m; };
  stub("stub:server-only", {});
  stub("stub:auth-helpers", { getCurrentUserFromCookies: async () => sessionUser });
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

async function main(): Promise<void> {
  const ann = await import("../app/api/announcements/route");
  const logs = await import("../app/api/logs/route");
  const { db } = await import("../lib/store");

  sessionUser = null;
  const r1 = await ann.GET();
  assert("S1 unauthenticated GET /api/announcements → 401", r1.status === 401);
  const r2 = await logs.GET();
  assert("S2 unauthenticated GET /api/logs → 401", r2.status === 401);
  const r3 = await ann.POST();
  assert("S3 POST /api/announcements → 405 (Allow: GET)", r3.status === 405 && r3.headers.get("allow") === "GET");
  assert("S4 store without a workspace → [] (no DB query at all)", (await db.getAnnouncements("")).length === 0 && (await db.getAnnouncements(undefined as unknown as string)).length === 0);

  if (!VERIFY_URL) { console.log("SKIP  Part 2 (set CR_VERIFY_DATABASE_URL to a THROWAWAY database with all migrations)"); return; }
  if (!VERIFY_SAFE) { assert("Part 2 refuses a non-throwaway database", false, "refused"); return; }
  const { prisma } = await import("../lib/prisma");
  const t = Date.now();
  const A = await prisma.workspace.create({ data: { name: "A", slug: `ann-a-${t}`, owner: { create: { email: `ann-a-${t}@example.test` } } } as never });
  const B = await prisma.workspace.create({ data: { name: "B", slug: `ann-b-${t}`, owner: { create: { email: `ann-b-${t}@example.test` } } } as never });
  await prisma.announcement.createMany({ data: [
    { workspaceId: A.id, name: "A-one", text: "a" },
    { workspaceId: A.id, name: "A-two", text: "a" },
    { workspaceId: A.id, name: "A-jingle", text: "j", announcementType: "jingle", audioUrl: "/api/jingles/audio/x" },
    { workspaceId: B.id, name: "B-secret", text: "b" },
  ] });
  assert("S5 store with an unknown workspace → []", (await db.getAnnouncements("no-such-workspace")).length === 0);

  sessionUser = { id: "ua", tenantId: A.id };
  const ra = (await (await ann.GET()).json()) as { title: string }[];
  sessionUser = { id: "ub", tenantId: B.id };
  const rb = (await (await ann.GET()).json()) as { title: string }[];
  const ta = ra.map((x) => x.title).sort().join(","), tb = rb.map((x) => x.title).sort().join(",");
  assert("S6 signed-in user of A gets A's own announcements (jingles excluded)", ta === "A-one,A-two", ta);
  assert("S7 workspace A NEVER sees workspace B", !ta.includes("B-secret"));
  assert("S8 workspace B sees only B", tb === "B-secret", tb);
  const rl = await logs.GET();
  assert("S9 signed-in GET /api/logs → 200 array", rl.status === 200 && Array.isArray(await rl.json()));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(process.exitCode ?? 0); });
