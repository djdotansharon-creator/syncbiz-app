/**
 * Global users list for the SyncBiz platform owner (`SUPER_ADMIN`).
 *
 * Every `User` row is listed — including *orphan* users who exist in the
 * `User` table but have no `WorkspaceMember` row. Those accounts cannot
 * pass `getUserByEmail` in `lib/user-store.ts` (it requires a
 * membership), so login fails, signup returns "already exists" from
 * `createWorkspaceOwner`, and they never appear on workspace-scoped
 * UIs. This page is the visibility + recovery surface.
 *
 * @see `lib/user-store.ts::getUserByEmail` — membership required
 * @see `lib/user-store.ts::createWorkspaceOwner` — duplicate key by email
 */

import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import PlatformUsersRowActions from "@/components/admin/platform-users-row-actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Platform users",
  robots: { index: false, follow: false },
};

function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function statusClass(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30";
    case "PENDING":
      return "bg-amber-500/10 text-amber-300 ring-amber-500/30";
    case "DISABLED":
      return "bg-rose-500/10 text-rose-300 ring-rose-500/30";
    default:
      return "bg-neutral-500/10 text-neutral-300 ring-neutral-500/30";
  }
}

type SearchParams = { filter?: string };

export default async function AdminPlatformUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const onlyOrphan = sp.filter === "orphan" || sp.filter === "1";

  const admin = await requireSuperAdmin();
  const adminId = admin.id;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      ownedWorkspaces: { select: { id: true, name: true, slug: true } },
      memberships: {
        include: {
          workspace: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      _count: {
        select: {
          ownedWorkspaces: true,
          memberships: true,
          branchAssignments: true,
          auditLogs: true,
          createdGuestSessions: true,
          aiDjSessions: true,
        },
      },
    },
  });

  const rows = users
    .map((u) => {
      const isSuperAdmin = u.role === "SUPER_ADMIN";
      const isOwner = u.ownedWorkspaces.length > 0;
      const orphan =
        !isOwner &&
        u._count.memberships === 0 &&
        u._count.branchAssignments === 0;
      /** Non-owners with no blockers: API strips memberships+branches, then deletes `User`. */
      const canSafeDelete =
        !isSuperAdmin &&
        u.id !== adminId &&
        !isOwner &&
        u._count.auditLogs === 0 &&
        u._count.createdGuestSessions === 0 &&
        u._count.aiDjSessions === 0;
      return { u, isSuperAdmin, isOwner, orphan, canSafeDelete };
    })
    .filter((r) => (onlyOrphan ? r.orphan : true));

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/platform"
          className="text-[12px] text-neutral-400 hover:text-neutral-200"
        >
          ← Back to workspaces
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Platform · All users</h1>
        <p className="mt-1 text-xs text-neutral-500" dir="rtl">
          כל שורות <code className="text-[11px]">User</code> במסד. יתומים: אין{" "}
          <code className="text-[11px]">WorkspaceMember</code> — פרטים בקטע המידע (ברירת מחדל מכווץ).
        </p>
      </div>

      <details
        dir="rtl"
        className="group rounded-md border border-neutral-700/90 bg-neutral-900/40 text-right text-sm open:border-neutral-600 [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
      >
        <summary className="flex w-full cursor-pointer select-none items-center justify-start gap-2 px-3 py-2 text-xs text-neutral-400 transition hover:text-neutral-200">
          <span className="min-w-0 flex-1">
            <span className="font-medium text-neutral-300">מידע למנהל</span>
            <span className="mr-1.5 text-[11px] text-neutral-500">
              — חשבונות תקועים, פעולות ומחיקה בטוחה
            </span>
          </span>
          <span className="shrink-0 text-neutral-500 transition group-open:rotate-90" aria-hidden>
            ▶
          </span>
        </summary>
        <div className="space-y-3 border-t border-neutral-800/80 px-3 pb-3 pt-2 text-xs leading-relaxed text-neutral-300">
          <div>
            <p className="text-[11px] font-medium text-amber-200/90">למה מופיעים חשבונות &quot;תקועים&quot;</p>
            <p className="mt-1.5 text-[11px] text-neutral-400">
              <code className="text-[10px]">getUserByEmail</code> ב־<code className="text-[10px]">user-store</code> מחזיר{" "}
              <code className="text-[10px]">null</code> בלי לפחות שורת <code className="text-[10px]">WorkspaceMember</code>
              . הרשמה (<code className="text-[10px]">createWorkspaceOwner</code>) זורקת &quot;User already exists&quot; אם
              שורת <code className="text-[10px]">User</code> כבר קיימת. מצב: אימייל קיים + אין שיוך = הרשמה אומרת
              &quot;קיים&quot;, התחברות נכשלת, וממשקי admin לפי־סניף לא מציגים את המשתמש. בטבלה: הגדרת סיסמה, השבתה, או
              (אם הזכאות מאפשרת) מחיקה בטוחה.
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-neutral-200">מה כל פעולה אומרת</p>
            <ul className="mt-1.5 list-inside list-disc space-y-1.5 pr-0.5 text-[11px] text-neutral-400">
              <li>
                <strong className="text-neutral-300">השבתה (Disable)</strong> — <code className="text-[10px]">User.status=DISABLED</code>
                ; השורה וכל חברויות ה-workspace נשארות. חסימת התחברות כללית; סשנים יורדים בבקשה הבאה.
              </li>
              <li>
                <strong className="text-neutral-300">הסרה מ-workspace</strong> — אין כפתור ייעודי כאן; Access Control
                ב-workspace, או <strong>מחיקה בטוחה</strong> שמסירה את כל שורות Member/Branch של המשתמש בכל
                ה-workspace (רק כשאינו בעלים).
              </li>
              <li>
                <strong className="text-neutral-300">מחיקת יתום</strong> — אין בעלות על workspace ואין שיוכים: מחיקה
                בטוחה מסירה רק את <code className="text-[10px]">User</code>.
              </li>
              <li>
                <strong className="text-neutral-300">משתמש בדיקות עם שיוך</strong> — אותו כפתור <strong>מחיקה בטוחה</strong>
                : השרת מנקה <code className="text-[10px]">WorkspaceMember</code> /{" "}
                <code className="text-[10px]">UserBranchAssignment</code> ואז את ה-User. חסום אם יש בעלות workspace או
                {" "}
                <code className="text-[10px]">AuditLog</code> (ברמת workspace) / אורח / AI-DJ שחוסמים.
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-medium text-neutral-200">מחיקה בטוחה (כפתור אדום) — תנאים</p>
            <p className="mt-1.5 text-[11px] text-neutral-500">
              לא <code className="text-[10px]">SUPER_ADMIN</code>, לא אתה, ללא בעלות workspace, בלי שורות{" "}
              <code className="text-[10px]">AuditLog</code> / guest / AI DJ שחוסמים. אם יש חברויות, ה-API מסיר
              membership ו-branch ואז את <code className="text-[10px]">User</code> באותה טרנזקציה. במודאל: הקלדת
              אימייל המשתמש לאישור. <strong>השבתה</strong> ו־<strong>הגדרת סיסמה</strong> לא מסירות שיוך. פעולות
              הורסות נרשמות ב־<code className="text-[10px]">PlatformAuditLog</code>.
            </p>
          </div>
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-400">
          Showing <span className="text-neutral-200">{rows.length}</span> user
          {rows.length === 1 ? "" : "s"}
          {onlyOrphan ? " (orphan filter on)" : ""}
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href="/admin/platform/users"
            className={
              !onlyOrphan
                ? "rounded border border-neutral-500 bg-neutral-200 px-2 py-1 font-medium text-neutral-900"
                : "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
            }
          >
            All
          </Link>
          <Link
            href="/admin/platform/users?filter=orphan"
            className={
              onlyOrphan
                ? "rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 font-medium text-amber-200"
                : "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
            }
          >
            Orphans only
          </Link>
          <Link
            href="/admin/platform/audit"
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            Audit log
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-6 text-sm text-neutral-400">
          {onlyOrphan ? "No orphan users. Try “All”." : "No users in the database."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-neutral-800">
          <table className="min-w-[1200px] w-full divide-y divide-neutral-800 text-xs">
            <thead className="bg-neutral-900 text-left uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-2 py-2 font-medium">Email</th>
                <th className="px-2 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Role</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Password</th>
                <th className="px-2 py-2 font-medium">SUPER_ADMIN</th>
                <th className="px-2 py-2 font-medium">Owner</th>
                <th className="px-2 py-2 font-medium">Member of</th>
                <th className="px-2 py-2 font-medium">Orphan</th>
                <th className="px-2 py-2 font-medium">Created</th>
                <th className="px-2 py-2 font-medium">Last login</th>
                <th className="px-2 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {rows.map(({ u, isSuperAdmin, isOwner, orphan, canSafeDelete }) => (
                <tr
                  key={u.id}
                  className={
                    orphan
                      ? "bg-amber-950/20 hover:bg-amber-950/30"
                      : "hover:bg-neutral-900/40"
                  }
                >
                  <td className="px-2 py-1.5 align-top">
                    <div className="max-w-[200px] break-all font-mono text-[11px] text-neutral-100">{u.email}</div>
                    <div className="text-[10px] text-neutral-600">{u.id.slice(0, 10)}…</div>
                  </td>
                  <td className="px-2 py-1.5 align-top text-neutral-300">{u.name || "—"}</td>
                  <td className="px-2 py-1.5 align-top font-mono text-[11px] text-neutral-300">{u.role}</td>
                  <td className="px-2 py-1.5 align-top">
                    <span
                      className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${statusClass(
                        u.status,
                      )}`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 align-top text-neutral-300">
                    {u.passwordHash ? "yes" : "no"}
                  </td>
                  <td className="px-2 py-1.5 align-top text-neutral-300">{isSuperAdmin ? "yes" : "no"}</td>
                  <td className="px-2 py-1.5 align-top text-neutral-300">
                    {isOwner ? (
                      <ul className="list-inside list-disc text-[10px]">
                        {u.ownedWorkspaces.map((w) => (
                          <li key={w.id}>
                            <Link
                              href={`/admin/platform/workspaces/${encodeURIComponent(w.id)}`}
                              className="text-sky-300 hover:underline"
                            >
                              {w.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-top text-neutral-300">
                    {u.memberships.length === 0 ? (
                      "—"
                    ) : (
                      <ul className="max-w-[200px] list-inside list-disc text-[10px]">
                        {u.memberships.map((m) => (
                          <li key={m.id}>
                            <span className="text-neutral-400">{m.role}</span>{" "}
                            <Link
                              href={`/admin/platform/workspaces/${encodeURIComponent(m.workspaceId)}`}
                              className="text-sky-300 hover:underline"
                            >
                              {m.workspace.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    {orphan ? (
                      <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-200">
                        yes
                      </span>
                    ) : (
                      "no"
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-top text-neutral-500 whitespace-nowrap">
                    {fmtDateTime(u.createdAt)}
                  </td>
                  <td className="px-2 py-1.5 align-top text-neutral-500 whitespace-nowrap">
                    {fmtDateTime(u.lastLoginAt ?? null)}
                  </td>
                  <td className="px-2 py-1.5 align-top min-w-[140px]">
                    <PlatformUsersRowActions
                      userId={u.id}
                      userEmail={u.email}
                      userRole={u.role}
                      status={u.status}
                      isSuperAdmin={isSuperAdmin}
                      isSelf={u.id === adminId}
                      canSafeDelete={canSafeDelete}
                      orphan={orphan}
                      hasWorkspaceTies={
                        u._count.memberships > 0 || u._count.branchAssignments > 0
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
