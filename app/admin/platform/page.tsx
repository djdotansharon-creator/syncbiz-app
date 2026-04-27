/**
 * V1 SaaS — read-only platform workspaces dashboard.
 *
 * Surface for the SyncBiz platform owner to inspect every Workspace's
 * lifecycle row (`WorkspaceEntitlement`) at a glance: owner, status,
 * trial expiry, configured limits, and current resource usage.
 *
 * No mutations in V1. No suspended/contact-support page. No impersonation.
 * Suspend/unsuspend lands in Week 2; enforcement (gating workspaces by
 * `status`) lands in Week 3 behind a feature flag — see audit §6.
 *
 * The parent layout (`app/admin/layout.tsx`) already enforces
 * `requireSuperAdmin()`. We re-call it here for defense-in-depth so the
 * page can never be rendered without the platform-owner role even if a
 * future refactor changes how the layout chains.
 */

import { requireSuperAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

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

export default async function AdminPlatformPage() {
  await requireSuperAdmin();

  const [workspaces, deviceCounts] = await Promise.all([
    prisma.workspace.findMany({
      include: {
        owner: { select: { email: true } },
        entitlement: true,
        _count: { select: { members: true, branches: true } },
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

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Platform · Workspaces</h1>
        <p className="text-sm text-neutral-500">
          {sorted.length} workspace{sorted.length === 1 ? "" : "s"}
          {missingEntitlement > 0 ? (
            <>
              {" "}
              · <span className="text-amber-400">{missingEntitlement} missing entitlement</span>
            </>
          ) : null}
        </p>
      </div>
      <p className="text-xs text-neutral-500">
        Read-only V1 view. Suspend/unsuspend, edits, and audit log land in Week 2. Enforcement is Week 3.
      </p>

      {sorted.length === 0 ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-6 text-sm text-neutral-400">
          No workspaces yet.
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
                <th className="px-3 py-2 font-medium text-right">Users</th>
                <th className="px-3 py-2 font-medium text-right">Branches</th>
                <th className="px-3 py-2 font-medium text-right">Devices</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {sorted.map((ws) => {
                const ent = ws.entitlement;
                const status = ent?.status;
                const limits = ent
                  ? `${ent.maxBranches}/${ent.maxDevices}/${ent.maxUsers}/${ent.maxPlaylists}`
                  : "—";
                const trialLabel = ent?.trialEndsAt ? fmtDate(ent.trialEndsAt) : "—";
                const trialRel = ent?.trialEndsAt ? fmtRelative(ent.trialEndsAt) : "";
                const deviceCount = deviceCountByWorkspace.get(ws.id) ?? 0;
                return (
                  <tr key={ws.id} className="hover:bg-neutral-900/40">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-neutral-100">{ws.name}</div>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="pt-2 text-[11px] text-neutral-600">
        Limits column: Branches / Devices / Users / Playlists (max). Sort: soonest trial expiry
        first, then newest workspace.
      </p>
    </div>
  );
}
