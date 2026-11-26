import { NextRequest, NextResponse } from "next/server";
import { createPlaylist, getPlaylist, isPlaylistPersistError } from "@/lib/playlist-store";
import { getCurrentUserFromCookies, hasBranchAccess } from "@/lib/auth-helpers";
import { getAccessType } from "@/lib/user-store";
import { memberMayApprovePlaylists } from "@/lib/roles-store";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import { prisma } from "@/lib/prisma";
import { extractClientIp, writeTenantAuditLog } from "@/lib/admin/tenant-audit";
import { copyableTracks, decideShareAction, type ShareAction, type ShareStatus } from "@/lib/playlist-share-rules";
import { getShareForRecipient, getShareForSender, getShareInWorkspace, setShareStatus, workspaceBranchIds } from "@/lib/playlist-share-store";

const ACTIONS: ShareAction[] = ["accept", "decline", "copy", "revoke", "leave"];

/**
 * Answer a share (owner 2026-11-22 / 2026-11-23, sharing phases C and D). POST { action: "accept" | "decline" | "copy" | "revoke" | "leave", name?, branchId? }
 *   · accept  — live: the receiver sees the owner's playlist and its changes (read-only);
 *   · copy    — a playlist of the receiver's OWN (optionally with a name of their own), made of the songs that play from a web address — a local file never travels; a pending share is then settled.
 *               For a share to a branch it lands in that branch; for a share to a PERSON in another business it lands in the person's own business, in `branchId` (a branch they may use; default "default");
 *   · decline / leave — the receiver says no / stops following;  revoke — only the sender.
 * WHO may answer: a share to a branch — someone who may use that branch, inside the sender's business; a share to a PERSON — only that person (whatever business they are in); only the SENDER may take a share back.
 * A share is found only through one of these three doors (it was sent to me / it is a branch share of my business / I sent it from my business) — an id from anywhere else is a 404.
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
  const branchIn = (body as { branchId?: unknown } | null)?.branchId;

  try {
    const [toMe, branchShare, fromMe] = await Promise.all([getShareForRecipient(user.id, id), getShareInWorkspace(tenantId, id), getShareForSender(tenantId, user.id, id)]);

    // which door, and what that means for the rules
    let share = toMe ?? branchShare ?? fromMe;
    if (!share) return NextResponse.json({ error: "Share not found" }, { status: 404 });
    const isPerson = share.targetKind === "USER";
    let decision;
    if (toMe) {
      decision = decideShareAction({ current: share.status as ShareStatus, action, isSender: false, canUseTarget: true });
    } else if (branchShare) {
      if (!branchShare.targetBranchId) return NextResponse.json({ error: "Share not found" }, { status: 404 });
      // owner 2026-11-26: accepting what another branch shares with this branch is a permission of the person's ROLE ("Approve shared playlists"). The business owner is never held back; a person with no role is
      // unchanged; with roles off (SYNCBIZ_ROLES) nothing changes at all (lib/roles-store.ts memberMayApprovePlaylists).
      if (action === "accept" && (await getAccessType(user.id, tenantId)) !== "OWNER" && !(await memberMayApprovePlaylists(tenantId, user.id))) {
        return NextResponse.json({ error: "Your role may not approve shared playlists" }, { status: 403 });
      }
      share = branchShare;
      decision = decideShareAction({
        current: share.status as ShareStatus,
        action,
        isSender: share.fromUserId === user.id,
        canUseTarget: await hasBranchAccess(user.id, branchShare.targetBranchId, tenantId),
      });
    } else {
      // I sent it (to a person): the only thing a sender may do to it is take it back
      if (action !== "revoke") return NextResponse.json({ error: "Only the person it was shared with can answer it" }, { status: 403 });
      decision = decideShareAction({ current: share.status as ShareStatus, action, isSender: true, canUseTarget: false });
    }
    if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });

    let copy = null;
    if (decision.makesCopy) {
      // where the copy goes: a branch share → that branch; a share to a person → a branch of the PERSON'S own business that they may use
      let targetBranch: string;
      if (isPerson) {
        const asked = typeof branchIn === "string" && branchIn.trim() ? branchIn.trim() : "default";
        // a branch of THE PERSON'S OWN business (an owner's access check alone would accept any id) — and one they may use
        const inOwnBusiness = asked === "default" || (await workspaceBranchIds(tenantId)).includes(asked);
        if (!inOwnBusiness || !(await hasBranchAccess(user.id, asked, tenantId))) return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
        targetBranch = asked;
      } else {
        targetBranch = share.targetBranchId!;
      }
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
          branchId: targetBranch,
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
    if (isPerson) {
      await writeTenantAuditLog(prisma, {
        action: action === "revoke" ? "playlist.share_revoke" : "playlist.share_answer",
        entity: "playlist_share",
        actorUserId: user.id,
        workspaceId: tenantId,
        targetUserId: id,
        ipAddress: extractClientIp(req),
        metadata: { playlistId: share.playlistId, action },
      });
    }
    if (copy) void notifyLibraryUpdated(user.id, { branchId: copy.branchId ?? "default", entityType: "playlist", action: "created" });
    else if (!isPerson && share.targetBranchId) void notifyLibraryUpdated(user.id, { branchId: share.targetBranchId, entityType: "playlist", action: "updated" });
    return NextResponse.json({ status: decision.status, copy });
  } catch (e) {
    console.error("[api/playlist-shares] POST error:", e);
    return NextResponse.json({ error: "Failed to answer the share" }, { status: 500 });
  }
}
