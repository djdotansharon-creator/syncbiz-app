/**
 * Deterministic regression coverage for LOCAL playback reboot auto-resume (lib/local-recovery.ts).
 *
 * Field bug: after a Windows reboot a desktop MASTER auto-resumed URL playback but NOT local playback.
 * Root cause: the recovery snapshot persisted only IDs; a URL's identity is rebuilt from the server by
 * id, but a local file's id is device-local/unresolvable (ephemeral / My-Music / folder db-source that
 * only stored its root path), so the exact local file could not be restored → local never resumed.
 * Fix: persist the concrete local path(s) in the device-only snapshot and reconstruct on restore.
 *
 * These assert the pure resume decision (no MPV/DOM). Run: npx tsx scripts/verify-local-recovery.ts
 */
import {
  captureLocalRecovery,
  sanitizeLocalRecovery,
  needsLocalReconstruction,
  reconstructLocalSourceFromSnapshot,
  captureEphemeralSource,
  sanitizeEphemeralSource,
  reconstructEphemeralSource,
  captureUrlSource,
  sanitizeUrlSource,
  reconstructUrlSource,
} from "@/lib/local-recovery";
import { EPHEMERAL_LOCAL_PLAYLIST_PREFIX } from "@/lib/local-playlist-artwork";
import type { UnifiedSource } from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const FILE_A = "C:\\Users\\YCD ATMOSPHERE\\Music\\a.mp3"; // spaces in path (real station user)
const FILE_B = "C:\\Users\\YCD ATMOSPHERE\\Music\\b.mp3";
const FILE_C = "C:\\Users\\YCD ATMOSPHERE\\Music\\c.mp3";
const FOLDER = "C:\\Users\\YCD ATMOSPHERE\\Music"; // folder root (db-source url), not a file
const URL_STREAM = "https://stream.example.com/live.mp3";
const YT = "https://www.youtube.com/watch?v=abc123";

// ── capture: URL sessions store NOTHING (their restore is unchanged) ─────────────────────────────
assert("capture: URL current → undefined (URL unchanged)", captureLocalRecovery({ currentPlayUrl: URL_STREAM, queuePlayUrls: [URL_STREAM] }) === undefined);
assert("capture: YouTube current → undefined", captureLocalRecovery({ currentPlayUrl: YT }) === undefined);
assert("capture: null current → undefined", captureLocalRecovery({ currentPlayUrl: null }) === undefined);

// ── capture: LOCAL sessions store the concrete path(s) ───────────────────────────────────────────
{
  const rec = captureLocalRecovery({ currentPlayUrl: FILE_A });
  assert("capture: single local file → currentUrl set, no queueUrls", !!rec && rec.currentUrl === FILE_A && rec.queueUrls === undefined, JSON.stringify(rec));
}
{
  const rec = captureLocalRecovery({ currentPlayUrl: FILE_B, queuePlayUrls: [FILE_A, FILE_B, FILE_C], title: "b", cover: "cov" });
  assert("capture: local folder → queueUrls (3), title, cover, spaces preserved",
    !!rec && rec.currentUrl === FILE_B && rec.queueUrls?.length === 3 && rec.queueUrls?.[0] === FILE_A && rec.title === "b" && rec.cover === "cov");
}
{
  // Mixed queue: only the local paths survive; if <=1 local remains, no queueUrls.
  const rec = captureLocalRecovery({ currentPlayUrl: FILE_A, queuePlayUrls: [FILE_A, URL_STREAM, YT] });
  assert("capture: mixed queue → non-local filtered, single local ⇒ no queueUrls", !!rec && rec.currentUrl === FILE_A && rec.queueUrls === undefined);
}

// ── needsLocalReconstruction: the divergence between URL (works) and LOCAL (broken) ──────────────
assert("needs: no rec (URL session) → false (unchanged)", needsLocalReconstruction(URL_STREAM, undefined) === false);
assert("needs: saved local playlist, id url === file → false (id path already works)", needsLocalReconstruction(FILE_A, { currentUrl: FILE_A }) === false);
assert("needs: folder db-source, id url = folder root ≠ file → true (reconstruct)", needsLocalReconstruction(FOLDER, { currentUrl: FILE_A }) === true);
assert("needs: ephemeral, id url null → true (reconstruct)", needsLocalReconstruction(null, { currentUrl: FILE_A }) === true);
assert("needs: id url is a URL but rec is local → true (reconstruct)", needsLocalReconstruction(URL_STREAM, { currentUrl: FILE_A }) === true);

