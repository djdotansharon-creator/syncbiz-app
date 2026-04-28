/**
 * V1 SaaS — platform workspaces dashboard.
 *
 * Surface for the SyncBiz platform owner to inspect every Workspace's
 * lifecycle row (`WorkspaceEntitlement`) at a glance: owner, status,
 * trial expiry, configured limits, and current resource usage.
 *
 * Layered V1 capabilities:
 * - Week 1: read-only table with B/D/U/P limits, owner, trial expiry.
 * - Week 2: per-row Suspend / Unsuspend / Extend-trial actions, written
 *   through dedicated POST endpoints with `PlatformAuditLog` in the
 *   same Prisma transaction.
 * - Week 3: workspace-side enforcement of `SUSPENDED` for non-admins,
 *   gated behind `SYNCBIZ_ENFORCE_SUSPENSION`.
 * - Week 4: drill-down (members, devices, audit) at
 *   `/admin/platform/workspaces/[id]`, plus a global audit log at
 *   `/admin/platform/audit` and the ability to edit pilot limits and
 *   globally disable / enable users.
 *
 * The parent layout (`app/admin/layout.tsx`) already enforces
 * `requireSuperAdmin()`. We re-call it here for defense-in-depth so the
 * page can never be rendered without the platform-owner role even if a
 * future refactor changes how the layout chains.
 */

import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import WorkspaceActions from "@/components/admin/workspace-actions";
import PlatformWorkspaceDeletedBanner from "@/components/admin/platform-workspace-deleted-banner";
import {
  PlatformQuotaRowBadges,
  PlatformQuotaStatusPill,
} from "@/components/admin/platform-quota-ui";
import WorkspaceTestDeleteButton from "@/components/admin/workspace-test-delete-button";
import PlatformToolbarSearch from "@/components/admin/platform-toolbar-search";
import { buildQuotaChecks } from "@/lib/admin/platform-quotas";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Platform",
  robots: { index: false, follow: false },
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function fmtRelative(d: Date | null | undefined): string {
  if (!d) return "";
  const days = Math.round((d.getTime() - Date.now()) / ONE_DAY_MS);
  if (days === 0) return "today";
  if (days > 0) return `in ${days}d`;
  return `expired ${-days}d ago`;
}

function statusClass(status: string | undefined): string {
  switch (status) {
    case "TRIALING":
      return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
    case "ACTIVE":
      return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
    case "PAST_DUE":
      return "bg-orange-500/15 text-orange-300 ring-orange-500/30";
    case "SUSPENDED":
      return "bg-rose-500/15 text-rose-300 ring-rose-500/30";
    case "CANCELLED":
      return "bg-neutral-500/15 text-neutral-300 ring-neutral-500/30";
    default:
      return "bg-neutral-500/15 text-neutral-400 ring-neutral-500/30";
  }
}

function normalizeSearch(q: unknown): string {
  return typeof q === "string" ? q.trim().toLowerCase() : "";
}

function workspaceMatchesQuery(ws: {
  name: string;
  slug: string;
  owner: { email: string };
}, needle: string): boolean {
  if (!needle) return true;
  return (
    ws.name.toLowerCase().includes(needle) ||
    ws.slug.toLowerCase().includes(needle) ||
    ws.owner.email.toLowerCase().includes(needle)
  );
}

