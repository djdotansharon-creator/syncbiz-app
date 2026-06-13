/**
 * Operator debug: "why did this local track get selected?"
 *
 * Loads the on-disk Local Collection Snapshot, scores every row against a prompt
 * via the same scorer used by the Electron renderer, and prints the top-N matches
 * with field-by-field reasoning. Works with NO Electron app running — it reads
 * the snapshot JSON directly. Helpful for confirming whether the AI is picking
 * tracks by real Genre / ID3 metadata vs folder-name path tokens.
 *
 * Usage:
 *   npx tsx scripts/explain-local-search.ts "<prompt>" [--top N] [--snapshot PATH]
 *
 *   <prompt>            Free-text DJ prompt (e.g. "jazz", "ים תיכוני רגוע").
 *   --top N             Print top N candidates (default 20).
 *   --snapshot PATH     Use this collection-snapshot.json (default: auto-detect
 *                       under %APPDATA%/syncbiz-desktop-app/local-collection/
 *                       or ~/Library/Application Support/syncbiz-desktop-app/local-collection/).
 *
 * Output per candidate:
 *   title / artist / genre / path / score / matched fields / reason / tagSrc.
 *   tagSrc classifies the row as `id3` (real tags), `xlsx` (Tag&Rename import),
 *   or `path-only` (no Genre / Title / Artist / Album / Comment — folder/name
 *   was the only signal).
 *
 * Exit code: always 0 — this is a diagnostic, not a test.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  parseLocalSearchIntents,
  scoreLocalTrackForAiSearch,
  toLocalAiSearchMatchDebug,
} from "../desktop/src/shared/local-ai-playlist-search";
import {
  applyLocalStrictFloor,
  getTrustedFolderLabelsForParserSlugs,
} from "../lib/recommendations/local-strict-floor";
import { parseSmartCatalogQuery } from "../lib/recommendations/parse-smart-catalog-query";

type SnapshotRow = {
  localId: string;
  absolutePath: string;
  relativePathFromRoot: string;
  size?: number;
  mtimeMs?: number;
  artist: string | null;
  title: string | null;
  genre: string | null;
  year: string | null;
  album: string | null;
  durationSec: number | null;
  comment?: string | null;
  bpm?: number | null;
  rating?: number | null;
  trackNumber?: string | null;
  rootPath?: string | null;
};

type SnapshotFile = {
  schemaVersion?: number;
  musicFolderRoot?: string | null;
  tracks?: Record<string, SnapshotRow>;
  updatedAt?: string;
};

function parseArgs(argv: string[]): { prompt: string; top: number; snapshot: string | null } {
  const args = argv.slice(2);
  let prompt = "";
  let top = 20;
  let snapshot: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--top" && args[i + 1]) {
      const n = Number(args[++i]);
      if (Number.isFinite(n) && n > 0) top = Math.min(200, Math.max(1, Math.floor(n)));
      continue;
    }
    if (a === "--snapshot" && args[i + 1]) {
      snapshot = args[++i] ?? null;
      continue;
    }
    if (a.startsWith("--")) continue;
    if (!prompt) {
      prompt = a;
    } else {
      prompt = `${prompt} ${a}`;
    }
  }
  return { prompt: prompt.trim(), top, snapshot };
}

/**
 * Electron stores the snapshot under `<userData>/local-collection/<deviceId>/`
 * where `userData` defaults to `<APPDATA>/<productName>`. The desktop app uses
 * `productName: "SyncBiz Player"` (with a space), but older builds used
 * `syncbiz-player-desktop` and dev builds may use `syncbiz-desktop-app`. List
 * every plausible folder and let the script pick the most recent file.
 */
const POSSIBLE_PRODUCT_FOLDERS = [
  "SyncBiz Player",
  "syncbiz-player-desktop",
  "syncbiz-desktop-app",
];

