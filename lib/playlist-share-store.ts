import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPlaylist } from "@/lib/playlist-store";
import type { Playlist } from "@/lib/playlist-types";
import { creatorDisplayName } from "@/lib/playlist-credit";
import { redactPlaylistForShare } from "@/lib/playlist-share-redact";
import { parseHandle } from "@/lib/user-handle";
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
  /** "BRANCH" (a branch of the sender's own business) or "USER" (a person, possibly in another business) */
  kind: "BRANCH" | "USER";
  /** the sender's business — only for a share to a person (who the person must be able to recognise) */
  fromBusiness: string | null;
  /** for a share to a person, as the SENDER sees it: who it went to */
  targetName: string | null;
  targetHandle: string | null;
  /** WHITELISTED data only (lib/playlist-share-redact.ts) — never the raw playlist */
  playlist: Playlist | null;
};

type ShareRow = Awaited<ReturnType<typeof findShareRows>>[number];
function findShareRows(where: Prisma.PlaylistShareWhereInput) {
  return prisma.playlistShare.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: SHARE_INCLUDE,
  });
}

const SHARE_INCLUDE = {
  fromUser: { select: { name: true, firstName: true, lastName: true } },
  targetUser: { select: { name: true, firstName: true, lastName: true, handle: true } },
  playlist: { select: { workspace: { select: { name: true } } } },
} as const;

/** the playlist as a receiver may see it: whitelisted, never the raw row */
async function sharedPlaylistFor(playlistId: string): Promise<Playlist | null> {
  const p = await getPlaylist(playlistId);
  return p ? redactPlaylistForShare(p) : null;
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
    kind: row.targetKind === "USER" ? "USER" : "BRANCH",
    fromBusiness: row.targetKind === "USER" ? row.playlist.workspace.name : null,
    targetName: row.targetKind === "USER" ? creatorDisplayName(row.targetUser) ?? null : null,
    targetHandle: row.targetKind === "USER" ? row.targetUser?.handle ?? null : null,
    playlist: await sharedPlaylistFor(row.playlistId),
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
      include: SHARE_INCLUDE,
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
  const rows = await findShareRows({ playlistId, playlist: { workspaceId } });
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


// ── Sharing with a PERSON (phase D) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PersonLookup = { id: string; name: string | null; handle: string; active: boolean };

/** A person by their EXACT VONO ID — nothing partial, never a list. null when the text is not an exact ID or nobody has it. */
export async function findPersonByHandle(raw: string): Promise<PersonLookup | null> {
  const parsed = parseHandle(raw);
  if (!parsed) return null;
  const u = await prisma.user.findUnique({ where: { handle: parsed.handle }, select: { id: true, name: true, firstName: true, lastName: true, handle: true, status: true } });
  if (!u || !u.handle) return null;
  return { id: u.id, name: creatorDisplayName(u) ?? null, handle: u.handle, active: u.status === "ACTIVE" };
}

/** how many shares of this sender's business are open (pending / accepted) towards this person, and how many shares wait for the person in all */
export async function countPersonShares(i: { workspaceId: string; targetUserId: string }): Promise<{ openToTarget: number; pendingForTarget: number }> {
  const [openToTarget, pendingForTarget] = await Promise.all([
    prisma.playlistShare.count({ where: { targetKind: "USER", targetUserId: i.targetUserId, status: { in: ["PENDING", "ACCEPTED"] }, playlist: { workspaceId: i.workspaceId } } }),
    prisma.playlistShare.count({ where: { targetKind: "USER", targetUserId: i.targetUserId, status: "PENDING" } }),
  ]);
  return { openToTarget, pendingForTarget };
}

/** Creates ONE pending share of a playlist to a person; null when an open share of it to that person already exists. */
export async function createPersonShare(i: { workspaceId: string; playlistId: string; fromUserId: string; targetUserId: string }): Promise<ShareView | null> {
  const open = await prisma.playlistShare.findFirst({
    where: { playlistId: i.playlistId, targetKind: "USER", targetUserId: i.targetUserId, status: { in: ["PENDING", "ACCEPTED"] }, playlist: { workspaceId: i.workspaceId } },
    select: { id: true },
  });
  if (open) return null;
  const row = await prisma.playlistShare.create({
    data: { playlistId: i.playlistId, fromUserId: i.fromUserId, targetKind: "USER", targetUserId: i.targetUserId, status: "PENDING" },
    include: SHARE_INCLUDE,
  });
  return toView(row);
}

/** The shares sent TO this person (from any business), filtered by status. */
export async function listSharesForPerson(i: { userId: string; statuses: ShareStatus[] }): Promise<ShareView[]> {
  const rows = await findShareRows({ targetKind: "USER", targetUserId: i.userId, status: { in: i.statuses } });
  return Promise.all(rows.map(toView));
}

/** One share, only when it was sent TO this person. */
export async function getShareForRecipient(userId: string, shareId: string) {
  return prisma.playlistShare.findFirst({ where: { id: shareId, targetKind: "USER", targetUserId: userId } });
}

/** One share, only when this person SENT it and its playlist is in the caller's workspace. */
export async function getShareForSender(workspaceId: string, userId: string, shareId: string) {
  return prisma.playlistShare.findFirst({ where: { id: shareId, fromUserId: userId, playlist: { workspaceId } } });
}
