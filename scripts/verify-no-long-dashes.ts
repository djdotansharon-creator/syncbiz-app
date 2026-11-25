/**
 * THE ONE RULE (owner directive 2026-11-25, CLAUDE.md "No long dashes"):
 * nothing we write carries a long dash. U+2013 EN DASH and U+2014 EM DASH are
 * both written as a plain "-", everywhere: UI text, code, comments, log lines,
 * documents, seed data, test gates.
 *
 * This gate is the enforcement. It applies to everyone's commits, not only to
 * Claude's, so a new long dash fails before it reaches main.
 *
 *   npx tsx scripts/verify-no-long-dashes.ts
 *       every tracked file. Until the prepared sweep lands this REPORTS THE
 *       EXISTING BACKLOG (about 8,900). That is an inventory, not a failure of
 *       whatever you are working on.
 *
 *   npx tsx scripts/verify-no-long-dashes.ts --changed [--base <ref>]
 *       ONLY the lines this branch ADDS, read out of `git diff`. A line that was
 *       already in the repository is never reported, even inside a file you
 *       edited. This is what CI runs, and it is why the rule can land before the
 *       backlog is swept.
 *
 * The exceptions below are technical, never stylistic. Read the reason before
 * adding one: "it looked nicer" is not a reason.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EN = String.fromCharCode(0x2013);
const EM = String.fromCharCode(0x2014);
const DASH = new RegExp("[" + EN + EM + "]", "g");

/**
 * EXCEPTION 1 - parser idioms.
 * Song metadata arrives from YouTube, SoundCloud, M3U files and playlists with a
 * REAL em or en dash in the title ("Daft Punk - Around the World"). The character
 * classes and separator arrays that split or join "Artist - Title" must keep
 * accepting all three forms, or the player stops showing an artist.
 */
const PARSER_IDIOMS: readonly string[] = [
  "[" + EN + EM + "-]",
  "[-" + EN + EM + "]",
  "[-" + EN + EM + "|]",
  "[-" + EN + EM + "|:]",
  "[^\\-" + EN + EM + "|:]",
  "[-" + EN + "]",
  "\\s\\-" + EN,
  '" ' + EM + ' "',
  '" ' + EN + ' "',
];

/**
 * EXCEPTION 2 - files that must not be edited at all.
 *  - prisma/migrations: an applied migration is checksummed in _prisma_migrations;
 *    editing one breaks `prisma migrate`.
 *  - fixtures: sample EXTERNAL data. Its dashes are the input the parsers are
 *    tested against; removing them removes the test's point.
 *  - lib/url-eof-advance.ts: PINNED. verify-p0-url-owner-automix S5 asserts this
 *    file is byte-identical to commit 8e8895a, the accepted URL-EOF tracker in
 *    the playback chain. A cosmetic edit there breaks a deliberate protection;
 *    re-pinning the guard instead would destroy the invariant it exists to hold.
 *  - lock files and generated output.
 */
const EXCLUDE_PATH: readonly RegExp[] = [
  /^prisma\/migrations\//,
  /^fixtures\//,
  /^lib\/url-eof-advance\.ts$/,
  /(^|\/)package-lock\.json$/,
  /\.lock$/,
];

const TEXT = /\.(tsx?|jsx?|cjs|mjs|css|html|md|txt|json|ya?ml|csv|sql|prisma)$/;

const keep = (f: string) => TEXT.test(f) && !EXCLUDE_PATH.some((r) => r.test(f));
const allowedLine = (line: string) => PARSER_IDIOMS.some((idiom) => line.includes(idiom));

type Hit = { file: string; line: number; text: string };

/** The branch this one will merge into: GitHub's base ref in CI, origin/main otherwise. */
function baseRef(): string {
  const i = process.argv.indexOf("--base");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const ci = process.env.GITHUB_BASE_REF;
  return ci ? "origin/" + ci : "origin/main";
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
}

/** Every line this branch ADDS, with its real line number in the new file. */
function addedLines(): { hits: Hit[]; allowed: number; files: number } {
  let diff = "";
  try {
    diff = sh("git diff -U0 --diff-filter=ACMR " + baseRef() + "...HEAD");
  } catch {
    // no such base here (fresh clone, CI without the remote ref): nothing to compare
    return { hits: [], allowed: 0, files: 0 };
  }
  const hits: Hit[] = [];
  const touched = new Set<string>();
  let file = "";
  let lineNo = 0;
  let scanning = false;

  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).replace(/^b\//, "").trim();
      file = p === "/dev/null" ? "" : p;
      scanning = file !== "" && keep(file);
      if (scanning) touched.add(file);
      continue;
    }
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (!scanning) continue;
    if (raw.startsWith("+")) {
      const text = raw.slice(1);
      if ((text.match(DASH) || []).length && !allowedLine(text)) {
        hits.push({ file, line: lineNo, text: text.trim().slice(0, 120) });
      }
      lineNo++;
    }
  }
  return { hits, allowed: 0, files: touched.size };
}

/** Every long dash in the repository, including files nobody touched. */
function wholeRepo(): { hits: Hit[]; allowed: number; files: number } {
  const files = sh("git ls-files --cached --others --exclude-standard")
    .split("\n").map((s) => s.trim()).filter(Boolean).filter(keep);
  const hits: Hit[] = [];
  let allowed = 0;
  for (const f of files) {
    let src: string;
    try {
      src = readFileSync(f, "utf-8");
    } catch {
      continue; // deleted, or not readable as text
    }
    DASH.lastIndex = 0;
    if (!DASH.test(src)) continue;
    src.split(/\r?\n/).forEach((line, i) => {
      if (!(line.match(DASH) || []).length) return;
      if (allowedLine(line)) { allowed++; return; }
      hits.push({ file: f, line: i + 1, text: line.trim().slice(0, 120) });
    });
  }
  return { hits, allowed, files: files.length };
}

const changedOnly = process.argv.includes("--changed");
const { hits, allowed, files } = changedOnly ? addedLines() : wholeRepo();

console.log("verify-no-long-dashes" + (changedOnly ? "  (only the lines this branch adds)" : "  (every tracked file)"));
console.log("  " + (changedOnly ? "files this branch touches .... " : "files scanned ................ ") + files);
if (!changedOnly) console.log("  lines allowed by exception 1 . " + allowed);
console.log("  VIOLATIONS ................... " + hits.length);

if (hits.length > 0) {
  console.log("");
  console.log('Write a plain "-" instead. If a line genuinely needs a long dash to PARSE');
  console.log("external metadata, add its idiom to PARSER_IDIOMS and say why in the commit.");
  console.log("");
  for (const v of hits.slice(0, 60)) console.log("  " + v.file + ":" + v.line + "  " + v.text);
  if (hits.length > 60) console.log("  ... and " + (hits.length - 60) + " more");
  if (!changedOnly) {
    console.log("");
    console.log("A full-repo run reports the BACKLOG. The sweep that clears it is prepared on");
    console.log("chore/no-long-dashes; CI runs --changed, which reads only what a PR adds.");
  }
  console.log("");
  console.log("FAIL  " + hits.length + " long dash(es)");
  process.exit(1);
}

console.log("");
console.log("PASS  no long dash outside the parser idioms");
