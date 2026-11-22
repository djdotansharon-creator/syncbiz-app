import { NextRequest, NextResponse } from "next/server";
import { createPlaylist, getPlaylist, isPlaylistPersistError } from "@/lib/playlist-store";
import { getCurrentUserFromCookies, hasBranchAccess } from "@/lib/auth-helpers";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import { copyableTracks, decideShareAction, type ShareAction, type ShareStatus } from "@/lib/playlist-share-rules";
import { getShareInWorkspace, setShareStatus } from "@/lib/playlist-share-store";

const ACTIONS: ShareAction[] = ["accept", "decline", "copy", "revoke", "leave"];

/**
 * Answer a share (owner 2026-11-22, phase C). POST { action: "accept" | "decline" | "copy" | "revoke" | "leave", name?: string }
 *   · accept  — live: the receiving branch now sees the owner's playlist and its changes (read-only);
 *   · copy    — a playlist of the receiver's OWN (optionally with a name of their own) made of the songs that play from a web address — a local file never travels; a pending share is settled;
 *   · decline / leave — the receiver says no / stops following;  revoke — only the sender takes it back.
 * The receiver must be someone who may use the target branch. Fenced to the caller's business.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = (user.tenantId ?? "").trim();
  if (!tenantId) return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = (body as { action?: unknown } | null)?.action as ShareAction;
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const nameIn = (body as { name?: unknown } | null)?.name;

  try {
    const share = await getShareInWorkspace(tenantId, id);
    if (!share || !share.targetBranchId) return NextResponse.json({ error: "Share not found" }, { status: 404 });
    const decision = decideShareAction({
      current: share.status as ShareStatus,
      action,
      isSender: share.fromUserId === user.id,
      canUseTarget: await hasBranchAccess(user.id, share.targetBranchId, tenantId),
    });
    if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });

    let copy = null;
    if (decision.makesCopy) {
      const source = await getPlaylist(share.playlistId);
      if (!source) return NextResponse.json({ error: "The playlist is no longer available" }, { status: 404 });
      const tracks = copyableTracks(source.tracks ?? []);
      if (tracks.length === 0) return NextResponse.json({ error: "Nothing to copy: every song of this playlist is a file on another computer" }, { status: 400 });
      const name = (typeof nameIn === "string" ? nameIn.trim() : "").slice(0, 200) || source.name;
      try {
        copy = await createPlaylist({
          name,
          genre: source.genre,
          type: tracks[0]!.type,
          url: tracks[0]!.url,
          thumbnail: source.thumbnail || tracks[0]!.cover || "",
          branchId: share.targetBranchId,
          tenantId,
          createdByUserId: user.id,
          tracks,
        });
      } catch (e) {
        if (isPlaylistPersistError(e)) return NextResponse.json({ error: e.message }, { status: 400 });
        throw e;
      }
    }
    if (decision.status !== share.status) await setShareStatus(id, decision.status);
    void notifyLibraryUpdated(user.id, { branchId: share.targetBranchId, entityType: "playlist", action: copy ? "created" : "updated" });
    return NextResponse.json({ status: decision.status, copy });
  } catch (e) {
    console.error("[api/playlist-shares] POST error:", e);
    return NextResponse.json({ error: "Failed to answer the share" }, { status: 500 });
  }
}
