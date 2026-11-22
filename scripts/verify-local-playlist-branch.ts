/**
 * A PLAYLIST OF LOCAL MUSIC FILES BELONGS TO THE COMPUTER (BRANCH) THAT HOLDS THE FILES (owner 2026-11-22). Field test: the YCD playlist (files on the Lenovo) was saved in "default",
 * so a block made from it could never run on the Lenovo's branch. Two parts: (1) a local playlist made on a computer is saved in that computer's branch from the start;
 * (2) an already-saved one can be moved there — an explicit act: the Studio offers it, the server checks it.
 * Run: npx tsx scripts/verify-local-playlist-branch.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { decideLocalPlaylistMove, sameBranch, shouldOfferLocalMove, withStationBranch } from "../lib/local-playlist-branch";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LENOVO = "70227520-aaaa-bbbb-cccc-000000000001";
const CANON = "11111111-aaaa-bbbb-cccc-000000000002";

// ── same branch ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
assert("L1 'default' and the workspace's canonical branch are the same branch; two different branches are not", sameBranch("default", CANON, CANON) && sameBranch(undefined, CANON, CANON) && sameBranch(LENOVO, LENOVO, CANON) && !sameBranch("default", LENOVO, CANON) && !sameBranch(CANON, LENOVO, CANON));
assert("L2 with no canonical branch 'default' is only itself (never another branch)", sameBranch("default", "default", null) && !sameBranch("default", LENOVO, null));

// ── (1) a new local playlist is saved in the computer's branch ──────────────────────────────────────────────────────────────────────────────────
const body = { name: "YCD", url: "C:/Music/a.mp3", type: "local" };
assert("L3 an activated computer adds its branch to the body (the original is not mutated)", (withStationBranch(body, LENOVO) as { branchId?: string }).branchId === LENOVO && !("branchId" in body));
assert("L4 a computer that was never activated ('default' / nothing) sends the body EXACTLY as before", withStationBranch(body, "default") === body && withStationBranch(body, null) === body && withStationBranch(body, "  ") === body && withStationBranch(body, undefined) === body);

// ── (2) offering the move ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const base = { hasLocalFiles: true, playlistBranch: "default", ownBranch: LENOVO, canonicalDefaultBranchId: CANON, isDesktop: true };
assert("L5 a local playlist of 'default' dropped on the Lenovo's schedule: the move is offered", shouldOfferLocalMove(base));
assert("L6 not offered for a playlist of URLs (usable everywhere), nor in a browser / phone (we cannot know the files are on that computer), nor when it is already the computer's own, nor with no branch known",
  !shouldOfferLocalMove({ ...base, hasLocalFiles: false }) && !shouldOfferLocalMove({ ...base, isDesktop: false }) && !shouldOfferLocalMove({ ...base, playlistBranch: LENOVO }) && !shouldOfferLocalMove({ ...base, ownBranch: null }) && !shouldOfferLocalMove({ ...base, ownBranch: "" }));
assert("L7 a playlist whose branch is the canonical one, on a computer that still says 'default', is the SAME branch: nothing to offer", !shouldOfferLocalMove({ ...base, playlistBranch: CANON, ownBranch: "default" }));

// ── the server's decision ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ok = decideLocalPlaylistMove({ hasLocalFiles: true, alreadyThere: false, callerCanUseTargetBranch: true });
assert("L8 a local playlist, a branch the caller may use → allowed, a real move", ok.ok && !ok.noop);
const noop = decideLocalPlaylistMove({ hasLocalFiles: true, alreadyThere: true, callerCanUseTargetBranch: true });
assert("L9 already in that branch → allowed, nothing to do", noop.ok && noop.noop);
const forb = decideLocalPlaylistMove({ hasLocalFiles: true, alreadyThere: false, callerCanUseTargetBranch: false });
assert("L10 a branch the caller may NOT use → 403, even for a local playlist (and the access answer comes before everything else)", !forb.ok && forb.status === 403 && !decideLocalPlaylistMove({ hasLocalFiles: false, alreadyThere: false, callerCanUseTargetBranch: false }).ok && (decideLocalPlaylistMove({ hasLocalFiles: false, alreadyThere: false, callerCanUseTargetBranch: false }) as { status: number }).status === 403);
const urlPl = decideLocalPlaylistMove({ hasLocalFiles: false, alreadyThere: false, callerCanUseTargetBranch: true });
assert("L11 a playlist of URLs is refused (400) — it needs no move", !urlPl.ok && urlPl.status === 400);

// ── wiring ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const route = noComments(rd("app/api/playlists/[id]/move-to-branch/route.ts"));
assert("L12 the route: the playlist's own access gate, the caller's access to the TARGET branch, the local-files test, then ONLY the branch is changed; no path / track is read into the reply",
  /gatePlaylistAccess\(user \?\? null, playlist\)/.test(route) && /hasBranchAccess\(user\.id, target, user\.tenantId\)/.test(route) && /playlistHasLocalFiles\(playlist\)/.test(route) && /updatePlaylist\(id, \{ branchId: target \}\)/.test(route) && /NextResponse\.json\(\{ branchId: resolveMediaBranchId\(updated\), moved: true \}\)/.test(route) && !/\.url\b|tracks/.test(route));
const store = noComments(rd("lib/playlist-store.ts"));
assert("L13 the store changes a branch only when one is passed (canonicalised like a create); the PUT route never copies a branch from its body", /data\.branchId !== undefined && data\.branchId\) updateData\.branchId = await canonicalContentBranchForWrite\(existing\.workspaceId, data\.branchId\)/.test(store) && !/updates\.branchId|body\.branchId/.test(noComments(rd("app/api/playlists/[id]/route.ts"))));
const input = rd("components/library-input-area.tsx");
assert("L14 BOTH places that save a LOCAL playlist go through the helper; no other playlist creation (YouTube / URL) was touched", (input.match(/postLocalPlaylist\(\{/g) ?? []).length === 2 && /postLocalPlaylist\(\{[^}]*type: "local"/.test(input) && (input.match(/fetch\("\/api\/playlists", \{/g) ?? []).length === 3);
const create = noComments(rd("lib/local-playlist-create.ts"));
assert("L15 the helper stamps the branch only in the desktop app, and falls back to the old body when the server refuses the branch (403) — adding music never fails because of it", /syncbizDesktop\?\.getConfig === "function"\) branch = await resolveStationBranchId\(\)/.test(create) && /stamped !== body && res\.status === 403\) return send\(body\)/.test(create));
const studio = noComments(rd("components/schedules-studio/schedules-studio.tsx"));
const cr = studio.slice(studio.indexOf("const create = useCallback("), studio.indexOf("const createRef = useRef(create)"));
assert("L16 the Studio offers the move ONLY for a PLAYLIST, in this computer's own scope, not yet moved, in the desktop app; it adds nothing by itself (returns null) and the toast button does the move then the SAME block", /item\.targetType === "PLAYLIST" && scoped && ownBranchRaw && !movedLocal\.current\.has\(item\.targetId\)/.test(cr) && /isDesktop: typeof window !== "undefined" && typeof window\.syncbizDesktop\?\.getConfig === "function"/.test(cr) && /\/move-to-branch`, \{ branchId: ownBranchRaw \}/.test(cr) && /createRef\.current\(item, day, min, branchId\)/.test(cr) && /return null;\s*\}\s*\}\s*let dur = item\.dur;/.test(cr));
assert("L17 the toast action has its own longer time and button; Undo is unchanged", /action \? 12000 : undo \? 7000 : 4200/.test(studio) && /toast\.undo\?\.\(\); setToast\(null\)/.test(studio));
assert("L18 the pure module imports nothing", !/^import /m.test(rd("lib/local-playlist-branch.ts")));
assert("L19 nothing playback-related was touched: no MPV / orchestrator / watchdog / provider import in the new files", !/mpv|orchestrator|watchdog|device-player|audio-player|playback-provider/i.test(rd("lib/local-playlist-create.ts") + rd("lib/local-playlist-branch.ts") + rd("app/api/playlists/[id]/move-to-branch/route.ts")));

console.log(`\n${pass} passed, ${fail} failed`);
