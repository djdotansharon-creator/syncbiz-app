/**
 * Approach (b) — local playback on the designated-MASTER machine. Focused tests:
 *  - MockPlaybackSession.setStationSession populates session metadata and NEVER touches playback truth.
 *  - static guards proving the gate is fail-closed, local-only, metadata-only (no local path over WS),
 *    and that the MAIN's PLAY_SOURCE still never plays a local source (one action = one dispatch).
 * Run (from desktop/): npx tsx scripts/verify-local-playback-prb.ts
 * Lives under desktop/ (excluded from the Next app build) because it imports MockPlaybackSession, whose
 * transitive imports reach `electron` — importing that chain from the app-scoped scripts/ broke `next build`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { MockPlaybackSession } from "../src/playback-agent/mock-playback-session";
import { isDesignatedStationOffline, type DesignationRecord } from "../src/main/designation-cache";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
// From desktop/scripts/, the repo root is two levels up.
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "..", ...p), "utf-8");

// ── Part 1: setStationSession = metadata only, zero playback-truth mutation ──────────────────────────────
{
  const m = new MockPlaybackSession();
  const before = m.getState();
  assert("baseline status idle / position 0", before.status === "idle" && (before.position ?? 0) === 0);
  m.setStationSession({
    id: "pl-1", title: "My Local Playlist", cover: "/c.jpg", origin: "playlist", sourceType: "local",
    trackIndex: 2, sessionTitle: "My Local Playlist", sessionPlaylistId: "pl-1",
    sessionTracks: [
      { id: "t0", title: "A", cover: null },
      { id: "t1", title: "B", cover: null, durationSeconds: 100 },
      { id: "t2", title: "C", cover: "/c2.jpg" },
      { id: "t3", title: "D", cover: null },
    ],
  });
  const s = m.getState();
  assert("currentSource populated", s.currentSource?.id === "pl-1" && s.currentSource?.title === "My Local Playlist");
  assert("currentTrack = track at index", s.currentTrack?.title === "C");
  assert("currentTrackIndex + queueIndex = trackIndex", s.currentTrackIndex === 2 && s.queueIndex === 2);
  assert("queue mirrors sessionTracks (4 rows)", s.queue.length === 4 && s.queue[1]?.id === "t1");
  assert("sessionTracks populated + duration kept", s.sessionTracks?.length === 4 && s.sessionTracks?.[1]?.durationSeconds === 100);
  assert("sessionTitle + sessionPlaylistId set", s.sessionTitle === "My Local Playlist" && s.sessionPlaylistId === "pl-1");
  // THE CRITICAL INVARIANT: metadata write never touches playback truth.
  assert("status UNCHANGED (idle) — metadata never initiates playback", s.status === "idle");
  assert("position/duration UNCHANGED (0) — MPV stays the truth", (s.position ?? 0) === 0 && (s.duration ?? 0) === 0);
}
{
  // MPV truth still flows only through syncMpvStatus (unchanged path).
  const m = new MockPlaybackSession();
  m.setStationSession({ id: "s1", title: "T", cover: null, sessionTracks: [{ id: "s1", title: "T", cover: null }] });
  m.syncMpvStatus({ status: "playing", volume: 80, position: 5, duration: 200, engineReady: true, lastError: null } as never);
  assert("syncMpvStatus remains the only status writer", m.getState().status === "playing" && m.getState().position === 5);
}
{
  // Single source / no sessionTracks → still populates currentSource/currentTrack, empty queue.
  const m = new MockPlaybackSession();
  m.setStationSession({ id: "u1", title: "One", cover: null });
  const s = m.getState();
  assert("single source: currentTrack falls back to source title, queue empty", s.currentTrack?.title === "One" && s.queue.length === 0);
}

// ── device-ws-manager: metadata FIRST, then local never plays on MAIN (one dispatch) ─────────────────────
{
  const ws = read("desktop", "src", "device-websocket-client", "device-ws-manager.ts");
  const caseIdx = ws.indexOf('case "PLAY_SOURCE":');
  const setIdx = ws.indexOf("this.mock.setStationSession(", caseIdx);
  const breakIdx = ws.indexOf("if (!url) break;", caseIdx);
  assert("PLAY_SOURCE populates session", setIdx !== -1);
  assert("session set BEFORE the empty-url break (local populates metadata even with no url)", setIdx < breakIdx && breakIdx !== -1);
  assert("MAIN still refuses to play an empty (local-stripped) url → no MAIN playback for local", /if \(!url\) break;/.test(ws));
}

// ── device-player-context: fail-closed, local-only, metadata-only (no local path over WS) ────────────────
{
  const dp = read("lib", "device-player-context.tsx");
  assert("gate is fail-closed (electron AND (commandReady OR designatedStationOffline))", /const canLocalExec = isElectronShell === true && \(localMainCommandReady \|\| localMainDesignatedOffline\);/.test(dp));
  assert("commandReady + designatedStationOffline come from the co-located MAIN bridge status", /bridge\.onStatus\(apply\)/.test(dp) && /setLocalMainCommandReady\(Boolean\(s\?\.commandReady\)\)/.test(dp) && /setLocalMainDesignatedOffline\(Boolean\(s\?\.designatedStationOffline\)\)/.test(dp));
  assert("local detection is authoritative source type (not empty-url heuristic)", /currentSource\?\.type === "local"/.test(dp) && /source\?\.type === "local"/.test(dp));
  assert("local play uses provider transport (not WS audio)", /canLocalExec && source\?\.type === "local"\) \{[\s\S]*playSource\(source, trackIndex\)/.test(dp));
  assert("local transport gate on current source (play/pause/next/prev)", /const localExecCurrent = canLocalExec && currentSourceIsLocal;/.test(dp));
  assert("metadata-sync uses unifiedSourceToPayload (strips local paths → nothing local over WS)",
    /if \(!canLocalExec \|\| !currentSourceIsLocal \|\| !currentSource\) return;[\s\S]*unifiedSourceToPayload\(currentSource\)/.test(dp));
  // The remote path must be unchanged: the original PLAY_SOURCE send is still the final else.
  assert("remote/URL path unchanged (still sends PLAY_SOURCE to MASTER)", /else \{\s*sendCommandToMaster\("PLAY_SOURCE", \{\s*source: unifiedSourceToPayload\(source\),/.test(dp));
}

// ── playback-provider: source-aware fail-closed permission (the ACTUAL execution guard) ──────────────────
{
  const guard = read("lib", "device-mode-guard.ts");
  assert("2nd permission is fail-closed (default false)", /export const localSourceExecAllowed = \{ current: false \};/.test(guard));
  const pp = read("lib", "playback-provider.tsx");
  assert("provider imports localSourceExecAllowed (+ reactive restore signals)", /import \{ deviceModeAllowsLocalPlayback, localSourceExecAllowed, localExecResolved, subscribeLocalSourceExec \} from "\.\/device-mode-guard"/.test(pp));
  assert("localPlaybackPermitted = CONTROL guard OR (designated && LOCAL source)",
    /deviceModeAllowsLocalPlayback\.current \|\| \(localSourceExecAllowed\.current && unifiedSourceIsLocal\(source, playUrl\)\)/.test(pp));
  assert("local classification is authoritative source.type (plus local-path), not empty-url", /source\?\.type === "local"/.test(pp) && /isValidLocalFilePlaybackPath\(u\)/.test(pp));
  assert("NO bare deviceModeAllowsLocalPlayback guard remains (every exec guard goes via localPlaybackPermitted)", !/if \(!deviceModeAllowsLocalPlayback\.current\)/.test(pp));
  assert("reboot restore bypasses CONTROL guard ONLY for a LOCAL recovery block", /localSourceExecAllowed\.current && restoringLocal/.test(pp) && /const restoringLocal = !!persistedV2\?\.local;/.test(pp));
  const dp = read("lib", "device-player-context.tsx");
  assert("device-player-context sets the 2nd permission from canLocalExec (fail-closed signal)", /localSourceExecAllowed\.current = canLocalExec;/.test(dp));
}

// ── Offline permanent-designation authority (pure) ───────────────────────────────────────────────────────
{
  const rec: DesignationRecord = { schemaVersion: 1, workspaceId: "ws1", branchId: "default", durableDeviceId: "dsk-LENOVO", designatedAt: 1 };
  assert("offline: designated station matches (device+branch)", isDesignatedStationOffline(rec, { durableDeviceId: "dsk-LENOVO", branchId: "default", workspaceId: "ws1" }) === true);
  assert("offline: Dev-PC (different durable id) BLOCKED", isDesignatedStationOffline(rec, { durableDeviceId: "dsk-DEVPC", branchId: "default", workspaceId: "ws1" }) === false);
  assert("offline: different branch BLOCKED", isDesignatedStationOffline(rec, { durableDeviceId: "dsk-LENOVO", branchId: "other" }) === false);
  assert("offline: workspace mismatch BLOCKED", isDesignatedStationOffline(rec, { durableDeviceId: "dsk-LENOVO", branchId: "default", workspaceId: "ws2" }) === false);
  assert("offline: no record BLOCKED", isDesignatedStationOffline(null, { durableDeviceId: "dsk-LENOVO", branchId: "default" }) === false);
  assert("offline: empty stored workspace tolerated (keying optional; device+branch anchor)", isDesignatedStationOffline({ ...rec, workspaceId: "" }, { durableDeviceId: "dsk-LENOVO", branchId: "default" }) === true);
}

// ── Static guards: cache rule, revocation stop, server protocol, deterministic restore ───────────────────
{
  const ws = read("desktop", "src", "device-websocket-client", "device-ws-manager.ts");
  assert("MAIN writes cache ONLY on MASTER + designated===true", /mode === "MASTER" && designated === true/.test(ws) && /writeDesignationRecord\(/.test(ws));
  assert("MAIN clears cache on CONTROL or designated===false", /mode === "CONTROL" \|\| designated === false/.test(ws) && /clearDesignationRecord\(\)/.test(ws));
  assert("MAIN leaves cache on designated===undefined (no accidental clear)", /designated === undefined on a MASTER signal/.test(ws));
  assert("MAIN stops station audio on revocation when it WAS designated", /wasDesignated && this\.orchestrator/.test(ws) && /stopMusic\(\)/.test(ws) && /stopInterrupt\(\)/.test(ws));
  assert("MAIN snapshot exposes designatedStationOffline", /designatedStationOffline: this\.offlineDesignated/.test(ws));
  assert("MAIN loads cache synchronously at construction (deterministic, no race)", /this\.refreshOfflineDesignated\(\); \/\/ deterministic sync load/.test(ws));
}
{
  const srv = read("server", "index.ts");
  assert("server REGISTER transmits designated: designatedTrusted", /designated: designatedTrusted/.test(srv));
  assert("server CLEAR + REASSIGN both revoke via unified helper with designated:false",
    /const revokeCurrentDesignatedMaster =/.test(srv) &&
      /mode: "CONTROL", designated: false/.test(srv) &&
      /revokeCurrentDesignatedMaster\(durableDeviceId\)/.test(srv) &&
      /revokeCurrentDesignatedMaster\(\);/.test(srv));
}
{
  const dp = read("lib", "device-player-context.tsx");
  assert("renderer gate includes OFFLINE designation", /localMainCommandReady \|\| localMainDesignatedOffline/.test(dp));
  const pp = read("lib", "playback-provider.tsx");
  assert("restore waits DETERMINISTICALLY for permission (subscribe, not timeout)",
    /subscribeLocalSourceExec\(\(\) => \{[\s\S]*?setRestoreTick\(/.test(pp));
  assert("restore has no sleep/timeout-based wait", !/setTimeout\([^)]*restore/i.test(pp));
  assert("restore re-runs on restoreTick", /\}, \[restoreTick\]\);/.test(pp));
  assert("offline-capable LOCAL recovery condition is scoped (syncbizDesktop + persistedV2.local)", /!!persistedV2\?\.local && typeof window !== "undefined" && "syncbizDesktop" in window/.test(pp));
}

console.log(`\n${pass} passed, ${fail} failed`);
