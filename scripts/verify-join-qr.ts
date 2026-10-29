/**
 * The QR join link and the vendored QR generator (owner 2026-10-30: "a QR for joining"): the link a QR carries, reading the code back from a scanned link, and a structural check of the QR matrix (size for the
 * link, the three finder squares). No database, no browser. Run: npx tsx scripts/verify-join-qr.ts
 */
import { readFileSync } from "node:fs";
import qrcode from "../lib/vendor/qrcode-generator";
import { buildJoinLink, joinCodeFromQuery } from "../lib/join-link";
import { isWellFormedJoinCode, normalizeJoinCode } from "../lib/join-by-code";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}

const link = buildJoinLink("https://syncbiz-app-production.up.railway.app/", "ABCD-EFGH");
assert("Q1 the link is the sign-up page with the code inside (no double slash, the code encoded)", link === "https://syncbiz-app-production.up.railway.app/signup?join=ABCD-EFGH", link);
const back = joinCodeFromQuery(new URL(link).searchParams.get("join"));
assert("Q2 a scanned link gives the same code back, and it is a well-formed join code", back === "ABCD-EFGH" && isWellFormedJoinCode(normalizeJoinCode(back)));
assert("Q3 junk in the query is ignored (too short, scripts, nothing)", joinCodeFromQuery("<script>") === "" && joinCodeFromQuery("AB") === "" && joinCodeFromQuery(null) === "" && joinCodeFromQuery("abcd efgh") === "ABCD-EFGH" && joinCodeFromQuery("ABCDEFG0") === "");

const qr = qrcode(0, "M");
qr.addData(link, "Byte");
qr.make();
const n = qr.getModuleCount();
assert("Q4 the matrix is a valid QR size (21 + 4 per version) and fits the link in a small version", (n - 21) % 4 === 0 && n >= 29 && n <= 49, n);
// the three finder patterns: a 7x7 ring (dark), 5x5 light ring, 3x3 dark core — top-left, top-right, bottom-left
const finder = (r0: number, c0: number): boolean => {
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    const edge = r === 0 || r === 6 || c === 0 || c === 6;
    const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
    const want = edge || core;
    if (qr.isDark(r0 + r, c0 + c) !== want) return false;
  }
  return true;
};
assert("Q5 the three finder squares are where a phone camera looks for them", finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0));
const src = readFileSync("lib/vendor/qrcode-generator.js", "utf8");
assert("Q6 the vendored generator carries its MIT licence header, and its licence file is next to it — no npm dependency was added", /Licensed under the MIT license/.test(src) && readFileSync("lib/vendor/qrcode-generator.LICENSE.txt", "utf8").includes("The MIT License") && !/qrcode/.test(readFileSync("package.json", "utf8")));
const signup = readFileSync("components/join/signup-flow.tsx", "utf8");
assert("Q7 sign-up opened from a join link keeps the code and goes straight to the code step (no new-business / join choice)", /joinCodeFromQuery\(new URLSearchParams\(window\.location\.search\)\.get\("join"\)\)/.test(signup) && /setStep\(fromLink \? "code" : "choice"\)/.test(signup));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
