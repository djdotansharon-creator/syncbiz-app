/**
 * Seed the Music Library Metadata vertical slice into LOCAL syncbiz_dev ONLY.
 * Input = the read-only originals JSON (from desktop/scripts/read-50-originals.mjs).
 * Writes ONLY to Postgres (Layer A via refreshFromBank, plus a typo-review row + one custom field).
 * NEVER touches a music file. Refuses any non-local / non-dev database.
 *   DATABASE_URL=postgresql://…localhost…/syncbiz_dev npx tsx scripts/seed-music-library-metadata.mts <json>
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { refreshFromBank, detectTypoTokens, type OriginalRead } from "../lib/universal/music-library-metadata";

function assertLocalDev() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (url.match(/@([^:/]+)/) ?? [])[1] ?? "";
  const db = (url.match(/\/([a-zA-Z0-9_]+)(\?|$)/) ?? [])[1] ?? "";
  if (!(host === "localhost" || host === "127.0.0.1") || !/dev/.test(db))
    throw new Error(`refuse: DATABASE_URL must be LOCAL syncbiz_dev (got host=${host} db=${db})`);
  if ((process.env.SYNCBIZ_ENV ?? "development") !== "development") throw new Error("refuse: SYNCBIZ_ENV must be development");
  return { host, db };
}

async function main() {
  const target = assertLocalDev();
  const jsonPath = process.argv[2];
  const payload = JSON.parse(readFileSync(jsonPath, "utf8")) as { deviceId: string; records: (OriginalRead & { modifiedAt: string })[] };
  const reads: OriginalRead[] = payload.records.map((r) => ({ ...r, modifiedAt: r.modifiedAt ? new Date(r.modifiedAt) : null }));

  const prisma = new PrismaClient();
  try {
    console.log(`[seed] target host=${target.host} db=${target.db} device=${payload.deviceId} records=${reads.length}`);
    const source = await prisma.localLibrarySource.upsert({
      where: { deviceId: payload.deviceId }, create: { deviceId: payload.deviceId, label: "Local bank (dev slice)" }, update: {},
    });

    // Layer A ONLY — one-way MP3→SyncBiz. Preview first, then apply.
    const preview = await refreshFromBank(prisma, source.id, reads, { apply: false });
    console.log(`[seed] refresh preview: created=${preview.created.length} updated=${preview.updated.length} unchanged=${preview.unchanged.length} missing=${preview.missing.length}`);
    const applied = await refreshFromBank(prisma, source.id, reads, { apply: true });
    console.log(`[seed] refresh applied: created=${applied.created.length} updated=${applied.updated.length} unchanged=${applied.unchanged.length}`);

    // Possible-typo review queue (e.g. SELECTES → SELECTED). approved=false; comment NEVER changed.
    const typoCounts = new Map<string, { suggestion: string; confidence: string; n: number }>();
    for (const r of reads) for (const hit of detectTypoTokens(r.originalComments ?? [])) {
      const key = hit.rawToken.toUpperCase();
      const cur = typoCounts.get(key) ?? { suggestion: hit.suggestedMeaning, confidence: hit.confidence, n: 0 };
      cur.n++; typoCounts.set(key, cur);
    }
    for (const [rawToken, v] of typoCounts) {
      await prisma.commentTokenReview.upsert({
        where: { rawToken }, create: { rawToken, suggestedMeaning: v.suggestion, category: "possible_typo", confidence: v.confidence, occurrences: v.n, approved: false },
        update: { occurrences: v.n, suggestedMeaning: v.suggestion },
      });
    }
    console.log(`[seed] possible-typo tokens: ${[...typoCounts.keys()].join(", ") || "(none)"}`);

    // One example Custom Field (SyncBiz-only; never an MP3 tag).
    await prisma.customFieldDefinition.upsert({
      where: { name: "venue_zone" }, create: { name: "venue_zone", label: "Venue Zone", type: "select", allowedOptions: ["Lobby", "Bar", "Main Floor", "Patio"], active: true, displayOrder: 1 }, update: {},
    });
    console.log("[seed] custom field: venue_zone (select)");
    console.log("[seed] DONE — LocalTrackFile(Layer A) + typo review + custom field seeded to syncbiz_dev.");
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
