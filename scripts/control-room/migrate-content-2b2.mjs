/**
 * CONTROL ROOM GATE 2B-2 (ops, TEST) — move branch-scoped CONTENT rows of ONE workspace from the legacy branch key
 * "default" to that workspace's canonical Branch (Branch.legacyKey = "default").
 * Tables: Playlist, JinglePadAssignment, Announcement, Source (incl. radio), Schedule.
 * NEVER touches identity tables (done in 2A-2), PlaybackIncident telemetry, rows with an empty/null branch, other
 * workspaces (incl. workspace "system"), or any other column. No network calls; WS / app untouched.
 *
 * Runs INSIDE the app container (uses DATABASE_URL from its env). Prints no secrets.
 *   node migrate-content-2b2.mjs <workspaceId> <canonicalBranchId> --expect=<pl>,<pad>,<ann>,<src>,<sch> --dry-run
 *   node migrate-content-2b2.mjs <workspaceId> <canonicalBranchId> --expect=... --apply   --manifest=<path>
 *   node migrate-content-2b2.mjs <workspaceId> <canonicalBranchId> --reverse --manifest=<path>
 *
 * Fail-closed: exact canonical lookup; "default" counts must equal --expect; a jingle pad present under BOTH
 * "default" and canonical stops the run (no merge / delete / guess); every per-row update must hit exactly 1 row
 * (one transaction). Each row's content fingerprint (all columns except branchId / updatedAt) is recorded in the
 * manifest and re-checked after apply. Idempotent; reverse moves exactly the manifest row ids back.
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
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
if (workspaceId === "system") fail("refusing workspace 'system'");
const TABLES = ["playlist", "jinglePadAssignment", "announcement", "source", "schedule"];
if (mode !== "reverse" && (expect.length !== TABLES.length || expect.some((n) => !Number.isInteger(n) || n < 0))) fail(`--expect=<${TABLES.join(">,<")}> required`);
if (mode !== "dry-run" && !manifestPath) fail("--manifest=<path> required");

const prisma = new PrismaClient();

function fingerprint(row) {
  const { branchId, updatedAt, ...rest } = row;
  const sorted = Object.fromEntries(Object.keys(rest).sort().map((k) => [k, rest[k] instanceof Date ? rest[k].toISOString() : rest[k]]));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}
async function counts(branchId) {
  const out = {};
  for (const t of TABLES) out[t] = await prisma[t].count({ where: { workspaceId, branchId } });
  return out;
}
async function padConflicts(canonical) {
  const pads = await prisma.jinglePadAssignment.findMany({ where: { workspaceId, branchId: { in: [LEGACY, canonical] } }, select: { padId: true, branchId: true } });
  const by = new Map();
  for (const p of pads) by.set(p.padId, new Set([...(by.get(p.padId) ?? []), p.branchId]));
  return [...by].filter(([, s]) => s.size > 1).map(([padId]) => padId);
}
async function otherSnapshot() {
  // Rows OUTSIDE the migration scope (other workspaces, or this workspace on any branch other than default/canonical,
  // or null branch) — fingerprinted before and after to prove nothing unrelated changed.
  const h = createHash("sha256");
  for (const t of TABLES) {
    const rows = await prisma[t].findMany({
      where: { OR: [{ workspaceId: { not: workspaceId } }, { workspaceId, branchId: { notIn: [LEGACY, canonicalArg] } }] },
      orderBy: { id: "asc" },
    });
    for (const r of rows) h.update(`${t}:${r.id}:${fingerprint(r)}:${r.branchId}\n`);
  }
  if (TABLES.includes("playlist")) {
    const nulls = await prisma.playlist.findMany({ where: { branchId: null }, orderBy: { id: "asc" } });
    for (const r of nulls) h.update(`playlist-null:${r.id}:${fingerprint(r)}\n`);
  }
  return h.digest("hex");
}

try {
  const canon = await prisma.branch.findUnique({
    where: { workspaceId_legacyKey: { workspaceId, legacyKey: LEGACY } },
    select: { id: true, code: true, legacyKey: true, workspaceId: true },
  });
  if (!canon) fail("canonical Branch (legacyKey=default) not found in workspace");
  if (canon.id !== canonicalArg) fail(`canonical mismatch: db=${canon.id} arg=${canonicalArg}`);
  console.log("canonical", JSON.stringify(canon));
  console.log("content-on-default(before)", JSON.stringify(await counts(LEGACY)));
  console.log("content-on-canonical(before)", JSON.stringify(await counts(canon.id)));
  const otherBefore = await otherSnapshot();
  console.log("out-of-scope-fingerprint(before)", otherBefore.slice(0, 16));

  if (mode === "reverse") {
    if (!existsSync(manifestPath)) fail("manifest not found");
    const m = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (m.workspaceId !== workspaceId || m.canonicalBranchId !== canon.id) fail("manifest workspace/canonical mismatch");
    for (const r of m.rows.filter((x) => x.table === "jinglePadAssignment")) {
      const c = await prisma.jinglePadAssignment.count({ where: { workspaceId, branchId: LEGACY, padId: r.padId, NOT: { id: r.id } } });
      if (c > 0) fail(`reverse collision: pad ${r.padId} already on default`);
    }
    const res = await prisma.$transaction(async (tx) => {
      const done = Object.fromEntries(TABLES.map((t) => [t, 0]));
      for (const r of m.rows) {
        const u = await tx[r.table].updateMany({ where: { id: r.id, workspaceId, branchId: canon.id }, data: { branchId: r.oldBranchId } });
        if (u.count !== 1) {
          const cur = await tx[r.table].findUnique({ where: { id: r.id }, select: { branchId: true } });
          if (cur?.branchId === r.oldBranchId) continue; // already reversed (idempotent)
          throw new Error(`reverse ${r.table} ${r.id}: expected 1 row, got ${u.count}`);
        }
        done[r.table]++;
      }
      return done;
    });
    console.log("REVERSED", JSON.stringify(res));
  } else {
    const rows = [];
    for (const t of TABLES) {
      const found = await prisma[t].findMany({ where: { workspaceId, branchId: LEGACY }, orderBy: { id: "asc" } });
      for (const r of found) {
        rows.push({ table: t, id: r.id, oldBranchId: LEGACY, newBranchId: canon.id, fingerprint: fingerprint(r), ...(t === "jinglePadAssignment" ? { padId: r.padId } : {}) });
      }
    }
    const planned = Object.fromEntries(TABLES.map((t) => [t, rows.filter((r) => r.table === t).length]));
    console.log("PLAN", JSON.stringify(rows.map((r) => [r.table, r.id])));
    console.log("PLANNED", JSON.stringify(planned));

    if (rows.length === 0 && mode === "apply" && manifestPath && existsSync(manifestPath)) {
      const m = JSON.parse(readFileSync(manifestPath, "utf-8"));
      for (const r of m.rows) {
        const cur = await prisma[r.table].findUnique({ where: { id: r.id }, select: { branchId: true } });
        if (cur?.branchId !== canon.id) fail(`nothing on default but manifest row ${r.table} ${r.id} is not canonical`);
      }
      console.log("NO-OP: already migrated (idempotent)");
      process.exit(0);
    }
    const got = TABLES.map((t) => planned[t]);
    if (got.join(",") !== expect.join(",")) fail(`count mismatch: found ${got.join(",")} expected ${expect.join(",")}`);

    const conflicts = await padConflicts(canon.id);
    if (conflicts.length > 0) fail(`pad conflict (same pad under default AND canonical): ${conflicts.join(",")}`);
    console.log("PAD CONFLICTS none");

    if (mode === "dry-run") {
      console.log("DRY-RUN PASS", JSON.stringify(planned));
      process.exit(0);
    }

    const manifest = {
      gate: "2B-2", createdAt: new Date().toISOString(), workspaceId, legacyKey: LEGACY, canonicalBranchId: canon.id,
      planned, rows, outOfScopeFingerprintBefore: otherBefore, applied: false,
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const res = await prisma.$transaction(async (tx) => {
      const done = Object.fromEntries(TABLES.map((t) => [t, 0]));
      for (const r of rows) {
        const u = await tx[r.table].updateMany({ where: { id: r.id, workspaceId, branchId: LEGACY }, data: { branchId: canon.id } });
        if (u.count !== 1) throw new Error(`apply ${r.table} ${r.id}: expected 1 row, got ${u.count}`);
        done[r.table]++;
      }
      return done;
    });
    manifest.applied = true; manifest.appliedAt = new Date().toISOString(); manifest.result = res;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log("APPLIED", JSON.stringify(res));

    // Post-apply proof: same ids, canonical branch, identical content fingerprints.
    let bad = 0;
    for (const r of rows) {
      const cur = await prisma[r.table].findUnique({ where: { id: r.id } });
      if (!cur || cur.branchId !== canon.id || fingerprint(cur) !== r.fingerprint) { bad++; console.log("MISMATCH", r.table, r.id); }
    }
    console.log(bad === 0 ? "POST-APPLY: ids preserved, branch canonical, content fingerprints identical" : `POST-APPLY: ${bad} mismatches`);
    const conflictsAfter = await padConflicts(canon.id);
    console.log("PAD CONFLICTS after", conflictsAfter.length === 0 ? "none" : conflictsAfter.join(","));
  }

  console.log("content-on-default(after)", JSON.stringify(await counts(LEGACY)));
  console.log("content-on-canonical(after)", JSON.stringify(await counts(canon.id)));
  const otherAfter = await otherSnapshot();
  console.log("out-of-scope-fingerprint(after)", otherAfter.slice(0, 16), otherAfter === otherBefore ? "UNCHANGED" : "CHANGED");
  if (otherAfter !== otherBefore) fail("rows outside the migration scope changed — investigate");
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  await prisma.$disconnect();
}
