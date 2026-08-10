/**
 * Pure unit self-check for the Phase B0 normalize + CatalogResolver v2 scoring core.
 * Runs WITHOUT a database: `npx tsx scripts/check-universal-resolver.ts`.
 */

import {
  detectVersionCues,
  normalizeArtistName,
  normalizeTitle,
  splitArtists,
  versionCompatible,
  versionTypeFromTitle,
} from "@/lib/universal/normalize";
import {
  rankCandidates,
  RESOLVER_THRESHOLDS,
  scoreCandidate,
  type ResolverCandidate,
  type ResolverQuery,
} from "@/lib/universal/catalog-resolver";
import { buildChartEditionUid, promoteObservationToChartEntryData } from "@/lib/universal/chart-ingestion";
import {
  assertNonProductionEnv,
  assertSafeIngestionTarget,
  describeDatabaseTarget,
  ProductionSafetyError,
} from "@/lib/universal/ingestion-env-guard";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

// ── normalize ──
check("normalizeTitle strips feat + punctuation", normalizeTitle("Hello (feat. Adele)!!!") === "hello");
check("normalizeTitle lowercases + diacritics", normalizeTitle("Beyoncé — Déjà Vu") === "beyonce deja vu");
check("normalizeArtistName basic", normalizeArtistName("The Weeknd") === "the weeknd");
check("splitArtists multi", JSON.stringify(splitArtists("Calvin Harris feat. Rihanna & Ne-Yo")) === JSON.stringify(["Calvin Harris", "Rihanna", "Ne-Yo"]));
check("splitArtists empty", splitArtists("") .length === 0);

// ── version detection ──
check("detect live cue", detectVersionCues("Song (Live at Wembley)").includes("live"));
check("detect remix cue", detectVersionCues("Track (Club Remix)").includes("remix"));
check("versionType original", versionTypeFromTitle("Plain Song") === "ORIGINAL");
check("versionType live", versionTypeFromTitle("Plain Song (Live)") === "LIVE");
check("versionType nightcore→SPED_UP", versionTypeFromTitle("Song - Nightcore") === "SPED_UP");
check("compatible same", versionCompatible("Song", "Song").compatible === true);
check("incompatible live vs studio", versionCompatible("Song", "Song (Live)").compatible === false);

// ── scoring ──
const base: ResolverCandidate = {
  id: "t1",
  displayTitle: "Blinding Lights",
  normalizedTitle: normalizeTitle("Blinding Lights"),
  durationMs: 200000,
  canonicalIsrc: "USUG11904206",
  versionType: "ORIGINAL",
  artistNames: [normalizeArtistName("The Weeknd")],
  providerRefs: [{ provider: "youtube", externalId: "abc123" }],
};

check("exact ISRC = 1.0", scoreCandidate({ title: "x", isrc: "USUG11904206" }, base).score === 1);
check("provider+externalId = 0.98", scoreCandidate({ title: "x", provider: "youtube", externalId: "abc123" }, base).score === 0.98);

const titleArtistQ: ResolverQuery = { title: "Blinding Lights", artists: ["The Weeknd"], durationMs: 201000 };
const ta = scoreCandidate(titleArtistQ, base);
check("title+artist strong", ta.score >= 0.85);
check("title+artist reasons", ta.reasons.includes("primary artist match"));

const karaokeCand: ResolverCandidate = { ...base, id: "t2", displayTitle: "Blinding Lights (Karaoke Version)", canonicalIsrc: null };
const kv = scoreCandidate({ title: "Blinding Lights", artists: ["The Weeknd"] }, karaokeCand);
check("karaoke hard-blocked", kv.score <= 0.2 && kv.warnings.some((w) => w.includes("version block")));

const liveCand: ResolverCandidate = { ...base, id: "t3", displayTitle: "Blinding Lights (Live)", canonicalIsrc: null };
const lv = scoreCandidate({ title: "Blinding Lights", artists: ["The Weeknd"] }, liveCand);
check("live penalized vs studio", lv.score < ta.score);

const wrongDur: ResolverCandidate = { ...base, id: "t4", durationMs: 400000, canonicalIsrc: null };
const wd = scoreCandidate({ title: "Blinding Lights", artists: ["The Weeknd"], durationMs: 200000 }, wrongDur);
check("far duration penalized", wd.score < ta.score);

// ── ranking ──
const ranked = rankCandidates(titleArtistQ, [karaokeCand, base, liveCand]);
check("rank picks studio original", ranked.match?.id === "t1");
check("rank method title_artist", ranked.method === "title_artist");

const noMatch = rankCandidates({ title: "Totally Different Song", artists: ["Nobody"] }, [base]);
check("no match → null below threshold", noMatch.match === null && noMatch.method === "none");
check("resolver never fabricates YouTube fallback", noMatch.candidates.every((c) => c.candidate.id === "t1"));

// ── B0.5: thresholds / decision policy ──
check("thresholds exposed", RESOLVER_THRESHOLDS.autoMatch === 0.9 && RESOLVER_THRESHOLDS.ambiguous === 0.7 && RESOLVER_THRESHOLDS.candidate === 0.6);