function candidateSnapshotRoots(): string[] {
  const roots: string[] = [];
  const appdata = process.env.APPDATA?.trim();
  if (appdata) {
    for (const product of POSSIBLE_PRODUCT_FOLDERS) {
      roots.push(path.join(appdata, product, "local-collection"));
    }
  }
  const home = process.env.HOME?.trim();
  if (home) {
    for (const product of POSSIBLE_PRODUCT_FOLDERS) {
      roots.push(
        path.join(home, "Library", "Application Support", product, "local-collection"),
      );
      roots.push(path.join(home, ".config", product, "local-collection"));
    }
  }
  return roots.filter((r) => existsSync(r));
}

function autoFindSnapshot(): string | null {
  const roots = candidateSnapshotRoots();
  let best: { path: string; mtimeMs: number } | null = null;
  for (const root of roots) {
    let devices: string[] = [];
    try {
      devices = readdirSync(root);
    } catch {
      continue;
    }
    for (const dev of devices) {
      const candidate = path.join(root, dev, "collection-snapshot.json");
      try {
        const st = statSync(candidate);
        if (!st.isFile()) continue;
        if (!best || st.mtimeMs > best.mtimeMs) {
          best = { path: candidate, mtimeMs: st.mtimeMs };
        }
      } catch {
        continue;
      }
    }
  }
  return best?.path ?? null;
}

function loadSnapshot(p: string): SnapshotFile | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as SnapshotFile;
  } catch (e) {
    console.error("Could not parse snapshot:", e);
    return null;
  }
}

