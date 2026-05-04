/**
 * After `next build` with `output: "standalone"`, copy the standalone server + assets
 * into desktop/staged-web for Electron to spawn (see embedded-next-server.ts).
 */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const standaloneSrc = path.join(repoRoot, ".next/standalone");
const dest = path.join(__dirname, "../staged-web");

if (!fs.existsSync(standaloneSrc)) {
  console.error("[stage-standalone] Missing .next/standalone. Run `npm run build` at the repo root first.");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(standaloneSrc, dest, { recursive: true });

const pubSrc = path.join(repoRoot, "public");
if (fs.existsSync(pubSrc)) {
  fs.cpSync(pubSrc, path.join(dest, "public"), { recursive: true });
}

const staticSrc = path.join(repoRoot, ".next/static");
if (!fs.existsSync(staticSrc)) {
  console.error("[stage-standalone] Missing .next/static after build.");
  process.exit(1);
}
fs.mkdirSync(path.join(dest, ".next"), { recursive: true });
fs.cpSync(staticSrc, path.join(dest, ".next/static"), { recursive: true });

/**
 * Belt-and-suspenders prune. Even with outputFileTracingExcludes tightened in
 * next.config.ts, NFT can still leak test artifacts and Prisma's leftover
 * atomic-write temp files into .next/standalone. Strip them here so the
 * electron-builder step starts from a clean tree.
 */
const TOP_LEVEL_PRUNE = [
  "test-results",
  "playwright-report",
  "e2e",
  "backups",
  "docs",
];
for (const name of TOP_LEVEL_PRUNE) {
  const p = path.join(dest, name);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log("[stage-standalone] Pruned", name);
  }
}

/**
 * Recursively delete any `query_engine-*.tmp*` files under `.prisma/` dirs.
 * On Windows, `prisma generate` writes the engine atomically (tmpNNNN → rename);
 * if the rename fails because the file is locked, the temp copy is left behind.
 * Each is ~18MB and they accumulate across rebuilds.
 */
function prunePrismaTmp(dir) {
  let removed = 0;
  let bytes = 0;
  if (!fs.existsSync(dir)) return { removed, bytes };
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".prisma") {
        const clientDir = path.join(full, "client");
        if (fs.existsSync(clientDir)) {
          for (const f of fs.readdirSync(clientDir)) {
            if (/^query_engine-.*\.tmp/i.test(f)) {
              const fp = path.join(clientDir, f);
              try {
                bytes += fs.statSync(fp).size;
              } catch {}
              fs.rmSync(fp, { force: true });
              removed += 1;
            }
          }
        }
      } else {
        const sub = prunePrismaTmp(full);
        removed += sub.removed;
        bytes += sub.bytes;
      }
    }
  }
  return { removed, bytes };
}
const prismaPrune = prunePrismaTmp(path.join(dest, "node_modules"));
if (prismaPrune.removed > 0) {
  console.log(
    `[stage-standalone] Pruned ${prismaPrune.removed} stale Prisma engine temp file(s) (${(prismaPrune.bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
}

function dirSizeBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {}
      }
    }
  }
  return total;
}
const stagedBytes = dirSizeBytes(dest);
console.log(
  `[stage-standalone] Staged web app at ${dest} (${(stagedBytes / 1024 / 1024).toFixed(1)} MB)`,
);
