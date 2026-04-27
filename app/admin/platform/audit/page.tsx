/**
 * Global PlatformAuditLog reader for platform admins.
 *
 * Shows the most recent 100 admin events across the entire platform.
 * Per Week 4 product call we deliberately skipped pagination — the
 * pilot's audit volume is single-digit-per-week. If/when the table
 * grows past a few hundred rows, swap the `take: 100` for
 * cursor-based paging (use `searchParams.cursor` as the seed and
 * order by `createdAt desc, id desc` to preserve insertion order).
 *
 * Filters supported via querystring:
 *  - `?action=workspace.suspend` — exact action match (closed enum, see
 *    `lib/admin/platform-audit.ts::PlatformAuditAction`).
 *  - `?workspace=<id>` — restrict to events targeting one workspace.
 *
 * Filters are intentionally exact-match. Free-text search lands later
 * if/when needed.
 */

import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Platform Audit Log",
  robots: { index: false, follow: false },
};

const KNOWN_ACTIONS = [
  "workspace.suspend",
  "workspace.unsuspend",
  "workspace.test_delete",
  "entitlement.extend_trial",
  "entitlement.update_limits",
  "user.platform_disable",
  "user.platform_enable",
  "user.set_password",
  "user.orphan_delete",
  "user.safe_account_delete",
] as const;

function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function AdminPlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; workspace?: string }>;
}) {
  await requireSuperAdmin();
  const sp = await searchParams;

  const where: Prisma.PlatformAuditLogWhereInput = {};
  const actionFilter =
    sp.action && (KNOWN_ACTIONS as readonly string[]).includes(sp.action) ? sp.action : null;
  if (actionFilter) where.action = actionFilter;

  const workspaceFilter =
    sp.workspace && typeof sp.workspace === "string" && sp.workspace.trim().length > 0
      ? sp.workspace.trim()
      : null;
  if (workspaceFilter) where.targetWorkspaceId = workspaceFilter;

  const [events, totalCount, scopedWorkspace] = await Promise.all([
    prisma.platformAuditLog.findMany({
      where,
      include: {
        actor: { select: { id: true, email: true } },
        targetWorkspace: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.platformAuditLog.count({ where }),
    workspaceFilter
      ? prisma.workspace.findUnique({
          where: { id: workspaceFilter },
          select: { id: true, name: true, slug: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/platform"
          className="text-[12px] text-neutral-400 hover:text-neutral-200"
        >
          ← Back to workspaces
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Platform audit log</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Showing {events.length} of {totalCount} matching events. Newest first.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-2 text-xs">
        <span className="text-neutral-500">Filter:</span>
        <FilterPill href="/admin/platform/audit" active={!actionFilter}>
          all
        </FilterPill>
        {KNOWN_ACTIONS.map((a) => (
          <FilterPill
            key={a}
            href={`/admin/platform/audit?action=${encodeURIComponent(a)}${
              workspaceFilter ? `&workspace=${encodeURIComponent(workspaceFilter)}` : ""
            }`}
            active={actionFilter === a}
          >
            {a}
          </FilterPill>
        ))}
        {workspaceFilter ? (
          <span className="ml-2 inline-flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-300">
            workspace:{" "}
            <span className="font-mono text-neutral-100">
              {scopedWorkspace?.name ?? workspaceFilter.slice(0, 8)}
            </span>
            <Link
              href={`/admin/platform/audit${actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : ""}`}
              className="ml-1 text-neutral-500 hover:text-neutral-200"
              aria-label="Clear workspace filter"
            >
              ✕
            </Link>
          </span>
        ) : null}
      </div>

      {events.length === 0 ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-6 text-sm text-neutral-400">
          No audit events match the current filter.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-neutral-800">
          <table className="min-w-full divide-y divide-neutral-800 text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Target workspace</th>
                <th className="px-3 py-2 font-medium">Details</th>
                <th className="px-3 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {events.map((ev) => (
                <tr key={ev.id} className="align-top hover:bg-neutral-900/40">
                  <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">
                    {fmtDateTime(ev.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">
                    {ev.actor?.email ?? <span className="text-neutral-500">deleted user</span>}
                  </td>
                  <td className="px-3 py-2">
                    <code className="rounded bg-neutral-900 px-1 py-0.5 text-[11px] text-neutral-200">
                      {ev.action}
                    </code>
                  </td>
                  <td className="px-3 py-2">
                    {ev.targetWorkspace ? (
                      <Link
                        href={`/admin/platform/workspaces/${encodeURIComponent(ev.targetWorkspace.id)}`}
                        className="text-neutral-200 hover:text-white hover:underline"
                      >
                        {ev.targetWorkspace.name}
                      </Link>
                    ) : (
                      <span className="text-neutral-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-neutral-400">
                    <MetadataCell value={ev.metadata} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-neutral-500">
                    {ev.ipAddress || "—"}
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

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded border border-neutral-500 bg-neutral-100 px-2 py-0.5 font-medium text-neutral-900"
          : "rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800"
      }
    >
      {children}
    </Link>
  );
}

function MetadataCell({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") return <span className="text-neutral-600">—</span>;
  let json: string;
  try {
    json = JSON.stringify(value, null, 0);
  } catch {
    json = "[unserializable]";
  }
  // Wrap in <pre> wrapper-style so long JSON breaks but stays readable.
  if (json.length > 320) json = json.slice(0, 320) + "…";
  return <span className="break-all font-mono">{json}</span>;
}
