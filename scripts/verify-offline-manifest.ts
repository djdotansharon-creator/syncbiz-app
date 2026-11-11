/**
 * Music Bank Phase 2, stage B (owner 2026-11-10/11): the OFFLINE MANIFEST — which songs a station may keep offline and
 * until when. Checks the pure composer and the route's auth.
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
  const { composeOfflineManifest, OFFLINE_LICENSE_DAYS } = await import("../lib/music-bank/offline-manifest");
  const { privateBankById } = await import("../lib/music-bank/private-banks");
  const mix = privateBankById("all-day-mix")!;
  const now = new Date("2026-11-11T12:00:00Z");
  const h = (n: number) => n.toString(16).padStart(64, "0");
  const assets: Array<{ logicalId: string; contentHash: string; contentHashAlgorithm: string; sizeBytes: bigint; mimeType: string; durationSeconds: number | null }> = mix.tracks.slice(0, 3).map((t, i) => ({ logicalId: t.id, contentHash: h(i + 1), contentHashAlgorithm: "sha256", sizeBytes: BigInt(1000 + i), mimeType: "audio/mpeg", durationSeconds: 200 }));
  assets.push({ logicalId: mix.tracks[3].id, contentHash: "abc", contentHashAlgorithm: "md5", sizeBytes: BigInt(5), mimeType: "audio/mpeg", durationSeconds: null });

  const open = composeOfflineManifest({ now, workspaceId: "ws1", grants: [{ bankId: "all-day-mix", expiresAt: null, closesAt: null, offlineEnabled: true }], assets });
  const b = open.banks[0];
  assert("B1 an open bank is offline-entitled: only songs with a READY sha256 asset, sizes + hashes, total bytes",
    open.banks.length === 1 && b.bankId === "all-day-mix" && b.tracks.length === 3 && b.totalBytes === 1000 + 1001 + 1002 && open.totalBytes === b.totalBytes
    && b.tracks.every((t) => /^[0-9a-f]{64}$/.test(t.contentHash) && t.sizeBytes > 0));
  assert(`B2 the offline license is rolling: ${OFFLINE_LICENSE_DAYS} days from now when the bank has no end`,
    b.validUntil === new Date(now.getTime() + OFFLINE_LICENSE_DAYS * 86_400_000).toISOString() && b.endsAt === null);

  const closesAt = new Date("2026-11-12T02:00:00Z");
  const closing = composeOfflineManifest({ now, workspaceId: "ws1", grants: [{ bankId: "all-day-mix", expiresAt: null, closesAt, offlineEnabled: true }], assets });
  assert("B3 a switched-off bank stays offline only until its 04:00 close (offline == seen == heard)",
    closing.banks[0]?.validUntil === closesAt.toISOString() && closing.banks[0]?.endsAt === closesAt.toISOString());
  const closed = composeOfflineManifest({ now, workspaceId: "ws1", grants: [{ bankId: "all-day-mix", expiresAt: null, closesAt: new Date("2026-11-11T02:00:00Z"), offlineEnabled: true }], assets });
  const unknown = composeOfflineManifest({ now, workspaceId: "ws1", grants: [{ bankId: "nope", expiresAt: null, closesAt: null, offlineEnabled: true }], assets });
  assert("B4 a closed bank and an unknown bank are not offline-entitled (the station removes its copies)", closed.banks.length === 0 && unknown.banks.length === 0);
  const none = composeOfflineManifest({ now, workspaceId: "ws1", grants: [], assets });
  assert("B5 no grant → nothing offline (public genre packs are not offline-entitled until billing)", none.banks.length === 0 && none.totalBytes === 0);

  const keys = new Set<string>();
  JSON.stringify(open, (k, v) => { if (k) keys.add(k); return v; });
  assert("B6 the manifest carries ids, titles, sizes and hashes only — no URL, token, path or audio",
    ![...keys].some((k) => /url|token|path|audio|bucket|objectKey|signed/i.test(k)));

  const lib = read("lib/music-bank/offline-manifest.ts");
  const route = read("app/api/music-bank/offline-manifest/route.ts");
  assert("B7 server-only module; a lookup failure never throws (→ 503, the station keeps its copies until the license ends)",
    /import "server-only";/.test(lib) && /catch \(e\) \{[\s\S]*?return null;/.test(lib) && /status: 503/.test(route));
  assert("B8 station auth = the signed station token AND a registered StationDevice of that same business (as /authorize); else a signed-in person",
    /verifyDesktopStationToken\(/.test(route) && /station\.workspaceId !== claims\.workspaceId\) return "invalid";/.test(route)
    && /status: 401/.test(route) && /getCurrentUserFromCookies\(\)/.test(route));

  // ── stage D (owner 2026-11-11): the per-bank Offline switch in the catalog ──
  const offOff = composeOfflineManifest({ now, workspaceId: "ws1", grants: [{ bankId: "all-day-mix", expiresAt: null, closesAt: null, offlineEnabled: false }], assets });
  const offMissing = composeOfflineManifest({ now, workspaceId: "ws1", grants: [{ bankId: "all-day-mix", expiresAt: null, closesAt: null }], assets });
  assert("D1 Offline OFF (the default) → the bank is not in the manifest (streams only; the station deletes its copies)",
    offOff.banks.length === 0 && offMissing.banks.length === 0);
  const toggle = read("app/api/music-bank/offline/route.ts");
  assert("D2 the switch: signed-in business owner / admin only, only for a bank open to that business right now, own business only",
    /getCurrentUserFromCookies\(\)/.test(toggle) && /hasTenantAdminRole\(user\.id, user\.tenantId \?\? null\)/.test(toggle) && /status: 403/.test(toggle)
    && /liveBankIdsForWorkspace\(workspaceId, "catalog"\)/.test(toggle) && /status: 404/.test(toggle)
    && /where: \{ workspaceId_bankId: \{ workspaceId, bankId: body\.bankId \} \}, data: \{ offlineEnabled: body\.offline \}/.test(toggle));
  const pb = read("app/api/music-bank/private-banks/route.ts");
  const panel = read("components/royalty-free-music-workspace-panel.tsx");
  assert("D3 the catalog shows Offline on a private bank's page (only owners / admins may switch it); the dev Stream / Local toggle is gone",
    /offline\[b\.id\] = \{ enabled: info\[b\.id\]\?\.enabled \?\? false, bytes: info\[b\.id\]\?\.bytes \?\? 0, canToggle \}/.test(pb)
    && /role="switch"[\s\S]{0,200}aria-checked=\{offline\.enabled\}/.test(panel) && /disabled=\{!offline\.canToggle \|\| offlineBusy\}/.test(panel)
    && /fetch\("\/api\/music-bank\/offline", \{\s*method: "PUT"/.test(panel) && !/\{m === "stream" \? "Stream" : "Local"\}/.test(panel));
  const css = read("app/center-panels.css");
  assert("D5 (owner 2026-11-11) the look: only the word Offline + a switch that fills with VONO blue; no long text on screen",
    /Offline\s*<span className="sb-cp-switch" aria-hidden="true">/.test(panel) && !/Kept on this business's computers/.test(panel)
    && /\.sb-cp-offline\.is-on \.sb-cp-switch \{ background-size: 100% 100%; \}/.test(css) && /linear-gradient\(var\(--cp-accent\), var\(--cp-accent\)\)/.test(css));
  const mig = read("prisma/migrations/20261111180000_bank_offline_toggle/migration.sql").replace(/--.*$/gm, "").trim();
  assert("D4 the migration only adds one column, default off, idempotent (safe to apply before the code deploy)",
    mig === 'ALTER TABLE "MusicBankGrant" ADD COLUMN IF NOT EXISTS "offlineEnabled" BOOLEAN NOT NULL DEFAULT false;');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
}
void main();
