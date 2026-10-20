/**
 * MANAGEMENT ACCESS (owner 2026-10-13, security hotfix) — ONE server-side decision for the management area
 * (Dashboard, Control Room, Access Control + their management APIs):
 *   1. ROLE: only a manager may enter — access type OWNER (= workspace owner / admin / manager; the same rule the
 *      Control Room APIs already enforce). A branch employee never gets in (pages redirect to the player, APIs 403).
 *   2. LOCK: on the VONO DESKTOP app (a shared station computer) a manager must ALSO hold a fresh signed unlock
 *      (manager password re-auth, 15 min inactivity, dies with the app). A normal browser (HQ, the owner's Mac) is
 *      never locked — the signed-in manager goes straight in.
 * The player area (/sources …) and "Back to Player" are untouched. Nothing here touches playback, MASTER, WS or DB.
 */
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getAccessType } from "@/lib/user-store";
import { MGMT_UNLOCK_COOKIE, isDesktopAppUa, verifyUnlockValue } from "@/lib/management-unlock";

export type ManagementAccess = {
  signedIn: boolean;
  /** a manager (access type OWNER) */
  canManage: boolean;
  /** request comes from the VONO desktop app → the lock applies */
  desktop: boolean;
  /** desktop: a valid unlock is present (browsers: always true) */
  unlocked: boolean;
  /** unix seconds the desktop unlock expires (null = n/a) */
  unlockExp: number | null;
  email: string | null;
  userId: string | null;
};

export async function getManagementAccess(): Promise<ManagementAccess> {
  const user = await getCurrentUserFromCookies();
  const ua = (await headers()).get("user-agent");
  const desktop = isDesktopAppUa(ua);
  if (!user) return { signedIn: false, canManage: false, desktop, unlocked: false, unlockExp: null, email: null, userId: null };
  const canManage = (await getAccessType(user.id, user.tenantId)) === "OWNER";
  let unlockExp: number | null = null;
  if (desktop && canManage) unlockExp = await verifyUnlockValue((await cookies()).get(MGMT_UNLOCK_COOKIE)?.value, user.email);
  return { signedIn: true, canManage, desktop, unlocked: !desktop || unlockExp !== null, unlockExp, email: user.email, userId: user.id };
}

/** true when the caller is on the desktop app and management is NOT unlocked (APIs must refuse). */
export async function isManagementLockedForRequest(): Promise<boolean> {
  const ua = (await headers()).get("user-agent");
  if (!isDesktopAppUa(ua)) return false;
  const user = await getCurrentUserFromCookies();
  if (!user) return false; // unauthenticated is handled by the caller's own 401
  return (await verifyUnlockValue((await cookies()).get(MGMT_UNLOCK_COOKIE)?.value, user.email)) === null;
}

/** The API answer for a locked desktop station. */
export function managementLockedResponse(): NextResponse {
  return NextResponse.json({ error: "Management is locked on this station. Unlock it with a manager password.", locked: true }, { status: 423 });
}
