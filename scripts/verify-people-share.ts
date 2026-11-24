/**
 * SHARING A PLAYLIST WITH A PERSON IN ANOTHER BUSINESS — the security rules (owner 2026-11-23, sharing phase D). A share is a READ-ONLY, WHITELISTED window: who may send, who may find a person, what the receiver
 * sees, who may answer, caps, limits, audit. Pure rules + the wiring of the routes. Run: npx tsx scripts/verify-people-share.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { decidePersonShare, actionAllowedFor, MAX_OPEN_SHARES_PER_PERSON, MAX_PENDING_PER_PERSON } from "../lib/playlist-share-rules";
import { redactPlaylistForShare } from "../lib/playlist-share-redact";
import { allowHit } from "../lib/simple-rate-limit";
import type { Playlist } from "../lib/playlist-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const J = JSON.stringify;

const ok = { senderId: "me", senderIsOwner: true, senderIsCreator: false, target: { id: "you", active: true }, openToTarget: 0, pendingForTarget: 0 };
assert("D1 an owner may share with an active other person", decidePersonShare(ok).ok);
assert("D1b the person who MADE the playlist may share it with a person outside the business even when they are not an owner (owner 2026-11-24: whoever made it decides who gets it)", decidePersonShare({ ...ok, senderIsOwner: false, senderIsCreator: true }).ok);
assert("D2 someone who is neither the playlist's creator nor an owner may NOT send it out of the business (403)", J(decidePersonShare({ ...ok, senderIsOwner: false, senderIsCreator: false })) === J({ ok: false, status: 403, error: "Only the person who made this playlist, or an owner of the business, can share it with a person outside it" }));
const gone = J({ ok: false, status: 404, error: "No person with this ID" });
assert("D3 'nobody has this ID' and 'that person is disabled' give the SAME 404 answer — the reply never reveals whether the person exists", J(decidePersonShare({ ...ok, target: null })) === gone && J(decidePersonShare({ ...ok, target: { id: "you", active: false } })) === gone);
assert("D4 never to yourself (400) — inside the business the branches are the way", J(decidePersonShare({ ...ok, target: { id: "me", active: true } })) === J({ ok: false, status: 400, error: "That is your own ID — to share inside your business use the branches" }));
assert("D5 hard caps (429): at most 25 open shares from one business to one person; at most 100 waiting for one person from anyone", decidePersonShare({ ...ok, openToTarget: MAX_OPEN_SHARES_PER_PERSON }).ok === false && decidePersonShare({ ...ok, openToTarget: MAX_OPEN_SHARES_PER_PERSON - 1 }).ok && decidePersonShare({ ...ok, pendingForTarget: MAX_PENDING_PER_PERSON }).ok === false && decidePersonShare({ ...ok, pendingForTarget: MAX_PENDING_PER_PERSON - 1 }).ok);

assert("A1 who may answer: a share to a PERSON — only that person (accept / decline / copy / leave); a branch share — someone of the sender's business who may use the branch; only the SENDER may take a share back", actionAllowedFor("recipient", "USER", "accept") && actionAllowedFor("recipient", "USER", "copy") && actionAllowedFor("recipient", "USER", "leave") && !actionAllowedFor("sender", "USER", "accept") && !actionAllowedFor("branch-member", "USER", "accept") && actionAllowedFor("sender", "USER", "revoke") && actionAllowedFor("sender", "BRANCH", "revoke") && !actionAllowedFor("recipient", "USER", "revoke") && !actionAllowedFor("branch-member", "BRANCH", "revoke") && actionAllowedFor("branch-member", "BRANCH", "accept") && !actionAllowedFor("recipient", "BRANCH", "accept"));

const secret = {
  id: "p1", name: "Mix", genre: "chill", type: "youtube", url: "https://y.test/list", thumbnail: "https://img.test/t.jpg", cover: "https://img.test/t.jpg", createdAt: "2026-11-01T00:00:00Z", durationSeconds: 300,
  tenantId: "TENANT-SECRET", branchId: "BRANCH-SECRET", createdByUserId: "USER-SECRET", createdByName: "Dotan S", adminNotes: "internal note", catalogItemId: "CAT-SECRET", useCase: "x", libraryPlacement: "y", sharedById: "S",
  scheduleContributorBlocks: [{ id: "b" }], order: ["t1"],
  tracks: [
    { id: "t1", name: "Web song", type: "youtube", url: "https://y.test/a", cover: "https://img.test/a.jpg", durationSeconds: 200, catalogItemId: "CAT2" },
    { id: "t2", name: "Local song", type: "local", url: "C:\\Users\\dotan\\Music\\secret.mp3", cover: "data:image/png;base64,AAAA" },
    { id: "t3", name: "Path song", type: "youtube", url: "/home/dotan/music/a.mp3" },
    { id: "t4", name: "Winamp", type: "winamp", url: "https://x.test/list.m3u" },
  ],
} as unknown as Playlist;
const red = redactPlaylistForShare(secret);
const redText = J(red);
assert("X1 a receiver gets a WHITELISTED playlist: no tenant / branch / creator ids, no notes, no catalog links, no schedule blocks, no ordering internals — only name, genre, picture, length, the creator's DISPLAY name and the songs", !/TENANT-SECRET|BRANCH-SECRET|USER-SECRET|internal note|CAT-SECRET|CAT2|scheduleContributorBlocks|adminNotes|sharedById|libraryPlacement|useCase/.test(redText) && red.name === "Mix" && red.createdByName === "Dotan S" && red.tracks?.length === 4 && (red as unknown as Record<string, unknown>).tenantId === undefined);
assert("X2 a LOCAL song never travels (CLAUDE.md §12): its path is gone (a name only, type local, empty address); so is any address that is not http(s); a winamp entry is local too", !/C:|Users|secret\.mp3|\/home\/dotan/.test(redText) && red.tracks![1]!.url === "" && red.tracks![1]!.type === "local" && red.tracks![2]!.url === "" && red.tracks![3]!.url === "" && red.tracks![0]!.url === "https://y.test/a");
assert("X3 pictures keep only web or data-image addresses (a local-file picture reference is dropped)", redactPlaylistForShare({ ...secret, cover: "file:///C:/x.jpg", thumbnail: "C:/x.jpg" } as unknown as Playlist).cover === undefined && red.tracks![1]!.cover === "data:image/png;base64,AAAA" && red.tracks![0]!.cover === "https://img.test/a.jpg");

const t0 = 1_000_000;
assert("L1 the soft limiter lets N hits in a window through and refuses the next, then lets one in again when the window has passed", [1, 2, 3].every((i) => allowHit("k1", 3, 1000, t0 + i)) && !allowHit("k1", 3, 1000, t0 + 10) && allowHit("k1", 3, 1000, t0 + 1100) && allowHit("other", 3, 1000, t0 + 10));

// wiring
const shareRoute = rd("app/api/playlists/[id]/shares/route.ts");
const lookup = rd("app/api/people/lookup/route.ts");
const mine = rd("app/api/playlist-shares/mine/route.ts");
const answer = rd("app/api/playlist-shares/[id]/route.ts");
const store = rd("lib/playlist-share-store.ts");
assert("W1 sending to a person: the creator-or-owner check comes BEFORE anything about the person is looked up (and the creator is the playlist's recorded createdByUserId); the lookup is by exact ID; the decision rule is used; limited to 20 a hour; the creation is audited (who, which playlist, which person)", shareRoute.indexOf("!senderIsOwner && !senderIsCreator") > -1 && shareRoute.indexOf("!senderIsOwner && !senderIsCreator") < shareRoute.indexOf("findPersonByHandle(handleIn)") && /playlist\.createdByUserId === user\.id/.test(shareRoute) && /decidePersonShare\(\{/.test(shareRoute) && /allowHit\(`share-person:\$\{user\.id\}`, 20, 60 \* 60 \* 1000\)/.test(shareRoute) && /action: "playlist\.share_create"/.test(shareRoute) && /targetHandle: target!\.handle/.test(shareRoute));
assert("W2 the lookup: signed in + (the creator of THAT playlist, or an OWNER), the playlist gated like its own routes, 30 a minute, exact ID only, 404 for nobody / disabled, replies the display name and the ID and nothing else", /status: 401/.test(lookup) && /!== "OWNER"/.test(lookup) && /playlist\.createdByUserId === user\.id/.test(lookup) && /gatePlaylistAccess\(user, playlist\)/.test(lookup) && /allowHit\(`people-lookup:\$\{user\.id\}`, 30, 60 \* 1000\)/.test(lookup) && /findPersonByHandle\(/.test(lookup) && /NextResponse\.json\(\{ name: found\.name, handle: found\.handle \}\)/.test(lookup) && !/email/.test(lookup));
assert("W3 the exact-ID rule lives in the store: parseHandle (exact), findUnique by the full ID — no 'contains', no 'startsWith', no list", /parseHandle\(raw\)/.test(store) && /prisma\.user\.findUnique\(\{ where: \{ handle: parsed\.handle \}/.test(store) && !/findMany\(\{ where: \{ handle/.test(store) && !/handle: \{ (contains|startsWith)/.test(store));
assert("W4 EVERY share a receiver reads is the whitelisted copy (toView → sharedPlaylistFor → redactPlaylistForShare) — never the raw playlist; the receiver's own list answers only about the caller", /async function sharedPlaylistFor\(playlistId: string\)[\s\S]*?redactPlaylistForShare\(p\)/.test(store) && /playlist: await sharedPlaylistFor\(row\.playlistId\)/.test(store) && /listSharesForPerson\(\{ userId: user\.id/.test(mine) && /status: 401/.test(mine) && /where: \{ id: shareId, targetKind: "USER", targetUserId: userId \}/.test(store));
assert("W5 answering finds a share only through ONE of three doors (sent TO me / a branch share of MY business / sent BY me from my business); a sender of a share to a person may only take it back; the copy of a share to a person lands in a branch the PERSON may use in THEIR business; answers are audited", /getShareForRecipient\(user\.id, id\)/.test(answer) && /getShareInWorkspace\(tenantId, id\)/.test(answer) && /getShareForSender\(tenantId, user\.id, id\)/.test(answer) && /Only the person it was shared with can answer it/.test(answer) && /hasBranchAccess\(user\.id, asked, tenantId\)/.test(answer) && /workspaceBranchIds\(tenantId\)\)\.includes\(asked\)/.test(answer) && /tenantId,\s*createdByUserId: user\.id/.test(answer) && /playlist\.share_answer/.test(answer) && /playlist\.share_revoke/.test(answer));
assert("W6 the sender's own door is fenced to the sender's business (the share's playlist must be in it) and a share of another business can never be answered from here", /where: \{ id: shareId, fromUserId: userId, playlist: \{ workspaceId \} \}/.test(store) && /where: \{ id: shareId, targetKind: "BRANCH", playlist: \{ workspaceId \} \}/.test(store));
const audit = rd("lib/admin/tenant-audit.ts");
assert("W7 the audit trail knows the three new actions and the entity", ["playlist.share_create", "playlist.share_revoke", "playlist.share_answer"].every((a) => (audit.match(new RegExp(`"${a.replace(".", "\\.")}"`, "g")) ?? []).length >= 2) && /"playlist_share"/.test(audit));
const me = rd("app/api/auth/me/route.ts");
assert("W8 every person gets their ID the first time the app asks who they are (once per process, best effort, never blocks) — so they can be found by it", /ensureUserHandleOnce\(user\.id\);/.test(me) && /const triedThisProcess = new Set<string>\(\)/.test(rd("lib/user-handle-store.ts")));
const dlg = rd("components/playlist-share-dialog.tsx");
assert("W9 the dialog: the person is found by their exact ID first and shown (name + ID) BEFORE anything is sent; the 'creator or owner' message is shown when the server says 403; people shares of this playlist are listed with 'Take back'", /\/api\/people\/lookup\?handle=.*&playlistId=/.test(dlg) && /setFound\(\{ name: j\.name \?\? null, handle: j\.handle \}\)/.test(dlg) && /body: JSON\.stringify\(\{ handle: found\.handle \}\)/.test(dlg) && /r\.status === 403 \? t\.ownerOnly/.test(dlg) && /s\.kind === "USER"/.test(dlg));
const hook = rd("lib/use-playlist-shares.ts");
assert("W10 a receiver reads the shares sent to THEM as a person even when the window's branch cannot receive branch shares, and a copy of such a share carries the window's branch", /\/api\/playlist-shares\/mine\?status=all/.test(hook) && /branchId \? read\(/.test(hook) && /copyBranchId \? \{ branchId: copyBranchId \}/.test(hook));

console.log(`\n${pass} passed, ${fail} failed`);
