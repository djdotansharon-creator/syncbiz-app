/**
 * /suspended — workspace member contact-support page (V1 SaaS Week 3).
 *
 * Lives outside the `(app)` route group so the suspension redirect in
 * `app/(app)/layout.tsx` never points back into a layout that would
 * redirect again (no infinite loop).
 *
 * Defensive routing rules (in priority order):
 * 1. No session cookie → redirect to /login (the suspended page itself
 *    is not informative without a known workspace).
 * 2. Session is valid but the user's workspace isn't actually suspended,
 *    OR the enforcement flag is off → redirect home. This covers the
 *    edge case where someone bookmarks /suspended after the admin lifts
 *    the suspension.
 * 3. Otherwise: render the generic contact-support message.
 *
 * V1 product decision (locked with the user): the admin-supplied
 * `suspendedReason` is NEVER shown to workspace members. It's an
 * internal note only. Members only see "your workspace is suspended,
 * please contact support". Reason is available to the SUPER_ADMIN via
 * Prisma Studio and via the `PlatformAuditLog` row.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getActiveSuspensionForUser } from "@/lib/auth/suspension";
import LogoutButton from "./logout-button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz · Workspace suspended",
  robots: { index: false, follow: false },
};

const SUPPORT_EMAIL = process.env.SYNCBIZ_SUPPORT_EMAIL ?? "support@syncbiz.app";

function fmtDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export default async function SuspendedPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login");

  const suspension = await getActiveSuspensionForUser(user);
  if (!suspension) redirect("/");

  const sinceLabel = fmtDate(suspension.suspendedAt);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-8 shadow-xl">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30"
          >
            {/* Lock glyph in pure SVG; no icon library dependency. */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M10 1.5a4 4 0 00-4 4V8H5a2 2 0 00-2 2v7a2 2 0 002 2h10a2 2 0 002-2v-7a2 2 0 00-2-2h-1V5.5a4 4 0 00-4-4zM8 5.5a2 2 0 014 0V8H8V5.5z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Workspace suspended</h1>
            <p className="font-mono text-[12px] text-neutral-500">{suspension.workspaceName}</p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-neutral-300">
          Your SyncBiz workspace is currently suspended and the team can&apos;t access it.
          Please contact support to resolve the issue and restore access.
        </p>

        <dl className="space-y-2 rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-xs">
          <div className="flex justify-between">
            <dt className="text-neutral-500">Signed in as</dt>
            <dd className="text-neutral-300">{user.email}</dd>
          </div>
          {sinceLabel ? (
            <div className="flex justify-between">
              <dt className="text-neutral-500">Suspended since</dt>
              <dd className="text-neutral-300">{sinceLabel}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-neutral-500">Support</dt>
            <dd>
              <Link
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                  `Workspace suspended: ${suspension.workspaceName}`,
                )}`}
                className="text-sky-400 hover:text-sky-300 hover:underline"
              >
                {SUPPORT_EMAIL}
              </Link>
            </dd>
          </div>
        </dl>

        <div className="flex items-center justify-between gap-3 pt-2">
          <p className="text-[11px] text-neutral-500">
            If access has been restored, refresh the page.
          </p>
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
