/**
 * SHARING A PLAYLIST TO BRANCHES OF THE SAME BUSINESS — phase C, the server (owner 2026-11-22). The pure rules + the wiring of the three routes: fenced to the caller's business, the receiver decides,
 * only the sender revokes, a copy never carries a local song. Run: npx tsx scripts/verify-playlist-shares.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pickShareTargets, decideShareAction, copyableTracks } from "../lib/playlist-share-rules";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const J = JSON.stringify;

const ws = ["B1", "B2", "B3", "CANON"];
const base = { playlistBranch: "B1", canonicalDefaultBranchId: "CANON", workspaceBranchIds: ws, access: ["*"] };

assert("R1 a list of branches: the ones of this business, not the playlist's own, are targets; a branch of ANOTHER business and the playlist's own branch are skipped with the reason", J(pickShareTargets({ ...base, requested: ["B2", "B1", "OTHER-BIZ"] })) === J({ targets: ["B2"], skipped: [{ branchId: "B1", reason: "own-branch" }, { branchId: "OTHER-BIZ", reason: "not-a-branch-of-this-business" }] }));
assert("R2 \"all\" = every branch of the business except the playlist's own one", J(pickShareTargets({ ...base, requested: "all" }).targets) === J(["B2", "B3", "CANON"]));
assert("R3 the legacy 'default' playlist counts as the canonical branch: sharing it to CANON is sharing it to its own branch", J(pickShareTargets({ ...base, playlistBranch: "default", requested: ["CANON", "B2"] })) === J({ targets: ["B2"], skipped: [{ branchId: "CANON", reason: "own-branch" }] }));
assert("R4 only branches the sender may use: someone with access to B2 alone can share to B2 but not B3 (\"all\" then gives just B2)", J(pickShareTargets({ ...base, access: ["B1", "B2"], requested: ["B2", "B3"] })) === J({ targets: ["B2"], skipped: [{ branchId: "B3", reason: "no-access" }] }) && J(pickShareTargets({ ...base, access: ["B1", "B2"], requested: "all" }).targets) === J(["B2"]));
assert("R5 duplicates and blanks collapse; nothing asked → nothing", J(pickShareTargets({ ...base, requested: ["B2", " B2 ", ""] }).targets) === J(["B2"]) && J(pickShareTargets({ ...base, requested: [] })) === J({ targets: [], skipped: [] }));

const pend = (action: "accept" | "decline" | "copy" | "revoke" | "leave", o: Partial<{ isSender: boolean; canUseTarget: boolean }> = {}) => decideShareAction({ current: "PENDING", action, isSender: false, canUseTarget: true, ...o });
assert("D1 the receiver decides a pending share: accept → ACCEPTED (live), decline → DECLINED, copy → a copy is made and the live link is declined", J(pend("accept")) === J({ ok: true, status: "ACCEPTED", makesCopy: false }) && J(pend("decline")) === J({ ok: true, status: "DECLINED", makesCopy: false }) && J(pend("copy")) === J({ ok: true, status: "DECLINED", makesCopy: true }));
assert("D2 a copy is still possible after accepting (the share stays accepted); an accepted share can be left; a pending one cannot be 'left'", J(decideShareAction({ current: "ACCEPTED", action: "copy", isSender: false, canUseTarget: true })) === J({ ok: true, status: "ACCEPTED", makesCopy: true }) && J(decideShareAction({ current: "ACCEPTED", action: "leave", isSender: false, canUseTarget: true })) === J({ ok: true, status: "DECLINED", makesCopy: false }) && !pend("leave").ok);
assert("D3 only the SENDER revokes (pending or accepted); a receiver is refused 403; a closed share cannot be revoked again", J(decideShareAction({ current: "ACCEPTED", action: "revoke", isSender: true, canUseTarget: false })) === J({ ok: true, status: "REVOKED", makesCopy: false }) && J(pend("revoke")) === J({ ok: false, status: 403, error: "Only the person who shared it can take a share back" }) && !decideShareAction({ current: "DECLINED", action: "revoke", isSender: true, canUseTarget: true }).ok);
assert("D4 someone who may NOT use the target branch can answer nothing (403) — even a sender cannot accept on the receiver's behalf — and a revoked share answers 409 to everything", J(pend("accept", { canUseTarget: false })) === J({ ok: false, status: 403, error: "Forbidden: no access to this branch" }) && J(decideShareAction({ current: "REVOKED", action: "accept", isSender: false, canUseTarget: true })) === J({ ok: false, status: 409, error: "The sender took this share back" }));
assert("D5 an answer is given once: accepting / declining an already-answered share is refused 409", !decideShareAction({ current: "ACCEPTED", action: "accept", isSender: false, canUseTarget: true }).ok && !decideShareAction({ current: "DECLINED", action: "accept", isSender: false, canUseTarget: true }).ok && !decideShareAction({ current: "ACCEPTED", action: "decline", isSender: false, canUseTarget: true }).ok);

const tr = (type: string, url: string) => ({ type, url });
assert("K1 a copy keeps only the songs that play from a web address — local and winamp files never travel", J(copyableTracks([tr("youtube", "https://y.test/a"), tr("local", "C:/m/a.mp3"), tr("winamp", "https://x.test/p.m3u"), tr("soundcloud", "http://s.test/b"), tr("stream-url", "/home/x/a.mp3"), tr("youtube", "")])) === J([tr("youtube", "https://y.test/a"), tr("soundcloud", "http://s.test/b")]));

// wiring
const rules = rd("lib/playlist-share-rules.ts");
const store = rd("lib/playlist-share-store.ts");
const r1 = rd("app/api/playlists/[id]/shares/route.ts");
const r2 = rd("app/api/playlist-shares/route.ts");
const r3 = rd("app/api/playlist-shares/[id]/route.ts");
assert("W1 the rules are pure (no store / fetch / prisma); the store fences EVERY query to the caller's workspace (the playlist's workspace) and never touches another business", !/prisma|fetch\(/.test(rules.replace(/\/\*[\s\S]*?\*\//g, "")) && (store.match(/workspaceId/g) ?? []).length >= 8 && /playlist: \{ workspaceId/.test(store) && /where: \{ id: shareId, targetKind: "BRANCH", playlist: \{ workspaceId \} \}/.test(store));
assert("W2 sharing: same access gate as the playlist's own routes, branches only of the caller's business that the caller may use, the playlist's own branch excluded; 'No branch to share to' 400 with the reasons", /gatePlaylistAccess\(user \?\? null, playlist\)/.test(r1) && /pickShareTargets\(\{/.test(r1) && /workspaceBranchIds\(tenantId\)/.test(r1) && /getAssignedBranchIdsForUser\(user\.id, tenantId\)/.test(r1) && /No branch to share to/.test(r1));
assert("W3 the list: signed-in only, one branch must be one the caller may use (403), no branch given = only the branches the caller may use; always inside the caller's business", /status: 401/.test(r2) && /Forbidden: no access to this branch/.test(r2) && /listSharesForBranches\(\{ workspaceId: tenantId/.test(r2));
assert("W4 answering: the share must be in the caller's business (404 otherwise), the rule decides who may do what, a copy runs BEFORE the status changes and fails cleanly when nothing can be copied, the copy is the receiver's own (createdByUserId = the receiver, branch = the target)", /getShareInWorkspace\(tenantId, id\)/.test(r3) && /decideShareAction\(\{/.test(r3) && r3.indexOf("createPlaylist({") < r3.indexOf("await setShareStatus(") && /Nothing to copy/.test(r3) && /createdByUserId: user\.id/.test(r3) && /branchId: share\.targetBranchId/.test(r3) && /copyableTracks\(source\.tracks/.test(r3));
assert("W5 nothing reaches a branch before it is accepted: the sharing route only creates PENDING shares and does not touch the playlist; no route here changes a playlist's own branch or content", /status: "PENDING"/.test(store) && !/updatePlaylist|deletePlaylist/.test(r1 + r2 + r3));

console.log(`\n${pass} passed, ${fail} failed`);
