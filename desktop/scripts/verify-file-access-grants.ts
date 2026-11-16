/**
 * C5 step 3 — unit test for capability-based local file access (`desktop/src/main/file-access-grants.ts`).
 *
 * Builds a real temp tree: an approved music root (+ sub-folder + an extra root) and an UNAPPROVED sibling, then
 * asserts authorizeLocalRead ALLOWS reads inside the chosen roots and REJECTS everything else — relative paths,
 * `..` traversal, absolute paths outside the roots, non-existent paths, NUL, and (best-effort) a junction inside
 * the root that escapes to the unapproved sibling.
 *
 * Run: npx tsx desktop/scripts/verify-file-access-grants.ts
 */
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorizeLocalRead } from "../src/main/file-access-grants";
import type { DesktopRuntimeConfig } from "../src/shared/mvp-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const base = mkdtempSync(path.join(tmpdir(), "vono-grants-"));
const root = path.join(base, "Music");
const sub = path.join(root, "Rock");
const extra = path.join(base, "Extra");
const outside = path.join(base, "Secret");
mkdirSync(sub, { recursive: true });
mkdirSync(extra, { recursive: true });
mkdirSync(outside, { recursive: true });
const inFile = path.join(sub, "song.mp3"); writeFileSync(inFile, "x");
const extraFile = path.join(extra, "e.mp3"); writeFileSync(extraFile, "x");
const outFile = path.join(outside, "secret.txt"); writeFileSync(outFile, "TOP SECRET");

const cfg = {
  deviceId: "dsk-test", branchId: "default", workspaceLabel: "", apiBaseUrl: "https://x", wsUrl: "wss://x",
  wsToken: "t", musicFolderPath: root, additionalMusicFolders: [extra],
} as DesktopRuntimeConfig;

// ALLOW — inside the chosen roots
assert("ALLOW file inside the music root subfolder", authorizeLocalRead(inFile, cfg) === realpathSync.native(inFile));
assert("ALLOW the root folder itself (scan)", authorizeLocalRead(root, cfg) !== null);
assert("ALLOW subfolder (scan)", authorizeLocalRead(sub, cfg) !== null);
assert("ALLOW file under an ADDITIONAL root", authorizeLocalRead(extraFile, cfg) !== null);

// REJECT — outside / malformed
assert("REJECT absolute file OUTSIDE every root (no free computer access)", authorizeLocalRead(outFile, cfg) === null);
assert("REJECT relative path", authorizeLocalRead("Music/Rock/song.mp3", cfg) === null);
assert("REJECT ../ traversal that escapes the root", authorizeLocalRead(path.join(root, "..", "Secret", "secret.txt"), cfg) === null);
assert("REJECT non-existent file under root", authorizeLocalRead(path.join(sub, "nope.mp3"), cfg) === null);
assert("REJECT NUL in path", authorizeLocalRead(inFile + "\0.png", cfg) === null);
assert("REJECT empty / non-string", authorizeLocalRead("", cfg) === null && authorizeLocalRead(123, cfg) === null);
assert("REJECT when no roots configured", authorizeLocalRead(inFile, { ...cfg, musicFolderPath: undefined, additionalMusicFolders: [] } as DesktopRuntimeConfig) === null);

// REJECT — symlink/junction escape (best-effort: needs OS support; skip-as-pass if unavailable)
const esc = path.join(root, "escape");
let junctionMade = false;
try { symlinkSync(outside, esc, "junction"); junctionMade = true; } catch { /* no privilege / unsupported */ }
if (junctionMade) {
  assert("REJECT junction INSIDE root that escapes to an unapproved folder", authorizeLocalRead(path.join(esc, "secret.txt"), cfg) === null);
} else {
  console.log("SKIP  junction-escape case (OS did not allow creating a junction) — treated as pass");
  pass++;
}

try { rmSync(base, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
