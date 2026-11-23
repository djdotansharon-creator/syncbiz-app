/**
 * SHARING A PLAYLIST TO BRANCHES OF THE SAME BUSINESS — the rules (owner 2026-11-22, docs/PLAYLIST_SHARING_DESIGN.md phase C). PURE: no store, no fetch.
 *   · who can be a target: only branches of the SENDER'S OWN business, never the playlist's own branch, and only branches the sender may use ("all" = every such branch);
 *   · the receiver DECIDES: a share is PENDING until someone who may use that branch accepts (LIVE: the receiving branch sees the owner's changes, read-only), declines, or makes their own copy;
 *   · a copy never carries a local song (the file is on another computer), and is a playlist of its own;
 *   · only the sender may revoke; the receiver may leave an accepted share.
 */
import { sameBranch } from "./local-playlist-branch";

export type ShareStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED";
export type ShareAction = "accept" | "decline" | "copy" | "revoke" | "leave";

export type SkippedTarget = { branchId: string; reason: "not-a-branch-of-this-business" | "own-branch" | "no-access" };

/** Which branches a share goes to, and which asked-for ones were skipped (and why). `access` is the caller's branch ids, or contains "*" for all. Duplicates collapse. */
export function pickShareTargets(i: {
  playlistBranch: string | null | undefined;
  canonicalDefaultBranchId: string | null;
  requested: string[] | "all";
  workspaceBranchIds: string[];
  access: string[];
}): { targets: string[]; skipped: SkippedTarget[] } {
  const list: string[] = i.requested === "all" ? i.workspaceBranchIds : i.requested;
  const asked = [...new Set(list.map((x) => String(x ?? "").trim()).filter(Boolean))];
  const allAccess = i.access.includes("*");
  const targets: string[] = [];
  const skipped: SkippedTarget[] = [];
  for (const id of asked) {
    if (!i.workspaceBranchIds.includes(id)) skipped.push({ branchId: id, reason: "not-a-branch-of-this-business" });
    else if (sameBranch(id, i.playlistBranch, i.canonicalDefaultBranchId)) skipped.push({ branchId: id, reason: "own-branch" });
    else if (!allAccess && !i.access.includes(id)) skipped.push({ branchId: id, reason: "no-access" });
    else targets.push(id);
  }
  return { targets, skipped };
}

export type ShareDecision = { ok: true; status: ShareStatus; makesCopy: boolean } | { ok: false; status: 400 | 403 | 409; error: string };

/** What an action does to a share. `isSender` / `canUseTarget` say who is asking. A copy is allowed while the share is pending or accepted: a pending one is then settled as DECLINED (the live link was not wanted). */
export function decideShareAction(i: { current: ShareStatus; action: ShareAction; isSender: boolean; canUseTarget: boolean }): ShareDecision {
  const { current, action } = i;
  if (action === "revoke") {
    if (!i.isSender) return { ok: false, status: 403, error: "Only the person who shared it can take a share back" };
    if (current === "PENDING" || current === "ACCEPTED") return { ok: true, status: "REVOKED", makesCopy: false };
    return { ok: false, status: 409, error: "This share is already closed" };
  }
  if (!i.canUseTarget) return { ok: false, status: 403, error: "Forbidden: no access to this branch" };
  if (current === "REVOKED") return { ok: false, status: 409, error: "The sender took this share back" };
  if (action === "accept") return current === "PENDING" ? { ok: true, status: "ACCEPTED", makesCopy: false } : { ok: false, status: 409, error: "This share is not waiting for an answer" };
  if (action === "decline") return current === "PENDING" ? { ok: true, status: "DECLINED", makesCopy: false } : { ok: false, status: 409, error: "This share is not waiting for an answer" };
  if (action === "leave") return current === "ACCEPTED" ? { ok: true, status: "DECLINED", makesCopy: false } : { ok: false, status: 409, error: "There is no accepted share to leave" };
  if (action === "copy") {
    if (current === "PENDING") return { ok: true, status: "DECLINED", makesCopy: true };
    if (current === "ACCEPTED") return { ok: true, status: "ACCEPTED", makesCopy: true };
    return { ok: false, status: 409, error: "This share is closed" };
  }
  return { ok: false, status: 400, error: "Unknown action" };
}

/** The songs a COPY keeps: those that play from a web address. A local file lives on one computer only, so it never travels. */
export function copyableTracks<T extends { url?: string | null; type?: string | null }>(tracks: T[]): T[] {
  return tracks.filter((t) => {
    const u = (t.url ?? "").trim();
    return t.type !== "local" && t.type !== "winamp" && (u.startsWith("http://") || u.startsWith("https://"));
  });
}

// ── Sharing with a PERSON in another business (owner 2026-11-23, phase D) ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** hard caps, counted in the database (the in-memory limiter is only the soft layer) */
export const MAX_OPEN_SHARES_PER_PERSON = 25; // open (pending / accepted) shares from ONE sender-business to ONE person
export const MAX_PENDING_PER_PERSON = 100; // everything waiting for ONE person, from anyone

export type PersonShareDecision = { ok: true } | { ok: false; status: 400 | 403 | 404 | 429; error: string };

/**
 * May this sender share with this person? Only an OWNER of the business may send a playlist OUT of it; the person must exist and be active — "no such person", "disabled" and "never had an ID" all answer the same 404, so the
 * answer reveals nothing but "no person with this ID"; never to yourself (use a branch share); and neither the person nor the pair may be flooded.
 */
export function decidePersonShare(i: {
  senderId: string;
  senderIsOwner: boolean;
  target: { id: string; active: boolean } | null;
  openToTarget: number;
  pendingForTarget: number;
}): PersonShareDecision {
  if (!i.senderIsOwner) return { ok: false, status: 403, error: "Only an owner of the business can share a playlist with a person outside it" };
  if (!i.target || !i.target.active) return { ok: false, status: 404, error: "No person with this ID" };
  if (i.target.id === i.senderId) return { ok: false, status: 400, error: "That is your own ID — to share inside your business use the branches" };
  if (i.openToTarget >= MAX_OPEN_SHARES_PER_PERSON) return { ok: false, status: 429, error: "Too many shares are already open with this person" };
  if (i.pendingForTarget >= MAX_PENDING_PER_PERSON) return { ok: false, status: 429, error: "This person has too many shares waiting right now" };
  return { ok: true };
}

/** Who may do what to a share, by the role of the asker: the PERSON it was sent to answers it (accept / decline / copy / leave); only its SENDER takes it back. A share of one business can never be answered from another. */
export type ShareActor = "recipient" | "sender" | "branch-member";
export function actionAllowedFor(actor: ShareActor, kind: "BRANCH" | "USER", action: ShareAction): boolean {
  if (action === "revoke") return actor === "sender";
  if (kind === "USER") return actor === "recipient";
  return actor === "branch-member";
}
