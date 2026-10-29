/**
 * MANAGEMENT LOCK API (owner 2026-10-13, security hotfix) — desktop station only.
 *   GET    → { desktop, canManage, unlocked, expiresAt }            (status for the UI)
 *   POST   { code } → the station access code (123 until the owner sets his own) — any signed-in person — OR a manager's own password → signed unlock cookie (rate-limited: 10 / account, 20 / address, 15 min)
 *   PUT    → "touch": the user is active → extend the unlock 15 min (only while it is still valid; polling never calls it)
 *   DELETE → lock now (clears the unlock)
 * A browser (not the desktop app) never needs this: management is open to a signed-in manager there.
 */
import { NextRequest, NextResponse } from "next/server";
import { validateCredentialsAsync } from "@/lib/auth";
import { matchesManagementCode } from "@/lib/management-code";
import { getManagementAccess } from "@/lib/management-access";
import { MGMT_UNLOCK_COOKIE, createUnlockValue, unlockCookieOptions } from "@/lib/management-unlock";
import { attemptKeys, blockedFor, recordFailure, recordSuccess } from "@/lib/auth-rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await getManagementAccess();
  return NextResponse.json({ desktop: a.desktop, canManage: a.canManage, unlocked: a.canManage && a.unlocked, expiresAt: a.unlockExp ? a.unlockExp * 1000 : null });
}

export async function POST(req: NextRequest) {
  const a = await getManagementAccess();
  if (!a.signedIn || !a.email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const keys = attemptKeys("mgmt-unlock", a.email, req.headers);
  const wait = blockedFor(keys);
  if (wait > 0) {
    return NextResponse.json({ error: "Too many attempts. Try again later.", retryAfterSec: Math.ceil(wait / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } });
  }
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; password?: unknown };
  const entered = typeof body.code === "string" ? body.code : typeof body.password === "string" ? body.password : "";
  // the station code opens the lock for anyone signed in (role still decides what they may see); a manager may also use their own password
  const ok = entered !== "" && (matchesManagementCode(entered) || (a.canManage && (await validateCredentialsAsync(a.email, entered))));
  if (!ok) {
    keys.forEach((k) => recordFailure(k));
    return NextResponse.json({ error: "Wrong code." }, { status: 401 });
  }
  keys.forEach((k) => recordSuccess(k));
  const { value, exp } = await createUnlockValue(a.email);
  const res = NextResponse.json({ ok: true, expiresAt: exp * 1000 });
  res.cookies.set(MGMT_UNLOCK_COOKIE, value, unlockCookieOptions());
  return res;
}

export async function PUT() {
  const a = await getManagementAccess();
  if (!a.canManage || !a.email || !a.desktop || a.unlockExp === null) return NextResponse.json({ unlocked: false }, { status: 200 });
  const { value, exp } = await createUnlockValue(a.email);
  const res = NextResponse.json({ unlocked: true, expiresAt: exp * 1000 });
  res.cookies.set(MGMT_UNLOCK_COOKIE, value, unlockCookieOptions());
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(MGMT_UNLOCK_COOKIE, "", { ...unlockCookieOptions(), maxAge: 0 });
  return res;
}