const exactIsrcQ: ResolverQuery = { title: "Blinding Lights", artists: ["The Weeknd"], isrc: "USUG11904206" };
const autoRes = rankCandidates(exactIsrcQ, [base]);
check("auto_match on ISRC-strong", autoRes.decision === "auto_match" && autoRes.match?.id === "t1");
check("result carries thresholds", autoRes.thresholds.autoMatch === 0.9);

// same title, DIFFERENT artist → must NOT auto-match
const diffArtist: ResolverCandidate = { ...base, id: "t5", canonicalIsrc: null, artistNames: [normalizeArtistName("Lionel Richie")] };
const diffRes = rankCandidates({ title: "Blinding Lights", artists: ["The Weeknd"] }, [diffArtist]);
check("diff artist not auto-matched", diffRes.decision !== "auto_match" && diffRes.match === null);

// original vs remaster → version mismatch, not auto
const remaster: ResolverCandidate = { ...base, id: "t6", displayTitle: "Blinding Lights (2024 Remaster)", canonicalIsrc: null };
const remScore = scoreCandidate({ title: "Blinding Lights", artists: ["The Weeknd"] }, remaster);
check("remaster flagged as version mismatch", remScore.versionMismatch.includes("remaster"));
check("remaster not auto-matched", rankCandidates({ title: "Blinding Lights", artists: ["The Weeknd"] }, [remaster]).decision !== "auto_match");

// radio edit vs extended, remix vs original
check("radio edit vs extended incompatible", versionCompatible("Song (Radio Edit)", "Song (Extended Mix)").compatible === false);
check("remix vs original incompatible", versionCompatible("Song", "Song (Club Remix)").compatible === false);

// featured + multiple artists
check("featured artist split", splitArtists("Drake feat. Rihanna")[0] === "Drake" && splitArtists("Drake feat. Rihanna").length === 2);
check("multiple artists split", splitArtists("Swedish House Mafia, A$AP Rocky & Someone").length === 3);

// Hebrew / Arabic / punctuation
check("hebrew title normalized", normalizeTitle("שיר עברי (רמיקס)") === "שיר עברי");
check("arabic title normalized (hamza folds to alef, letters kept)", normalizeTitle("أغنية عربية") === normalizeTitle("اغنية عربية") && normalizeTitle("أغنية عربية").length > 0);
check("punctuation-insensitive", normalizeTitle("Hello, World!") === normalizeTitle("hello   world"));

// same ISRC, different metadata → ISRC still dominates
check("same ISRC dominates metadata", scoreCandidate({ title: "Completely Different Name", isrc: "USUG11904206" }, base).score === 1);

// near-identical duration
const nearDur: ResolverCandidate = { ...base, id: "t7", durationMs: 201000, canonicalIsrc: null };
check("near duration = tight", scoreCandidate({ title: "Blinding Lights", artists: ["The Weeknd"], durationMs: 200500 }, nearDur).reasons.includes("duration tight"));

// unmatched song in a chart snapshot → unresolved, still returned as data upstream
const unmatched = rankCandidates({ title: "A Song Not In Catalog", artists: ["Unknown"] }, [base]);
check("unmatched → unresolved", unmatched.decision === "unresolved" && unmatched.match === null);

// promotion ChartObservationEntry → ChartEntry data
const promoted = promoteObservationToChartEntryData({ rank: 3, previousRank: 5, sourceExternalId: "ext9", matchedUniversalTrackId: "u1", matchConfidence: 0.95 });
check("promotion maps matched track", promoted.universalTrackId === "u1" && promoted.providerExternalId === "ext9" && promoted.rank === 3);

// repeated ingestion of same edition → identical uid (idempotency), different territory → different
const edA = buildChartEditionUid({ source: "apple_music", chartType: "TOP", territory: "IL", editionKey: "2026-W31" });
const edA2 = buildChartEditionUid({ source: "Apple_Music", chartType: "TOP", territory: "il", editionKey: "2026-W31" });
const edB = buildChartEditionUid({ source: "apple_music", chartType: "TOP", territory: "GB", editionKey: "2026-W31" });
const edNull = buildChartEditionUid({ source: "apple_music", chartType: "TOP", editionKey: "2026-W31" });
const edNull2 = buildChartEditionUid({ source: "apple_music", chartType: "TOP", territory: null, editionKey: "2026-W31" });
check("editionUid idempotent (case/space)", edA === edA2);
check("editionUid discriminates territory", edA !== edB);
check("editionUid null territory stable", edNull === edNull2 && edNull.includes("global"));

// production safety guard — no silent bypass
const prevEnv = process.env.SYNCBIZ_ENV;
try {
  process.env.SYNCBIZ_ENV = "production";
  let threwProd = false;
  try { assertNonProductionEnv("test"); } catch (e) { threwProd = e instanceof ProductionSafetyError; }
  check("guard blocks production", threwProd);

  delete process.env.SYNCBIZ_ENV;
  let threwUnset = false;
  try { assertNonProductionEnv("test"); } catch (e) { threwUnset = e instanceof ProductionSafetyError; }
  check("guard blocks unset env", threwUnset);

  process.env.SYNCBIZ_ENV = "development";
  let okDev = true;
  try { assertNonProductionEnv("test"); } catch { okDev = false; }
  check("guard allows development", okDev);
} finally {
  if (prevEnv === undefined) delete process.env.SYNCBIZ_ENV;
  else process.env.SYNCBIZ_ENV = prevEnv;
}