export default async function AdminPlatformPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const qNormalized = normalizeSearch(sp.q);

  const admin = await requireSuperAdmin();

  const [workspaces, deviceCounts] = await Promise.all([
    prisma.workspace.findMany({
      include: {
        owner: { select: { id: true, email: true, role: true } },
        entitlement: true,
        _count: { select: { members: true, branches: true, playlists: true } },
      },
    }),
    // `Device` has no inverse relation back to Workspace in the schema, so
    // `_count.devices` isn't available — group by `Device.workspaceId` once.
    prisma.device.groupBy({
      by: ["workspaceId"],
      _count: { _all: true },
    }),
  ]);

  const deviceCountByWorkspace = new Map<string, number>(
    deviceCounts.map((row) => [row.workspaceId, row._count._all]),
  );

  // Sort: soonest trial expiry first (nulls last), then newest workspace first.
  const sorted = [...workspaces].sort((a, b) => {
    const aT = a.entitlement?.trialEndsAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bT = b.entitlement?.trialEndsAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (aT !== bT) return aT - bT;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const missingEntitlement = sorted.filter((w) => !w.entitlement).length;

  const displayedWorkspaces = qNormalized
    ? sorted.filter((w) => workspaceMatchesQuery(w, qNormalized))
    : sorted;

  return (
    <div className="space-y-4">
      <PlatformWorkspaceDeletedBanner />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
        <h1 className="text-2xl font-semibold">Platform · Workspaces</h1>
        <div className="flex flex-col gap-2 sm:items-end sm:text-right">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <PlatformToolbarSearch
              actionPath="/admin/platform"
              placeholder="Search name, slug, owner email…"
              initialQ={typeof sp.q === "string" ? sp.q : ""}
            />
            <Link
              href="/admin/platform/users"
              className="rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[12px] font-medium text-neutral-200 hover:bg-neutral-800"
            >
              All users
            </Link>
            <Link
              href="/admin/platform/audit"
              className="rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[12px] font-medium text-neutral-200 hover:bg-neutral-800"
            >
              Audit log
            </Link>
          </div>
          <p className="text-sm text-neutral-500">
            {qNormalized ? (
              <>
                <span className="text-neutral-200">{displayedWorkspaces.length}</span> match
                {displayedWorkspaces.length === 1 ? "" : "es"}
                <span className="text-neutral-600"> · </span>
                <span className="text-neutral-600">{sorted.length} total workspaces</span>
              </>
            ) : (
              <>
                {sorted.length} workspace{sorted.length === 1 ? "" : "s"}
              </>
            )}
            {missingEntitlement > 0 ? (
              <>
                {" "}
                · <span className="text-amber-400">{missingEntitlement} missing entitlement</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
      <p className="text-xs text-neutral-500">
        Click a workspace name to drill into members, devices, and edit pilot limits. Suspend /
        unsuspend / extend-trial happen here on each row.
      </p>

      {sorted.length === 0 ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-6 text-sm text-neutral-400">
          No workspaces yet.
        </div>
      ) : displayedWorkspaces.length === 0 ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-6 text-sm text-neutral-400">
          No workspaces match “{typeof sp.q === "string" ? sp.q.trim() : ""}”.{" "}
          <Link href="/admin/platform" className="text-sky-400 hover:underline">
            Clear search
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-neutral-800">
          <table className="min-w-full divide-y divide-neutral-800 text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Workspace</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Trial ends</th>
                <th className="px-3 py-2 font-medium">Limits (B/D/U/P)</th>
                <th className="px-3 py-2 font-medium">Pilot quota</th>
                <th className="px-3 py-2 font-medium text-right">Users</th>
                <th className="px-3 py-2 font-medium text-right">Branches</th>
                <th className="px-3 py-2 font-medium text-right">Devices</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Actions</th>
                <th className="px-3 py-2 font-medium">Test cleanup</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {displayedWorkspaces.map((ws) => {
                const ent = ws.entitlement;
                const status = ent?.status;
                const limits = ent
                  ? `${ent.maxBranches}/${ent.maxDevices}/${ent.maxUsers}/${ent.maxPlaylists}`
                  : "—";
                const trialLabel = ent?.trialEndsAt ? fmtDate(ent.trialEndsAt) : "—";
                const trialRel = ent?.trialEndsAt ? fmtRelative(ent.trialEndsAt) : "";
                const deviceCount = deviceCountByWorkspace.get(ws.id) ?? 0;
                const quota = buildQuotaChecks(ent, {
                  branches: ws._count.branches,
                  devices: deviceCount,
                  members: ws._count.members,
                  playlists: ws._count.playlists,
                });
                return (
                  <tr key={ws.id} className="hover:bg-neutral-900/40">
                    <td className="px-3 py-2 align-top">
                      <Link
                        href={`/admin/platform/workspaces/${encodeURIComponent(ws.id)}`}
                        className="block font-medium text-neutral-100 hover:text-white hover:underline"
                      >
                        {ws.name}
                      </Link>
                      <div className="font-mono text-[11px] text-neutral-500">{ws.slug}</div>
                    </td>
                    <td className="px-3 py-2 align-top text-neutral-300">{ws.owner.email}</td>
                    <td className="px-3 py-2 align-top">
                      {status ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusClass(status)}`}
                        >
                          {status}
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-400">no entitlement</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-neutral-300">{ent?.planCode ?? "—"}</td>
                    <td className="px-3 py-2 align-top">
                      <div className="text-neutral-200">{trialLabel}</div>
                      {trialRel ? (
                        <div className="text-[11px] text-neutral-500">{trialRel}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-[12px] text-neutral-300">
                      {limits}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="space-y-1.5">
                        <PlatformQuotaStatusPill
                          hasEntitlement={quota.hasEntitlement}
                          anyOver={quota.anyOver}
                        />
                        <PlatformQuotaRowBadges checks={quota.checks} />
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums text-neutral-200">
                      {ws._count.members}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums text-neutral-200">
                      {ws._count.branches}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums text-neutral-200">
                      {deviceCount}
                    </td>
                    <td className="px-3 py-2 align-top text-neutral-400">
                      {fmtDate(ws.createdAt)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <WorkspaceActions
                        workspaceId={ws.id}
                        workspaceName={ws.name}
                        workspaceSlug={ws.slug}
                        ownerEmail={ws.owner.email}
                        status={status ?? null}
                        hasEntitlement={Boolean(ent)}
                        trialEndsAtLabel={ent?.trialEndsAt ? fmtDate(ent.trialEndsAt) : "—"}
                        trialEndsAtRelative={ent?.trialEndsAt ? fmtRelative(ent.trialEndsAt) : ""}
                        trialEndsAtIso={ent?.trialEndsAt ? ent.trialEndsAt.toISOString() : null}
                      />
                    </td>
                    <td className="px-3 py-2 align-top max-w-[140px]">
                      <WorkspaceTestDeleteButton
                        workspaceId={ws.id}
                        name={ws.name}
                        slug={ws.slug}
                        ownerId={ws.ownerId}
                        ownerEmail={ws.owner.email}
                        adminId={admin.id}
                        ownerIsSuperAdmin={ws.owner.role === "SUPER_ADMIN"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="pt-2 text-[11px] text-neutral-600">
        Limits: configured max (B/D/U/P). Pilot quota: current vs max — OK or Over limit (B/D/U/P
        badges; enforcement not active). Sort: soonest trial expiry first, then newest workspace.
      </p>
    </div>
  );
}
