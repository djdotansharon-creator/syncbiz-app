/**
 * F1 — 3-way parity guard for the remote-media URL policy.
 *
 * Asserts lib/remote-media-url-policy.ts ≡ server/remote-media-url-policy.ts on a battery of inputs.
 * The existing server test (server/verify-remote-media-url-policy-parity.ts) asserts server ≡ desktop/shared,
 * so lib ≡ server ≡ desktop transitively. Run: npx tsx scripts/verify-url-policy-parity.ts
 */
import * as libPol from "../lib/remote-media-url-policy";
import * as srvPol from "../server/remote-media-url-policy";

const CASES: string[] = [
  "", "   ", "/api/media/abc", "/api/jingles/audio/x", "/admin", "//evil.com/x",
  "file:///etc/passwd", "local:thing", "C:\\\\windows", "\\\\server\\share",
  "http://example.com/stream", "https://example.com/", "http://radio.example.org:8000/live",
  "http://user:pass@example.com/", "ftp://example.com/x", "gopher://x/", "javascript:alert(1)",
  "http://localhost/", "http://foo.localhost/", "http://x.local/",
  "http://127.0.0.1/", "http://127.1/", "http://0.0.0.0/", "http://10.0.0.5/", "http://192.168.1.1/",
  "http://172.16.0.1/", "http://172.31.255.1/", "http://172.32.0.1/", "http://169.254.169.254/latest/meta-data/",
  "http://100.64.0.1/", "http://255.255.255.255/", "http://2130706433/", "http://3232235777/",
  "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fe80::1]/", "http://[fc00::1]/", "http://[2001:4860:4860::8888]/",
  "http://8.8.8.8/", "https://1.1.1.1/", "https://youtube.com/watch", "https://soundcloud.com/x",
];
const BASES = [null, "https://app.example.com", "http://localhost:3000"];

let mismatches = 0, checks = 0;
for (const c of CASES) {
  const a = libPol.isForbiddenMediaTarget(c), b = srvPol.isForbiddenMediaTarget(c);
  checks++;
  if (a !== b) { mismatches++; console.error(`MISMATCH isForbiddenMediaTarget(${JSON.stringify(c)}): lib=${a} server=${b}`); }
  for (const base of BASES) {
    const ra = libPol.resolveRemoteMediaTarget(c, base), rb = srvPol.resolveRemoteMediaTarget(c, base);
    checks++;
    if (ra !== rb) { mismatches++; console.error(`MISMATCH resolveRemoteMediaTarget(${JSON.stringify(c)}, ${JSON.stringify(base)}): lib=${JSON.stringify(ra)} server=${JSON.stringify(rb)}`); }
  }
}
console.log(`parity checks: ${checks}, mismatches: ${mismatches}`);
if (mismatches) { console.error("PARITY FAILED — lib and server policy diverged."); process.exit(1); }
console.log("PARITY OK — lib ≡ server (and ≡ desktop via the server parity test).");