function classifyTagSrc(row: SnapshotRow): "id3" | "xlsx" | "path-only" | "partial" {
  const hasGenre = !!row.genre?.trim();
  const hasTitle = !!row.title?.trim();
  const hasArtist = !!row.artist?.trim();
  const hasAlbum = !!row.album?.trim();
  const hasComment = !!row.comment?.trim();

  const commentSuggestsXlsx = !!row.comment && /·|#\d+/.test(row.comment);
  if (commentSuggestsXlsx && (hasGenre || hasTitle || hasArtist)) return "xlsx";

  if (hasGenre && (hasTitle || hasArtist)) return "id3";
  if (hasGenre || hasTitle || hasArtist || hasAlbum || hasComment) return "partial";
  return "path-only";
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

async function main(): Promise<void> {
  const { prompt, top, snapshot: snapshotArg } = parseArgs(process.argv);
  if (!prompt) {
    console.error("Usage: npx tsx scripts/explain-local-search.ts \"<prompt>\" [--top N] [--snapshot PATH]");
    process.exit(2);
  }

  const snapshotPath = snapshotArg ?? autoFindSnapshot();
  if (!snapshotPath) {
    console.error(
      "No snapshot found. Pass --snapshot <path-to-collection-snapshot.json>, or scan first via Desktop.",
    );
    console.error("Looked under:", candidateSnapshotRoots().join("\n  "));
    process.exit(2);
  }

  const snap = loadSnapshot(snapshotPath);
  if (!snap || !snap.tracks || Object.keys(snap.tracks).length === 0) {
    console.error("Snapshot is empty at", snapshotPath);
    process.exit(2);
  }

  const allRows = Object.values(snap.tracks);
  const intents = parseLocalSearchIntents(prompt);
  const parserStyleSlugs = parseSmartCatalogQuery(prompt).styleTaxonomySlugs;
  const trustedLabels = getTrustedFolderLabelsForParserSlugs(parserStyleSlugs);

  console.log("─".repeat(78));
  console.log("Snapshot:", snapshotPath);
  console.log("Tracks in snapshot:", allRows.length);
  console.log("Music folder root:", snap.musicFolderRoot ?? "(unknown)");
  console.log("Prompt:", JSON.stringify(prompt));
  console.log(
    "Intent groups:",
    intents.groups.length === 0 ? "(none)" : intents.groups.map((g) => g.label).join(" + "),
  );
  console.log("Parser style slugs:", parserStyleSlugs.length === 0 ? "(none)" : parserStyleSlugs.join(", "));
  if (trustedLabels.length > 0) {
    console.log("Trusted folder labels:", trustedLabels.slice(0, 12).join(" | "));
  }
  console.log("─".repeat(78));

  if (intents.groups.length === 0) {
    console.warn("No intent groups parsed from prompt — local search would return 0 candidates.");
    return;
  }

  const scored = allRows
    .map((row) => {
      const fields = {
        artist: row.artist,
        title: row.title,
        album: row.album,
        genre: row.genre,
        year: row.year,
        comment: row.comment ?? null,
        bpm: row.bpm ?? null,
        rating: row.rating ?? null,
        trackNumber: row.trackNumber ?? null,
        durationSec: row.durationSec,
        relativePathFromRoot: row.relativePathFromRoot,
        absolutePath: row.absolutePath,
      };
      const r = scoreLocalTrackForAiSearch(fields, intents);
      return { row, fields, score: r.score, debug: toLocalAiSearchMatchDebug(r) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.row.relativePathFromRoot.localeCompare(b.row.relativePathFromRoot));

  if (scored.length === 0) {
    console.log("No local candidates matched the prompt.");
    return;
  }

  const limit = Math.min(top, scored.length);
  const candidatesForFloor = scored.map((s) => ({
    absolutePath: s.row.absolutePath,
    genre: s.row.genre,
    comment: s.row.comment ?? null,
    title: s.row.title,
    artist: s.row.artist,
    album: s.row.album,
    matchDebug: s.debug,
  }));
  const floorOutcome = applyLocalStrictFloor(candidatesForFloor, parserStyleSlugs);
  const passingIndex = new Set(
    floorOutcome.passing.map((c) => c.absolutePath.toLowerCase()),
  );

  console.log(`Top ${limit} candidates (of ${scored.length} total matches):`);
  console.log();
  for (let i = 0; i < limit; i++) {
    const s = scored[i]!;
    const tagSrc = classifyTagSrc(s.row);
    const matchedFields = (s.debug.groups ?? [])
      .filter((g) => g.matched)
      .flatMap((g) => g.fields);
    const distinctFields = [...new Set(matchedFields)];
    const passes = passingIndex.has(s.row.absolutePath.toLowerCase());
    const status = parserStyleSlugs.length === 0 ? "—" : passes ? "PASS" : "DROP";
    const headerLine = `#${pad(String(i + 1), 3)} score=${pad(String(s.score), 4)} ${pad(status, 5)} tagSrc=${pad(tagSrc, 9)}`;
    console.log(headerLine);
    console.log(`     title:   ${s.row.title ?? "(null)"}`);
    console.log(`     artist:  ${s.row.artist ?? "(null)"}`);
    console.log(`     genre:   ${s.row.genre ?? "(null)"}`);
    console.log(`     album:   ${s.row.album ?? "(null)"}`);
    console.log(`     comment: ${shorten(s.row.comment ?? "(null)", 70)}`);
    console.log(`     path:    ${s.row.relativePathFromRoot}`);
    console.log(`     fields:  ${distinctFields.length === 0 ? "(none)" : distinctFields.join("+")}`);
    console.log(`     reason:  ${s.debug.reason}`);
    console.log();
  }

  const limited = scored.slice(0, limit);
  const counts = limited.reduce(
    (acc, s) => {
      const t = classifyTagSrc(s.row);
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.log("─".repeat(78));
  console.log("Top-" + limit + " tag-source breakdown:");
  for (const k of ["id3", "xlsx", "partial", "path-only"]) {
    if (counts[k]) console.log(`  ${pad(k, 10)} ${counts[k]}`);
  }
  if (parserStyleSlugs.length > 0) {
    const passCount = limited.filter((s) =>
      passingIndex.has(s.row.absolutePath.toLowerCase()),
    ).length;
    console.log(
      `Strict-floor (parser slugs: ${parserStyleSlugs.join(", ")}): ${passCount}/${limit} pass, ${limit - passCount} dropped (would be excluded from AI playlist).`,
    );
  } else {
    console.log("Strict-floor: not enforced (prompt has no style taxonomy slug).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
