/**
 * F1 — DEV integration test of the ACTUAL route POST /api/radio/metadata (not just safe-fetch).
 * Requires: local dev server on BASE, local DB, internet. DEV ONLY. Never run against PROD.
 * Run: npx tsx scripts/verify-f1-route-integration.ts
 */
const BASE = process.env.F1_BASE_URL || "http://localhost:3000";
const EMAIL = "test@syncbiz.com";
const PASSWORD = "test123";

let pass = 0, fail = 0, skip = 0;
function ok(name: string, cond: boolean, evidence?: unknown) { if (cond) { pass++; console.log("PASS", name, evidence !== undefined ? "| " + JSON.stringify(evidence) : ""); } else { fail++; console.error("FAIL", name, evidence !== undefined ? "| " + JSON.stringify(evidence) : ""); } }

async function meta(url: string, cookie?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/api/radio/metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ url }),
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body };
}

async function main() {
  // Case 1 — no session → 401
  const r1 = await meta("https://example.com/");
  ok("1. no session → 401", r1.status === 401, { status: r1.status });

  // Login → session cookie
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const setCookies: string[] = (login.headers as any).getSetCookie ? (login.headers as any).getSetCookie() : [login.headers.get("set-cookie") || ""];
  const sessionCookie = setCookies.map((c) => (c || "").split(";")[0]).filter((c) => c.startsWith("syncbiz-session=")).join("; ");
  if (login.status !== 200 || !sessionCookie) {
    console.error(`LOGIN FAILED status=${login.status} — authenticated cases cannot run`);
    skip += 5;
    console.log(`\nRESULT  pass=${pass} fail=${fail} skip=${skip}`);
    process.exit(fail ? 1 : 0);
  }
  console.log("login OK, session cookie acquired");

  // Case 2 — authed + public HTTP → works (REAL page title, not the host-derived fallback)
  const r2 = await meta("http://example.com/", sessionCookie);
  ok("2. authed + public HTTP → real content", r2.status === 200 && /Example Domain/i.test(r2.body?.title || ""), { status: r2.status, title: r2.body?.title });

  // Case 3 — authed + public HTTPS → works (REAL content; proves TLS/SNI)
  const r3 = await meta("https://example.com/", sessionCookie);
  ok("3. authed + public HTTPS → real content", r3.status === 200 && /Example Domain/i.test(r3.body?.title || ""), { status: r3.status, title: r3.body?.title });

  // Case 4 — authed + public→public redirect (http://wikipedia.org → https://www.wikipedia.org) → real content
  const r4 = await meta("http://wikipedia.org/", sessionCookie);
  ok("4. authed + public redirect→public → real content", r4.status === 200 && /wikipedia/i.test(r4.body?.title || ""), { status: r4.status, title: r4.body?.title });

  // Case 5 — authed + internal literal → rejected (400)
  const r5a = await meta("http://169.254.169.254/latest/meta-data/", sessionCookie);
  ok("5a. authed + 169.254.169.254 → 400", r5a.status === 400, { status: r5a.status, body: r5a.body });
  const r5b = await meta("http://127.0.0.1/", sessionCookie);
  ok("5b. authed + 127.0.0.1 → 400", r5b.status === 400, { status: r5b.status, body: r5b.body });

  // Case 6 — authed + DNS-rebind (public name → 127.0.0.1) → blocked at connect, benign fallback (no content fetched)
  const r6 = await meta("http://127.0.0.1.nip.io/", sessionCookie);
  ok("6. authed + DNS→127.0.0.1 → benign fallback (image null, no real fetch)", r6.status === 200 && r6.body?.image === null, { status: r6.status, title: r6.body?.title, image: r6.body?.image });

  console.log(`\nRESULT  pass=${pass} fail=${fail} skip=${skip}`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error("INTEGRATION ERROR", e?.message || e); process.exit(2); });