// ── reconstruct: intentional STOP / no snapshot → nothing to resume ──────────────────────────────
assert("reconstruct: undefined rec → null (STOP stays stopped)", reconstructLocalSourceFromSnapshot(undefined) === null);
assert("reconstruct: invalid currentUrl → null", reconstructLocalSourceFromSnapshot({ currentUrl: "not-a-path" }) === null);

// ── reconstruct: single local file → single local source ─────────────────────────────────────────
{
  const rc = reconstructLocalSourceFromSnapshot({ currentUrl: FILE_A });
  assert("reconstruct: single → local source url=file, trackIndex 0",
    !!rc && rc.source.url === FILE_A && rc.source.type === "local" && rc.trackIndex === 0, JSON.stringify(rc?.source?.id));
}

// ── reconstruct: multi local → ephemeral folder playlist, correct start index ─────────────────────
{
  const rc = reconstructLocalSourceFromSnapshot({ currentUrl: FILE_B, queueUrls: [FILE_A, FILE_B, FILE_C], title: "My Music" });
  const tracks = rc?.source.playlist?.tracks ?? [];
  assert("reconstruct: multi → origin playlist w/ 3 tracks", rc?.source.origin === "playlist" && tracks.length === 3);
  assert("reconstruct: multi → trackIndex points at current file (B → 1)", rc?.trackIndex === 1, `idx=${rc?.trackIndex}`);
  assert("reconstruct: multi → track urls preserved in order (spaces intact)", tracks[0]?.url === FILE_A && tracks[1]?.url === FILE_B && tracks[2]?.url === FILE_C);
}
{
  const rc = reconstructLocalSourceFromSnapshot({ currentUrl: FILE_C, queueUrls: [FILE_A, FILE_B, FILE_C] });
  assert("reconstruct: multi → current=C ⇒ trackIndex 2", rc?.trackIndex === 2);
}

// ── sanitize: untrusted persisted JSON is normalized/validated ────────────────────────────────────
assert("sanitize: non-object → undefined", sanitizeLocalRecovery(null) === undefined && sanitizeLocalRecovery("x") === undefined);
assert("sanitize: relative currentUrl → undefined", sanitizeLocalRecovery({ currentUrl: "songs\\a.mp3" }) === undefined);
{
  const r = sanitizeLocalRecovery({ currentUrl: FILE_A, queueUrls: [FILE_A, "bad", 5, FILE_B], title: " t ", cover: "c" });
  assert("sanitize: keeps valid local, drops junk, trims title", !!r && r.currentUrl === FILE_A && r.queueUrls?.length === 2 && r.title === "t" && r.cover === "c");
}
assert("sanitize: file:// URL accepted", !!sanitizeLocalRecovery({ currentUrl: "file:///C:/Music/a.mp3" }));

// ── round-trip: capture → JSON → sanitize (localStorage persistence) preserves identity ───────────
{
  const rec = captureLocalRecovery({ currentPlayUrl: FILE_B, queuePlayUrls: [FILE_A, FILE_B], title: "b" });
  const round = sanitizeLocalRecovery(JSON.parse(JSON.stringify(rec)));
  assert("round-trip: capture→JSON→sanitize preserves currentUrl+queue", round?.currentUrl === FILE_B && round?.queueUrls?.length === 2);
}

