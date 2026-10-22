/**
 * beta.22 — station media authorization (server) tests. Run: npx tsx scripts/verify-station-media-authorize.ts
 *  - verifyDesktopStationToken: ONLY a desktop_access token that is bound to a station AND carries a workspace
 *  - ws_register tokens, unbound desktop tokens, tampered / foreign-secret tokens → rejected
 *  - existing desktop-token verification unchanged (claims additive)
 *  - authorize route: Bearer path requires a registered StationDevice of the signed workspace; the cookie path is unchanged
 */
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.SYNCBIZ_WS_SECRET = "test-ws-secret-0123456789abcdef";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

async function main(): Promise<void> {
  const t = await import("../lib/auth-ws-token");
  const bound = t.createDesktopAccessToken("u1", { workspaceId: "ws-1", authorizedBranches: ["b1"], stationDeviceId: "dsk-aaaa", stationBranchId: "b1" });
  const unbound = t.createDesktopAccessToken("u1", { workspaceId: "ws-1", authorizedBranches: ["b1"] });
  const noWs = t.createDesktopAccessToken("u1", { stationDeviceId: "dsk-aaaa" });
  const wsReg = t.createWsToken("u1", { workspaceId: "ws-1", stationDeviceId: "dsk-aaaa" });
  const s = t.verifyDesktopStationToken(bound);
  assert("A1 bound desktop token → station identity (workspace + durable station id)", !!s && s.workspaceId === "ws-1" && s.stationDeviceId === "dsk-aaaa" && s.userId === "u1");
  assert("A2 desktop token NOT bound to a station → rejected", t.verifyDesktopStationToken(unbound) === null);
  assert("A3 no workspace claim → rejected", t.verifyDesktopStationToken(noWs) === null);
  assert("A4 a ws_register token is never a station credential", t.verifyDesktopStationToken(wsReg) === null);
  const [p, sig] = bound.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), stationDeviceId: "dsk-lenovo" })).toString("base64url") + "." + sig;
  assert("A5 tampered station id (signature mismatch) → rejected", t.verifyDesktopStationToken(forged) === null);
  assert("A6 existing verification unchanged: claims still return userId + workspace", JSON.stringify(t.verifyDesktopAccessTokenClaims(bound)) === JSON.stringify({ userId: "u1", workspaceId: "ws-1" }) && t.verifyDesktopAccessToken(unbound) === "u1");
  process.env.SYNCBIZ_WS_SECRET = "another-secret-0123456789abcdef";
  assert("A7 token signed with another secret → rejected", t.verifyDesktopStationToken(bound) === null);

  const route = readFileSync(path.join(__dirname, "../app/api/music-bank/authorize/route.ts"), "utf8");
  assert("R1 Bearer path: verifyDesktopStationToken + StationDevice must exist in the SIGNED workspace, else 401",
    /verifyDesktopStationToken\(/.test(route) && /prisma\.stationDevice\.findUnique\(\{ where: \{ durableDeviceId: claims\.stationDeviceId \}/.test(route) &&
    /station\.workspaceId !== claims\.workspaceId\) return "invalid"/.test(route) && /if \(station === "invalid"\) return NextResponse\.json\(\{ error: "Station not authorized\." \}, \{ status: 401 \}\)/.test(route));
  assert("R2 station token is scoped to that station (deviceId = stationDeviceId, workspace = signed workspace)",
    /const deviceId = station\s*\? station\.stationDeviceId/.test(route) && /const workspaceId = station \? station\.workspaceId/.test(route));
  assert("R3 cookie path unchanged when no Bearer header", /const user = station \? null : await getCurrentUserFromCookies\(\)/.test(route) && /if \(!station && !user\) return NextResponse\.json\(\{ error: "Please sign in\." \}, \{ status: 401 \}\)/.test(route));
  assert("R4 genre scope still server-authoritative (READY assets)", /getReadyMediaAssetGenreIds\(\)/.test(route));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => console.log(`\n${pass} passed, ${fail} failed`));
