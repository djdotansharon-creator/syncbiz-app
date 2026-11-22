import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPlaylist } from "@/lib/playlist-store";
import type { Playlist } from "@/lib/playlist-types";
import { creatorDisplayName } from "@/lib/playlist-credit";
import type { ShareStatus } from "@/lib/playlist-share-rules";

/**
 * Sharing a playlist to branches of the SAME business — the store (phase C). Every query is fenced to ONE workspace (the caller's): a share, its playlist and its target branch must all belong to it.
 * Server only. Cross-business sharing (a person in another business) is phase D and is NOT here.
 */

export async function workspaceBranchIds(workspaceId: string): Promise<string[]> {
  const rows = await prisma.branch.findMany({ where: { workspaceId }, select: { id: true } });
  return rows.map((r) => r.id);
}

export type ShareView = {
  id: string;
  playlistId: string;
  targetBranchId: string;
  status: ShareStatus;
  createdAt: string;
  decidedAt: string | null;
  fromUserId: string;
  fromName: string | null;
  playlist: Playlist | null;
};

type ShareRow = Awaited<ReturnType<typeof findShareRows>>[number];
function findShareRows(where: Prisma.PlaylistShareWhereInput) {
  return prisma.playlistShare.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { fromUser: { select: { name: true, firstName: true, lastName: true } } },
  });
}

async function toView(row: ShareRow): Promise<ShareView> {
  return {
    id: row.id,
    playlistId: row.playlistId,
    targetBranchId: row.targetBranchId ?? "",
    status: row.status as ShareStatus,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    fromUserId: row.fromUserId,
    fromName: creatorDisplayName(row.fromUser) ?? null,
    playlist: await getPlaylist(row.playlistId),
  };
}

/** Creates PENDING branch shares of one playlist; a branch that already has an open (pending / accepted) share of it is left as it is. Returns what was created. */
export async function createBranchShares(i: { workspaceId: string; playlistId: string; fromUserId: string; branchIds: string[] }): Promise<ShareView[]> {
  if (i.branchIds.length === 0) return [];
  const open = await prisma.playlistShare.findMany({
    where: { playlistId: i.playlistId, targetKind: "BRANCH", targetBranchId: { in: i.branchIds }, status: { in: ["PENDING", "ACCEPTED"] }, playlist: { workspaceId: i.workspaceId } },
    select: { targetBranchId: true },
  });
  const taken = new Set(open.map((r) => r.targetBranchId));
  const fresh = i.branchIds.filter((b) => !taken.has(b));
  const created: ShareView[] = [];
  for (const branchId of fresh) {
    const row = await prisma.playlistShare.create({
      data: { playlistId: i.playlistId, fromUserId: i.fromUserId, targetKind: "BRANCH", targetBranchId: branchId, status: "PENDING" },
      include: { fromUser: { select: { name: true, firstName: true, lastName: true } } },
    });
    created.push(await toView(row));
  }
  return created;
}

/** Shares aimed at these branches (`"*"` = every branch of the workspace), filtered by status. */
export async function listSharesForBranches(i: { workspaceId: string; branchIds: string[] | "*"; statuses: ShareStatus[] }): Promise<ShareView[]> {
  const rows = await findShareRows({
    targetKind: "BRANCH",
    status: { in: i.statuses },
    playlist: { workspaceId: i.workspaceId },
    ...(i.branchIds === "*" ? {} : { targetBranchId: { in: i.branchIds } }),
  });
  return Promise.all(rows.map(toView));
}

/** The shares OF one playlist (for the sender's own screen). */
export async function listSharesOfPlaylist(workspaceId: string, playlistId: string): Promise<ShareView[]> {
  const rows = await findShareRows({ playlistId, targetKind: "BRANCH", playlist: { workspaceId } });
  return Promise.all(rows.map(toView));
}

/** One share, only when its playlist belongs to the caller's workspace. */
export async function getShareInWorkspace(workspaceId: string, shareId: string) {
  return prisma.playlistShare.findFirst({ where: { id: shareId, targetKind: "BRANCH", playlist: { workspaceId } } });
}

export async function setShareStatus(shareId: string, status: ShareStatus): Promise<void> {
  const now = new Date();
  await prisma.playlistShare.update({
    where: { id: shareId },
    data: { status, ...(status === "REVOKED" ? { revokedAt: now } : { decidedAt: now }) },
  });
}
