/**
 * C2 — parity + unit test for the server media-URL policy.
 *
 *  PARITY   — the server copy `remote-media-url-policy.ts` must give the SAME forbidden/allowed verdict as the
 *             station copy `desktop/src/shared/remote-media-url-policy.ts` for every vector (anti-drift guard:
 *             the two separate builds duplicate the core logic, so this proves they stay in sync).
 *  UNIT     — `isForbiddenMediaTarget`: empty / server-relative "/..." / public http(s) → allowed (NOT forbidden);
 *             internal / loopback / file / UNC / non-http(s) / credentials → forbidden.
 *
 * Run: npx tsx server/verify-remote-media-url-policy-parity.ts
 */
import { resolveRemoteMediaTarget as srv, isForbiddenMediaTarget } from "./remote-media-url-policy.js";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

// The desktop copy is a SEPARATE (CJS) build outside this project's rootDir — load it via a COMPUTED specifier so
// the server `tsc` build does not try to resolve it (a static literal would trip rootDir); tolerate CJS/ESM interop.
const deskModPath = ["..", "desktop", "src", "shared", "remote-media-url-policy.js"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const deskMod: any = await import(deskModPath);
const desk: (raw: unknown, base?: string | null) => string | null = deskMod.resolveRemoteMediaTarget ?? deskMod.default?.resolveRemoteMediaTarget;
assert("desktop policy module loaded (cross-build parity source)", typeof desk === "function");

// Absolute vectors: both copies must agree on the forbidden verdict (null-ness).
const ABS: string[] = [
  "https://cdn.example.com/a.mp3", "http://ice1.somafm.com:8000/x", "https://www.youtube.com/watch?v=x",
  "https://soundcloud.com/a/b", "https://pub-x.r2.dev/f.mp3", "http://8.8.8.8/stream", "http://1.2.3.4:8000/s",
  "http://[2001:4860:4860::8888]/s", "http://172.15.0.1/s", "http://100.63.0.1/s",
  "http://10.0.0.5/a", "http://192.168.1.1/a", "http://172.16.0.1/a", "http://127.0.0.1/a",
  "http://169.254.169.254/x", "http://100.100.0.1/a", "http://0.0.0.0/a", "http://255.255.255.255/a",
  "http://2130706433/a", "http://0x7f000001/a", "http://0177.0.0.1/a", "http://127.1/a", "http://3232235777/a",
  "http://[::1]/a", "http://[::]/a", "http://[fe80::1]/a", "http://[fc00::1]/a", "http://[fd12::1]/a",
  "http://[::ffff:10.0.0.1]/a", "http://[::ffff:127.0.0.1]/a",
  "http://localhost/a", "http://api.localhost/a", "http://printer.local/a",
  "file:///C:/a.mp3", "local://x", "ytdl://x", "data:audio/mp3;base64,AA", "javascript:alert(1)", "blob:https://x/y",
  "C:\\Music\\x.mp3", "C:/Music/x.mp3", "\\\\srv\\share\\x", "https://ok.com/a\\b", "//evil.com/a.mp3",
  "a.mp3", "music/x.mp3", "http://user:pass@public.com/a", "http://public.com@10.0.0.1/a", "http://10.0.0.1@public.com/a",
  "", "https://x.com/" + "a".repeat(3000),
];
let drift = 0;
for (const v of ABS) {
  const same = (srv(v) === null) === (desk(v) === null);
  if (!same) { drift++; console.log(`  DRIFT: ${JSON.stringify(v)} server=${srv(v)} desktop=${desk(v)}`); }
}
assert(`PARITY server≡desktop verdict on ${ABS.length} absolute vectors`, drift === 0, `${drift} drift(s)`);

// Relative + same base must agree too.
const APP = "https://syncbiz-app-test-production.up.railway.app";
assert("PARITY relative /api/media agrees", (srv("/api/media/x", APP) === null) === (desk("/api/media/x", APP) === null));
assert("PARITY relative with no base agrees", (srv("/api/media/x") === null) === (desk("/api/media/x") === null));

// isForbiddenMediaTarget — the server predicate.
assert("UNIT empty url NOT forbidden (pause/resume/local)", isForbiddenMediaTarget("") === false && isForbiddenMediaTarget(undefined) === false);
assert("UNIT server-relative /api/jingles NOT forbidden (JINGLES pass)", isForbiddenMediaTarget("/api/jingles/audio/91361cb7") === false);
assert("UNIT server-relative /api/jingles/bell NOT forbidden", isForbiddenMediaTarget("/api/jingles/bell/ding") === false);
assert("UNIT server-relative /api/media NOT forbidden", isForbiddenMediaTarget("/api/media/abc") === false);
assert("UNIT relative path OUTSIDE /api/ forbidden (approved routes only)",
  isForbiddenMediaTarget("/internal/secret") === true && isForbiddenMediaTarget("/etc/passwd") === true && isForbiddenMediaTarget("/admin") === true);
assert("UNIT public https NOT forbidden", isForbiddenMediaTarget("https://cdn.example.com/a.mp3") === false);
assert("UNIT public http radio NOT forbidden", isForbiddenMediaTarget("http://ice1.somafm.com:8000/x") === false);
assert("UNIT YouTube/SoundCloud/Droploud NOT forbidden",
  !isForbiddenMediaTarget("https://www.youtube.com/watch?v=x") && !isForbiddenMediaTarget("https://soundcloud.com/a/b") && !isForbiddenMediaTarget("https://pub-x.r2.dev/f.mp3"));
assert("UNIT internal IPv4 forbidden", isForbiddenMediaTarget("http://10.0.0.1/a") && isForbiddenMediaTarget("http://192.168.1.1/a"));
assert("UNIT loopback/encoded forbidden", isForbiddenMediaTarget("http://127.0.0.1/a") && isForbiddenMediaTarget("http://2130706433/a") && isForbiddenMediaTarget("http://[::1]/a"));
assert("UNIT cloud-metadata IP forbidden", isForbiddenMediaTarget("http://169.254.169.254/latest/meta-data"));
assert("UNIT file/UNC/local/protocol-relative forbidden",
  isForbiddenMediaTarget("file:///C:/a.mp3") && isForbiddenMediaTarget("\\\\srv\\share\\x") && isForbiddenMediaTarget("local://x") && isForbiddenMediaTarget("//evil.com/a.mp3"));
assert("UNIT non-http(s) scheme forbidden", isForbiddenMediaTarget("ytdl://x") && isForbiddenMediaTarget("data:audio/mp3;base64,AA"));
assert("UNIT credentials forbidden", isForbiddenMediaTarget("http://user:pass@public.com/a"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
