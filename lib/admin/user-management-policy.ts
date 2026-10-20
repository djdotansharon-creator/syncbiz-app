/**
 * Gate 3B-3 — tenant user-management rank / ownership rules (PURE; the routes load caller + target and call these).
 *
 * Locked rules (owner decisions 2026-10-06):
 *  - Only WORKSPACE_ADMIN (or SUPER_ADMIN membership) in the ACTIVE workspace may use user management at all
 *    (MANAGER = HQ_CONTROL has no users.manage) — enforced by requireWorkspaceAdmin().
 *  - Only the Workspace Owner (Workspace.ownerId) or a platform SUPER_ADMIN may create / promote / modify / pause /
 *    resume / remove another WORKSPACE_ADMIN. A non-owner admin manages lower ranks only.
 *  - The Workspace Owner membership itself can never be demoted / paused / removed / disabled here (no implicit
 *    ownership transfer); only the owner (or a platform SUPER_ADMIN) may edit the owner's own row, keeping its role.
 *  - A user's password is GLOBAL: PATCH newPassword only for self or a platform SUPER_ADMIN.
 *  - Global disable (User.status) is platform SUPER_ADMIN only.
 */

export type UmCaller = { userId: string; isWorkspaceOwner: boolean; isPlatformSuperAdmin: boolean };
export type UmTarget = { userId: string; membershipRole: string; isWorkspaceOwner: boolean };
export type UmDenial = { status: 400 | 403; error: string; code: string };

export const isAdminMembershipRole = (role: string | null | undefined): boolean =>
  role === "WORKSPACE_ADMIN" || role === "SUPER_ADMIN";

/** May this caller manage WORKSPACE_ADMIN-level members (create / promote / modify / pause / remove)? */
export const canManageAdmins = (c: UmCaller): boolean => c.isWorkspaceOwner || c.isPlatformSuperAdmin;

const deny = (status: 400 | 403, code: string, error: string): UmDenial => ({ status, code, error });

/** POST create / invite. accessType "OWNER" = a WORKSPACE_ADMIN member. */
export function checkCreateMember(c: UmCaller, accessType: "OWNER" | "BRANCH_USER"): UmDenial | null {
  if (accessType === "OWNER" && !canManageAdmins(c)) {
    return deny(403, "ADMIN_CREATE_OWNER_ONLY", "Only the workspace owner can create workspace admins");
  }
  return null;
}

/** PATCH edit (role / branches / name / password). */
export function checkEditMember(
  c: UmCaller,
  t: UmTarget,
  next: { accessType: "OWNER" | "BRANCH_USER"; hasNewPassword: boolean },
): UmDenial | null {
  const self = c.userId === t.userId;
  if (next.hasNewPassword && !self && !c.isPlatformSuperAdmin) {
    return deny(403, "PASSWORD_SELF_ONLY", "You cannot set another user's password");
  }
  if (t.isWorkspaceOwner) {
    if (next.accessType !== "OWNER") return deny(403, "OWNER_IMMUTABLE", "The workspace owner cannot be demoted");
    if (!self && !c.isPlatformSuperAdmin) return deny(403, "OWNER_IMMUTABLE", "Only the workspace owner can edit the owner");
    return null;
  }
  if (isAdminMembershipRole(t.membershipRole) && !self && !canManageAdmins(c)) {
    return deny(403, "ADMIN_PEER_OWNER_ONLY", "Only the workspace owner can change another workspace admin");
  }
  if (next.accessType === "OWNER" && !isAdminMembershipRole(t.membershipRole) && !canManageAdmins(c)) {
    return deny(403, "ADMIN_PROMOTE_OWNER_ONLY", "Only the workspace owner can promote to workspace admin");
  }
  return null;
}

/** pause / resume / remove (membership-level) — owner row never; admin rows only by the owner / platform. */
export function checkMembershipOp(c: UmCaller, t: UmTarget, op: "pause" | "resume" | "remove"): UmDenial | null {
  if (t.isWorkspaceOwner && op !== "resume") {
    return deny(403, "OWNER_IMMUTABLE", `The workspace owner cannot be ${op === "pause" ? "paused" : "removed"}`);
  }
  if (isAdminMembershipRole(t.membershipRole) && c.userId !== t.userId && !canManageAdmins(c)) {
    return deny(403, "ADMIN_PEER_OWNER_ONLY", "Only the workspace owner can manage another workspace admin");
  }
  return null;
}

/** Global disable (User.status across ALL workspaces) — platform SUPER_ADMIN only. */
export function checkGlobalDisable(c: UmCaller): UmDenial | null {
  return c.isPlatformSuperAdmin ? null : deny(403, "GLOBAL_DISABLE_PLATFORM_ONLY", "Only a platform admin can disable an account globally; use remove-member for this workspace");
}

/** Last-admin rule for a PATCH that would drop an admin to a non-admin role. */
export function checkLastAdminDemotion(t: UmTarget, nextAccessType: "OWNER" | "BRANCH_USER", otherActiveAdmins: number): UmDenial | null {
  if (isAdminMembershipRole(t.membershipRole) && nextAccessType !== "OWNER" && otherActiveAdmins === 0) {
    return deny(400, "LAST_ADMIN", "Cannot demote the last workspace admin");
  }
  return null;
}
