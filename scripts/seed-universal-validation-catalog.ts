/**
 * Phase V1 — controlled LOCAL seed of representative CatalogItems for validating the
 * universal-music backfill / resolver. LOCAL DEV ONLY (guarded). No production, no
 * pg_dump, no real customer metadata. All rows carry a stable marker so the seed is
 * idempotent (re-run = upsert, no duplicates) and cleanup removes ONLY seed data.
 *
 *   npx tsx scripts/seed-universal-validation-catalog.ts             # dry-run (default)
 *   npx tsx scripts/seed-universal-validation-catalog.ts --apply     # write to LOCAL DB
 *   npx tsx scripts/seed-universal-validation-catalog.ts --cleanup --apply   # remove seed only
 *
 * Contains NO passwords, users, account IDs, tokens, customer IDs, or personal data.
 */

import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { assertSafeIngestionTarget } from "@/lib/universal/ingestion-env-guard";
import { versionTypeFromTitle } from "@/lib/universal/normalize";

export const SEED_MARKER = "[[seed:universal-validation-v1]]";

type Expect = "valid" | "invalid" | "dup";
interface SeedSpec {
  caseTag: string;
  language: "en" | "he" | "ar" | "mixed";
  provider: "youtube" | "spotify" | "soundcloud" | "direct";
  url: string;
  videoId: string | null;
  title: string;
  artist: string | null;
  durationSec: number | null;
  expect: Expect;
}

let ytCounter = 0;
const nextVideoId = () => "sv" + String(++ytCounter).padStart(9, "0"); // 11 chars, valid charset
const ytUrl = (id: string, suffix = "") => `https://www.youtube.com/watch?v=${id}${suffix}`;

const items: SeedSpec[] = [];
function addYt(
  caseTag: string,
  language: SeedSpec["language"],
  title: string,
  artist: string | null,
  durationSec: number | null,
  expect: Expect = "valid",
): string {
  const videoId = nextVideoId();
  items.push({ caseTag, language, provider: "youtube", url: ytUrl(videoId), videoId, title, artist, durationSec, expect });
  return videoId;
}

// ── Version matrix (same base title + artist → version detection + resolver clustering) ──
const VERSIONS: Array<[string, string]> = [
  ["Original", "Midnight Avenue"],
  ["Live", "Midnight Avenue (Live at the Roxy)"],
  ["Remix", "Midnight Avenue (Club Remix)"],
  ["Radio Edit", "Midnight Avenue (Radio Edit)"],
  ["Extended", "Midnight Avenue (Extended Mix)"],
  ["Remaster", "Midnight Avenue (2024 Remaster)"],
  ["Acoustic", "Midnight Avenue (Acoustic)"],
  ["Instrumental", "Midnight Avenue (Instrumental)"],
  ["Cover", "Midnight Avenue (Cover)"],
  ["Karaoke", "Midnight Avenue (Karaoke Version)"],
  ["Sped Up", "Midnight Avenue (Sped Up)"],
  ["Slowed", "Midnight Avenue (Slowed + Reverb)"],
];
for (const [v, t] of VERSIONS) addYt(`version:${v}`, "en", t, "Nova Kane", 210);

// ── Artist patterns ──
addYt("artist:single", "en", "Paper Planes", "Ivy Sol", 190);
addYt("artist:two-amp", "en", "Neon Skyline", "Ivy Sol & Rio Marsh", 200);
addYt("artist:feat", "en", "Slow Motion", "Ivy Sol feat. Suki Lane", 205);
addYt("artist:x", "en", "Afterglow", "Ivy Sol x DJ Petra", 215);
addYt("artist:with", "en", "Embers", "Ivy Sol with The Embers", 220);
addYt("artist:spelling-fold-1", "en", "Halo Lights", "Beyonce", 200); // folds to same normalizedName as ↓
addYt("artist:spelling-fold-2", "en", "Second Sun", "Beyoncé", 205);
addYt("artist:spelling-diff-1", "en", "Night Drive", "The Weeknd", 200); // different normalized vs ↓
addYt("artist:spelling-diff-2", "en", "Night Drive II", "The Weekend", 205);

// ── Hebrew ──
addYt("lang:he", "he", "שיר הקיץ", "עדן ברזל", 200);
addYt("lang:he-version", "he", "אור וצל (רמיקס)", "דנה גל", 210); // Hebrew "remix" text — English-only detector won't catch (known)
addYt("lang:he", "he", "דרך העיר", "יונת שדה", 195);
addYt("lang:he", "he", "לב שבור", "עומר טל", 205);
addYt("lang:he", "he", "בין הכוכבים", "מיה רון", 188);
addYt("lang:he-multi", "he", "חול ורוח", "עדן ברזל feat. מיה רון", 212);

