/**
 * Music Bank OFFLINE (owner 2026-11-10/11/12): which songs ONE COMPUTER may keep offline and until when — per computer,
 * per bank (only the bank clicked downloads), private banks with a live grant + the Royalty-Free demo packs for everyone.
 * Checks the pure composer, the routes' auth and the catalog switch.
 * Run: npx tsx scripts/verify-offline-manifest.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";

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

async function main() {
  const { composeOfflineManifest, OFFLINE_LICENSE_DAYS, demoPacks } = await import("../lib/music-bank/offline-manifest");
  const { privateBankById } = await import("../lib/music-bank/private-banks");
  const mix = privateBankById("all-day-mix")!;
  const now = new Date("2026-11-11T12:00:00Z");
  const h = (n: number) => n.toString(16).padStart(64, "0");
  const assets: Array<{ logicalId: string; contentHash: string; contentHashAlgorithm: string; sizeBytes: bigint; mimeType: string; durationSeconds: number | null }> = mix.tracks.slice(0, 3).map((t, i) => ({ logicalId: t.id, contentHash: h(i + 1), contentHashAlgorithm: "sha256", sizeBytes: BigInt(1000 + i), mimeType: "audio/mpeg", durationSeconds: 200 }));
  assets.push({ logicalId: mix.tracks[3].id, contentHash: "abc", contentHashAlgorithm: "md5", sizeBytes: BigInt(5), mimeType: "audio/mpeg", durationSeconds: null });
  const packs = demoPacks();
  const jazz = packs.find((p) => p.id === "jazz") ?? packs[0];
  const dance = packs.find((p) => p.id !== jazz.id)!;
  for (const [i, t] of [...jazz.tracks.slice(0, 2), ...dance.tracks.slice(0, 2)].entries()) assets.push({ logicalId: t.id, contentHash: h(100 + i), contentHashAlgorithm: "sha256", sizeBytes: BigInt(500), mimeType: "audio/mpeg", durationSeconds: 180 });
  const openGrant = [{ bankId: "all-day-mix", expiresAt: null, closesAt: null }];

  const open = composeOfflineManifest({ now, workspaceId: "ws1", chosen: ["all-day-mix"], grants: openGrant, assets });
  const b = open.banks[0];
  assert("B1 a chosen open private bank is offline: only songs with a READY sha256 asset, sizes + hashes, total bytes",
    open.banks.length === 1 && b.bankId === "all-day-mix" && b.tracks.length === 3 && b.totalBytes === 1000 + 1001 + 1002 && open.totalBytes === b.totalBytes
    && b.tracks.every((t) => /^[0-9a-f]{64}$/.test(t.contentHash) && t.sizeBytes > 0));
  assert(`B2 the offline license is rolling: ${OFFLINE_LICENSE_DAYS} days from now when the bank has no end`,
    b.validUntil === new Date(now.getTime() + OFFLINE_LICENSE_DAYS * 86_400_000).toISOString() && b.endsAt === null);

  const closesAt = new Date("2026-11-12T02:00:00Z");
  const closing = composeOfflineManifest({ now, workspaceId: "ws1", chosen: ["all-day-mix"], grants: [{ bankId: "all-day-mix", expiresAt: null, closesAt }], assets });
  assert("B3 a switched-off bank stays offline only until its 04:00 close (offline == seen == heard)",
    closing.banks[0]?.validUntil === closesAt.toISOString() && closing.banks[0]?.endsAt === closesAt.toISOString());
  const closed = composeOfflineManifest({ now, workspaceId: "ws1", chosen: ["all-day-mix"], grants: [{ bankId: "all-day-mix", expiresAt: null, closesAt: new Date("2026-11-11T02:00:00Z") }], assets });
  const unknown = composeOfflineManifest({ now, workspaceId: "ws1", chosen: ["nope"], grants: [{ bankId: "nope", expiresAt: null, closesAt: null }], assets });
  const noGrant = composeOfflineManifest({ now, workspaceId: "ws1", chosen: ["all-day-mix"], grants: [], assets });
  assert("B4 a closed private bank, an unknown bank, and a private bank without a grant are not offline (the station removes its copies)",
    closed.banks.length === 0 && unknown.banks.length === 0 && noGrant.banks.length === 0);
  const none = composeOfflineManifest({ now, workspaceId: "ws1", chosen: [], grants: openGrant, assets });
  assert("B5 nothing chosen on this computer → nothing offline (an open bank is NOT downloaded by itself)", none.banks.length === 0 && none.totalBytes === 0);

  const keys = new Set<string>();
  JSON.stringify(open, (k, v) => { if (k) keys.add(k); return v; });
  assert("B6 the manifest carries ids, titles, sizes and hashes only — no URL, token, path or audio",
    ![...keys].some((k) => /url|token|path|audio|bucket|objectKey|signed/i.test(k)));

  const lib = read("lib/music-bank/offline-manifest.ts");
  const route = read("app/api/music-bank/offline-manifest/route.ts");
  assert("B7 server-only module; a lookup failure never throws (→ 503, the station keeps its copies until the license ends)",
    /import "server-only";/.test(lib) && /catch \(e\) \{[\s\S]*?return null;/.test(lib) && /status: 503/.test(route));
  assert("B8 station auth = the signed station token AND a registered StationDevice of that same business; the manifest is THAT station's",
    /verifyDesktopStationToken\(/.test(route) && /station\.workspaceId !== claims\.workspaceId\) return "invalid";/.test(route)
    && /return \{ workspaceId: claims\.workspaceId, durableDeviceId: claims\.stationDeviceId \};/.test(route)
    && /offlineManifestForStation\(workspaceId, deviceId\)/.test(route) && /status: 401/.test(route) && /getCurrentUserFromCookies\(\)/.test(route));

  // ── per computer, per bank (owner 2026-11-12) ──
  const onlyJazz = composeOfflineManifest({ now, workspaceId: "ws1", chosen: [jazz.id], grants: openGrant, assets });
  assert("P1 only the bank clicked downloads: Offline on one demo pack → that pack only (not the open private bank, not other packs)",
    onlyJazz.banks.length === 1 && onlyJazz.banks[0].bankId === jazz.id && onlyJazz.banks[0].tracks.length === 2 && onlyJazz.banks[0].endsAt === null);
  const two = composeOfflineManifest({ now, workspaceId: "ws1", chosen: [jazz.id, dance.id, jazz.id], grants: [], assets });
  assert("P2 every Royalty-Free demo pack may be kept offline by any business (no grant needed); a bank counts once",
    two.banks.length === 2 && packs.length >= 7 && !packs.some((p) => p.id === "all-day-mix"));
  const libCode = lib.replace(/\/\*[\s\S]*?\*\//g, "");
  assert("P3 the manifest is per COMPUTER: built from StationOfflineBank rows of that station (durableDeviceId), not from the business",
    /prisma\.stationOfflineBank\.findMany\(\{ where: \{ workspaceId, durableDeviceId \}/.test(lib) && !/offlineEnabled/.test(libCode));

  const toggle = read("app/api/music-bank/offline/route.ts");
  assert("D2 the switch: signed-in owner / admin only, on a registered computer OF THIS business, only an entitled bank, one row per computer+bank",
    /getCurrentUserFromCookies\(\)/.test(toggle) && /hasTenantAdminRole\(user\.id, user\.tenantId \?\? null\)/.test(toggle) && /status: 403/.test(toggle)
    && /s\.workspaceId === workspaceId/.test(toggle) && /isOfflineEntitled\(workspaceId, body\.bankId\)/.test(toggle) && /status: 404/.test(toggle)
    && /durableDeviceId_bankId: \{ durableDeviceId: deviceId, bankId: body\.bankId \}/.test(toggle)
    && /deleteMany\(\{ where: \{ durableDeviceId: deviceId, bankId: body\.bankId \} \}\)/.test(toggle)
    && /canToggle: admin && deviceKnown/.test(toggle));
  const panel = read("components/royalty-free-music-workspace-panel.tsx");
  assert("D3 the catalog shows Offline on EVERY pack for THIS computer (desktop bridge id); a browser sees it dimmed (Desktop app only)",
    /\{offline \? \(\s*<button[\s\S]{0,120}role="switch"[\s\S]{0,80}aria-checked=\{offline\.enabled\}/.test(panel)
    && /offline=\{offlineFor\(selectedGenre\.id\)\}/.test(panel) && /bridge\.getConfig\(\)/.test(panel)
    && /body: JSON\.stringify\(\{ bankId, offline, deviceId: computerId \}\)/.test(panel)
    && /\{offline && !offlineHere \? <span className="sb-cp-faint text-\[11px\] font-medium">Desktop app only<\/span> : null\}/.test(panel));
  const css = read("app/center-panels.css");
  assert("D5 (owner 2026-11-11) the look: only the word Offline + a switch that fills with VONO blue; no long text on screen",
    /Offline\s*<span className="sb-cp-switch" aria-hidden="true">/.test(panel) && !/Kept on this business's computers/.test(panel)
    && /\.sb-cp-offline\.is-on \.sb-cp-switch \{ background-size: 100% 100%; \}/.test(css) && /linear-gradient\(var\(--cp-accent\), var\(--cp-accent\)\)/.test(css));
  const mig = read("prisma/migrations/20261112090000_station_offline_bank/migration.sql").replace(/--.*$/gm, "");
  const fill = read("scripts/sql/station-offline-backfill.sql").replace(/--.*$/gm, "");
  assert("D4 the migration only CREATEs the new table + indexes, all IF NOT EXISTS (safe before the deploy); nothing existing is altered",
    /CREATE TABLE IF NOT EXISTS "StationOfflineBank"/.test(mig) && (mig.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g) ?? []).length === 2 && !/ALTER|DROP|DELETE|UPDATE/i.test(mig));
  assert("D6 the one-time copy keeps what is already downloaded: every station of a business that had Offline on gets the row; idempotent",
    /FROM "MusicBankGrant" g\s+JOIN "StationDevice" s ON s\."workspaceId" = g\."workspaceId"\s+WHERE g\."offlineEnabled" = true\s+ON CONFLICT \("durableDeviceId", "bankId"\) DO NOTHING;/.test(fill)
    && !/DELETE|UPDATE|DROP|ALTER/i.test(fill));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
}
void main();
