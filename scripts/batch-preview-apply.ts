/**
 * Batch Preview → (optional) Apply for the Music Library Metadata slice — LOCAL syncbiz_dev ONLY.
 * Preview is the default. Apply writes ONLY Original Metadata (Layer A) to syncbiz_dev; enrichment untouched.
 * NEVER writes a music file.  Music files modified is always 0.
 *   npx tsx scripts/batch-preview-apply.ts <batch-json> [--apply]
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { refreshFromBank, detectTypoTokens, isSelectedComment, type OriginalRead } from "../lib/universal/music-library-metadata";

function assertLocalDev() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (url.match(/@([^:/]+)/) ?? [])[1] ?? "";
  const db = (url.match(/\/([a-zA-Z0-9_]+)(\?|$)/) ?? [])[1] ?? "";
  if (!(host === "localhost" || host === "127.0.0.1") || !/dev/.test(db)) throw new Error(`STOP: target must be LOCAL syncbiz_dev (host=${host} db=${db}) — refusing to write.`);
  if ((process.env.SYNCBIZ_ENV ?? "development") !== "development") throw new Error("STOP: SYNCBIZ_ENV must be development.");
  return { host, db };
}

async function main() {
  const target = assertLocalDev();
  const apply = process.argv.includes("--apply");
  const payload = JSON.parse(readFileSync(process.argv[2], "utf8")) as { deviceId: string; count: number; report: Record<string, unknown>; records: (OriginalRead & { modifiedAt: string })[] };
  const reads: OriginalRead[] = payload.records.map((r) => ({ ...r, modifiedAt: r.modifiedAt ? new Date(r.modifiedAt) : null }));

  const prisma = new PrismaClient();
  try {
    console.log(`[batch] DB target host=${target.host} db=${target.db}  |  device=${payload.deviceId}  |  records=${reads.length}  |  mode=${apply ? "APPLY" : "PREVIEW"}`);
    const source = await prisma.localLibrarySource.upsert({ where: { deviceId: payload.deviceId }, create: { deviceId: payload.deviceId, label: "Local bank (dev)" }, update: {} });

    const enrichmentBefore = await prisma.trackEnrichment.count({ where: { localFile: { sourceId: source.id } } });
    const preview = await refreshFromBank(prisma, source.id, reads, { apply: false });

    const selectedCount = reads.filter((r) => (r.originalComments ?? []).some((c) => isSelectedComment(c))).length;
    const typoTokens = new Set<string>();
    for (const r of reads) for (const h of detectTypoTokens(r.originalComments ?? [])) typoTokens.add(h.rawToken.toUpperCase());
    const pathLeak = /[A-Za-z]:\\/.test(JSON.stringify(reads.map((r) => [r.localRef, r.filename])));

    const report = {
      ...payload.report,
      new: preview.created.length, changed: preview.updated.length, unchanged: preview.unchanged.length, missing: preview.missing.length,
      proposedDbMutations: preview.syncbizDbChangesProposed, enrichmentPreserved: preview.enrichmentPreserved,
      selectedTracks: selectedCount, possibleTypoTokens: [...typoTokens], absolutePathLeaks: pathLeak ? "YES" : 0,
      musicFilesModified: preview.musicFilesModified,
    };
    console.log("[batch] PREVIEW REPORT:\n" + JSON.stringify(report, null, 2));

    if (!apply) { console.log("[batch] preview only — nothing written. Re-run with --apply to write Layer A to syncbiz_dev."); return; }
    if (pathLeak) throw new Error("STOP: absolute path leak detected — refusing to apply.");
    if (preview.musicFilesModified !== 0) throw new Error("STOP: musicFilesModified != 0 — refusing to apply.");

    // ── APPLY (Layer A only) ──
    const applied = await refreshFromBank(prisma, source.id, reads, { apply: true });
    // typo review queue (approved=false) + custom field (idempotent) so the screen is complete
    for (const raw of typoTokens) await prisma.commentTokenReview.upsert({ where: { rawToken: raw }, create: { rawToken: raw, suggestedMeaning: "SELECTED", category: "possible_typo", confidence: "possible typo", approved: false }, update: {} });
    await prisma.customFieldDefinition.upsert({ where: { name: "venue_zone" }, create: { name: "venue_zone", label: "Venue Zone", type: "select", allowedOptions: ["Lobby", "Bar", "Main Floor", "Patio"], displayOrder: 1 }, update: {} });

    // ── POST-APPLY VERIFY ──
    let vPass = 0, vFail = 0; const v = (n: string, c: boolean) => { if (c) vPass++; else { vFail++; console.error("  ✗ " + n); } };
    const availableCount = await prisma.localTrackFile.count({ where: { sourceId: source.id, availability: "available" } });
    v(`available records == batch size (${reads.length})`, availableCount === reads.length);
    const rePreview = await refreshFromBank(prisma, source.id, reads, { apply: false });
    v("idempotent re-read: 0 new, 0 changed", rePreview.created.length === 0 && rePreview.updated.length === 0);
    const allRefs = await prisma.localTrackFile.findMany({ where: { sourceId: source.id }, select: { localRef: true } });
    v("no duplicate localRef", new Set(allRefs.map((r) => r.localRef)).size === allRefs.length);
    const enrichmentAfter = await prisma.trackEnrichment.count({ where: { localFile: { sourceId: source.id } } });
    v(`enrichment preserved (before ${enrichmentBefore} == after ${enrichmentAfter})`, enrichmentAfter === enrichmentBefore);
    const dump = JSON.stringify(await prisma.localTrackFile.findMany({ where: { sourceId: source.id }, select: { localRef: true, filename: true, displayComment: true } }));
    v("no absolute path stored", !/[A-Za-z]:\\/.test(dump));
    v("music files modified == 0 (invariant)", applied.musicFilesModified === 0);

    console.log(`[batch] APPLIED: new=${applied.created.length} changed=${applied.updated.length} unchanged=${applied.unchanged.length} missing=${applied.missing.length}`);
    console.log(`[batch] POST-APPLY VERIFY: ${vPass} passed, ${vFail} failed  |  available=${availableCount}  enrichment=${enrichmentAfter}`);
    process.exitCode = vFail > 0 ? 1 : 0;
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
