/**
 * Owner 2026-11-02 — the control room shows each station's engine version and an amber "Update" when a newer one is published.
 * The store lookup runs against a REAL (local) database with a throwaway workspace; the rest are static pins.
 * REFUSES to run against anything but a localhost database.
 *
 * Run: node --env-file=.env.development --require ./scripts/_test-stubs/preload.cjs --import tsx scripts/verify-station-version.ts
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("REFUSED: DATABASE_URL is not a localhost database — this test creates and deletes rows.");
  process.exit(2);
}
let pass = 0, fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++; else fail++;
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const day = 86_400_000;

async function main() {
  const { prisma } = await import("../lib/prisma");
  const { db } = await import("../lib/store");
  const tag = randomUUID().slice(0, 8);
  const owner = await prisma.user.create({ data: { email: `stver-owner-${tag}@example.test`, role: "WORKSPACE_ADMIN" } });
  const ws = await prisma.workspace.create({ data: { name: `Station version test ${tag}`, slug: `stver-test-${tag}`, ownerId: owner.id } });
  try {
    const b1 = await prisma.branch.create({ data: { workspaceId: ws.id, name: "Branch One" } });
    const b2 = await prisma.branch.create({ data: { workspaceId: ws.id, name: "Branch Two" } });
    const b3 = await prisma.branch.create({ data: { workspaceId: ws.id, name: "Branch Three (no station)" } });
    const now = Date.now();
    await prisma.stationDevice.createMany({
      data: [
        { durableDeviceId: `dsk-old-${tag}`, workspaceId: ws.id, branchId: b1.id, platform: "windows", appVersion: "2.2.7", lastSeenAt: new Date(now - day) },
        { durableDeviceId: `dsk-new-${tag}`, workspaceId: ws.id, branchId: b1.id, platform: "windows", appVersion: "2.3.0", lastSeenAt: new Date(now) },
        { durableDeviceId: `dsk-b2-${tag}`, workspaceId: ws.id, branchId: b2.id, platform: "windows", appVersion: "2.2.8-beta.21", lastSeenAt: new Date(now - 2 * day) },
      ],
    });
    const m = await db.getStationVersionByBranch(ws.id);
    assert("V1 a branch with two stations shows the version of the one seen most recently", m.get(b1.id) === "2.3.0", [...m]);
    assert("V2 a single station shows its own version (a beta tag is kept as is)", m.get(b2.id) === "2.2.8-beta.21");
    assert("V3 a branch without a station has no version (nothing invented)", !m.has(b3.id) && m.size === 2);
    assert("V4 an unknown account gives an empty map (never another workspace's data)", (await db.getStationVersionByBranch(`nope-${tag}`)).size === 0 && (await db.getStationVersionByBranch(undefined)).size === 0);
  } finally {
    await prisma.stationDevice.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.branch.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.workspace.delete({ where: { id: ws.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }

  const api = rd("app/api/branches/route.ts");
  const view = rd("components/control-room/all-branches-view.tsx");
  const phr = rd("lib/i18n/management.ts");
  const css = rd("app/globals.css");
  assert("V5 the branches API returns stationVersion next to hasStation", /getStationVersionByBranch\(accountId\)/.test(api) && /stationVersion: versions\.get\(b\.id\) \?\? null/.test(api));
  assert("V6 the list compares with the newest published engine (same rule as the player's pill) and shows 'Update' only when older",
    /import \{ isNewer \} from "@\/lib\/desktop-version"/.test(view) && /isNewer\(latestEngine, row\.stationVersion\)/.test(view) && /className="cr-row-update"/.test(view));
  assert("V7 Hebrew 'עדכון' / English 'Update' + tooltip", /"cr\.update": "Update"/.test(phr) && /"cr\.update": "עדכון"/.test(phr) && /"cr\.updateTip": "Player engine v\{v\}/.test(phr) && /"cr\.updateTip": "מנוע הנגן v\{v\}/.test(phr));
  assert("V8 the row pill is flat amber (same colours as the player's), no border / shadow", /\.cr-row-update \{[^}]*background: #fbbf24; color: #1c1400;/.test(css) && !/\.cr-row-update \{[^}]*(border:|box-shadow)/.test(css));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