// ── EXACT FIELD TRANSITION: URL playing → switch to LOCAL → snapshot must reference LOCAL, and a
//    reboot restore that finds URL A (queue fallback) must still dispatch LOCAL. Models the persist
//    INPUT (what playback-provider captures from state) + the restore DECISION, without React. ─────
{
  // 1) URL A is playing → the snapshot the provider would write carries NO local block.
  const urlSnapshotLocal = captureLocalRecovery({ currentPlayUrl: URL_STREAM, queuePlayUrls: [URL_STREAM] });
  assert("transition: while URL A plays → snapshot has no local block", urlSnapshotLocal === undefined);

  // 2) User switches to a LOCAL playlist; it becomes state.currentSource and plays via in-app MPV, so
  //    getPlayUrl(currentSource) is the local file. The provider now captures a local block that
  //    references LOCAL — NOT the previous URL A.
  const localSnapshot = captureLocalRecovery({ currentPlayUrl: FILE_B, queuePlayUrls: [FILE_A, FILE_B, FILE_C], title: "Local Set" });
  assert("transition: after switch to LOCAL → snapshot local block references LOCAL, not URL A",
    !!localSnapshot && localSnapshot.currentUrl === FILE_B && !localSnapshot.currentUrl.startsWith("http"));

  // 3) Reboot restore: even if the persisted queue still resolved URL A by id (queue fallback), the
  //    presence of the local block forces reconstruction of LOCAL (music must never resume the wrong
  //    source). Model the restore decision the provider makes.
  const idResolvedPlayUrl = URL_STREAM; // sourceRaw fell back to URL A from the queue
  assert("transition: restore with local block + id→URL A ⇒ needs reconstruction",
    needsLocalReconstruction(idResolvedPlayUrl, localSnapshot) === true);
  const rc = reconstructLocalSourceFromSnapshot(localSnapshot);
  assert("transition: reboot restore dispatches LOCAL (reconstructed), not URL A",
    !!rc && rc.source.type === "local" && (rc.source.playlist?.tracks?.[rc.trackIndex]?.url === FILE_B));

  // 4) Guard the inverse: a URL session (no local block) must NEVER reconstruct — URL restore unchanged.
  assert("transition: URL session (no local block) → no reconstruction (URL restore unchanged)",
    needsLocalReconstruction(URL_STREAM, urlSnapshotLocal) === false && reconstructLocalSourceFromSnapshot(urlSnapshotLocal) === null);
}

// ── ROYALTY-FREE / MUSIC BANK CATALOG reboot case (ephemeral id + /api/media HTTP tracks) ─────────
// Real Lenovo: RFM track playing → reboot → silence. The catalog source has an ephemeral id the server
// never knows, and its tracks are /api/media URLs (not local paths), so neither id-restore nor the local
// block can rebuild it. These assert the ephemeral capture/reconstruct that fixes it.
const MEDIA_A = "https://syncbiz-app-production.up.railway.app/api/media/asset-a";
const MEDIA_B = "https://syncbiz-app-production.up.railway.app/api/media/asset-b";
function rfmSource(mode: "stream" | "local" = "stream"): UnifiedSource {
  const type = mode === "stream" ? "stream-url" : "local";
  const t1 = mode === "stream" ? MEDIA_A : FILE_A;
  const t2 = mode === "stream" ? MEDIA_B : FILE_B;
  const playlist: Playlist = {
    id: `${EPHEMERAL_LOCAL_PLAYLIST_PREFIX}musicbank-lofi-${mode}`,
    name: "Lo-Fi — Samples", genre: "Lo-Fi", type: type as Playlist["type"], url: t1, thumbnail: "",
    createdAt: new Date().toISOString(),
    tracks: [{ id: "asset-a", name: "A", type: type as never, url: t1 }, { id: "asset-b", name: "B", type: type as never, url: t2 }],
    order: ["asset-a", "asset-b"],
  };
  return { id: playlist.id, title: playlist.name, genre: "Lo-Fi", cover: null, type: type as never, url: t1, origin: "playlist", playlist };
}
{
  const src = rfmSource("stream");
  // 1) While RFM plays, the local block is NOT captured (tracks are /api/media, not local paths)…
  assert("rfm: local block NOT captured for /api/media tracks", captureLocalRecovery({ currentPlayUrl: MEDIA_A, queuePlayUrls: [MEDIA_A, MEDIA_B] }) === undefined);
  // …but the ephemeral source blob IS captured, preserving the /api/media track identities.
  const eph = captureEphemeralSource(src);
  assert("rfm: ephemeral blob captured (id + 2 media tracks)", !!eph && eph.sourceId === src.id && eph.tracks.length === 2 && eph.tracks[0].url === MEDIA_A && eph.type === "stream-url");

  // 2) Non-ephemeral / URL sources must NOT produce an ephemeral blob (URL/saved restore unchanged).
  assert("rfm: server playlist (pl-*) → no ephemeral blob", captureEphemeralSource({ id: "pl-123", title: "x", genre: "g", cover: null, type: "stream-url", url: MEDIA_A, origin: "playlist", playlist: { id: "pl-123", name: "x", genre: "g", type: "stream-url", url: MEDIA_A, thumbnail: "", createdAt: "", tracks: [{ id: "a", name: "A", type: "stream-url" as never, url: MEDIA_A }], order: ["a"] } }) === undefined);
  assert("rfm: bare URL source (no playlist) → no ephemeral blob", captureEphemeralSource({ id: "u1", title: "u", genre: "g", cover: null, type: "stream-url", url: URL_STREAM, origin: "source" }) === undefined);

  // 3) Reboot restore: id misses (ephemeral), local recon null → ephemeral recon rebuilds the catalog.
  assert("rfm: local reconstruction is null (not a local session)", reconstructLocalSourceFromSnapshot(undefined) === null);
  const rcE = reconstructEphemeralSource(eph, 1);
  assert("rfm: ephemeral reconstruction rebuilds catalog source (origin playlist, 2 tracks)", !!rcE && rcE.source.origin === "playlist" && rcE.source.playlist?.tracks?.length === 2);
  assert("rfm: reconstructed track urls preserved (/api/media)", rcE?.source.playlist?.tracks?.[0]?.url === MEDIA_A && rcE?.source.playlist?.tracks?.[1]?.url === MEDIA_B);
  assert("rfm: reconstructed trackIndex clamped to requested (1)", rcE?.trackIndex === 1);
  assert("rfm: reconstructed id === persisted ephemeral id", rcE?.source.id === src.id);

  // 4) sanitize round-trip (localStorage persistence) preserves the catalog blob.
  const round = sanitizeEphemeralSource(JSON.parse(JSON.stringify(eph)));
  assert("rfm: capture→JSON→sanitize preserves sourceId + tracks", round?.sourceId === src.id && round?.tracks.length === 2);
  assert("rfm: sanitize rejects blob with no tracks / no id", sanitizeEphemeralSource({ sourceId: "x" }) === undefined && sanitizeEphemeralSource({ tracks: [] }) === undefined);

  // 5) Preserve: an intentional STOP (no snapshot / no ephemeral blob) does not resume.
  assert("rfm: no ephemeral blob → no reconstruction (STOP stays stopped)", reconstructEphemeralSource(undefined, 0) === null);
}

