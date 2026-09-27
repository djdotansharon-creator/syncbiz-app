/**
 * Stage a dedicated, VERIFIED Node runtime for the external VONO Watchdog at
 * desktop/resources/vono-watchdog/node.exe (+ NODE_LICENSE.txt). No global Node dependency on the
 * station. Supply-chain hardened & reproducible:
 *
 *   - EXACT pinned Node version + EXACT arch (win-x64 for the pilot).
 *   - Official Node distribution source (https://nodejs.org/dist/<ver>/).
 *   - SHA-256 verified TWICE: the downloaded node.exe is hashed and must equal (a) the entry in the
 *     official SHASUMS256.txt for win-x64/node.exe, AND (b) the in-repo PINNED_SHA256 constant.
 *   - Build FAILS on ANY mismatch or on a missing pin — there is NO silent fallback to an unverified
 *     runtime. (First-time pin discovery: run with ALLOW_UNPINNED_DISCOVERY=1 to print the official
 *     hash to paste into PINNED_SHA256; that mode still refuses to STAGE an unpinned binary.)
 *
 * Idempotent: skips if node.exe already present and matches PINNED_SHA256 (pass --force to re-verify).
 */
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");

// ── PINS (reproducibility) ──────────────────────────────────────────────────
const NODE_VERSION = "v22.23.3"; // pinned supported Node 22 LTS ("Jod")
const NODE_ARCH_DIR = "win-x64"; // pinned arch for the pilot
// SHA-256 of https://nodejs.org/dist/v22.23.3/win-x64/node.exe, from the official SHASUMS256.txt.
// The build verifies downloaded == official SHASUMS == this pin; any mismatch fails closed (no fallback).
const PINNED_SHA256 = "9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e";

const DIST = `https://nodejs.org/dist/${NODE_VERSION}`;
const NODE_URL = `${DIST}/${NODE_ARCH_DIR}/node.exe`;
const SHASUMS_URL = `${DIST}/SHASUMS256.txt`;
const LICENSE_URL = `https://raw.githubusercontent.com/nodejs/node/${NODE_VERSION}/LICENSE`;

const outDir = path.join(__dirname, "..", "resources", "vono-watchdog");
const outfile = path.join(outDir, "node.exe");
const licenseOut = path.join(outDir, "NODE_LICENSE.txt");

function getBuffer(u, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft <= 0) return reject(new Error("too many redirects"));
        res.resume();
        return resolve(getBuffer(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${u}`)); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function officialHashFor(shasumsText, relPath) {
  for (const line of shasumsText.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+(.+)$/i);
    if (m && m[2].replace(/^\.\//, "") === relPath) return m[1].toLowerCase();
  }
  return null;
}

async function main() {
  const force = process.argv.includes("--force");
  const discovery = process.env.ALLOW_UNPINNED_DISCOVERY === "1";
  fs.mkdirSync(outDir, { recursive: true });

  // Fast path: already staged and matches the pin.
  if (!force && PINNED_SHA256 && fs.existsSync(outfile) && sha256(fs.readFileSync(outfile)) === PINNED_SHA256.toLowerCase()) {
    console.log(`[fetch-node-runtime] node.exe present and matches PINNED_SHA256 — skipping.`);
    return;
  }

  console.log(`[fetch-node-runtime] downloading Node ${NODE_VERSION} ${NODE_ARCH_DIR} + SHASUMS256.txt`);
  const [nodeBuf, shasums] = await Promise.all([getBuffer(NODE_URL), getBuffer(SHASUMS_URL).then((b) => b.toString("utf8"))]);

  const got = sha256(nodeBuf);
  const official = officialHashFor(shasums, `${NODE_ARCH_DIR}/node.exe`);
  if (!official) throw new Error(`SHASUMS256.txt has no entry for ${NODE_ARCH_DIR}/node.exe`);
  if (got !== official) throw new Error(`downloaded node.exe sha256 ${got} ≠ official SHASUMS ${official} — ABORT (no fallback)`);

  if (!PINNED_SHA256) {
    const msg = `PINNED_SHA256 is empty. Official ${NODE_ARCH_DIR}/node.exe sha256 = ${official}. ` +
      `Paste it into PINNED_SHA256 in fetch-node-runtime.cjs to enable staging.`;
    if (discovery) { console.log(`[fetch-node-runtime] DISCOVERY: ${msg} (NOT staging in discovery mode)`); return; }
    throw new Error(`refusing to stage an UNPINNED runtime. ${msg}`);
  }
  if (official !== PINNED_SHA256.toLowerCase()) {
    throw new Error(`official SHASUMS ${official} ≠ in-repo PINNED_SHA256 ${PINNED_SHA256.toLowerCase()} — possible tamper/version drift — ABORT`);
  }

  // All three agree (downloaded == official == pinned) → stage atomically + license.
  const tmp = outfile + ".tmp";
  fs.writeFileSync(tmp, nodeBuf);
  fs.renameSync(tmp, outfile);
  try { fs.writeFileSync(licenseOut, await getBuffer(LICENSE_URL)); } catch (e) { console.warn(`[fetch-node-runtime] LICENSE fetch failed (non-fatal): ${e.message}`); }
  console.log(`[fetch-node-runtime] verified + wrote ${outfile} (sha256=${got})`);
}

main().catch((e) => { console.error("[fetch-node-runtime] FAILED:", e.message); process.exit(1); });