// ── Phase-1 calibration: version-detection precedence + Hebrew/Arabic remix ──
check("Extended Mix → EXTENDED", versionTypeFromTitle("Song (Extended Mix)") === "EXTENDED");
check("Extended Version → EXTENDED", versionTypeFromTitle("Song (Extended Version)") === "EXTENDED");
check("Extended Edit → EXTENDED", versionTypeFromTitle("Song (Extended Edit)") === "EXTENDED");
check("Extended Remix → EXTENDED (extended precedes remix)", versionTypeFromTitle("Song (Extended Remix)") === "EXTENDED");
check("Extended Mix is NOT REMIX", versionTypeFromTitle("Song (Extended Mix)") !== "REMIX");
check("Club Remix still REMIX", versionTypeFromTitle("Song (Club Remix)") === "REMIX");
check("Hebrew רמיקס → REMIX", versionTypeFromTitle("אור וצל (רמיקס)") === "REMIX");
check("Arabic ريمكس → REMIX", versionTypeFromTitle("ليلة القمر (ريمكس)") === "REMIX");
check("Hebrew remix is a version cue", detectVersionCues("אור וצל (רמיקס)").includes("remix"));
check("Arabic remix is a version cue", detectVersionCues("ليلة القمر (ريمكس)").includes("remix"));
check("Radio Edit → RADIO_EDIT (not swallowed by edit)", versionTypeFromTitle("Song (Radio Edit)") === "RADIO_EDIT");
check("Remastered → REMASTER (not Original)", versionTypeFromTitle("Song (Remastered)") === "REMASTER");
check("2024 Remaster → REMASTER", versionTypeFromTitle("Song (2024 Remaster)") === "REMASTER");
check("Acoustic Version → ACOUSTIC", versionTypeFromTitle("Song (Acoustic Version)") === "ACOUSTIC");
check("Live Remix → LIVE (live precedence)", versionTypeFromTitle("Song (Live Remix)") === "LIVE");
check("plain title → ORIGINAL", versionTypeFromTitle("Just A Song") === "ORIGINAL");

// ── B0.5-prep: DB target guard (pure — fake URLs, NO database connection) ──
{
  const prevEnv2 = process.env.SYNCBIZ_ENV;
  const prevProd = process.env.SYNCBIZ_PROD_DATABASE_HOST;
  try {
    const desc = describeDatabaseTarget("postgresql://admin:supersecret@db.example.com:5432/mydb?sslmode=require");
    check("target masks user + parses host/db", desc.userMasked === "a***" && desc.host === "db.example.com" && desc.database === "mydb");
    check("target never leaks password", !JSON.stringify(desc).includes("supersecret"));

    const tryTarget = (env: string | undefined, url: string, prodHost?: string): string => {
      if (env === undefined) delete process.env.SYNCBIZ_ENV;
      else process.env.SYNCBIZ_ENV = env;
      if (prodHost === undefined) delete process.env.SYNCBIZ_PROD_DATABASE_HOST;
      else process.env.SYNCBIZ_PROD_DATABASE_HOST = prodHost;
      try {
        assertSafeIngestionTarget("test", url);
        return "ok";
      } catch (e) {
        return e instanceof ProductionSafetyError ? "blocked" : "error";
      }
    };

    check("dev + remote host blocked", tryTarget("development", "postgresql://u:p@db.rlwy.net:5432/railway") === "blocked");
    check("dev + localhost ok", tryTarget("development", "postgresql://u:p@localhost:5432/syncbiz_dev") === "ok");
    check("staging + managed + no prodHost blocked", tryTarget("staging", "postgresql://u:p@x.rlwy.net:5432/railway") === "blocked");
    check("staging + host == prod blocked", tryTarget("staging", "postgresql://u:p@nozomi.proxy.rlwy.net:5432/railway", "nozomi.proxy.rlwy.net") === "blocked");
    check("staging + managed + different prodHost ok", tryTarget("staging", "postgresql://u:p@staging.rlwy.net:5432/railway", "nozomi.proxy.rlwy.net") === "ok");
    check("staging + localhost ok", tryTarget("staging", "postgresql://u:p@localhost:5432/db") === "ok");
    check("production env blocked regardless of host", tryTarget("production", "postgresql://u:p@localhost:5432/db") === "blocked");
  } finally {
    if (prevEnv2 === undefined) delete process.env.SYNCBIZ_ENV;
    else process.env.SYNCBIZ_ENV = prevEnv2;
    if (prevProd === undefined) delete process.env.SYNCBIZ_PROD_DATABASE_HOST;
    else process.env.SYNCBIZ_PROD_DATABASE_HOST = prevProd;
  }
}

console.log(`\n[check-universal-resolver] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
