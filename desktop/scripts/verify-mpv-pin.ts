/**
 * C4 — validates the mpv pin + integrity helpers (`desktop/mpv-pin.json`, `desktop/scripts/mpv-integrity.cjs`).
 * Deterministic, no network. Does NOT run fetch-mpv (that would download). Run: npx tsx desktop/scripts/verify-mpv-pin.ts
 */
import { sha256Buf, hexEq, loadPin } from "./mpv-integrity.cjs";
import { MPV_WIN_PIN } from "../src/main/runtime-binaries/mpv-pin";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

// ── pin structure ──
const pin = loadPin();
const win = pin && pin.win_x64;
assert("pin loads with win_x64", !!win);
assert("releaseTag is a non-empty string", typeof win.releaseTag === "string" && win.releaseTag.length > 0, win && win.releaseTag);
assert("exeSha256 is 64-hex", /^[0-9a-f]{64}$/i.test(win.exeSha256), win && win.exeSha256);
let re: RegExp | null = null;
try { re = new RegExp(win.assetPattern); } catch { re = null; }
assert("assetPattern is a valid regex", re !== null);
assert("assetPattern matches a sample asset name", !!re && re.test("mpv-x86_64-v3-20260421-git-abcdef1.7z"));
assert("assetPattern rejects a non-matching name", !!re && !re.test("mpv-i686-20260421.7z"));

// ── hexEq ──
assert("hexEq: identical matches", hexEq(win.exeSha256, win.exeSha256));
assert("hexEq: case-insensitive match", hexEq(win.exeSha256.toUpperCase(), win.exeSha256.toLowerCase()));
assert("hexEq: different → false", !hexEq(win.exeSha256, "a".repeat(64)));
assert("hexEq: short/empty/non-string → false", !hexEq("abc", win.exeSha256) && !hexEq("", "") && !hexEq(undefined as unknown as string, win.exeSha256));

// ── sha256Buf sanity (known vector) ──
assert("sha256Buf('abc') is the known SHA-256", sha256Buf("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

// ── parity: the runtime TS mirror (mpv-pin.ts) ≡ the build JSON (mpv-pin.json), so build + runtime never drift ──
assert("parity: mpv-pin.ts releaseTag === mpv-pin.json", MPV_WIN_PIN.releaseTag === win.releaseTag);
assert("parity: mpv-pin.ts exeSha256 === mpv-pin.json", MPV_WIN_PIN.exeSha256 === win.exeSha256);
assert("parity: mpv-pin.ts assetPattern === mpv-pin.json", MPV_WIN_PIN.assetPattern === win.assetPattern);

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`pin: mpv ${win && win.releaseTag} / ${win && win.exeSha256}`);
process.exit(process.exitCode ?? 0);
