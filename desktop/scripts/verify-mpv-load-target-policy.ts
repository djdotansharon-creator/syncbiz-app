/**
 * C1 A2 — a LOCAL file must load (2026-11-18). PURE checks of `resolveMpvLoadTarget` (desktop/src/shared/remote-media-url-policy.ts), the gate `mpv-manager.loadInternal` applies to every target before MPV
 * `loadfile`, plus static wiring checks. Needs no electron / ws / MPV, so it runs anywhere.
 *
 * Why: commit 674fcad (C1) gated `loadInternal` with `resolveRemoteMediaTarget`, which rejects every Windows drive path — but the renderer plays LOCAL music by sending its raw path to `mpvPlayUrl` →
 * `loadInternal`, so a LOCAL song (and the offline / restart restore of one) never loaded: `MPV_LOAD_REJECTED_C1`, then silence. The existing A2 test only checked that the gate EXISTS.
 *
 * Run (from the repo root): npx tsx desktop/scripts/verify-mpv-load-target-policy.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveMpvLoadTarget, resolveRemoteMediaTarget } from "../src/shared/remote-media-url-policy";
import { normalizeMpvLoadTarget } from "../src/main/mpv-input-normalize";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "..", ...p), "utf-8").replace(/\r\n/g, "\n");

// ── a LOCAL drive file loads (the bug) ──
for (const p of ["C:\\Music\\a.mp3", "C:/Music/a.mp3", "d:\\Dropbox\\PlaylistPro\\Hits\\שיר.flac", "E:\\a b\\c (1).wav", "file:///C:/Music/a.mp3", "FILE:///c:/Music/a.mp3"]) {
  assert(`ALLOW local file ${JSON.stringify(p)}`, resolveMpvLoadTarget(p) === p);
}
assert("a local path is returned untouched (trimmed only)", resolveMpvLoadTarget("  C:\\Music\\a.mp3  ") === "C:\\Music\\a.mp3");
assert("the OLD gate rejected exactly those (this is what the old test never covered)", resolveRemoteMediaTarget("C:\\Music\\a.mp3") === null && resolveRemoteMediaTarget("file:///C:/Music/a.mp3") === null);

// ── everything that was rejected for a good reason STILL is ──
for (const p of [
  "\\\\nas\\music\\a.mp3", "\\\\?\\C:\\a.mp3", "\\\\?\\UNC\\host\\share\\a.mp3", "//evil.com/a.mp3", "file://evil.com/share/a.mp3", "file://nas/music/a.mp3", "file:///etc/passwd", "local://x",
  "http://192.168.1.20:8000/stream", "http://10.0.0.5/a", "http://127.0.0.1/a", "http://localhost/a", "http://printer.local/a", "http://169.254.169.254/x",
  "ytdl://x", "data:audio/mp3;base64,AA", "javascript:alert(1)", "blob:https://x/y", "http://user:pass@public.com/a",
  "a.mp3", "music/x.mp3", "C:a.mp3", "/api/media/xyz", "", "   ",
]) {
  assert(`REJECT ${JSON.stringify(p)}`, resolveMpvLoadTarget(p) === null);
}
assert("REJECT a non-string / NUL / over-long target", resolveMpvLoadTarget(undefined) === null && resolveMpvLoadTarget(42) === null && resolveMpvLoadTarget("C:\\a\0.mp3") === null && resolveMpvLoadTarget("C:\\" + "a".repeat(5000)) === null);

// ── every legitimate remote source still passes, byte for byte ──
for (const u of ["https://www.youtube.com/watch?v=abc", "https://soundcloud.com/a/b", "https://stream.radio.example/live.mp3", "http://ice1.somafm.com:8000/x", "https://app.example.com/api/media/xyz", "https://pub-x.r2.dev/f.mp3"]) {
  assert(`ALLOW remote ${u}`, resolveMpvLoadTarget(u) === u && resolveRemoteMediaTarget(u) === u);
}

// ── the remote policy itself is untouched (the server copy mirrors it — server/verify-remote-media-url-policy-parity.ts) ──
assert("resolveRemoteMediaTarget still rejects every local / UNC / file form (A1 at the WS boundary stays strict)", ["C:\\a.mp3", "C:/a.mp3", "\\\\srv\\s\\a", "file:///C:/a.mp3", "local://x"].every((v) => resolveRemoteMediaTarget(v) === null));

// ── what MPV is then handed: the local path becomes a loadable file target (normalizeMpvLoadTarget is no longer unreachable for it) ──
const n = normalizeMpvLoadTarget("C:\\Music\\a.mp3");
assert("a local drive path normalizes to a FILE target", n.kind === "file" && n.target.length > 0, JSON.stringify(n));

// ── static wiring ──
const mpv = read("desktop", "src", "main", "mpv-manager.ts");
const loadStart = mpv.indexOf("private loadInternal(");
const load = mpv.slice(loadStart, mpv.indexOf("pause(): void {", loadStart));
assert("loadInternal gates with resolveMpvLoadTarget (not the bare remote policy) and still returns before loadfile on a rejection", /if \(!resolveMpvLoadTarget\(u\)\) \{[\s\S]{0,400}?return;\s*\}/.test(load) && !/resolveRemoteMediaTarget\(/.test(load));
assert("the gate still runs BEFORE resolveOfflineUrl (loopback vault output is never re-checked)", load.indexOf("resolveMpvLoadTarget(u)") > -1 && load.indexOf("resolveMpvLoadTarget(u)") < load.indexOf("resolveOfflineUrl(u)"));
const ws = read("desktop", "src", "device-websocket-client", "device-ws-manager.ts");
assert("the WS boundary (A1) uses ONLY the strict remote policy — a local path over the cloud socket is still refused (CLAUDE.md §12)", /resolveRemoteMediaTarget\(rawUrl, this\.config\.apiBaseUrl\)/.test(ws) && /resolveRemoteMediaTarget\(rUrl, this\.config\.apiBaseUrl\)/.test(ws) && !/resolveMpvLoadTarget/.test(ws));
const pol = read("desktop", "src", "shared", "remote-media-url-policy.ts");
assert("the policy module stays PURE (no node: imports, no require, no fetch / net)", !/from "node:/.test(pol) && !/require\(/.test(pol) && !/\bfetch\b|createServer|net\./.test(pol));

console.log(`\n${pass} passed, ${fail} failed`);
