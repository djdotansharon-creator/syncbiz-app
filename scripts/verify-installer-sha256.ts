/**
 * The site publishes the installer's SHA-256 (GitHub's asset digest) so the player's self-update can verify what it downloads.
 * Run: npx tsx scripts/verify-installer-sha256.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { sha256FromDigest } from "../lib/desktop-installer-resolve";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const H = "4e3a3c0a09d5c0ebd70366d73358626a8a6523ff7f7286b65e24ec3f9424f2df";
assert("H1 GitHub's `sha256:<hex>` digest → the lower-case hex", sha256FromDigest(`sha256:${H}`) === H && sha256FromDigest(`SHA256:${H.toUpperCase()}`) === H);
assert("H2 anything else → null (no digest, other algorithm, wrong length, not a string)", [undefined, null, "", "md5:abcd", `sha1:${H.slice(0, 40)}`, `sha256:${H.slice(1)}`, `sha256:${H}00`, 42].every((v) => sha256FromDigest(v) === null));
const route = readFileSync(path.join(__dirname, "..", "app/api/desktop/download/route.ts"), "utf-8");
const resolver = readFileSync(path.join(__dirname, "..", "lib/desktop-installer-resolve.ts"), "utf-8");
assert("H3 the resolver passes the asset's digest on, the download API returns it as `sha256` (null when unknown)", /sha256: sha256FromDigest\(asset\.digest\)/.test(resolver) && /sha256: part\.sha256 \?\? null/.test(route) && /sha256: latest\.sha256/.test(route));
console.log(`\n${pass} passed, ${fail} failed`);