// ── AD-HOC / PASTED URL source recovery (renderer remount re-ownership) ───────────────────────────
// Incident: a pasted YouTube URL (playnext-* id, origin source) was playing via MPV; the renderer
// remounted, currentSource became null, MPV kept playing orphaned, EOF couldn't advance. These assert
// the URL-source capture/reconstruct that lets the remounted renderer re-own the pasted URL.
const YT_WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
{
  // capture: only for http(s) playback URLs; local paths / relative are rejected.
  const rec = captureUrlSource({ playUrl: YT_WATCH, sourceType: "youtube", title: "Pasted Mix", cover: "c" });
  assert("url: capture ad-hoc http URL → block with url+type+title", !!rec && rec.url === YT_WATCH && rec.sourceType === "youtube" && rec.title === "Pasted Mix");
  assert("url: capture rejects a local path", captureUrlSource({ playUrl: FILE_A }) === undefined);
  assert("url: capture rejects empty/relative", captureUrlSource({ playUrl: "" }) === undefined && captureUrlSource({ playUrl: "songs/a.mp3" }) === undefined);

  // reconstruct: rebuild a playable ad-hoc URL source (fresh playnext id, origin source, url preserved).
  const rcU = reconstructUrlSource(rec);
  assert("url: reconstruct → source owns the pasted URL (origin source, type youtube)", !!rcU && rcU.source.url === YT_WATCH && rcU.source.origin === "source" && rcU.source.type === "youtube" && rcU.trackIndex === 0);
  assert("url: reconstruct(undefined) → null (nothing to re-own)", reconstructUrlSource(undefined) === null);

  // sanitize round-trip (localStorage persistence).
  const round = sanitizeUrlSource(JSON.parse(JSON.stringify(rec)));
  assert("url: capture→JSON→sanitize preserves url+type", round?.url === YT_WATCH && round?.sourceType === "youtube");
  assert("url: sanitize rejects non-http / junk", sanitizeUrlSource({ url: "file:///x" }) === undefined && sanitizeUrlSource({ url: FILE_A }) === undefined && sanitizeUrlSource(null) === undefined);

  // mutual exclusivity: an http play URL is never a local block, and a local path is never a url block.
  assert("url: http play URL is not captured as LOCAL", captureLocalRecovery({ currentPlayUrl: YT_WATCH }) === undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
