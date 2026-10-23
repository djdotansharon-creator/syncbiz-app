/**
 * PR #61 review (2026-10-23) — the search / album / artist / recommend routes are signed-in only. Run: npx tsx scripts/verify-search-api-auth.ts
 * No DB, no network: the session is simulated by stubbing @/lib/auth-helpers (getCurrentUserFromCookies); the signed-in calls use parameters
 * every route answers immediately (too short / invalid), so nothing is fetched. Unauthenticated → 401 with an empty body of data, before anything runs.
 */
import Module from "node:module";
import path from "node:path";
import { NextRequest } from "next/server";

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

// route file, an in-range-looking URL that every route answers at once (no network), what a signed-in 200 looks like
const ROUTES: Array<[string, string, string]> = [
  ["album-search", "/api/album-search?q=a", "albums"],
  ["album-tracks", "/api/album-tracks?id=x", "tracks"],
  ["album-playlist", "/api/album-playlist?album=a", "playlist"],
  ["artist-search", "/api/artist-search?q=a", "artists"],
  ["artist-image", "/api/artist-image?name=a", "url"],
  ["sources/youtube-recommend", "/api/sources/youtube-recommend", "candidates"],
  ["sources/search", "/api/sources/search?q=a", "results"],
];

async function main(): Promise<void> {
  for (const [file, url, key] of ROUTES) {
    const mod = (await import(`../app/api/${file}/route`)) as { GET: (req: NextRequest) => Promise<Response> };
    sessionUser = null;
    const anon = await mod.GET(new NextRequest(`http://localhost${url}`));
    const anonBody = (await anon.json().catch(() => ({}))) as Record<string, unknown>;
    assert(`${file}: anonymous → 401, no data`, anon.status === 401 && !(key in anonBody), `status ${anon.status}`);
    sessionUser = { id: "u1", tenantId: "t1" };
    const authed = await mod.GET(new NextRequest(`http://localhost${url}`));
    const authedBody = (await authed.json().catch(() => ({}))) as Record<string, unknown>;
    assert(`${file}: signed in → 200 (the guard does not block)`, authed.status === 200 && key in authedBody, `status ${authed.status}`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
}
void main();