// ── Arabic ──
addYt("lang:ar", "ar", "ليلة القمر", "سمير الحلبي", 200);
addYt("lang:ar", "ar", "قلبي معك", "ليان مراد", 210);
addYt("lang:ar", "ar", "طريق النور", "سمير الحلبي", 198);
addYt("lang:ar", "ar", "حبيبي", "نور الشام", 205);
addYt("lang:ar", "ar", "أغنية عربية", "فرقة الأمل", 190);
addYt("lang:ar-version", "ar", "ليلة القمر (ريمكس)", "سمير الحلبي", 215);

// ── Mixed language ──
addYt("lang:mixed", "mixed", "Tel Aviv Nights", "Ivy Sol & עדן ברזל", 210);
addYt("lang:mixed", "mixed", "שקיעה — Sunset", "Mara Vitale", 200);
addYt("lang:mixed", "mixed", "Cairo Sky سماء", "Nova Kane", 205);

// ── Matching cases ──
addYt("match:same-title-diff-artist", "en", "Golden Hour", "Ivy Sol", 200);
addYt("match:same-title-diff-artist", "en", "Golden Hour", "Marco Vitale", 240);
addYt("match:punctuation", "en", "Don't Look Back", "Rio Marsh", 200);
addYt("match:punctuation", "en", "Dont Look Back", "Rio Marsh", 200);
addYt("match:capitalization", "en", "SUMMER RAIN", "Suki Lane", 200);
addYt("match:capitalization", "en", "Summer Rain", "Suki Lane", 200);
addYt("match:near-duration", "en", "Paper Moon", "Nova Kane", 200);
addYt("match:near-duration", "en", "Paper Moon", "Nova Kane", 202);
addYt("match:far-duration", "en", "Long Jam", "DJ Petra", 200);
addYt("match:far-duration", "en", "Long Jam", "DJ Petra", 600);

// duplicate videoId (same video, different URL) → backfill should flag a duplicate mapping
const dupVideoId = addYt("match:dup-videoid-1", "en", "Echo Chamber", "Rio Marsh", 200);
items.push({
  caseTag: "match:dup-videoid-2", language: "en", provider: "youtube",
  url: ytUrl(dupVideoId, "&feature=share"), videoId: dupVideoId,
  title: "Echo Chamber (Alt Upload)", artist: "Rio Marsh", durationSec: 200, expect: "dup",
});

// missing metadata
addYt("meta:no-duration", "en", "Weightless", "Mara Vitale", null);
addYt("meta:no-artist", "en", "Untitled Demo", null, 180);

// no external id (YouTube provider but no resolvable video id) → intentionally invalid
items.push({
  caseTag: "meta:no-external-id", language: "en", provider: "youtube",
  url: "https://www.youtube.com/@seedchannel/videos", videoId: null,
  title: "Channel Trailer", artist: "Ivy Sol", durationSec: 120, expect: "invalid",
});

// ── Non-YouTube providers ──
items.push({ caseTag: "provider:spotify", language: "en", provider: "spotify", url: "https://open.spotify.com/track/seedspotifytrk0000000001", videoId: null, title: "Violet Sky", artist: "Nova Kane", durationSec: 200, expect: "valid" });
items.push({ caseTag: "provider:spotify", language: "en", provider: "spotify", url: "https://open.spotify.com/track/seedspotifytrk0000000002", videoId: null, title: "Violet Sky (Remix)", artist: "Nova Kane", durationSec: 230, expect: "valid" });
items.push({ caseTag: "provider:soundcloud", language: "en", provider: "soundcloud", url: "https://soundcloud.com/seed-artist/violet-dub", videoId: null, title: "Violet Dub", artist: "DJ Petra", durationSec: 250, expect: "valid" });
items.push({ caseTag: "provider:soundcloud", language: "en", provider: "soundcloud", url: "https://soundcloud.com/seed-artist/night-set", videoId: null, title: "Night Set", artist: "DJ Petra", durationSec: 2400, expect: "valid" });
items.push({ caseTag: "provider:local-m3u", language: "en", provider: "direct", url: "https://media.example.test/library/seed/track-001.m3u8", videoId: null, title: "Local Loop", artist: "House Band", durationSec: 180, expect: "valid" });

