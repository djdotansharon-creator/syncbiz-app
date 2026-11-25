/**
 * SHARING INSIDE VONO — THE SCREENS (owner 2026-11-22, phase C step 2): the "Share inside VONO" dialog, the waiting pill + request card (look inside / accept / copy / decline), the "Shared" view, grey local
 * songs. Static wiring guards + the pure helpers. Run: npx tsx scripts/verify-sharing-ui.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isLocalOnlyLeaf, sharedPlaylistToSource } from "../lib/shared-playlist-source";
import type { Playlist } from "../lib/playlist-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

assert("H1 a song is 'local only' when it is a local / winamp file or its address is not http(s); a web song is not", isLocalOnlyLeaf({ type: "local", url: "C:/a.mp3" }) && isLocalOnlyLeaf({ type: "winamp", url: "https://x.test/p.m3u" }) && isLocalOnlyLeaf({ type: "stream-url", url: "/home/a.mp3" }) && isLocalOnlyLeaf({ type: "youtube", url: "" }) && !isLocalOnlyLeaf({ type: "youtube", url: "https://y.test/a" }) && !isLocalOnlyLeaf({ type: "soundcloud", url: "http://s.test/a" }));
const pl = { id: "p1", name: "Mix", genre: "", type: "youtube", url: "https://y.test/a", thumbnail: "t.jpg", tracks: [] } as unknown as Playlist;
const src = sharedPlaylistToSource(pl);
assert("H2 a shared playlist becomes a library playlist source in its OWN id space (shared-<id>, never colliding with the branch's own playlists), with its cover and the playlist attached", src.id === "shared-p1" && src.origin === "playlist" && src.cover === "t.jpg" && src.playlist === pl && src.genre === "Mixed");

const hook = rd("lib/use-playlist-shares.ts");
assert("S1 the hook asks only about THIS window's branch (api/playlist-shares?status=all&branchId=…), asks for the branch's shares only when the branch can receive them (null → only the shares sent to ME as a person, phase D), refreshes on library-updated / focus / visibility and once a minute while visible, keeps what is on screen when a read fails, and raises the 'new share' toast only for requests that arrived AFTER the first load", /api\/playlist-shares\?status=all&branchId=\$\{encodeURIComponent\(branchId\)\}/.test(hook) && /branchId \? read\(/.test(hook) && /\/api\/playlist-shares\/mine\?status=all/.test(hook) && /"library-updated"/.test(hook) && /addEventListener\("focus"/.test(hook) && /visibilitychange/.test(hook) && /60_000/.test(hook) && /a failed read keeps what is on screen/.test(hook) && /if \(seen\.current\)/.test(hook) && /seen\.current = ids;/.test(hook));
assert("S2 answering posts {action, name?, branchId? (a copy of a share to a person)} to /api/playlist-shares/:id, reports the server's error text, and after a copy tells the library to refresh", /\/api\/playlist-shares\/\$\{encodeURIComponent\(id\)\}/.test(hook) && /JSON\.stringify\(\{ action, \.\.\.\(name \? \{ name \} : \{\}\), \.\.\.\(copyBranchId \? \{ branchId: copyBranchId \} : \{\}\) \}\)/.test(hook) && /error: j\.error \?\? "Something went wrong"/.test(hook) && /if \(j\.copy\) window\.dispatchEvent\(new CustomEvent\("library-updated"\)\)/.test(hook));

const dlg = rd("components/playlist-share-dialog.tsx");
assert("D1 the dialog sends to chosen branches (or all the free ones) through POST /api/playlists/:id/shares, shows where it is already shared (waiting / accepted) with 'take back' (revoke), never offers the playlist's own branch, and says plainly that the branch is ASKED first", /api\/playlists\/\$\{encodeURIComponent\(playlistId\)\}\/shares/.test(dlg) && /branchIds: \[\.\.\.picked\]/.test(dlg) && /action: "revoke"/.test(dlg) && /filter\(\(b\) => b\.id !== own\)/.test(dlg) && /the playlist appears there only after someone accepts/.test(dlg) && /const free = candidates\.filter\(\(b\) => !open\.has\(b\.id\)\)/.test(dlg));
const sm = rd("components/share-modal.tsx");
const card = rd("components/source-card-unified.tsx");
assert("D2 'Share inside VONO' is offered only for a SAVED playlist (the saved playlist's own id, not the library's pl-… id), inside the usual share dialog, which keeps its link / WhatsApp / mail tiles untouched", /vonoPlaylistId \? \(\s*<button type="button" className="sb-shr-vono"/.test(sm) && /if \(vonoOpen && vonoPlaylistId\) return <PlaylistShareDialog/.test(sm) && /vonoPlaylistId=\{source\.origin === "playlist" && source\.playlist\?\.tenantId \? source\.playlist\.id : undefined\}/.test(card) && /shareOptions\.map/.test(sm) && /handleShare\("copy"\)/.test(sm));
assert("D3 a click inside a dialog of a card (a portal child of the card) no longer opens the playlist under it (single click) or plays it (double click): only clicks whose target is inside the card count", /!articleRef\.current\.contains\(tgt\)\) return;/.test(card) && /!articleRef\.current\.contains\(e\.target as Node\)\) return;/.test(card));

const req = rd("components/playlist-share-requests.tsx");
assert("R1 the request card: the playlist's square + name under it + who made it + song count, 'Look inside' opens the numbered list in PREVIEW mode (read-only), and the receiver decides: accept / make my copy (own name) / decline — nothing is changed before an answer", /PlaylistWorkspacePanel\s+mode="preview"/.test(req) && /run\("accept"/.test(req) && /run\("copy", name\.trim\(\)/.test(req) && /run\("decline"/.test(req) && /sb-shr-look/.test(req) && /fromRect/.test(req) && /prefers-reduced-motion/.test(req));
assert("R2 the pill shows only while something waits; it opens the card (the card is never opened by itself)", /if \(count <= 0\) return null;/.test(req) && /<PlaylistSharePill count=\{shares\.pending\.length\} onClick=\{\(\) => setRequestsOpen\(true\)\} \/>/.test(sm === "" ? "" : rd("components/sources-manager.tsx")) && /\{requestsOpen && shares\.pending\.length > 0 \? \(/.test(rd("components/sources-manager.tsx")));

const panel = rd("components/playlist-workspace-panel.tsx");
assert("P1 (classic view removed 2026-11-25) the playlist screen has three modes: 'library' (everything, as before), 'shared' (play only: no ⋯, no classic view) and 'preview' (nothing plays, nothing changes: rows inert, no big play, no ⋯, no classic view); a song that cannot play here is drawn grey and says so instead of playing", /mode = "library"/.test(panel) && /const showMenu = mode === "library" &&/.test(panel) && /const canPlay = mode !== "preview";/.test(panel) && /data-ro=\{mode === "preview" \? "1" : undefined\}/.test(panel) && /data-off=\{off \? "1" : undefined\}/.test(panel) && /if \(off\) onUnavailable\?\.\(it\);/.test(panel) && !/<button type="button" className="sb-alb-classic"/.test(panel)); // (2026-11-25: the Classic view button was removed for every mode)
const shared = rd("components/shared-playlists-panel.tsx");
assert("P2 the Shared view plays only what can play here (a local file of another computer is left out of the queue and shown grey, pressing it says 'Local file not found'), has no ⋯ / classic view, and offers 'Stop following'", /mode="shared"/.test(shared) && /unavailable=\{isLocalOnlyLeaf\}/.test(shared) && /leaves\.filter\(\(l\) => !isLocalOnlyLeaf\(l\)\)/.test(shared) && /Local file not found/.test(shared) && /void onLeave\(open\.id\)/.test(shared));

const mgr = rd("components/sources-manager.tsx");
assert("M1 the library asks for shares only for a branch that CAN receive them: the window's branch (the legacy 'default' = the business's canonical branch, none when it has none)", /const shareBranchId = useMemo\(\(\) => \{[\s\S]*?return v === "default" \? defaultBranchId : v;/.test(mgr) && /usePlaylistShares\(shareBranchId,/.test(mgr));
assert("M2 the 'Shared' chip appears ONLY when this branch has shares (waiting or accepted) — a business that never shares sees nothing new; the Shared view is its own center panel like Radio", /\.\.\.\(shares\.accepted\.length \+ shares\.pending\.length > 0 \? \[\{ id: "shared" as const, label: "Shared"/.test(mgr) && /selection\.id === "shared" \? \(\s*<SharedPlaylistsPanel/.test(mgr));
assert("M3 playing a shared song uses the SAME primitives as the other expanded playlists (queue of the playable songs, then play at the pressed song's index through playSourceOverride / playSource) — no new playback code", /const playSharedLeaf = useCallback\(/.test(mgr) && /setQueue\(all, \{ force: true \}\)/.test(mgr) && /playlistLeafTrackIndexForQueueItem\(leaf\)/.test(mgr) && /if \(playSourceOverride\) playSourceOverride\(leaf, ti\);\s*else playSource\(leaf, ti\);/.test(mgr));
const css = rd("app/globals.css");
const added = css.slice(css.indexOf("/* ── Sharing inside VONO"), css.indexOf("/* ── Sharing inside VONO") + 9000);
assert("C1 the new styles are flat (no blur / filter / backdrop-filter), respect reduced motion and have a light-display variant", !/backdrop-filter|filter:|blur\(/.test(added.slice(0, added.indexOf("html[data-sb-display=\"white\"] .sb-shr-pill") + 120)) && /prefers-reduced-motion/.test(added) && /html\[data-sb-display="white"\] \.sb-shr-pill/.test(added));

console.log(`\n${pass} passed, ${fail} failed`);
