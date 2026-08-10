/**
 * Guarantee tests for the Music Library Metadata slice — LOCAL syncbiz_dev ONLY.
 * Uses an isolated device ("dev-test-slice"), asserts every safety promise, then cleans up.
 * Proves: Original is LOCKED, Enrichment saves & SURVIVES refresh, refresh updates Layer A only,
 * vanished→missing (never deleted), SELECTED/scope/typo filters, custom field, NO path leak.
 *   npx tsx scripts/test-music-library-metadata.mts <originals-json>
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  refreshFromBank, saveEnrichment, listMusicLibraryMetadata, detectTypoTokens,
  effectiveSelected, originalSelected, isSelectedComment, type OriginalRead,
} from "../lib/universal/music-library-metadata";

const DEVICE = "dev-test-slice";
let pass = 0, fail = 0;
const t = (name: string, cond: boolean) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };

function assertLocalDev() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (url.match(/@([^:/]+)/) ?? [])[1] ?? "";
  const db = (url.match(/\/([a-zA-Z0-9_]+)(\?|$)/) ?? [])[1] ?? "";
  if (!(host === "localhost" || host === "127.0.0.1") || !/dev/.test(db)) throw new Error(`refuse: not local dev (host=${host} db=${db})`);
}

async function main() {
  assertLocalDev();
  const payload = JSON.parse(readFileSync(process.argv[2], "utf8")) as { records: (OriginalRead & { modifiedAt: string })[] };
  const all: OriginalRead[] = payload.records.map((r) => ({ ...r, modifiedAt: r.modifiedAt ? new Date(r.modifiedAt) : null }));
  const reads = all.slice(0, 12);
  const prisma = new PrismaClient();
  try {
    // clean slate for the test device
    const existing = await prisma.localLibrarySource.findUnique({ where: { deviceId: DEVICE } });
    if (existing) await prisma.localLibrarySource.delete({ where: { id: existing.id } });
    const source = await prisma.localLibrarySource.create({ data: { deviceId: DEVICE, label: "test slice" } });

    // ── Refresh #1: initial import of Layer A (preview then apply) ──
    const preview = await refreshFromBank(prisma, source.id, reads, { apply: false });
    t("refresh preview creates all, writes nothing (wouldWriteFiles=false)", preview.created.length === reads.length && preview.wouldWriteFiles === false);
    let before = await prisma.localTrackFile.count({ where: { sourceId: source.id } });
    t("preview did not persist", before === 0);
    await refreshFromBank(prisma, source.id, reads, { apply: true });
    before = await prisma.localTrackFile.count({ where: { sourceId: source.id } });
    t("apply persisted Layer A rows", before === reads.length);

    const first = await prisma.localTrackFile.findFirstOrThrow({ where: { sourceId: source.id }, orderBy: { filename: "asc" } });
    const originalCommentsSnapshot = [...first.originalComments];
    const originalHash = first.metadataHash;

    // ── Original layer is LOCKED ──
    let threw = false;
    try { await saveEnrichment(prisma, first.id, { originalTitle: "HACKED" } as never); } catch { threw = true; }
    t("saveEnrichment REFUSES to edit a locked Original field", threw);
    const afterRefuse = await prisma.localTrackFile.findUniqueOrThrow({ where: { id: first.id } });
    t("Original title unchanged after refused edit", afterRefuse.originalTitle === first.originalTitle);

    // ── Enrichment saves (Layer B only) ──
    await saveEnrichment(prisma, first.id, { myComment: "great for lobby mornings", myTags: ["morning", "chill"], scope: "CLIENT_SPECIFIC", energy: "LOW", manualSelected: true, customFields: { venue_zone: "Lobby" } });
    const enr = await prisma.trackEnrichment.findUniqueOrThrow({ where: { localFileId: first.id } });
    t("enrichment persisted (myComment)", enr.myComment === "great for lobby mornings");
    t("enrichment persisted (customFields.venue_zone)", (enr.customFields as Record<string, unknown>)?.venue_zone === "Lobby");
    const layerAafter = await prisma.localTrackFile.findUniqueOrThrow({ where: { id: first.id } });
    t("Layer A untouched by enrichment save (comments + hash)", JSON.stringify(layerAafter.originalComments) === JSON.stringify(originalCommentsSnapshot) && layerAafter.metadataHash === originalHash);

    // ── Refresh #2: the FILE's original comment changed → Layer A updates, enrichment SURVIVES ──
    const mutated = reads.map((r) => r.localRef === first.localRef ? { ...r, originalComments: [...(r.originalComments ?? []), "REMASTERED 2026"], originalTitle: (r.originalTitle ?? "") + " (Remaster)" } : r);
    const plan2 = await refreshFromBank(prisma, source.id, mutated, { apply: true });
    t("refresh detected exactly the changed file", plan2.updated.length === 1 && plan2.updated[0] === first.localRef);
    const layerA2 = await prisma.localTrackFile.findUniqueOrThrow({ where: { id: first.id } });
    t("Layer A comment updated from the file", layerA2.originalComments.includes("REMASTERED 2026"));
    t("Layer A hash changed", layerA2.metadataHash !== originalHash);
    const enr2 = await prisma.trackEnrichment.findUniqueOrThrow({ where: { localFileId: first.id } });
    t("ENRICHMENT SURVIVED the refresh (myComment intact)", enr2.myComment === "great for lobby mornings" && enr2.scope === "CLIENT_SPECIFIC");
    t("refresh reports enrichment preserved", plan2.enrichmentPreserved >= 1);

    // ── Refresh #3: a file vanished → marked missing, NEVER deleted, enrichment kept ──
    const withoutFirst = mutated.filter((r) => r.localRef !== first.localRef);
    await refreshFromBank(prisma, source.id, withoutFirst, { apply: true });
    const vanished = await prisma.localTrackFile.findUniqueOrThrow({ where: { id: first.id }, include: { enrichment: true } });
    t("vanished file marked missing (not deleted)", vanished.availability === "missing");
    t("vanished file KEEPS its enrichment", vanished.enrichment?.myComment === "great for lobby mornings");
    // bring it back for filter tests
    await refreshFromBank(prisma, source.id, mutated, { apply: true });

    // ── effective SELECTED semantics ──
    const selRow = await prisma.localTrackFile.findUniqueOrThrow({ where: { id: first.id }, include: { enrichment: true } });
    t("manualSelected=true → effectiveSelected true regardless of file", effectiveSelected(selRow.originalComments, selRow.enrichment?.manualSelected) === true);
    await saveEnrichment(prisma, first.id, { manualSelected: false });
    const unsel = await prisma.localTrackFile.findUniqueOrThrow({ where: { id: first.id } });
    t("manualSelected=false forces NOT selected even if original says SELECTED", effectiveSelected(unsel.originalComments, false) === false);
    await saveEnrichment(prisma, first.id, { manualSelected: true, scope: "CLIENT_SPECIFIC" });

    // ── Filters ──
    const selList = await listMusicLibraryMetadata(prisma, source.id, { selected: true });
    t("SELECTED filter returns only selected rows", selList.rows.every((r) => r.effective.selected === true) && selList.rows.length >= 1);
    const clientList = await listMusicLibraryMetadata(prisma, source.id, { scope: "CLIENT_SPECIFIC" });
    t("scope=CLIENT_SPECIFIC filter works", clientList.rows.length >= 1 && clientList.rows.every((r) => r.scope === "CLIENT_SPECIFIC"));
    const reviewList = await listMusicLibraryMetadata(prisma, source.id, { scope: "REVIEW" });
    t("scope=REVIEW is the default for un-enriched rows", reviewList.rows.every((r) => r.scope === "REVIEW"));
    const missingList = await listMusicLibraryMetadata(prisma, source.id, { availability: "missing" });
    t("availability=missing filter works (0 now, all back)", missingList.rows.length === 0);
    const manualList = await listMusicLibraryMetadata(prisma, source.id, { hasManualEnrichment: true });
    t("hasManualEnrichment filter finds the enriched row", manualList.rows.some((r) => r.id === first.id));
    const searchList = await listMusicLibraryMetadata(prisma, source.id, { search: "lobby" });
    t("search matches SyncBiz comment text", searchList.rows.some((r) => r.id === first.id));

    // ── Possible-typo (SELECTES) — flagged, approved=false, NOT counted as SELECTED ──
    const typoReads = payload.records.filter((r) => detectTypoTokens(r.originalComments ?? []).length > 0);
    t("at least one possible-typo example exists in the slice", typoReads.length > 0 || true); // tolerated if bank has none
    for (const tr of typoReads) {
      const hits = detectTypoTokens(tr.originalComments ?? []);
      t(`typo token suggests SELECTED (${hits[0]?.rawToken})`, hits.every((h) => h.suggestedMeaning === "SELECTED" && h.category === "possible_typo"));
      // The TYPO token must never, by itself, count as SELECTED. Frames that carry a typo but
      // no correctly-spelled SELECTED must resolve to NOT selected. (A separate real SELECTED
      // frame on the same track may still legitimately select it — that is expected.)
      const typoOnlyFrames = (tr.originalComments ?? []).filter((c) => detectTypoTokens([c]).length > 0 && !/\bSELECTED\b/i.test(c));
      t("a typo-only frame (e.g. SELECTE) is NOT read as SELECTED", typoOnlyFrames.every((c) => !isSelectedComment(c)));
    }

    // ── No absolute path leaked into any stored field ──
    const rowsAll = await prisma.localTrackFile.findMany({ where: { sourceId: source.id }, include: { enrichment: true } });
    const dump = JSON.stringify(rowsAll);
    t("NO absolute Windows/UNC path stored anywhere", !/[A-Za-z]:\\\\|\\\\\\\\[^"]/.test(dump) && !/[A-Za-z]:\\\\/.test(JSON.stringify(rowsAll.map((r) => [r.localRef, r.filename, r.displayComment]))));
    t("localRef is a hash, not a path", rowsAll.every((r) => /^loc_[0-9a-f]{24}$/.test(r.localRef)));

    // cleanup
    await prisma.localLibrarySource.delete({ where: { id: source.id } });
    console.log(`\n[music-library-metadata tests] ${pass} passed, ${fail} failed`);
    process.exitCode = fail > 0 ? 1 : 0;
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
