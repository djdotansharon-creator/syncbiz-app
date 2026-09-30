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
