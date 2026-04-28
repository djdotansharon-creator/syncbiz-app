#!/usr/bin/env node
/**
 * Reads data/playlist-pro-genres.pdf (Playlist Pro genre listing) and writes
 * prisma/seed-data/music-taxonomy-playlist-pro-enrichment.generated.json
 *
 * Stage 3 enrichment only — deterministic semantic slugs + category hints.
 *
 * Rows listed in lib/music-taxonomy-playlist-pro-merge-config.json `aliasMergeByLabel`
 * are omitted here (aliases applied at seed time onto canonical Excel slugs).
 *
 * Usage:
 *   node scripts/build-playlist-pro-enrichment-from-pdf.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { PDFParse } = require("pdf-parse");

const INPUT = path.join(process.cwd(), "data", "playlist-pro-genres.pdf");
const MERGE_CFG_PATH = path.join(
  process.cwd(),
  "lib",
  "music-taxonomy-playlist-pro-merge-config.json",
);
const OUTPUT = path.join(
  process.cwd(),
  "prisma",
  "seed-data",
  "music-taxonomy-playlist-pro-enrichment.generated.json",
);

function loadMergeCfg() {
  return JSON.parse(fs.readFileSync(MERGE_CFG_PATH, "utf8"));
}

/** Semantic slug: playlist-pro-<normalized>; Hebrew uses overrides from merge config. */
function semanticPlaylistProSlug(labelEn, overrides, slugUseCount) {
  const trimmed = labelEn.trim();
  if (overrides[trimmed]) {
    const base = overrides[trimmed];
    const prev = slugUseCount.get(base) ?? 0;
    slugUseCount.set(base, prev + 1);
    return prev === 0 ? base : `${base}-${prev + 1}`;
  }

  let body = trimmed
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 96);

  if (!body) body = "genre";

  let baseSlug = `playlist-pro-${body}`;
  const seen = slugUseCount.get(baseSlug) ?? 0;
  slugUseCount.set(baseSlug, seen + 1);
  if (seen === 0) return baseSlug;
  return `${baseSlug}-${seen + 1}`;
}

function resolvePlaylistProCategory(labelEn) {
  const t = labelEn.trim();
  if (/^ישראלי\s*-/.test(t)) return "ISRAELI_SPECIALS";

  const u = t.replace(/\s+/g, " ").trim().toUpperCase();
  if (/^(DJ SETS|COVERS|MTV)\b/u.test(u)) return "STYLE_TAGS";

  if (
    u === "HOUSE - NU DISCO" ||
    u === "HOUSE - DEEP & SEXY" ||
    u === "HOUSE - LATIN"
  ) {
    return "STYLE_TAGS";
  }

  return "MAIN_SOUND_GENRE";
}

function labelHeFromLabelEn(labelEn) {
  const x = labelEn.trim();
  return /[\u0590-\u05FF]/.test(x) ? x : x;
}

function explodeConcatenatedLine(line) {
  let s = line.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
  if (!s || /^--/.test(s)) return [];

  const splitters = [
    /\s+(?=ישראלי\s*-)/u,
    /\s+(?=MTV\s*-)/u,
    /\s+(?=SOUL\s*-)/u,
    /\s+(?=JAZZ\s*-)/u,
    /\s+(?=HOUSE\s*-)/u,
    /\s+(?=ROCK\s*-)/u,
    /\s+(?=FUNK\s*-)/u,
    /\s+(?=COVERS\s*-)/u,
    /\s+(?=REGGAE\s*-)/u,
    /\s+(?=CHILLOUT\s*-)/u,
    /\s+(?=BOSSA\s)/u,
    /\s+(?=ACID\s+JAZZ)/u,
    /\s+(?=GIPSY\s*-)/u,
    /\s+(?=DJ\s+SETS)/u,
    /\s+(?=SLOW\s+&\s+BALLADS)/u,
    /\s+(?=BRAZIL|FRENCH|GREEK|ORIENTAL|ITALIAN|SPAIN|ARGENTINA|CUBA|INDIE|UNSORTED)/u,
    /\s+(?=\d{4}'s\s-\s)/u,
    /\s+(?=\d{4}\s+OLDIES)/u,
  ];

  let chunks = [s];
  for (const rx of splitters) {
    chunks = chunks.flatMap((c) => c.split(rx).map((x) => x.trim()).filter(Boolean));
  }
  return chunks;
}

function extractGenrePair(chunk) {
  const s = chunk.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
  if (!s || !/\s-\s/.test(s)) return null;
  const idx = s.indexOf(" - ");
  if (idx === -1) return null;
  const left = s.slice(0, idx).trim();
  const right = s.slice(idx + 3).trim();
  const label = `${left} - ${right}`;
  if (label.length >= 4 && label.length <= 160) return label;
  return null;
}

function genresFromLine(line) {
  const pieces = explodeConcatenatedLine(line);
  const out = [];
  for (const p of pieces) {
    const g = extractGenrePair(p);
    if (g && !out.includes(g)) out.push(g);
  }
  if (out.length === 0 && /\d{4}'s\s-\s/.test(line)) {
    const s = line.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    for (const chunk of s.split(/\s+(?=\d{4}'s\s-\s)/u)) {
      const g = extractGenrePair(chunk.trim());
      if (g) out.push(g);
    }
  }
  return out;
}

async function main() {
  const mergeCfg = loadMergeCfg();
  const aliasSkip = new Set(Object.keys(mergeCfg.aliasMergeByLabel || {}));
  const hebrewSlugOverrides = mergeCfg.hebrewLabelSlugOverrides || {};

  if (!fs.existsSync(INPUT)) {
    console.error(`Missing PDF: ${INPUT}`);
    process.exit(1);
  }

  const parser = new PDFParse({ data: fs.readFileSync(INPUT) });
  const { text } = await parser.getText();

  const normalized = text.replace(/\r/g, "\n");
  const idx = normalized.indexOf("Playlist Pro Genres");
  const tail =
    idx >= 0 ? normalized.slice(idx + "Playlist Pro Genres".length) : normalized;

  const withoutFooter = tail.replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "").trim();

  const lines = withoutFooter.split(/\n/).map((l) => l.trim()).filter(Boolean);

  const slugUseCount = new Map();
  const seenLabels = new Set();
  const rows = [];
  let sort = 9100;

  let skippedMerge = 0;

  for (const line of lines) {
    const genres = genresFromLine(line);
    for (const labelEn of genres) {
      if (seenLabels.has(labelEn)) continue;
      seenLabels.add(labelEn);

      if (aliasSkip.has(labelEn.trim())) {
        skippedMerge += 1;
        continue;
      }

      const slug = semanticPlaylistProSlug(labelEn, hebrewSlugOverrides, slugUseCount);
      rows.push({
        slug,
        category: resolvePlaylistProCategory(labelEn),
        labelEn,
        labelHe: labelHeFromLabelEn(labelEn),
        descriptionHeUser: null,
        descriptionAi:
          "Playlist Pro PDF reference genre (data/playlist-pro-genres.pdf). Alias bridge for scheduling/metadata.",
        aliases: [],
        status: "ACTIVE",
        parentSlug: null,
        mergedIntoSlug: null,
        sortOrder: sort,
      });
      sort += 1;
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(rows, null, 2)}\n`, "utf8");

  const uniqueExtracted = seenLabels.size;
  console.info(
    `Playlist Pro enrichment: uniqueLabels=${uniqueExtracted} skippedMerge=${skippedMerge} newTags=${rows.length} → ${OUTPUT}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
