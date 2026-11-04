/**
 * Control Room — taking the player (station) off a branch (owner 2026-11-03: "let me separate them and delete the branch"). Run: npx tsx scripts/verify-branch-station-remove.ts
 *  Part 1 (no DB): the code shape — one transaction, FOR UPDATE locks, the audit row, confirmName, the legacy default refused, no foreign data touched; the route; the screen.
 *  Part 2 (THROWAWAY localhost DB via CR_VERIFY_DATABASE_URL, all migrations applied):
 *    - wrong / missing confirmName → 400 `confirm`, the station + designation survive
 *    - the legacy default branch → 409 `default`, nothing removed
 *    - a unknown branch / another workspace's branch → 404
 *    - a registered station + designated MASTER + an unused activation code: removed, the code revoked, ONE AuditLog row (branch.station_remove, who / IP / counts / 12-char device
 *      fingerprints, never a full id); other branches' stations untouched
 *    - then `deleteBranch` works (the point of the feature) and a branch with no player answers zeros + writes no audit row
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

const VERIFY_URL = process.env.CR_VERIFY_DATABASE_URL ?? "";
const VERIFY_SAFE = !!VERIFY_URL && ["localhost", "127.0.0.1"].includes(new URL(VERIFY_URL).hostname) && !/syncbiz_dev|railway|rlwy|production/i.test(VERIFY_URL);
process.env.DATABASE_URL = VERIFY_SAFE ? VERIFY_URL : "postgresql://nobody:none@127.0.0.1:1/none";
process.env.SYNCBIZ_ACTIVATION_SECRET = process.env.SYNCBIZ_ACTIVATION_SECRET || "test-activation-secret-0123456789";
{
  const Mo = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
  const m = new Module("stub:server-only") as unknown as { loaded: boolean; exports: unknown };
  m.loaded = true; m.exports = {}; Mo._cache["stub:server-only"] = m;
  const orig = Mo._resolveFilename;
  Mo._resolveFilename = function (r: string, ...rest: unknown[]) { return r === "server-only" ? "stub:server-only" : orig.call(this, r, ...rest); };
}

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

// ── Part 1: the shape of the code ──
{
  const src = read("lib/branch-management.ts");
  const fn = src.slice(src.indexOf("export async function removeBranchStation"));
  const route = read("app/api/control-room/branches/[id]/station/route.ts");
  const act = read("components/control-room/station-activation.tsx");
  const audit = read("lib/admin/tenant-audit.ts");
  assert("C1 removeBranchStation: the checks, the deletes and the audit row happen inside ONE prisma.$transaction", /prisma\.\$transaction\(\s*async \(tx\)/.test(fn) && /writeTenantAuditLog\(tx,/.test(fn) && /tx\.stationDevice\.deleteMany\(/.test(fn) && /tx\.branchMasterDesignation\.deleteMany\(/.test(fn));
  assert("C2 the branch row and its activation codes are locked FOR UPDATE before any check (an activation that is running finishes first)", /FROM "Branch"[^`]*FOR UPDATE/.test(fn) && /FROM "BranchActivationCode"[^`]*FOR UPDATE/.test(fn) && fn.indexOf("FOR UPDATE") < fn.indexOf("deleteMany"));
  assert("C3 the owner must type the branch's name (`confirm`) and the legacy default branch is refused (`default`)", /ctx\.confirmName/.test(fn) && /"confirm"/.test(fn) && /cur\.legacyKey/.test(fn) && /"default"/.test(fn));
  assert("C4 it deletes ONLY this workspace's rows of THIS branch — both deletes are filtered by workspaceId AND branchId", /branchMasterDesignation\.deleteMany\(\{ where: \{ workspaceId, branchId: cur\.id \} \}\)/.test(fn) && /stationDevice\.deleteMany\(\{ where: \{ workspaceId, branchId: cur\.id \} \}\)/.test(fn));
  assert("C5 it does not delete the branch, its users' assignments, scopes or schedules", !/tx\.branch\.delete|userBranchAssignment|memberScope|schedule/i.test(fn));
  assert("C6 the audit row is branch.station_remove with counts and 12-character fingerprints (never a full device id), and the action is registered", /action: "branch\.station_remove"/.test(fn) && /slice\(0, 12\)/.test(fn) && /"branch\.station_remove"/.test(audit) && (audit.match(/branch\.station_remove/g) ?? []).length >= 2);
  assert("C7 the route is owner-only (requireBranchManager), passes the typed name, the actor and the client IP, and words refusals with a code", /requireBranchManager\(\)/.test(route) && /confirmName: body\?\.confirmName/.test(route) && /userId: auth\.userId/.test(route) && /extractClientIp\(req\)/.test(route) && /code: e\.code/.test(route) && /export async function DELETE/.test(route));
  assert("C8 the screen: the button shows only when a player is registered, asks for the branch name in the confirm dialog and reloads the list afterwards", /hasMainStation \? \(\s*<div className="mt-4">\s*<button[^>]*onClick=\{\(\) => setRemoving\(true\)\}/.test(act) && /kind="station"/.test(act) && /typeToConfirm=\{branchName\}/.test(act) && /onStationRemoved\?\.\(\)/.test(act));
  const view = read("components/control-room/all-branches-view.tsx");
  const panel = read("components/control-room/branch-panel.tsx");
  assert("C9 the list view reloads after the player was taken off, and the panel hands the callback to the activation block", /onStationRemoved=\{\(\) => setReloadKey\(\(k\) => k \+ 1\)\}/.test(view) && /onStationRemoved=\{onStationRemoved\}/.test(panel));
  const i18n = read("lib/i18n/management.ts");
  assert("C10 the words exist in English and Hebrew (title, body, button, the default-branch refusal, the action label)", ["del.stationTitle", "del.stationBody", "del.stationRemove", "del.err.stationDefault", "act.removeStation"].every((k) => (i18n.match(new RegExp(`"${k}":`, "g")) ?? []).length === 2));
  const cd = read("components/control-room/confirm-delete.tsx");
  const hostSrc = read("components/control-room/all-branches-view.tsx");
  const store = read("lib/store.ts");
  assert("C12 the delete dialog can offer a second way out (an `extra` button with the same typed-name guard) — only the host decides when", /extra\?: \{ label: string; run: \(typed: string\) => Promise<string \| null> \}/.test(cd) && /onClick=\{\(\) => void runExtra\(\)\} disabled=\{busy \|\| !ready\}/.test(cd));
  assert("C13 the host offers 'remove the player and delete the branch' ONLY after the server refused with `station`, and runs the two steps in order (remove the player, then delete) — each re-checked by the server", /setPlayerBlocksDelete\(d\.code === "station"\)/.test(hostSrc) && /extra=\{playerBlocksDelete \?/.test(hostSrc) && hostSrc.indexOf("/station`") > 0 && hostSrc.indexOf("/station`") < hostSrc.indexOf("const res = await call(`/api/control-room/branches/${encodeURIComponent(deleting.id)}`)"));
  assert("C14 the list's 'a player is registered' counts a designated MASTER as well as a StationDevice (the delete rule counts both)", /branchMasterDesignation\.findMany\(\{ where: \{ workspaceId: wsId \}/.test(store) && /\.\.\.designated\.map/.test(store));
  assert("C11 the deletion rule itself is unchanged: deleteBranch still REFUSES a bound station (`station`) — removing the player is a separate, explicit step", /if \(stations > 0 \|\| designations > 0\) throw new BranchInputError\("This branch has a station installed\.", 409, "station"\)/.test(src));
}

async function dbPart(): Promise<void> {
  if (!VERIFY_URL) { console.log("SKIP  Part 2 (set CR_VERIFY_DATABASE_URL to a THROWAWAY database with all migrations)"); return; }
  if (!VERIFY_SAFE) { assert("Part 2 refuses a non-throwaway database", false, "refused"); return; }
  const { prisma } = await import("../lib/prisma");
  const bm = await import("../lib/branch-management");
  const t = Date.now();
  const mkWs = async (tag: string) => {
    const w = await prisma.workspace.create({ data: { name: `Station remove ${tag}`, slug: `sr-${tag}-${t}`, owner: { create: { email: `sr-${tag}-${t}@example.test` } } } as never });
    await prisma.workspace.update({ where: { id: w.id }, data: { stationIdPrefix: tag === "a" ? "VSA" : "VSB" } });
    return w;
  };
  const ws = await mkWs("a");
  const other = await mkWs("b");
  const actor = ws.ownerId as string;
  let n = 0;
  const mk = (workspaceId: string, name: string, extra: Record<string, unknown> = {}) => prisma.branch.create({ data: { workspaceId, name, code: `SR${t}${++n}`, locationCode: `SR${n}`, timezone: "Asia/Jerusalem", status: "ACTIVE", ...extra } as never });
  const counts = (workspaceId: string, branchId: string) => Promise.all([
    prisma.stationDevice.count({ where: { workspaceId, branchId } }),
    prisma.branchMasterDesignation.count({ where: { workspaceId, branchId } }),
  ]);
  const attempt = async (workspaceId: string, id: string, confirmName: unknown): Promise<{ ok: boolean; code?: string; status?: number; res?: { stations: number; designations: number } }> => {
    try { const res = await bm.removeBranchStation(workspaceId, id, { userId: actor, confirmName, ipAddress: "203.0.113.7" }); return { ok: true, res }; }
    catch (e) { const x = e as { code?: string; status?: number }; return { ok: false, code: x.code, status: x.status }; }
  };
  const audits = () => prisma.auditLog.findMany({ where: { workspaceId: ws.id, action: "branch.station_remove" }, orderBy: { createdAt: "asc" } });

  const b = await mk(ws.id, "Player branch");
  const bKeep = await mk(ws.id, "Other branch");
  const durable = `dsk-sr-${t}-main-device-id-long`;
  await prisma.stationDevice.create({ data: { durableDeviceId: durable, workspaceId: ws.id, branchId: b.id, platform: "win32", appVersion: "2.3.1" } });
  await prisma.branchMasterDesignation.create({ data: { workspaceId: ws.id, branchId: b.id, durableDeviceId: durable, designatedBy: actor } });
  await prisma.stationDevice.create({ data: { durableDeviceId: `dsk-sr-${t}-keep`, workspaceId: ws.id, branchId: bKeep.id, platform: "win32", appVersion: "2.3.1" } });
  const { code } = await bm.createActivationCode(ws.id, b.id, actor);
  assert("D0 the setup: one registered station + one designated MASTER + one unused activation code on the branch", (await counts(ws.id, b.id)).join() === "1,1" && !!code);

  let r = await attempt(ws.id, b.id, undefined);
  assert("D1 no confirmName → 400 `confirm`; the station and the designation survive", !r.ok && r.code === "confirm" && r.status === 400 && (await counts(ws.id, b.id)).join() === "1,1");
  r = await attempt(ws.id, b.id, "Other branch");
  assert("D2 another branch's name → 400 `confirm`; nothing removed", !r.ok && r.code === "confirm" && (await counts(ws.id, b.id)).join() === "1,1");

  const legacy = await mk(ws.id, "Legacy", { legacyKey: "default" });
  await prisma.stationDevice.create({ data: { durableDeviceId: `dsk-sr-${t}-legacy`, workspaceId: ws.id, branchId: legacy.id, platform: "win32", appVersion: "2.3.1" } });
  r = await attempt(ws.id, legacy.id, "Legacy");
  assert("D3 the legacy default branch (the pilot's) → 409 `default`; its station is still there", !r.ok && r.code === "default" && r.status === 409 && (await counts(ws.id, legacy.id))[0] === 1);

  r = await attempt(ws.id, "00000000-0000-0000-0000-000000000000", "x");
  assert("D4 an unknown branch → 404", !r.ok && r.status === 404);
  const foreign = await mk(other.id, "Foreign");
  r = await attempt(ws.id, foreign.id, "Foreign");
  assert("D5 another workspace's branch → 404 (never touched)", !r.ok && r.status === 404);

  assert("D6 before: deleteBranch REFUSES while the player is registered (`station`)", await (async () => { try { await bm.deleteBranch(ws.id, b.id, { userId: actor, confirmName: "Player branch" }); return false; } catch (e) { return (e as { code?: string }).code === "station"; } })());

  const before = Date.now();
  r = await attempt(ws.id, b.id, "  Player branch ");
  const rows = await audits();
  const md = (rows[0]?.metadata ?? {}) as { stations?: number; designations?: number; deviceFingerprints?: string[]; branchName?: string };
  assert("D7 the typed name (trimmed) removes the station AND the designation: answer 1 / 1, both rows gone", r.ok && r.res?.stations === 1 && r.res?.designations === 1 && (await counts(ws.id, b.id)).join() === "0,0");
  const live = await prisma.branchActivationCode.count({ where: { branchId: b.id, usedAt: null, revokedAt: null } });
  assert("D8 the unused activation code is revoked (no live code left to re-bind a player by accident)", live === 0);
  assert("D9 ONE AuditLog row: branch.station_remove / branch / the branch id / the actor / the IP / when / name + counts + a 12-character fingerprint, never the full device id",
    rows.length === 1 && rows[0]!.entity === "branch" && rows[0]!.entityId === b.id && rows[0]!.userId === actor && rows[0]!.ipAddress === "203.0.113.7" && rows[0]!.createdAt.getTime() >= before - 5_000
      && md.stations === 1 && md.designations === 1 && md.branchName === "Player branch" && md.deviceFingerprints?.[0] === durable.slice(0, 12) && !JSON.stringify(rows[0]!.metadata).includes(durable));
  assert("D10 other branches' players are untouched", (await counts(ws.id, bKeep.id))[0] === 1 && (await counts(ws.id, legacy.id))[0] === 1);

  // a designation WITHOUT a station row (the list must still say "a player is registered", and removal must clear it)
  const bd = await mk(ws.id, "Designation only");
  await prisma.branchMasterDesignation.create({ data: { workspaceId: ws.id, branchId: bd.id, durableDeviceId: `dsk-sr-${t}-orphan`, designatedBy: actor } });
  const { db } = await import("../lib/store");
  const withPlayer = await db.getBranchIdsWithStation(ws.id);
  assert("D10b a branch that has ONLY a designated MASTER is listed as having a player (so the screen shows it and offers the removal)", withPlayer.has(bd.id) && withPlayer.has(bKeep.id) && !withPlayer.has(b.id));
  r = await attempt(ws.id, bd.id, "Designation only");
  assert("D10c removing the player clears the designation-only branch (answer 0 stations / 1 designation) and it can be deleted", r.ok && r.res?.stations === 0 && r.res?.designations === 1 && (await (async () => { try { await bm.deleteBranch(ws.id, bd.id, { userId: actor, confirmName: "Designation only" }); return true; } catch { return false; } })()));

  r = await attempt(ws.id, b.id, "Player branch");
  assert("D11 a branch with no player answers 0 / 0, no error and writes NO second audit row", r.ok && r.res?.stations === 0 && r.res?.designations === 0 && (await audits()).filter((a) => a.entityId === b.id).length === 1);

  let deleted = false;
  try { await bm.deleteBranch(ws.id, b.id, { userId: actor, confirmName: "Player branch" }); deleted = true; } catch { /* asserted below */ }
  assert("D12 THE POINT: after the player was taken off, the branch can be deleted", deleted && !(await prisma.branch.findUnique({ where: { id: b.id }, select: { id: true } })));

  await prisma.$disconnect();
}

dbPart()
  .catch((e) => { assert("Part 2 ran without throwing", false, String(e).slice(0, 300)); })
  .finally(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1); });