// ── Padding to reach a representative 100–150 total (all valid, distinct) ──
const TARGET_TOTAL = 120;
for (let i = items.length; i < TARGET_TOTAL; i += 1) {
  addYt("padding", "en", `Studio Session Vol.${i}`, `Session Player ${i}`, 180 + (i % 40));
}

export interface SeedComposition {
  planned: number;
  valid: number;
  intentionallyInvalid: number;
  duplicates: number;
  versionCases: Record<string, number>;
  languageDistribution: Record<string, number>;
}

export function analyzeComposition(): SeedComposition {
  const versionCases: Record<string, number> = {};
  const languageDistribution: Record<string, number> = {};
  for (const it of items) {
    const v = versionTypeFromTitle(it.title);
    versionCases[v] = (versionCases[v] ?? 0) + 1;
    languageDistribution[it.language] = (languageDistribution[it.language] ?? 0) + 1;
  }
  return {
    planned: items.length,
    valid: items.filter((i) => i.expect === "valid").length,
    intentionallyInvalid: items.filter((i) => i.expect === "invalid").length,
    duplicates: items.filter((i) => i.expect === "dup").length,
    versionCases,
    languageDistribution,
  };
}

async function apply(prisma: PrismaClient): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const it of items) {
    const notes = `${SEED_MARKER} ${it.caseTag}`;
    const data = {
      title: it.title,
      artist: it.artist,
      videoId: it.videoId,
      provider: it.provider,
      durationSec: it.durationSec,
      curationNotes: notes,
      genres: [] as string[],
    };
    await prisma.catalogItem.upsert({
      where: { url: it.url },
      update: data,
      create: { url: it.url, canonicalUrl: null, ...data },
    });
    upserted += 1;
  }
  return { upserted };
}

interface CleanupReport {
  mode: "dry-run" | "apply";
  seedCatalogItems: number;
  removedUniversalTracks: number;
  removedCatalogItems: number;
  removedOrphanArtists: number;
}

async function cleanup(prisma: PrismaClient, doApply: boolean): Promise<CleanupReport> {
  const seed = await prisma.catalogItem.findMany({ where: { curationNotes: { contains: SEED_MARKER } }, select: { id: true } });
  const ids = seed.map((s) => s.id);
  if (!doApply) {
    const derived = await prisma.universalTrack.count({ where: { legacyCatalogItemId: { in: ids } } });
    return { mode: "dry-run", seedCatalogItems: ids.length, removedUniversalTracks: derived, removedCatalogItems: 0, removedOrphanArtists: 0 };
  }
  // Remove ONLY: backfill-derived UniversalTracks for seed items (cascade → their mappings/
  // artist-links/provenance), then the seed CatalogItems, then now-orphaned Artists.
  const ut = await prisma.universalTrack.deleteMany({ where: { legacyCatalogItemId: { in: ids } } });
  const ci = await prisma.catalogItem.deleteMany({ where: { curationNotes: { contains: SEED_MARKER } } });
  const orphans = await prisma.artist.findMany({ where: { tracks: { none: {} } }, select: { id: true } });
  const ar = await prisma.artist.deleteMany({ where: { id: { in: orphans.map((a) => a.id) } } });
  return { mode: "apply", seedCatalogItems: ids.length, removedUniversalTracks: ut.count, removedCatalogItems: ci.count, removedOrphanArtists: ar.count };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const doApply = args.has("--apply");
  const doCleanup = args.has("--cleanup");

  const target = assertSafeIngestionTarget(doCleanup ? "seed cleanup" : "validation seed");
  console.log(`[target] env=${target.env} host=${target.host} port=${target.port} db=${target.database} user=${target.userMasked}`);

  const prisma = new PrismaClient();
  try {
    if (doCleanup) {
      const report = await cleanup(prisma, doApply);
      console.log("[seed cleanup]", JSON.stringify(report, null, 2));
      return;
    }
    const composition = analyzeComposition();
    console.log("[seed composition]", JSON.stringify(composition, null, 2));
    if (!doApply) {
      console.log("DRY-RUN — no writes. Pass --apply to seed the LOCAL dev DB.");
      return;
    }
    const { upserted } = await apply(prisma);
    const total = await prisma.catalogItem.count({ where: { curationNotes: { contains: SEED_MARKER } } });
    console.log(`[seed apply] upserted=${upserted} seedRowsInDb=${total} (expected ${composition.planned})`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked directly (not when imported for SEED_MARKER / analyzeComposition).
const invokedDirectly = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
