import { NextRequest, NextResponse } from "next/server";
import { shadowAuthorize } from "@/lib/authz";
import { getPlaylist } from "@/lib/playlist-store";
import { getCurrentUserFromCookies, getAssignedBranchIdsForUser } from "@/lib/auth-helpers";
import { getAccessType } from "@/lib/user-store";
import { prisma } from "@/lib/prisma";
import { extractClientIp, writeTenantAuditLog } from "@/lib/admin/tenant-audit";
import { allowHit } from "@/lib/simple-rate-limit";
import { gatePlaylistAccess } from "@/lib/playlist-access";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { getCanonicalLegacyBranchId } from "@/lib/branch-resolver";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import { decidePersonShare, pickShareTargets } from "@/lib/playlist-share-rules";
import { countPersonShares, createBranchShares, createPersonShare, findPersonByHandle, listSharesOfPlaylist, workspaceBranchIds } from "@/lib/playlist-share-store";

/**
 * SHARE A PLAYLIST TO BRANCHES OF THE SAME BUSINESS (owner 2026-11-22, phase C). Same access gate as the playlist's own routes; every target must be a branch of the CALLER'S business that the caller may use
 * and not the playlist's own branch. The receiver decides (accept = live, copy, decline) — nothing appears in a branch until it is accepted.
 *   GET  → the shares of this playlist.
 *   POST { branchIds: string[] | "all" } → creates PENDING shares; replies what was created, what was skipped (and why) and how many were already open.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromCookies();
  const { id } = await params;
  const playlist = await getPlaylist(id);
  const g = await gatePlaylistAccess(user ?? null, playlist);
  if (!g.allow) return NextResponse.json({ error: g.message }, { status: g.httpStatus });
  if (!user?.tenantId) return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  return NextResponse.json(await listSharesOfPlaylist(user.tenantId, id));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromCookies();
  const { id } = await params;
  const playlist = await getPlaylist(id);
  const g = await gatePlaylistAccess(user ?? null, playlist);
  if (!g.allow) return NextResponse.json({ error: g.message }, { status: g.httpStatus });
  if (!user || !playlist) return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  const tenantId = (user.tenantId ?? "").trim();
  if (!tenantId) return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // ── to a PERSON by their exact VONO ID (phase D) — possibly in another business ──
  const handleIn = (body as { handle?: unknown } | null)?.handle;
  if (typeof handleIn === "string") {
    // only an OWNER of the business may send a playlist OUT of it — checked first, before anything about the person is looked up
    if ((await getAccessType(user.id, tenantId)) !== "OWNER") {
      return NextResponse.json({ error: "Only an owner of the business can share a playlist with a person outside it" }, { status: 403 });
    }
    if (!allowHit(`share-person:${user.id}`, 20, 60 * 60 * 1000)) return NextResponse.json({ error: "Too many shares in a short time. Try again later." }, { status: 429 });
    try {
      const target = await findPersonByHandle(handleIn);
      const counts = target ? await countPersonShares({ workspaceId: tenantId, targetUserId: target.id }) : { openToTarget: 0, pendingForTarget: 0 };
      const d = decidePersonShare({ senderId: user.id, senderIsOwner: true, target: target ? { id: target.id, active: target.active } : null, ...counts });
      if (!d.ok) return NextResponse.json({ error: d.error }, { status: d.status });
      shadowAuthorize("playlists/[id]/shares:POST:person", { userId: user.id, workspaceId: tenantId }, "content.manage", []); // Gate 3A shadow: log only, never blocks
      const created = await createPersonShare({ workspaceId: tenantId, playlistId: id, fromUserId: user.id, targetUserId: target!.id });
      if (created) {
        await writeTenantAuditLog(prisma, {
          action: "playlist.share_create",
          entity: "playlist_share",
          actorUserId: user.id,
          workspaceId: tenantId,
          targetUserId: created.id,
          ipAddress: extractClientIp(req),
          metadata: { playlistId: id, targetUserId: target!.id, targetHandle: target!.handle },
        });
        console.info(`[playlist-shares] shared a playlist with a person (playlist ${id}, share ${created.id})`);
      }
      return NextResponse.json({ created: created ? [created] : [], skipped: [], alreadyOpen: created ? 0 : 1 }, { status: 201 });
    } catch (e) {
      console.error("[api/playlists/shares] person POST error:", e);
      return NextResponse.json({ error: "Failed to share the playlist" }, { status: 500 });
    }
  }

  const raw = (body as { branchIds?: unknown } | null)?.branchIds;
  const requested: string[] | "all" | null = raw === "all" ? "all" : Array.isArray(raw) && raw.every((x) => typeof x === "string") ? (raw as string[]) : null;
  if (requested === null || (requested !== "all" && requested.length === 0)) {
    return NextResponse.json({ error: 'Send branchIds (a list of branch ids, or "all") or a handle (a person\'s exact VONO ID)' }, { status: 400 });
  }

  try {
    const [wsBranches, access, canonical] = await Promise.all([
      workspaceBranchIds(tenantId),
      getAssignedBranchIdsForUser(user.id, tenantId),
      getCanonicalLegacyBranchId(tenantId),
    ]);
    const { targets, skipped } = pickShareTargets({
      playlistBranch: resolveMediaBranchId(playlist),
      canonicalDefaultBranchId: canonical,
      requested,
      workspaceBranchIds: wsBranches,
      access,
    });
    if (targets.length === 0) return NextResponse.json({ error: "No branch to share to", skipped }, { status: 400 });

    shadowAuthorize("playlists/[id]/shares:POST", { userId: user.id, workspaceId: tenantId }, "content.manage", targets); // Gate 3A shadow: log only, never blocks
    const created = await createBranchShares({ workspaceId: tenantId, playlistId: id, fromUserId: user.id, branchIds: targets });
    for (const c of created) void notifyLibraryUpdated(user.id, { branchId: c.targetBranchId, entityType: "playlist", action: "updated" });
    console.info(`[playlist-shares] shared a playlist to ${created.length} branch(es) (playlist ${id}, ${targets.length - created.length} already open, ${skipped.length} skipped)`);
    return NextResponse.json({ created, skipped, alreadyOpen: targets.length - created.length }, { status: 201 });
  } catch (e) {
    console.error("[api/playlists/shares] POST error:", e);
    return NextResponse.json({ error: "Failed to share the playlist" }, { status: 500 });
  }
}
