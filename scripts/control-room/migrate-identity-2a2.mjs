/**
 * CONTROL ROOM GATE 2A-2 (ops, TEST) — move IDENTITY rows only from the legacy branch key "default" to the
 * workspace's canonical Branch (Branch.legacyKey = "default"). Tables touched: BranchMasterDesignation,
 * StationDevice, UserBranchAssignment. NEVER touches content (Playlist / JinglePadAssignment / Announcement /
 * Source / Schedule / radio) and never another workspace. WS state is not touched (no network calls).
 *
 * Runs INSIDE the app container (uses DATABASE_URL from its env). Prints no secrets.
 *   node migrate-identity-2a2.mjs <workspaceId> <canonicalBranchId> --expect=<bmd>,<sd>,<uba> --dry-run
 *   node migrate-identity-2a2.mjs <workspaceId> <canonicalBranchId> --expect=<bmd>,<sd>,<uba> --apply   --manifest=<path>
 *   node migrate-identity-2a2.mjs <workspaceId> <canonicalBranchId> --reverse --manifest=<path>
 *
 * Fail-closed: canonical lookup must match exactly; "default" row counts must equal --expect; no unique
 * collision at the target; every per-row update must affect exactly 1 row (inside one transaction).
 * Idempotent: a second --apply with nothing left on "default" and all manifest rows canonical is a no-op.
 * Reversible: --reverse moves exactly the manifest row ids back (canonical → "default").
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const LEGACY = "default";
const args = process.argv.slice(2);
const [workspaceId, canonicalArg] = args;
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null;
const mode = flag("dry-run") ? "dry-run" : flag("apply") ? "apply" : flag("reverse") ? "reverse" : null;
const manifestPath = opt("manifest");
const expect = (opt("expect") ?? "").split(",").map((x) => Number(x));

function fail(msg) { console.log(`FAIL: ${msg}`); process.exit(1); }
if (!workspaceId || !canonicalArg || !mode) fail("usage: <workspaceId> <canonicalBranchId> --dry-run|--apply|--reverse ...");
if (mode !== "reverse" && (expect.length !== 3 || expect.some((n) => !Number.isInteger(n) || n < 0))) fail("--expect=<bmd>,<sd>,<uba> required");
if (mode !== "dry-run" && !manifestPath) fail("--manifest=<path> required");

const prisma = new PrismaClient();
const TABLES = [
  ["BranchMasterDesignation", prisma.branchMasterDesignation, { id: true, workspaceId: true, branchId: true, durableDeviceId: true }],
  ["StationDevice", prisma.stationDevice, { id: true, workspaceId: true, branchId: true, durableDeviceId: true }],
  ["UserBranchAssignment", prisma.userBranchAssignment, { id: true, workspaceId: true, branchId: true, userId: true, role: true }],
];

async function contentSnapshot() {
  const where = { workspaceId, branchId: LEGACY };
  return {
    Playlist: await prisma.playlist.count({ where }),
    JinglePadAssignment: await prisma.jinglePadAssignment.count({ where }),
    Announcement: await prisma.announcement.count({ where }),
    Source: await prisma.source.count({ where }).catch(() => "n/a"),
  };
}

async function identityCounts(branchId) {
  const out = {};
  for (const [name, model] of TABLES) out[name] = await model.count({ where: { workspaceId, branchId } });
  return out;
}

try {
  // ── canonical branch: exact lookup ───────────────────────────────────────────────────────────────────────
  const canon = await prisma.branch.findUnique({
    where: { workspaceId_legacyKey: { workspaceId, legacyKey: LEGACY } },
    select: { id: true, code: true, legacyKey: true, workspaceId: true },
  });
  if (!canon) fail("canonical Branch (legacyKey=default) not found in workspace");
  if (canon.id !== canonicalArg) fail(`canonical mismatch: db=${canon.id} arg=${canonicalArg}`);
  console.log("canonical", JSON.stringify(canon));
  const contentBefore = await contentSnapshot();
  console.log("content-on-default(before)", JSON.stringify(contentBefore));
  console.log("identity-on-default(before)", JSON.stringify(await identityCounts(LEGACY)));
  console.log("identity-on-canonical(before)", JSON.stringify(await identityCounts(canon.id)));

  if (mode === "reverse") {
    if (!existsSync(manifestPath)) fail("manifest not found");
    const m = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (m.workspaceId !== workspaceId || m.canonicalBranchId !== canon.id) fail("manifest workspace/canonical mismatch");
    // collision check on the legacy target
    for (const r of m.rows.BranchMasterDesignation) {
      const c = await prisma.branchMasterDesignation.count({ where: { workspaceId, branchId: LEGACY, NOT: { id: r.id } } });
      if (c > 0) fail("reverse collision: a BranchMasterDesignation already exists on default");
    }
    for (const r of m.rows.UserBranchAssignment) {
      const c = await prisma.userBranchAssignment.count({ where: { workspaceId, userId: r.userId, branchId: LEGACY, NOT: { id: r.id } } });
      if (c > 0) fail(`reverse collision: UBA user ${r.userId} already on default`);
    }
    const res = await prisma.$transaction(async (tx) => {
      const done = {};
      for (const [name] of TABLES) {
        const model = tx[name.charAt(0).toLowerCase() + name.slice(1)];
        done[name] = 0;
        for (const r of m.rows[name]) {
          const u = await model.updateMany({ where: { id: r.id, workspaceId, branchId: canon.id }, data: { branchId: LEGACY } });
          if (u.count !== 1) {
            const cur = await model.findUnique({ where: { id: r.id }, select: { branchId: true } });
            if (cur?.branchId === LEGACY) continue; // already reversed (idempotent)
            throw new Error(`reverse ${name} ${r.id}: expected 1 row, got ${u.count}`);
          }
          done[name]++;
        }
      }
      return done;
    });
    console.log("REVERSED", JSON.stringify(res));
  } else {
    // ── plan ────────────────────────────────────────────────────────────────────────────────────────────────
    const rows = {};
    for (const [name, model, select] of TABLES) {
      rows[name] = await model.findMany({ where: { workspaceId, branchId: LEGACY }, select, orderBy: { id: "asc" } });
    }
    const counts = TABLES.map(([n]) => rows[n].length);
    console.log("PLAN", JSON.stringify(Object.fromEntries(TABLES.map(([n]) => [n, rows[n].map((r) => r.id)]))));

    const nothingLeft = counts.every((c) => c === 0);
    if (nothingLeft && mode === "apply" && manifestPath && existsSync(manifestPath)) {
      const m = JSON.parse(readFileSync(manifestPath, "utf-8"));
      let ok = true;
      for (const [name, model] of TABLES) for (const r of m.rows[name]) {
        const cur = await model.findUnique({ where: { id: r.id }, select: { branchId: true } });
        if (cur?.branchId !== canon.id) ok = false;
      }
      if (!ok) fail("nothing on default but manifest rows are not all canonical");
      console.log("NO-OP: already migrated (idempotent)");
      process.exit(0);
    }
    if (counts.join(",") !== expect.join(",")) fail(`count mismatch: found ${counts.join(",")} expected ${expect.join(",")}`);

    // ── collisions at the canonical target ──────────────────────────────────────────────────────────────────
    const bmdTarget = await prisma.branchMasterDesignation.count({ where: { workspaceId, branchId: canon.id } });
    if (bmdTarget > 0) fail("collision: BranchMasterDesignation already exists on canonical");
    for (const r of rows.UserBranchAssignment) {
      const c = await prisma.userBranchAssignment.count({ where: { workspaceId, userId: r.userId, branchId: canon.id } });
      if (c > 0) fail(`collision: UBA user ${r.userId} already on canonical`);
    }
    console.log("COLLISIONS none");

    if (mode === "dry-run") {
      console.log("DRY-RUN PASS", JSON.stringify(Object.fromEntries(TABLES.map(([n]) => [n, rows[n].length]))));
      process.exit(0);
    }

    // ── apply: manifest first, then one transaction by exact ids ────────────────────────────────────────────
    const manifest = {
      gate: "2A-2", createdAt: new Date().toISOString(), workspaceId, legacyKey: LEGACY,
      canonicalBranchId: canon.id, rows, contentOnDefaultBefore: contentBefore, applied: false,
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const res = await prisma.$transaction(async (tx) => {
      const done = {};
      for (const [name] of TABLES) {
        const model = tx[name.charAt(0).toLowerCase() + name.slice(1)];
        done[name] = 0;
        for (const r of rows[name]) {
          const u = await model.updateMany({ where: { id: r.id, workspaceId, branchId: LEGACY }, data: { branchId: canon.id } });
          if (u.count !== 1) throw new Error(`apply ${name} ${r.id}: expected 1 row, got ${u.count}`);
          done[name]++;
        }
      }
      return done;
    });
    manifest.applied = true; manifest.appliedAt = new Date().toISOString(); manifest.result = res;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log("APPLIED", JSON.stringify(res));
  }

  console.log("identity-on-default(after)", JSON.stringify(await identityCounts(LEGACY)));
  console.log("identity-on-canonical(after)", JSON.stringify(await identityCounts(canon.id)));
  const contentAfter = await contentSnapshot();
  console.log("content-on-default(after)", JSON.stringify(contentAfter));
  if (JSON.stringify(contentAfter) !== JSON.stringify(contentBefore)) fail("content counts changed — investigate");
  console.log("CONTENT UNCHANGED");
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  await prisma.$disconnect();
}
