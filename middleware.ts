import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseSessionValue } from "@/lib/auth-session";

const COOKIE_NAME = "syncbiz-session";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/sources",
  "/library",
  "/playlists",
  "/settings",
  "/access-control",
  "/devices",
  "/logs",
  "/radio",
  "/schedules",
  "/announcements",
  "/favorites",
  "/architecture",
  "/remote",
  "/remote-player",
  "/player",
  "/owner",
  "/mobile",
];

const ALLOWED_PATHS = ["/", "/login", "/signup"];
const ALLOWED_PREFIX = "/api/auth/";

function isAllowed(pathname: string): boolean {
  if (ALLOWED_PATHS.includes(pathname)) return true;
  if (pathname.startsWith(ALLOWED_PREFIX)) return true;
  return false;
}

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isMobileUserAgent(req: NextRequest): boolean {
  const ua = req.headers.get("user-agent") ?? "";
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Opera Mobi|Silk|Mobile/i.test(ua);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  const email = cookie ? parseSessionValue(cookie) : null;

  if (pathname === "/" && email) {
    return NextResponse.redirect(new URL("/sources", req.url));
  }

  const isEditRoute = /^\/(playlists|sources|radio)\/[^/]+\/edit(\/|$)/.test(pathname);
  if (
    isMobileUserAgent(req) &&
    pathname !== "/mobile" &&
    !pathname.startsWith("/mobile") &&
    !isEditRoute &&
    isProtected(pathname) &&
    email
  ) {
    return NextResponse.redirect(new URL("/mobile", req.url));
  }

  if (!isProtected(pathname)) {
    return NextResponse.next();
  }

  if (isAllowed(pathname)) {
    return NextResponse.next();
  }

  if (!email) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
