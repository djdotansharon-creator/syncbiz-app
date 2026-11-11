/**
 * 2026-11-10 (owner): PRIVATE music banks — a bank (first: "All Day Mix", the Shufersal songs) shows and plays ONLY for the
 * businesses the platform owner opened it to in Platform → Businesses. Checks the server lock, that the song list never ships
 * to the browser, the additive migration, the admin routes, and the catalog wiring.
 * Run: npx tsx scripts/verify-private-music-banks.ts
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";

// `server-only` is a Next.js build marker (not an npm package here) — stand in an empty module so the real access logic loads.
const stub = path.join(os.tmpdir(), "vono-server-only-stub.cjs");
writeFileSync(stub, "module.exports = {};\n");
const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
const origResolve = M._resolveFilename;
M._resolveFilename = function (req: string, ...rest: unknown[]) {
  return req === "server-only" ? stub : origResolve.call(this, req, ...rest);
};

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, n);
    if (/node_modules|\.next/.test(rel)) continue;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx?|jsx?)$/.test(n)) out.push(rel);
  }
  return out;
}

async function main() {
  // P1 — the song list never reaches the browser bundle
  const clientFiles = [...walk("components"), ...walk("app"), ...walk("lib")].filter((f) => /^\s*["']use client["']/.test(read(f)));
  // an import (static or dynamic) of the module — not the API path "/api/music-bank/private-banks" a client may fetch
  const leaking = clientFiles.filter((f) => /(from|import)\s*\(?\s*["'][^"']*lib\/music-bank\/(shufersal-demo-catalog|private-banks|bank-access)["']/.test(read(f)));
  assert(`P1 no client file imports the private song list (${clientFiles.length} client files checked)`, leaking.length === 0);
  assert("P2 the private registry and the access check are server-only",
    /import "server-only";/.test(read("lib/music-bank/private-banks.ts")) && /import "server-only";/.test(read("lib/music-bank/bank-access.ts")));

  // P3 — the lock is in the media token: a business without a grant never gets the bank's genre
  const { scopeGenres, isGrantLive } = await import("../lib/music-bank/bank-access");
  const { PRIVATE_BANKS, privateBankById } = await import("../lib/music-bank/private-banks");
  const ready = ["jazz", "dance", "shufersal-demo"];
  assert("P3a no grant → the private genre is removed, every public genre stays", JSON.stringify(scopeGenres(ready, [])) === JSON.stringify(["jazz", "dance"]));
  assert("P3b a grant for All Day Mix → its genre is in the token", JSON.stringify(scopeGenres(ready, ["all-day-mix"])) === JSON.stringify(ready));
  assert("P3c an unknown bank id opens nothing", JSON.stringify(scopeGenres(ready, ["nope"])) === JSON.stringify(["jazz", "dance"]));
  const now = new Date("2026-11-10T12:00:00Z");
  assert("P3d a grant with no end date is live; a past end date is not; a future one is",
    isGrantLive({ expiresAt: null }, now) && !isGrantLive({ expiresAt: new Date("2026-11-09T00:00:00Z") }, now) && isGrantLive({ expiresAt: new Date("2026-12-01T00:00:00Z") }, now));
  const auth = read("app/api/music-bank/authorize/route.ts");
  assert("P3e the authorize route (station + signed-in person) scopes the token by the business's open banks",
    /accessiblePrivateBanks\(\{ workspaceId: station \? station\.workspaceId : user!\.tenantId \?\? null, purpose: "token" \}\)/.test(auth)
    && /const allowedGenres = scopeGenres\(\[\.\.\.new Set\(\[\.\.\.dbGenres, \.\.\.pocGenres\]\)\], openBanks\.map\(\(b\) => b\.id\)\);/.test(auth));
  assert("P3f /api/media still refuses a genre that is not in the token (unchanged scope check)", /allowedGenres/.test(read("app/api/media/[assetId]/route.ts")));
  const access = read("lib/music-bank/bank-access.ts");
  assert("P3g a failed grant lookup closes private banks only (never throws, public catalog unaffected)", /catch \(e\) \{[\s\S]*?private banks closed[\s\S]*?return \[\];/.test(access));

  // 2026-11-11 owner rule: "only when I switch it on should it be SEEN and HEARD" — no see-everything bypass (not even the owner)
  const pbRoute = read("app/api/music-bank/private-banks/route.ts");
  assert("P3h seen == heard: no SUPER_ADMIN bypass; the catalog and the media token use the same per-business grant check",
    !/SUPER_ADMIN|isSuperAdminUser|userId/.test(access.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))
    && /accessiblePrivateBanks\(\{ workspaceId: user\.tenantId \?\? null \}\)/.test(pbRoute));

  // P4 — All Day Mix = the 100 Shufersal songs, mixed
  const mix = privateBankById("all-day-mix");
  const { SHUFERSAL_DEMO_TRACKS } = await import("../lib/music-bank/shufersal-demo-catalog");
  assert("P4 All Day Mix holds all 100 songs once each, in a mixed order", !!mix && mix.tracks.length === 100 && new Set(mix.tracks.map((t) => t.id)).size === 100
    && mix.tracks.map((t) => t.id).join() !== SHUFERSAL_DEMO_TRACKS.map((t) => t.id).join() && mix.genreIds.join() === "shufersal-demo" && PRIVATE_BANKS.length >= 1);

  // P5 — the migration is additive only
  const sql = read("prisma/migrations/20261110120000_music_bank_grants/migration.sql").replace(/--.*$/gm, "");
  const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
  assert("P5 the migration only creates the new table, its indexes and its key (nothing existing changes)",
    stmts.length === 4 && stmts.every((s) => /^(CREATE TABLE "MusicBankGrant"|CREATE (UNIQUE )?INDEX "MusicBankGrant_|ALTER TABLE "MusicBankGrant" ADD CONSTRAINT)/.test(s)));

  // P6 — admin routes: platform owner only, change + audit row in one transaction
  const put = read("app/api/admin/platform/workspaces/[id]/music-banks/route.ts");
  const list = read("app/api/admin/platform/music-banks/route.ts");
  assert("P6a both admin routes answer 403 to anyone but the platform owner",
    /const admin = await getSuperAdminOrNull\(\);\s*if \(!admin\) return NextResponse\.json\(\{ error: "Forbidden" \}, \{ status: 403 \}\);/.test(put)
    && /const admin = await getSuperAdminOrNull\(\);\s*if \(!admin\) return NextResponse\.json\(\{ error: "Forbidden" \}, \{ status: 403 \}\);/.test(list));
  // 2026-11-11: closing no longer deletes — it sets closesAt (the next 04:00, branch time); opening clears it
  assert("P6b open/close and its audit row commit together; closing sets the 04:00 close, opening clears it",
    /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*tx\.musicBankGrant\.upsert[\s\S]*closesAt: null, closeReason: null[\s\S]*closeTakesEffectAt\(now, zones\)[\s\S]*data: \{ closesAt, closeReason: "manual" \}[\s\S]*writePlatformAuditLog\(tx,/.test(put)
    && !/deleteMany/.test(put)
    && /"music_bank\.open"[\s\S]*"music_bank\.close"/.test(read("lib/admin/platform-audit.ts")));
  assert("P6c only a known bank, and an end date in the future", /Unknown bank/.test(put) && /The end date must be in the future/.test(put));

  // P7 — the screens
  const rfm = read("components/royalty-free-music-workspace-panel.tsx");
  assert("P7a the Royalty-Free catalog asks the server for the private banks and shows them only when there are some",
    /fetch\("\/api\/music-bank\/private-banks"/.test(rfm) && /\{privatePacks\.length > 0 \? \(/.test(rfm));
  const hub = read("components/admin/businesses-hub.tsx");
  // 2026-11-11 (owner, option א): the list is a table (hundreds of international accounts), not squares
  assert("P7b Platform → Accounts: a sortable, filterable table; an account page with tabs (Music banks / Chains & branches / Account)",
    /<table className="sb-bz-table">/.test(hub) && !/className="sb-pg-tile"/.test(hub) && /sb-bz-filters/.test(hub) && /aria-sort=/.test(hub)
    && /Music banks<\/button>/.test(hub) && /Chains &amp; branches<\/button>/.test(hub) && /Account<\/button>/.test(hub)
    && /href="\/admin\/platform\/accounts"/.test(read("app/admin/platform/page.tsx")) && /BusinessesHub/.test(read("app/admin/platform/accounts/page.tsx")));
  // 2026-11-11 (owner): "details are missing compared to the regular tables" → everything Platform · Workspaces shows
  assert("P7e the Accounts table carries the Workspaces table's details (trial end, used / limit, over limit, slug) and its actions",
    /buildQuotaChecks\(/.test(list) && /limits: e \?/.test(list) && /overLimit: quota\.anyOver/.test(list)
    && /th\("trial", "Trial ends"\)/.test(hub) && /th\("users", "Users"/.test(hub) && /th\("playlists", "Playlists"/.test(hub)
    && /<Usage used=\{b\.branchCount\} max=\{b\.limits\?\.branches\} \/>/.test(hub) && /\{ id: "over", label: "Over limit" \}/.test(hub)
    && /<WorkspaceActions[\s\S]*onChanged=\{onChanged\}/.test(hub) && /<WorkspaceTestDeleteButton/.test(hub)
    && /onChanged\?: \(\) => void;/.test(read("components/admin/workspace-actions.tsx")));
  assert("P7d the list shows each account's last device activity (server reads the newest Device.lastSeenAt)",
    /_max: \{ lastSeenAt: true \}/.test(list) && /lastActiveAt:/.test(list));
  assert("P7c the old Shufersal panel reads the list from the server too", /fetch\("\/api\/music-bank\/private-banks"/.test(read("components/shufersal-bank-workspace-panel.tsx")));

  // P8 — 2026-11-11 owner rules: a close takes effect at the next 04:00 (branch time), never mid-day; never silence
  const { nextLocalFour, closeTakesEffectAt, untilDateTakesEffectAt, CLOSE_GRACE_MS } = await import("../lib/music-bank/day-boundary");
  const il = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jerusalem" });
  assert("P8a next 04:00: noon IL → 04:00 tomorrow IL; 03:00 IL → 04:00 today; exactly 04:00 → tomorrow; bad zone → UTC",
    il(nextLocalFour(new Date("2026-11-11T10:00:00Z"), "Asia/Jerusalem").toISOString()) === "12/11/2026, 04:00:00"
    && il(nextLocalFour(new Date("2026-11-11T01:00:00Z"), "Asia/Jerusalem").toISOString()) === "11/11/2026, 04:00:00"
    && il(nextLocalFour(new Date("2026-11-11T02:00:00Z"), "Asia/Jerusalem").toISOString()) === "12/11/2026, 04:00:00"
    && nextLocalFour(new Date("2026-11-11T10:00:00Z"), "Nope/Zone").toISOString() === "2026-11-12T04:00:00.000Z");
  assert("P8b daylight saving + several branches (the latest 04:00 wins) + an until-date plays its whole day",
    nextLocalFour(new Date("2026-03-26T12:00:00Z"), "Asia/Jerusalem").toISOString() === "2026-03-27T01:00:00.000Z"
    && closeTakesEffectAt(new Date("2026-11-11T10:00:00Z"), ["Asia/Jerusalem", "UTC"]).toISOString() === "2026-11-12T04:00:00.000Z"
    && untilDateTakesEffectAt("2026-11-20", ["Asia/Jerusalem"])?.toISOString() === "2026-11-21T02:00:00.000Z");
  const t0 = new Date("2026-11-12T02:00:00Z");
  const closingGrant = { expiresAt: null, closesAt: t0 };
  assert("P8c seen until the close, playable 30 min longer (finish the song, switch — never refused into silence)",
    CLOSE_GRACE_MS === 30 * 60 * 1000
    && isGrantLive(closingGrant, new Date(t0.getTime() - 1)) && !isGrantLive(closingGrant, t0)
    && isGrantLive(closingGrant, new Date(t0.getTime() + 29 * 60 * 1000), CLOSE_GRACE_MS) && !isGrantLive(closingGrant, new Date(t0.getTime() + 31 * 60 * 1000), CLOSE_GRACE_MS));
  const guard = read("components/private-bank-guard.tsx");
  assert("P8d the guard acts only on the designated station's own window, once per (bank, close, attempt) + one retry, never restarts music stopped on purpose",
    /const isStation = handlers\.route\?\.kind === "station";/.test(guard) && /if \(!isStation \|\| typeof window === "undefined"\) return;/.test(guard)
    && /route\?\.kind !== "station" \|\| !route\.urlReady/.test(guard) && /f\.tries >= 2/.test(guard)
    && /status === "idle" && !pending && typeof st\.mpvLastError === "string" && st\.mpvLastError/.test(guard)
    && /dur - pos <= Math\.max\(1, mix\) \+ 1\.5/.test(guard));
  assert("P8e the fallback starts like a schedule (no MAIN change): the business's playlist, else the general Royalty-Free mix",
    /runSchedulePlayback\(/.test(guard) && /buildGeneralMixFallbackSource\(window\.location\.origin\)/.test(guard)
    && /<PrivateBankGuard \/>/.test(read("app/(app)/providers.tsx")) && /<PrivateBankNotice \/>/.test(read("components/app-shell.tsx")));
  const fb = read("app/api/admin/platform/workspaces/[id]/fallback-playlist/route.ts");
  assert("P8f fallback playlist: platform owner only, must belong to that business, audited",
    /getSuperAdminOrNull\(\);\s*if \(!admin\) return NextResponse\.json\(\{ error: "Forbidden" \}, \{ status: 403 \}\);/.test(fb)
    && /prisma\.playlist\.findFirst\(\{ where: \{ id: playlistId, workspaceId \}/.test(fb) && /"workspace\.fallback_playlist"/.test(fb));
  const mig2 = read("prisma/migrations/20261111120000_bank_close_next_morning/migration.sql").replace(/--.*$/gm, "");
  assert("P8g the migration only adds three nullable columns, idempotent (applied to PROD before the code deploy)",
    /ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "fallbackPlaylistId" TEXT;/.test(mig2)
    && /ADD COLUMN IF NOT EXISTS "closesAt" TIMESTAMP\(3\),\s*ADD COLUMN IF NOT EXISTS "closeReason" TEXT;/.test(mig2)
    && !/DROP|NOT NULL|UPDATE |DELETE /i.test(mig2));
  const { buildGeneralMixFallbackSource, isMusicBankSourceOf } = await import("../lib/music-bank/stream-source");
  const mixSrc = buildGeneralMixFallbackSource("https://x.test");
  assert("P8h the general mix holds all 176 public tracks as token-free /api/media URLs; the bank marker matches MAIN's ids",
    !!mixSrc && mixSrc.playlist!.tracks!.length === 176 && mixSrc.playlist!.tracks!.every((t) => /^https:\/\/x\.test\/api\/media\/a_[0-9a-f]+$/.test(t.url))
    && isMusicBankSourceOf("ephemeral-local-folder:musicbank-all-day-mix-stream:track:r3", "all-day-mix") && !isMusicBankSourceOf("ephemeral-local-folder:musicbank-jazz-stream", "all-day-mix"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
}
void main();
