/**
 * F1 — regression tests for the SSRF-safe fetch + URL policy. CONTROLLED ENVIRONMENT ONLY:
 * uses a local loopback server and public DNS names that point at 127.0.0.1 (nip.io). It never targets a real
 * internal service or cloud metadata. Network-dependent positive checks degrade to SKIP when offline.
 * Run: npx tsx scripts/verify-ssrf-safe-fetch.ts
 */
import http from "node:http";
import { safeFetch, SsrfBlockedError } from "../lib/ssrf-safe-fetch";
import { resolveRemoteMediaTarget, isForbiddenResolvedIp } from "../lib/remote-media-url-policy";

let pass = 0, fail = 0, skip = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.error("FAIL", name); } }
function skipped(name: string, why: string) { skip++; console.log("SKIP", name, "-", why); }
async function blocked(url: string): Promise<"blocked" | "allowed" | "neterr"> {
  try { await safeFetch(url, { timeoutMs: 4000 }); return "allowed"; }
  catch (e) { return e instanceof SsrfBlockedError ? "blocked" : "neterr"; }
}

async function main() {
  // 1) URL-policy unit — forbidden (null) vs allowed (non-null)
  const mustBlockPolicy = ["http://127.0.0.1/","http://10.0.0.1/","http://192.168.0.1/","http://169.254.169.254/","http://[::1]/","http://[fe80::1]/","http://2130706433/","http://user:pass@example.com/","ftp://example.com/","http://localhost/","http://x.local/"];
  const mustAllowPolicy = ["http://example.com/","https://example.com/","http://radio.example.org:8000/live","https://youtube.com/","https://soundcloud.com/x","http://8.8.8.8/","https://1.1.1.1/"];
  ok("policy blocks internal/invalid", mustBlockPolicy.every((u) => resolveRemoteMediaTarget(u) === null));
  ok("policy allows public http+https", mustAllowPolicy.every((u) => resolveRemoteMediaTarget(u) !== null));

  // 2) resolved-IP predicate (connection-time core)
  ok("resolved-IP blocks IPv4 internal", isForbiddenResolvedIp("127.0.0.1",4) && isForbiddenResolvedIp("10.1.2.3",4) && isForbiddenResolvedIp("169.254.169.254",4) && isForbiddenResolvedIp("192.168.5.5",4));
  ok("resolved-IP blocks IPv6 internal", isForbiddenResolvedIp("::1",6) && isForbiddenResolvedIp("fe80::1",6) && isForbiddenResolvedIp("fc00::1",6) && isForbiddenResolvedIp("::ffff:127.0.0.1",6));
  ok("resolved-IP allows public", !isForbiddenResolvedIp("8.8.8.8",4) && !isForbiddenResolvedIp("1.1.1.1",4) && !isForbiddenResolvedIp("2001:4860:4860::8888",6));

  // 3) redirect re-validation uses the same policy (each hop)
  ok("redirect target to internal is rejected by policy", resolveRemoteMediaTarget("http://169.254.169.254/") === null);

  // 4) safeFetch blocks literal-internal at connection time (no connection made)
  ok("safeFetch blocks 127.0.0.1", (await blocked("http://127.0.0.1/")) === "blocked");
  ok("safeFetch blocks [::1]", (await blocked("http://[::1]/")) === "blocked");
  ok("safeFetch blocks 169.254.169.254 (metadata)", (await blocked("http://169.254.169.254/latest/meta-data/")) === "blocked");

  // 5) controlled loopback server + DNS-rebinding proof
  const server = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<title>loopback</title>"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as import("node:net").AddressInfo).port;
  try {
    // literal loopback → blocked (pre-check)
    ok("safeFetch blocks literal loopback:port", (await blocked(`http://127.0.0.1:${port}/`)) === "blocked");
    // public DNS name that resolves to 127.0.0.1 → must be blocked at CONNECTION TIME (not just by hostname)
    const rebind = await blocked(`http://127.0.0.1.nip.io:${port}/`);
    if (rebind === "blocked") ok("DNS→127.0.0.1 (nip.io) blocked at connect", true);
    else if (rebind === "neterr") skipped("DNS→127.0.0.1 (nip.io) blocked at connect", "no network / DNS unavailable");
    else ok("DNS→127.0.0.1 (nip.io) blocked at connect", false); // allowed = SSRF hole
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }

  // 6) positive: real public HTTPS still works (Host/SNI preserved). Network-dependent → SKIP offline.
  try {
    const res = await safeFetch("https://example.com/", { timeoutMs: 6000 });
    ok("public HTTPS allowed + body read (Host/SNI ok)", res.ok && /example/i.test(res.body));
  } catch (e) {
    if (e instanceof SsrfBlockedError) ok("public HTTPS allowed", false);
    else skipped("public HTTPS allowed", "no network");
  }

  console.log(`\nRESULT  pass=${pass} fail=${fail} skip=${skip}`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error("TEST ERROR", e); process.exit(2); });
