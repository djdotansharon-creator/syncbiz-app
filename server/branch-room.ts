/**
 * PR-0 — WS runtime branch-room scoping (PURE, no I/O).
 *
 * The WS runtime "room" (one MASTER namespace, one device roster, one state stream, one command-routing
 * namespace) is keyed by WORKSPACE + branch, taken from the SIGNED token's workspaceId — NOT userId. So all
 * authorized users/devices/controllers in the same workspace+branch share ONE room, and the same branchId
 * (e.g. "default") in two different workspaces is fully isolated.
 *
 * userId remains the authenticated human identity (auth, audit, guest pairing) — it is NOT the room key.
 *
 * LEGACY fallback (this PR only): a token without a signed workspaceId falls back to an EXPLICIT per-user key
 * (`legacy:<userId>:<branch>`) so behavior is unchanged for legacy tokens and a "null:branch" room can never
 * form. Before Phase 0.2B designation enforcement we will require workspace-scoped tokens and drop this.
 */

export const DEFAULT_BRANCH_ID = "default";

/** Runtime branch-room key. Workspace-scoped when a signed workspaceId exists, else explicit legacy per-user. */
export function runtimeBranchKey(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  branchId: string | null | undefined,
): string {
  const b = (branchId ?? "").trim() || DEFAULT_BRANCH_ID;
  const ws = (workspaceId ?? "").trim();
  if (ws) return `ws:${ws}:${b}`;
  return `legacy:${(userId ?? "").trim()}:${b}`;
}

/** Owner-level scope key (spans branches within a workspace). Workspace-scoped, else legacy per-user. */
export function workspaceScopeKey(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
): string {
  const ws = (workspaceId ?? "").trim();
  return ws ? `ws:${ws}` : `legacy:${(userId ?? "").trim()}`;
}

/** True when a room key used the legacy per-user fallback (no signed workspaceId). */
export function isLegacyRoomKey(key: string): boolean {
  return key.startsWith("legacy:");
}

/**
 * Per-user branch authorization from the token's `authorizedBranches` claim (canonical impl, pure/testable).
 * A legacy token (claim === null) is restricted to the default branch only — a missing claim is NEVER "all".
 * Workspace scope is necessary but NOT sufficient: this per-user check must ALSO pass.
 */
export function isBranchAllowed(branchId: string, authorizedBranches: string[] | null): boolean {
  const normalized = (branchId ?? "").trim() || DEFAULT_BRANCH_ID;
  if (authorizedBranches === null) return normalized === DEFAULT_BRANCH_ID;
  return authorizedBranches.includes(normalized);
}

/**
 * Whether an owner_global connection may receive a branch's list entry / state. Requires BOTH the workspace
 * scope match AND per-user branch authorization (owner role is client-supplied; the token only proves
 * userId/workspaceId/authorizedBranches, so authorizedBranches must still gate every branch).
 */
export function ownerReceivesBranch(
  owner: { scopeKey: string; authorizedBranches: string[] | null },
  room: { scopeKey: string; branchId: string },
): boolean {
  return owner.scopeKey === room.scopeKey && isBranchAllowed(room.branchId, owner.authorizedBranches);
}

/**
 * COMMAND room-isolation guard: a resolved target may be commanded ONLY if it is a MASTER device AND its room
 * exactly equals the expected (caller/owner) room. Prevents a supplied targetDeviceId from crossing rooms.
 */
export function commandTargetInRoom(
  expectedRoomKey: string,
  target: { role?: string; mode?: string; roomKey?: string } | null | undefined,
): boolean {
  return !!target && target.role === "device" && target.mode === "MASTER" && target.roomKey === expectedRoomKey;
}
