/**
 * Proves the single identity path (ensureUniversalTrackId) NEVER false-merges different versions.
 * Runs against LOCAL syncbiz_dev, creates only its own temp rows, and deletes them in `finally`.
 *   DATABASE_URL=postgresql://…@localhost:5432/syncbiz_dev npx tsx scripts/test-identity-no-false-merge.ts
 */
import { PrismaClient } from "@prisma/client";
import { ensureUniversalTrackId } from "../lib/universal/ensure-universal-track";

// Read the connection from env (see .env.development.example) — never hardcode a credential.
const LOCAL = process.env.DATABASE_URL ?? "postgresql://postgres@localhost:5432/syncbiz_dev";
function assertLocalDev() {
  const url = LOCAL;
  if (!/@(localhost|127\.0\.0\.1)/.test(url) || !/dev/.test(url)) throw new Error("refuse: not local dev DB");
}

async function main() {
  assertLocalDev();
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL } } });
  const created = new Set<string>();
  let pass = 0, fail = 0;
  const check = (cond: boolean, msg: string) => { cond ? (pass++, console.log("  ✓ " + msg)) : (fail++, console.log("  ✗ FAIL: " + msg)); };
  const RUN = String(Date.now());
  const mk = (s: string) => `IDTEST_${RUN}_${s}`;

  try {
    // 1) Same title, different externalId → SEPARATE Recordings (no false merge).
    const a = await ensureUniversalTrackId(prisma, { provider: "youtube", externalId: `${RUN}_vidA`, title: mk("Same Title") }); created.add(a.universalTrackId);
    const b = await ensureUniversalTrackId(prisma, { provider: "youtube", externalId: `${RUN}_vidB`, title: mk("Same Title") }); created.add(b.universalTrackId);
    check(a.universalTrackId !== b.universalTrackId, "same title + different externalId → separate Recordings");
    check(a.created && b.created, "both were created (no strong match by title)");

    // 2) Same provider+externalId (mapping exists) → REUSE.
    await prisma.providerMapping.create({ data: { provider: "youtube", externalId: `${RUN}_vidA`, externalUrl: "https://example.com/x", universalTrackId: a.universalTrackId, playableStatus: "PLAYABLE" } });
    const a2 = await ensureUniversalTrackId(prisma, { provider: "youtube", externalId: `${RUN}_vidA`, title: mk("Different Title Same Asset") });
    check(a2.universalTrackId === a.universalTrackId && a2.method === "provider_external_id", "same provider+externalId (mapping exists) → reuse");

    // 3) Original / Extended / Live with different externalIds → 3 Recordings.
    const v1 = await ensureUniversalTrackId(prisma, { provider: "youtube", externalId: `${RUN}_o`, title: mk("Song X (Original)") }); created.add(v1.universalTrackId);
    const v2 = await ensureUniversalTrackId(prisma, { provider: "youtube", externalId: `${RUN}_e`, title: mk("Song X (Extended Mix)") }); created.add(v2.universalTrackId);
    const v3 = await ensureUniversalTrackId(prisma, { provider: "youtube", externalId: `${RUN}_l`, title: mk("Song X (Live)") }); created.add(v3.universalTrackId);
    check(new Set([v1, v2, v3].map((x) => x.universalTrackId)).size === 3, "Original/Extended/Live (different externalIds) → 3 separate Recordings");

    // 4) No strong id → a NEW Recording every time (False Duplicate > False Merge).
    const n1 = await ensureUniversalTrackId(prisma, { title: mk("No Strong Id") }); created.add(n1.universalTrackId);
    const n2 = await ensureUniversalTrackId(prisma, { title: mk("No Strong Id") }); created.add(n2.universalTrackId);
    check(n1.universalTrackId !== n2.universalTrackId, "no strong id → new Recording each time");

    // 5) Same ISRC (even different title) → REUSE (strong cross-source identity).
    const isrc = `TESTISRC${RUN.slice(-8)}`;
    const i1 = await ensureUniversalTrackId(prisma, { title: mk("ISRC One"), isrc }); created.add(i1.universalTrackId);
    const i2 = await ensureUniversalTrackId(prisma, { title: mk("ISRC Totally Different Title"), isrc });
    check(i2.universalTrackId === i1.universalTrackId && i2.method === "isrc", "same ISRC (different title) → reuse");

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    await prisma.providerMapping.deleteMany({ where: { universalTrackId: { in: [...created] } } }).catch(() => {});
    await prisma.universalTrack.deleteMany({ where: { id: { in: [...created] } } }).catch(() => {});
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
