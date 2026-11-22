/**
 * THE LIBRARY SHOWS A LOCAL PLAYLIST ONLY IN ITS OWN BRANCH (owner 2026-11-22; Dotan: "it does not matter to us if playlists created on the Lenovo disappear from other computers — make the change and reset").
 * Run: npx tsx scripts/verify-library-own-branch.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isLocalPlaylistOfAnotherBranch, libraryForBranch } from "../lib/library-branch-scope";
import type { UnifiedSource } from "../lib/source-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

const CANON = "branch-canon-1";
const pl = (id: string, branchId: string | undefined, local: boolean, extra: Record<string, unknown> = {}): UnifiedSource =>
  ({
    id, title: id, genre: "x", cover: null, type: local ? "local" : "youtube", url: local ? "C:/m/a.mp3" : "https://www.youtube.com/watch?v=aaaaaaaaaaa", origin: "playlist",
    playlist: { id, name: id, genre: "x", type: local ? "local" : "youtube", url: local ? "C:/m/a.mp3" : "https://www.youtube.com/watch?v=aaaaaaaaaaa", thumbnail: "", tracks: [{ id: id + "t", name: "t", type: local ? "local" : "youtube", url: local ? "C:/m/a.mp3" : "https://www.youtube.com/watch?v=aaaaaaaaaaa" }], branchId, ...extra },
  }) as unknown as UnifiedSource;
const src = (id: string): UnifiedSource => ({ id, title: id, genre: "x", cover: null, type: "youtube", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", origin: "source" }) as unknown as UnifiedSource;

const localHere = pl("local-here", "B1", true);
const localOther = pl("local-other", "B2", true);
const localLegacy = pl("local-legacy", "default", true);
const localCanon = pl("local-canon", CANON, true);
const localNoBranch = pl("local-nobranch", undefined, true);
const urlOther = pl("url-other", "B2", false);
const radioish = { id: "r1", title: "r", genre: "x", cover: null, type: "youtube", url: "https://x.test", origin: "radio" } as unknown as UnifiedSource;
const all = [localHere, localOther, localLegacy, localCanon, localNoBranch, urlOther, src("song"), radioish];

assert("L1 a window of branch B1 keeps ITS local playlist and hides the local playlists of other branches", !isLocalPlaylistOfAnotherBranch(localHere, "B1", null) && isLocalPlaylistOfAnotherBranch(localOther, "B1", null));
assert("L2 a playlist of LINKS is never hidden (it stays visible everywhere until sharing exists), nor a plain source or a radio", !isLocalPlaylistOfAnotherBranch(urlOther, "B1", null) && !isLocalPlaylistOfAnotherBranch(src("song"), "B1", null) && !isLocalPlaylistOfAnotherBranch(radioish, "B1", null));
assert("L3 the legacy key 'default' and the business's canonical branch are ONE branch: with a canonical branch, a 'default' playlist belongs to a window of that canonical branch (and not to B1)", !isLocalPlaylistOfAnotherBranch(localLegacy, CANON, CANON) && !isLocalPlaylistOfAnotherBranch(localCanon, "default", CANON) && isLocalPlaylistOfAnotherBranch(localLegacy, "B1", CANON));
assert("L4 a local playlist with no branch at all counts as 'default' (the accepted baseline): visible in a 'default' window, hidden in B1's", !isLocalPlaylistOfAnotherBranch(localNoBranch, "default", null) && isLocalPlaylistOfAnotherBranch(localNoBranch, "B1", null));
assert("L5 a window whose branch is not known yet (the desktop has not answered) shows EVERYTHING, exactly as before — and so does an empty one", libraryForBranch(all, null, null) === all && libraryForBranch(all, "", null) === all && libraryForBranch(all, undefined, null) === all);
const shown = libraryForBranch(all, "B1", CANON).map((s) => s.id);
assert("L6 B1's library: its local playlist, the link playlist, the song and the radio — not the other branches' local playlists (including the old 'default' one when the business has a canonical branch)", JSON.stringify(shown) === JSON.stringify(["local-here", "url-other", "song", "r1"]), shown.join(","));
const none = [localHere, urlOther, src("song")];
assert("L7 nothing to hide → the SAME array comes back (no needless re-render); the input is never mutated", libraryForBranch(none, "B1", null) === none && all.length === 8);
assert("L8 an expanded song of a local playlist (it carries its parent playlist) is hidden with it", isLocalPlaylistOfAnotherBranch({ ...pl("x", "B2", true), id: "x:track:1" } as UnifiedSource, "B1", null));

const sm = rd("components/sources-manager.tsx");
const lay = rd("app/(app)/(workspace)/layout.tsx");
assert("W1 only what is DRAWN changes: displaySources is the filtered list; `sources` (playback, queues, the schedule) is untouched; a window of unknown branch shows all", /const viewBranch = useStationBranchId\(\);\s*const displaySources = useMemo\(\(\) => libraryForBranch\(sources, viewBranch, defaultBranchId\), \[sources, viewBranch, defaultBranchId\]\);/.test(sm) && !/const displaySources = sources;/.test(sm) && /const \{ sources, setSources \} = useSourcesPlayback\(\);/.test(sm));
assert("W2 the canonical default branch id reaches the library from the server layout (same lookup the Studio page uses), failing safe to null", /getCanonicalLegacyBranchId\(user\.tenantId\)/.test(lay) && /defaultBranchId=\{defaultBranchId\}/.test(lay) && /catch \{\s*defaultBranchId = null;/.test(lay) && /defaultBranchId=\{defaultBranchId\}/.test(sm));
const studio = rd("app/(app)/(workspace)/schedules/page.tsx");
assert("W3 the Studio's side panel is NOT filtered (the old local playlist stays reachable for 'Move and add'): the schedules page still hands every playlist to the Studio", /playlists=\{playlists\}/.test(studio) && !/library-branch-scope/.test(studio) && !/library-branch-scope/.test(rd("components/schedules-studio/schedules-studio.tsx")));
assert("W4 the rule is pure (no store, no fetch, no playback)", !/fetch\(|prisma|usePlayback|useDevicePlayer/.test(rd("lib/library-branch-scope.ts").replace(/\/\*[\s\S]*?\*\//g, "")));

console.log(`\n${pass} passed, ${fail} failed`);
