/**
 * A REMOTE STARTS A LOCAL (COMPUTER-FILES) PLAYLIST ON THE STATION - IDS ONLY (owner 2026-11-26).
 *
 * Proves, with the REAL pure code and the REAL desktop MAIN (DeviceWsManager + PlaybackOrchestrator):
 *   P*  the request a click becomes is exactly { sourceId, trackIndex }; it can never carry a path / url / title / track list
 *       (CLAUDE.md section 12), even when the playlist's own tracks are full of paths; every doubt is a reject (fail closed)
 *   G*  the three shape guards (renderer, WS server, station MAIN) answer identically on a corpus of good and bad payloads
 *   M*  MAIN relays ONE exactly-once request on the status snapshot (the remote NEXT / PREV / JUMP channel) and touches NOTHING else
 *       (no metadata, no queue, no MPV); a bad payload relays nothing; a later NEXT does not replay it
 *   R*  the station window resolves the request BY ID in its own library and refuses anything that is not a LOCAL source there
 *   W*  wiring (static): the Remote sends only ids, the server guards before routing, MAIN's handler stays a pure relay, the station
 *       consumes the request through the same exactly-once block and plays through the SAME path as a click
 * Run: npx tsx scripts/verify-remote-local-play.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LOCAL_PLAY_COMMAND, LOCAL_PLAY_DUPLICATE_MS, isDuplicateLocalPlay, isLocalPlayPayload, isSafeLocalPlayId, localPlayKey, resolveLocalPlayRequest, resolveRelayedLocalTarget,
} from "../lib/remote-local-play";
import { isLocalPlayPayload as serverIsLocalPlayPayload, localPlayCommandMalformed, LOCAL_PLAY_COMMAND as SERVER_CMD } from "../server/local-play-command";
import { isLocalPlayPayload as desktopIsLocalPlayPayload, LOCAL_PLAY_COMMAND as DESKTOP_CMD } from "../desktop/src/shared/local-play-command";
import type { UnifiedSource } from "../lib/source-types";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

// ---------------------------------------------------------------- fixtures
const PATHS = ["C:\\Music\\Deep House\\01 Intro.mp3", "C:\\Music\\Deep House\\02 Groove.flac", "D:\\Bank\\03 Outro.wav"];
const localTracks = PATHS.map((p, i) => ({ id: `t${i}`, name: `Track ${i}`, title: `Track ${i}`, type: "local", url: p, cover: null }));
const localPlaylist = { id: "abc123", name: "Deep House (computer)", type: "local", url: "", thumbnail: "", tracks: localTracks };
const shell = { id: "pl-abc123", title: "Deep House (computer)", genre: "House", cover: null, type: "local", url: "", origin: "playlist", playlist: localPlaylist } as unknown as UnifiedSource;
const leaf2 = { ...shell, id: "pl-abc123:track:r2", type: "local", url: PATHS[2] } as unknown as UnifiedSource;
const ytPlaylist = { id: "yt1", name: "Mix", type: "youtube", url: "", thumbnail: "", tracks: [{ id: "y0", name: "a", type: "youtube", url: "https://www.youtube.com/watch?v=abcdefghijk" }] };
const ytShell = { id: "pl-yt1", title: "Mix", genre: "Mixed", cover: null, type: "youtube", url: "", origin: "playlist", playlist: ytPlaylist } as unknown as UnifiedSource;
const folderSource = { id: "src-folder1", title: "Music folder", genre: "Mixed", cover: null, type: "local_playlist", url: "C:\\Music", origin: "source", source: { type: "local_playlist" } } as unknown as UnifiedSource;

// ---------------------------------------------------------------- P: the request
{
  const a = resolveLocalPlayRequest(shell);
  assert("P1 a local playlist shell becomes exactly { sourceId, trackIndex: 0 }", !("reject" in a) && a.sourceId === "pl-abc123" && a.trackIndex === 0 && Object.keys(a).length === 2, JSON.stringify(a));
  const b = resolveLocalPlayRequest(leaf2);
  assert("P2 a row of the playlist is the shell + that row", !("reject" in b) && b.sourceId === "pl-abc123" && b.trackIndex === 2, JSON.stringify(b));
  const c = resolveLocalPlayRequest(shell, 1);
  assert("P2b an explicit row wins", !("reject" in c) && c.trackIndex === 1);
  const d = resolveLocalPlayRequest(shell, 3);
  assert("P3 a row that is not in the playlist is refused (nothing sent)", "reject" in d, JSON.stringify(d));
  const neg = resolveLocalPlayRequest(shell, -1), frac = resolveLocalPlayRequest(shell, 1.5);
  assert("P3b a negative / fractional row is not passed on (the same rule as the URL path: an unusable row means row 0)", !("reject" in neg) && neg.trackIndex === 0 && !("reject" in frac) && frac.trackIndex === 0, JSON.stringify([neg, frac]));
  assert("P4 a YouTube playlist is not a local source (the URL path is unchanged)", "reject" in resolveLocalPlayRequest(ytShell));
  assert("P4b no source", "reject" in resolveLocalPlayRequest(null));
  const e = resolveLocalPlayRequest(folderSource);
  assert("P4c a folder source (a local source) is a plain request too", !("reject" in e) && e.sourceId === "src-folder1" && e.trackIndex === 0, JSON.stringify(e));
  // the wire text never carries a path, a drive letter, a slash, a title or a url - whatever the playlist's own tracks hold
  const wire = JSON.stringify(resolveLocalPlayRequest(shell)) + JSON.stringify(resolveLocalPlayRequest(leaf2)) + JSON.stringify(resolveLocalPlayRequest(folderSource));
  assert("P5 the request text carries no path / drive / slash / url / title", !/[\\/]|[A-Za-z]:\\|local:|file:|http|Deep House|Track \d|\.mp3|\.flac|\.wav/.test(wire), wire);
  const sneaky = { ...shell, id: "C:\\Music\\x.mp3" } as unknown as UnifiedSource;
  assert("P6 an id that is a path is refused", "reject" in resolveLocalPlayRequest(sneaky));
  for (const bad of ["", "a b", "a/b", "a\\b", "local://x", "file:x", "C:\\x", "x".repeat(201), "pl-ab\u0000"]) {
    assert(`P6b id ${JSON.stringify(bad).slice(0, 30)} is not a plain id`, !isSafeLocalPlayId(bad));
  }
  for (const ok of ["pl-abc123", "pl-b07af457-044e-47d8-b422-00ef97d8e9bb", "src-folder1", "pl-abc123:track:r2", "cm0abcDEF.9_x-y"]) {
    assert(`P6c id ${ok} is plain`, isSafeLocalPlayId(ok));
  }
}

// ---------------------------------------------------------------- D: a double click is one intent
{
  const r0 = { sourceId: "pl-abc123", trackIndex: 0 }, r1 = { sourceId: "pl-abc123", trackIndex: 1 }, r2 = { sourceId: "pl-other", trackIndex: 0 };
  const last = { key: localPlayKey(r0), at: 1000 };
  assert("D1 the same target again inside the window is a duplicate", isDuplicateLocalPlay(last, r0, 1000 + 200));
  assert("D2 the same target after the window is a new intent (a deliberate second click plays again)", !isDuplicateLocalPlay(last, r0, 1000 + LOCAL_PLAY_DUPLICATE_MS + 1));
  assert("D3 another row or another playlist is never a duplicate", !isDuplicateLocalPlay(last, r1, 1100) && !isDuplicateLocalPlay(last, r2, 1100));
  assert("D4 nothing sent before is never a duplicate; a clock that went back is not one either", !isDuplicateLocalPlay(null, r0, 1) && !isDuplicateLocalPlay(last, r0, 500));
}

// ---------------------------------------------------------------- G: the three guards agree
{
  const corpus: unknown[] = [
    { sourceId: "pl-abc123", trackIndex: 0 }, { sourceId: "pl-abc123", trackIndex: 7 }, { sourceId: "src-folder1", trackIndex: 100000 },
    { sourceId: "pl-abc123", trackIndex: 100001 }, { sourceId: "pl-abc123", trackIndex: -1 }, { sourceId: "pl-abc123", trackIndex: 1.5 },
    { sourceId: "pl-abc123", trackIndex: "1" }, { sourceId: 5, trackIndex: 0 }, { sourceId: "", trackIndex: 0 },
    { sourceId: "pl-abc123" }, { trackIndex: 0 }, {}, null, undefined, "pl-abc123", 7, [], [["sourceId", "pl-abc123"]],
    { sourceId: "pl-abc123", trackIndex: 0, url: "C:\\Music\\x.mp3" }, { sourceId: "pl-abc123", trackIndex: 0, path: "/x" },
    { sourceId: "pl-abc123", trackIndex: 0, title: "x" }, { sourceId: "pl-abc123", trackIndex: 0, source: { id: "x" } },
    { sourceId: "C:\\Music\\x.mp3", trackIndex: 0 }, { sourceId: "local://x", trackIndex: 0 }, { sourceId: "file:///x", trackIndex: 0 },
    { sourceId: "pl-abc123", trackIndex: NaN }, { sourceId: "pl-abc123", trackIndex: Infinity },
  ];
  let agree = true; const disagree: string[] = [];
  for (const c of corpus) {
    const r = isLocalPlayPayload(c), s = serverIsLocalPlayPayload(c), m = desktopIsLocalPlayPayload(c);
    if (r !== s || r !== m) { agree = false; disagree.push(JSON.stringify(c)); }
  }
  assert("G1 renderer / server / MAIN guards agree on every payload of the corpus", agree, disagree.join(" | "));
  const goodCount = corpus.filter((c) => isLocalPlayPayload(c)).length;
  assert("G2 exactly the 3 plain payloads pass", goodCount === 3, String(goodCount));
  assert("G3 the three command names are the same string", LOCAL_PLAY_COMMAND === SERVER_CMD && SERVER_CMD === DESKTOP_CMD && LOCAL_PLAY_COMMAND === "PLAY_LOCAL_SOURCE");
  assert("G4 the server refuses a malformed PLAY_LOCAL_SOURCE and nothing else", localPlayCommandMalformed("PLAY_LOCAL_SOURCE", { sourceId: "x", trackIndex: 0, url: "C:\\a.mp3" }) &&
    localPlayCommandMalformed("PLAY_LOCAL_SOURCE", null) && !localPlayCommandMalformed("PLAY_LOCAL_SOURCE", { sourceId: "pl-x", trackIndex: 1 }) &&
    !localPlayCommandMalformed("PLAY_SOURCE", { anything: 1 }) && !localPlayCommandMalformed("NEXT", undefined));
}

// ---------------------------------------------------------------- R: the station resolves it by id
{
  const lib = [ytShell, shell, folderSource];
  const ok = resolveRelayedLocalTarget(lib, { sourceId: "pl-abc123", trackIndex: 1 });
  assert("R1 a local playlist in the station's own library is found by id", !("reject" in ok) && ok.source.id === "pl-abc123" && ok.trackIndex === 1);
  assert("R2 an id that is not in this library is refused", "reject" in resolveRelayedLocalTarget(lib, { sourceId: "pl-nope", trackIndex: 0 }));
  assert("R3 a YouTube playlist named by this command is refused (not a LOCAL source: the URL path is the only way)", "reject" in resolveRelayedLocalTarget(lib, { sourceId: "pl-yt1", trackIndex: 0 }));
  assert("R4 a row beyond the playlist is refused", "reject" in resolveRelayedLocalTarget(lib, { sourceId: "pl-abc123", trackIndex: 3 }));
  assert("R5 a bad id / bad row is refused before any lookup", "reject" in resolveRelayedLocalTarget(lib, { sourceId: "C:\\x", trackIndex: 0 }) && "reject" in resolveRelayedLocalTarget(lib, { sourceId: "pl-abc123", trackIndex: -2 }));
  assert("R6 an empty / missing library is refused", "reject" in resolveRelayedLocalTarget([], { sourceId: "pl-abc123", trackIndex: 0 }) && "reject" in resolveRelayedLocalTarget(null, { sourceId: "pl-abc123", trackIndex: 0 }));
  assert("R7 a folder source is found by id", !("reject" in resolveRelayedLocalTarget(lib, { sourceId: "src-folder1", trackIndex: 0 })));
}

// ---------------------------------------------------------------- M: the REAL MAIN relays and touches nothing else
// Desktop MAIN is loaded at RUNTIME (require), not via typed imports: the root tsconfig must never follow into desktop/.
type Snap = { sessionStepBootId?: string; sessionStepSeq?: number; sessionStepDirection?: string | null; sessionStepIndex?: number | null; sessionStepSessionId?: string | null; mockPlaybackStatus: string; mockSelectedLibraryId: string | null; mpvAttemptId: number };
type OrchLike = { kill(): void };
type MgrLike = { snapshot(): Snap };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PlaybackOrchestrator } = require(path.join(ROOT, "desktop", "src", "main", "playback-orchestrator")) as { PlaybackOrchestrator: new () => OrchLike };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DeviceWsManager } = require(path.join(ROOT, "desktop", "src", "device-websocket-client", "device-ws-manager")) as { DeviceWsManager: new (cfg: unknown, orch: OrchLike) => MgrLike };
{
  const orch = new PlaybackOrchestrator();
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  const m = mgr as unknown as { handleRemoteLocalPlay: (p: unknown) => void; handleRemoteStep: (c: "NEXT" | "PREV") => void; mock: { getState: () => unknown }; lastCommandSummary: string };
  const before = mgr.snapshot();
  const mirrorBefore = JSON.stringify(m.mock.getState());
  m.handleRemoteLocalPlay({ sourceId: "pl-abc123", trackIndex: 2 });
  const a = mgr.snapshot();
  assert("M1 a valid request raises the relay seq by exactly one", (a.sessionStepSeq ?? 0) === (before.sessionStepSeq ?? 0) + 1, `${before.sessionStepSeq} -> ${a.sessionStepSeq}`);
  assert("M2 the relay names the direction, the row and the id", a.sessionStepDirection === "local-play" && a.sessionStepIndex === 2 && a.sessionStepSessionId === "pl-abc123");
  assert("M3 nothing else changed: same session mirror, same MPV attempt, same status", JSON.stringify(m.mock.getState()) === mirrorBefore && a.mpvAttemptId === before.mpvAttemptId && a.mockPlaybackStatus === before.mockPlaybackStatus && a.mockSelectedLibraryId === before.mockSelectedLibraryId);
  const seq1 = a.sessionStepSeq;
  for (const bad of [null, undefined, {}, { sourceId: "pl-abc123" }, { sourceId: "pl-abc123", trackIndex: 0, url: "C:\\x.mp3" }, { sourceId: "C:\\x.mp3", trackIndex: 0 }, { sourceId: "pl-abc123", trackIndex: -1 }, "pl-abc123"]) m.handleRemoteLocalPlay(bad);
  const b = mgr.snapshot();
  assert("M4 a payload that is not exactly { sourceId, trackIndex } relays nothing (seq, direction, id unchanged)", b.sessionStepSeq === seq1 && b.sessionStepDirection === "local-play" && b.sessionStepSessionId === "pl-abc123" && b.sessionStepIndex === 2);
  m.handleRemoteLocalPlay({ sourceId: "pl-abc123", trackIndex: 2 });
  assert("M5 the same request sent again is a NEW request (a new seq: a deliberate second click plays again)", (mgr.snapshot().sessionStepSeq ?? 0) === (seq1 ?? 0) + 1);
  const boot = a.sessionStepBootId;
  assert("M6 the request is identified by (boot id, seq): the boot id is stable between two snapshots", typeof boot === "string" && boot === mgr.snapshot().sessionStepBootId);
  m.handleRemoteStep("NEXT"); // no session yet: the catalog step, not a relay
  assert("M7 a later remote step never turns into a local-play request", mgr.snapshot().sessionStepDirection !== "local-play" || (mgr.snapshot().sessionStepSeq ?? 0) === (seq1 ?? 0) + 1);
  orch.kill();
}

// ---------------------------------------------------------------- W: wiring (static)
{
  const ctx = read("lib/device-player-context.tsx");
  const mgrSrc = read("desktop/src/device-websocket-client/device-ws-manager.ts");
  const srv = read("server/index.ts");
  const mvp = read("desktop/src/shared/mvp-types.ts");
  const phone = read("lib/mobile-fleet.tsx");
  const kiosk = read("lib/station-controller-context.tsx");

  // Remote send: sits after the station's own LOCAL branch and before the URL branch; sends only the request
  const iStation = ctx.indexOf("} else if (canLocalExec && source && isLibraryLocalSource(source)) {");
  const iRemote = ctx.indexOf("} else if (source && isLibraryLocalSource(source)) {");
  const iUrl = ctx.indexOf("const exact = source ? resolveExactUrlTarget(source, trackIndex)");
  assert("W1 the Remote branch sits after the station's own LOCAL branch and before the URL branch", iStation > 0 && iRemote > iStation && iUrl > iRemote);
  const remoteBlock = ctx.slice(iRemote, iUrl).replace(/\/\/[^\n]*/g, ""); // code only (comments stripped)
  assert("W2 the Remote branch sends only the request (no payload builder, no url, no source)", /sendCommandToMaster\(LOCAL_PLAY_COMMAND, req\)/.test(remoteBlock) && !/unifiedSourceToPayload|\.url|source:|playlist/.test(remoteBlock.replace(/isLibraryLocalSource\(source\)|resolveLocalPlayRequest\(source, trackIndex\)|\{ id: source\?\.id \?\? null, trackIndex \}/g, "")));
  assert("W2a the Remote ignores the same target sent a moment ago (a double click is one intent)", /isDuplicateLocalPlay\(lastRemoteLocalPlayRef\.current, req, nowMs\)/.test(remoteBlock) && /lastRemoteLocalPlayRef\.current = \{ key: localPlayKey\(req\), at: nowMs \}/.test(remoteBlock));
  assert("W2b a request that cannot be made plain sends nothing (fail closed)", /if \("reject" in req\) \{[\s\S]*?return;\s*\}/.test(remoteBlock));
  assert("W2c the station's own click path (local branch) is untouched", /playSource\(source, trackIndex \?\? 0\);\n      \} else if \(source && isLibraryLocalSource\(source\)\)/.test(ctx));

  // Phone + store display
  for (const [name, src] of [["phone", phone], ["display", kiosk]] as const) {
    const i = src.indexOf("isLibraryLocalSource(source)");
    const j = src.indexOf("unifiedSourceToPayload(source)", i);
    assert(`W3 ${name}: a local source goes through resolveLocalPlayRequest (double-click guarded) and returns BEFORE any PLAY_SOURCE payload is built`, i > 0 && /resolveLocalPlayRequest\(source\)/.test(src.slice(i, i + 700)) && /isDuplicateLocalPlay\(/.test(src.slice(i, i + 1100)) && /\n        return;\n      \}/.test(src.slice(i, i + 1400)) && j > i);
  }

  // Server guard before the media check and before routing
  const iGuard = srv.indexOf("localPlayCommandMalformed(msg.command, msg.payload)");
  const iMedia = srv.indexOf("commandHasForbiddenMediaTarget(msg.command, msg.payload)");
  const iRoute = srv.indexOf("const target = masterId ? devices.get(masterId) : null;");
  assert("W4 the server refuses a malformed PLAY_LOCAL_SOURCE before the media check and before any routing", iGuard > 0 && iGuard < iMedia && iMedia < iRoute && /import \{ localPlayCommandMalformed \} from "\.\/local-play-command\.js"/.test(srv));

  // MAIN: a pure relay
  const mStart = mgrSrc.indexOf("private handleRemoteLocalPlay(payload: unknown): void {");
  const mEnd = mgrSrc.indexOf("private handleRemoteJump(payload: unknown): void {");
  const body = mgrSrc.slice(mStart, mEnd);
  assert("W5 MAIN's handler is a pure relay: no mock / orchestrator / persist / queue / MPV call", mStart > 0 && mEnd > mStart && !/this\.mock|orch|routeToOrchestrator|persist|playNext|publish|urlSession|cancelRestore|sendStateUpdate/.test(body.replace(/sessionStep\w+/g, "")), body.match(/this\.mock|orch\w*|routeToOrchestrator|persist\w*|playNext|publish\w*|urlSession|cancelRestore|sendStateUpdate/)?.[0] ?? "");
  assert("W5b it validates with the shared guard first", /if \(!isLocalPlayPayload\(payload\)\) \{[\s\S]*?return;\s*\}/.test(body));
  assert("W6 MAIN dispatches it inside the MASTER block, after the JUMP branch and before the transport fall-through", /else if \(cmd === "JUMP_SESSION_INDEX"\) \{\n            this\.handleRemoteJump\(p\.payload\); \/\/ P0 Gate 1e\n          \} else if \(cmd === LOCAL_PLAY_COMMAND\) \{\n            this\.handleRemoteLocalPlay\(p\.payload\);[^\n]*\n          \} else \{\n            this\.runTransportCommand/.test(mgrSrc));
  assert("W7 the status snapshot type admits the new direction", /sessionStepDirection\?: "next" \| "prev" \| "jump" \| "local-play" \| null;/.test(mvp) && /private sessionStepDirection: "next" \| "prev" \| "jump" \| "local-play" \| null/.test(mgrSrc));

  // Station window: same exactly-once block; same path as a click
  assert("W8 the station consumes it in the SAME exactly-once block as step / jump (seq > last, per boot)", /reqSeq > last\.seq && st\.sessionStepDirection === "local-play" && typeof st\.sessionStepIndex === "number" && typeof st\.sessionStepSessionId === "string"\) \{\n          relayedLocalPlayRef\.current\(/.test(ctx));
  const rStart = ctx.indexOf("const relayedLocalPlay = useCallback(");
  const rEnd = ctx.indexOf("useEffect(() => { relayedLocalPlayRef.current = relayedLocalPlay; }, [relayedLocalPlay]);");
  const rBody = ctx.slice(rStart, rEnd);
  assert("W9 the relay handler: station owner only, newest request wins, lookup by id, plays through playSourceOrSend, any doubt keeps the music", rStart > 0 && rEnd > rStart && /if \(!canLocalExecRef\.current\)/.test(rBody) && /const token = \+\+localPlayRelayTokenRef\.current/.test(rBody) && /token !== localPlayRelayTokenRef\.current/.test(rBody) && /resolveRelayedLocalTarget\(items, \{ sourceId, trackIndex \}\)/.test(rBody) && /"reject" in target/.test(rBody) && /playSourceOrSendRef\.current\(target\.source, target\.trackIndex\)/.test(rBody) && /\.catch\(/.test(rBody));
  assert("W9b it never calls the engine / MAIN directly (only the click path)", !/mpvPlayUrl|syncbizDesktop|sendCommandToMaster|playSource\(/.test(rBody.replace(/playSourceOrSendRef/g, "")));

  // types
  assert("W10 both RemoteCommand lists name the command", /\| "PLAY_LOCAL_SOURCE";/.test(read("lib/remote-control/types.ts")) && /\| "PLAY_LOCAL_SOURCE";/.test(read("server/ws-remote-control-types.ts")));
}

console.log(`\n${pass} passed, ${fail} failed`);
