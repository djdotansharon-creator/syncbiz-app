/**
 * Scale verification for the 250-song batch — LOCAL syncbiz_dev ONLY, device "dev-local-bank".
 * Read-mostly; makes one reversible enrichment edit + a missing→restore cycle, then leaves the slice.
 *   npx tsx scripts/verify-batch-250.ts <originals-json>
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { refreshFromBank, listMusicLibraryMetadata, saveEnrichment, detectTypoTokens, type OriginalRead } from "../lib/universal/music-library-metadata";

const DEVICE = "dev-local-bank";
let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = "") => { if (cond) pass++; else { fail++; console.error(`  ✗ ${name} ${extra}`); } };

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)/.test(url) || !/dev/.test(url)) throw new Error("refuse: not local dev");
  const payload = JSON.parse(readFileSync(process.argv[2], "utf8")) as { records: (OriginalRead & { modifiedAt: string })[] };
  const reads: OriginalRead[] = payload.records.map((r) => ({ ...r, modifiedAt: r.modifiedAt ? new Date(r.modifiedAt) : null }));
  const prisma = new PrismaClient();
  try {
    const source = await prisma.localLibrarySource.findUniqueOrThrow({ where: { deviceId: DEVICE } });

    const all = await listMusicLibraryMetadata(prisma, source.id, {});
    t(`seeded count == ${reads.length}`, all.total === reads.length, `(got ${all.total})`);

    const sel = await listMusicLibraryMetadata(prisma, source.id, { selected: true });
    t("SELECTED filter returns >0 and only selected", sel.rows.length > 0 && sel.rows.every((r) => r.effective.selected), `(${sel.rows.length})`);

    const typo = await listMusicLibraryMetadata(prisma, source.id, { possibleTypo: true });
    t("possible-typo rows exist and suggest SELECTED", typo.rows.length > 0 && typo.rows.every((r) => r.possibleTypos.every((h) => h.suggestedMeaning === "SELECTED")), `(${typo.rows.length})`);

    const multi = all.rows.filter((r) => r.original.comments.length > 1);
    t("multiple-comment rows are preserved as separate frames", multi.length > 0, `(${multi.length})`);

    // search hits a known artist token
    const anyArtist = all.rows.find((r) => r.original.artists[0])?.original.artists[0] ?? "";
    if (anyArtist) { const s = await listMusicLibraryMetadata(prisma, source.id, { search: anyArtist.slice(0, 4) }); t("search returns matches", s.rows.length > 0); }

    // all 6 scopes assignable + read back (uses 6 distinct rows)
    const SCOPES = ["GENERAL", "CLIENT_SPECIFIC", "EVENT_SPECIFIC", "INTERNAL", "REVIEW", "IGNORE"] as const;
    const sample = all.rows.slice(0, 6);
    for (let i = 0; i < SCOPES.length && i < sample.length; i++) await saveEnrichment(prisma, sample[i].id, { scope: SCOPES[i] });
    for (let i = 0; i < SCOPES.length && i < sample.length; i++) {
      const list = await listMusicLibraryMetadata(prisma, source.id, { scope: SCOPES[i] });
      t(`scope ${SCOPES[i]} assignable & filterable`, list.rows.some((r) => r.id === sample[i].id));
    }

    // edit → refresh(apply) preserves enrichment; Layer A only; music files modified = 0
    const target = sample[0];
    await saveEnrichment(prisma, target.id, { myComment: "batch-250 verify note", myTags: ["verify"] });
    const plan = await refreshFromBank(prisma, source.id, reads, { apply: true });
    t("refresh music files modified == 0", plan.musicFilesModified === 0);
    t("refresh music files read == batch size", plan.musicFilesRead === reads.length);
    const afterRefresh = await prisma.trackEnrichment.findUniqueOrThrow({ where: { localFileId: target.id } });
    t("enrichment SURVIVES refresh at scale", afterRefresh.myComment === "batch-250 verify note");

    // missing → restore (never deletes)
    const dropOne = reads.filter((r) => r.localRef !== target.localRef);
    await refreshFromBank(prisma, source.id, dropOne, { apply: true });
    const missing = await prisma.localTrackFile.findFirstOrThrow({ where: { sourceId: source.id, localRef: target.localRef }, include: { enrichment: true } });
    t("dropped file marked missing (not deleted) + keeps enrichment", missing.availability === "missing" && missing.enrichment?.myComment === "batch-250 verify note");
    await refreshFromBank(prisma, source.id, reads, { apply: true });
    const restored = await prisma.localTrackFile.findFirstOrThrow({ where: { sourceId: source.id, localRef: target.localRef } });
    t("restored file back to available", restored.availability === "available");

    // no absolute paths anywhere
    const dump = JSON.stringify(await prisma.localTrackFile.findMany({ where: { sourceId: source.id }, include: { enrichment: true } }));
    t("NO absolute Windows/UNC path stored", !/[A-Za-z]:\\\\/.test(dump) && !/\\\\\\\\[^"]+\\\\/.test(dump));
    const rows = await prisma.localTrackFile.findMany({ where: { sourceId: source.id }, select: { localRef: true } });
    t("every localRef is a hash", rows.every((r) => /^loc_[0-9a-f]{24}$/.test(r.localRef)));

    console.log(`\n[batch-250 verify] ${pass} passed, ${fail} failed  (total rows: ${all.total}, selected: ${sel.rows.length}, typos: ${typo.rows.length}, multi-comment: ${multi.length})`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
