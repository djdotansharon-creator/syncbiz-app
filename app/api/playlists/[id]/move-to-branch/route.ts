import { NextRequest, NextResponse } from "next/server";
import { shadowAuthorize } from "@/lib/authz";
import { getPlaylist, updatePlaylist, isPlaylistPersistError } from "@/lib/playlist-store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { gatePlaylistAccess } from "@/lib/playlist-access";
import { playlistHasLocalFiles } from "@/lib/playlist-playability";
import { contentBranchesEquivalent } from "@/lib/branch-resolver";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import { decideLocalPlaylistMove } from "@/lib/local-playlist-branch";

/**
 * Move a playlist of LOCAL music files to the branch of the computer that holds the files (owner 2026-11-22). Such a playlist was saved in "default" (the library sent no branch),
 * so a schedule block made from it belonged to "default" and never ran on the station of another branch; its music exists only on one computer, so it has to belong to that
 * computer's branch. An explicit, confirmed act (the Studio asks first) — nothing here runs by itself.
 *   · same access rule as the playlist's own routes (PUT) + the caller must be allowed to use the TARGET branch;
 *   · only a playlist that really plays local files (a URL playlist is usable by every branch of the business as it is);
 *   · it changes the playlist's branch and nothing else — no path, no track and no schedule block is touched or sent anywhere (CLAUDE.md §12).
 * Body: { branchId: string }. Replies the playlist's new branch only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromCookies();
  const { id } = await params;
  const playlist = await getPlaylist(id);
  const g = await gatePlaylistAccess(user ?? null, playlist);
  if (!g.allow) return NextResponse.json({ error: g.message }, { status: g.httpStatus });
  if (!user || !playlist) return NextResponse.json({ error: "Playlist not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const target = String((body as { branchId?: unknown } | null)?.branchId ?? "").trim();
  if (!target) return NextResponse.json({ error: "branchId is required" }, { status: 400 });

  try {
    const decision = decideLocalPlaylistMove({
      hasLocalFiles: playlistHasLocalFiles(playlist),
      alreadyThere: await contentBranchesEquivalent(user.tenantId, resolveMediaBranchId(playlist), target),
      callerCanUseTargetBranch: await hasBranchAccess(user.id, target, user.tenantId),
    });
    if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });
    if (decision.noop) return NextResponse.json({ branchId: resolveMediaBranchId(playlist), moved: false });

    shadowAuthorize("playlists/[id]/move-to-branch:POST", { userId: user.id, workspaceId: user.tenantId }, "content.manage", [target]); // Gate 3A shadow: log only, never blocks
    const updated = await updatePlaylist(id, { branchId: target });
    if (!updated) return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    console.info(`[playlists] moved a local playlist to another branch (playlist ${id}, from ${resolveMediaBranchId(playlist)} to ${resolveMediaBranchId(updated)})`);
    const uid = await getUserIdFromSession();
    if (uid) void notifyLibraryUpdated(uid, { branchId: resolveMediaBranchId(updated), entityType: "playlist", action: "updated" });
    return NextResponse.json({ branchId: resolveMediaBranchId(updated), moved: true });
  } catch (e) {
    if (isPlaylistPersistError(e)) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[api/playlists] move-to-branch error:", e);
    return NextResponse.json({ error: "Failed to move the playlist" }, { status: 500 });
  }
}
