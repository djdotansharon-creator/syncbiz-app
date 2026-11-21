/**
 * CROSS-BRANCH PLAYLISTS IN THE SCHEDULE (owner 2026-11-22). Field test 2026-11-21: a playlist made in the app is saved in branch "default"; a block made from it takes that
 * branch; a station runs only its OWN branch's blocks → the YCD block never ran on the Lenovo (branch Lenovo-Pailot). Owner: URL playlists should be usable by every branch of
 * the business; playlists of MP3 files on a computer exist only on that computer and stay with their branch.
 * Here: the pure rule (lib/schedule-branch-use.ts), the "does it play local files" helper, and the wiring of the validator + the two schedule routes.
 * Run: npx tsx scripts/verify-schedule-cross-branch.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { decidePlaylistBranchUse } from "../lib/schedule-branch-use";
import { playlistHasLocalFiles } from "../lib/playlist-playability";
import type { Playlist } from "../lib/playlist-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

// ── the rule ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
assert("X1 the playlist's own branch is allowed, local files or not (as always)", decidePlaylistBranchUse({ sameBranch: true, hasLocalFiles: true, callerCanUsePlaylistBranch: null }).ok && decidePlaylistBranchUse({ sameBranch: true, hasLocalFiles: false, callerCanUsePlaylistBranch: false }).ok);
const local = decidePlaylistBranchUse({ sameBranch: false, hasLocalFiles: true, callerCanUsePlaylistBranch: true });
assert("X2 a playlist of local files in ANOTHER branch is refused — even for a caller who may use that branch — and the reason is said", !local.ok && /exist only on the computer that built it/.test(local.ok ? "" : local.error), local.ok ? "" : local.error);
assert("X3 a playlist of URLs in another branch is allowed when the caller may use that branch", decidePlaylistBranchUse({ sameBranch: false, hasLocalFiles: false, callerCanUsePlaylistBranch: true }).ok);
const no = decidePlaylistBranchUse({ sameBranch: false, hasLocalFiles: false, callerCanUsePlaylistBranch: false });
const unknown = decidePlaylistBranchUse({ sameBranch: false, hasLocalFiles: false, callerCanUsePlaylistBranch: null });
assert("X4 …and refused (the old message) when the caller may NOT use it, or when nobody asked (an older caller)", !no.ok && !unknown.ok && (no.ok ? "" : no.error) === "Playlist belongs to a different branch" && (unknown.ok ? "" : unknown.error) === "Playlist belongs to a different branch");

// ── "does it play files that exist only on one computer" ────────────────────────────────────────────────────────────────────────────────────────
const pl = (o: Partial<Playlist> & { tracks?: { id: string; name: string; type: string; url: string }[] }) => ({ id: "p", name: "P", genre: "x", type: "youtube", url: "", thumbnail: "", tracks: [], ...o }) as unknown as Playlist;
assert("X5 type local / winamp → local files", playlistHasLocalFiles(pl({ type: "local" })) && playlistHasLocalFiles(pl({ type: "winamp" })));
assert("X6 a YouTube playlist whose tracks are all http(s) → not local", !playlistHasLocalFiles(pl({ url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", tracks: [{ id: "1", name: "a", type: "youtube", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }] })));
assert("X7 any track that is a path on a disk makes it local (a mixed playlist is still tied to its computer)", playlistHasLocalFiles(pl({ tracks: [{ id: "1", name: "a", type: "youtube", url: "https://x.test/a" }, { id: "2", name: "b", type: "local", url: "C:/Music/b.mp3" }] })));
assert("X8 an empty URL playlist is not local", !playlistHasLocalFiles(pl({ url: "https://x.test/list", tracks: [] })));

// ── wiring ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const val = rd("lib/schedule-target-validator.ts");
const code = val.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const pcase = code.slice(code.indexOf('case "PLAYLIST"'), code.indexOf('case "RADIO"'));
assert("X9 the validator asks the rule for a PLAYLIST, asks the caller about the playlist's branch ONLY when it is another branch and not local files, and treats a failed answer as 'no'", /decidePlaylistBranchUse\(\{ sameBranch, hasLocalFiles, callerCanUsePlaylistBranch \}\)/.test(pcase) && /!sameBranch && !hasLocalFiles && callerCanUseBranch/.test(pcase) && /catch \{\s*callerCanUsePlaylistBranch = false;/.test(pcase));
assert("X10 a SOURCE and a RADIO are UNCHANGED: still the exact same-branch rule", (code.match(/belongs to a different branch"/g) ?? []).length === 2 && /Source belongs to a different branch/.test(code) && /Radio station belongs to a different branch/.test(code) && (code.match(/contentBranchesEquivalent\(workspaceId, /g) ?? []).length === 3);
assert("X11 the local / winamp rule after it (the station checks playability at play time) and the http check are untouched", /playlist\.type === "local" \|\| playlist\.type === "winamp"/.test(pcase) && /Playlist has no playable HTTP URL/.test(pcase));
const post = rd("app/api/schedules/route.ts");
const patch = rd("app/api/schedules/[id]/route.ts");
assert("X12 both schedule routes pass 'may this caller use that branch' (the same access check the routes already use) — and the block's own branch check is still there, before the validation", /validateScheduleTarget\([^\n]*user\.tenantId, \(b\) => hasBranchAccess\(user\.id, b, user\.tenantId\)\)/.test(post) && /validateScheduleTarget\([^\n]*user\.tenantId, \(b\) => hasBranchAccess\(user\.id, b, user\.tenantId\)\)/.test(patch) && post.indexOf("Forbidden: no access to this branch") < post.indexOf("validateScheduleTarget(") && patch.indexOf("Forbidden: no access to target branch") < patch.indexOf("validateScheduleTarget("));
assert("X13 the pure rule imports nothing (no store, no playback)", !/^import /m.test(rd("lib/schedule-branch-use.ts")));

console.log(`\n${pass} passed, ${fail} failed`);
