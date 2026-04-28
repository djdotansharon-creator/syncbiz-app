import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";
import { userMayAccessWorkspace } from "@/lib/user-store";
import { ACTIVE_WORKSPACE_COOKIE_NAME } from "@/lib/active-workspace-constants";

const SESSION_COOKIE = "syncbiz-session";

const ACTIVE_WS_MAX_AGE_SEC = 60 * 60 * 24 * 365;

/**
 * POST `{ workspaceId: "<uuid>" }` — sets HttpOnly `syncbiz-active-workspace-id`
 * when the session user is a member (and not blocked) of that workspace.
 */
export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionVal = cookieStore.get(SESSION_COOKIE)?.value;
  const email = sessionVal ? parseSessionValue(sessionVal) : null;
  const normalized = email?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user || user.status === "DISABLED") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const wsId =
    typeof body === "object" && body !== null && "workspaceId" in body
      ? String((body as { workspaceId?: unknown }).workspaceId ?? "").trim()
      : "";

  if (!wsId) {
    return NextResponse.json({ ok: false, error: "workspaceId required" }, { status: 400 });
  }

  const allowed = await userMayAccessWorkspace(user.id, wsId);
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACTIVE_WORKSPACE_COOKIE_NAME, wsId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACTIVE_WS_MAX_AGE_SEC,
  });
  return res;
}
