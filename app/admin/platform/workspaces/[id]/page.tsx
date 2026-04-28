/**
 * Workspace drill-down page for platform admins.
 *
 * Read view + write hooks for a single workspace, accessed from the
 * link on each row of `/admin/platform`. Ships in Week 4 as the first
 * place where the platform owner can manage pilot limits and toggle
 * user access without going to Prisma Studio.
 *
 * Sections:
 *  1. Workspace card    — name, slug, owner, dates.
 *  2. Entitlement card  — status, plan, trial, limits, notes + Edit form.
 *  3. Members table     — email, role, branches, status, last login,
 *                         per-row Disable/Enable platform action.
 *  4. Devices table     — read-only, includes online/offline state.
 *  5. Recent admin log  — last 20 PlatformAuditLog rows scoped to this
 *                         workspace (suspend/unsuspend/extend/etc.).
 *
 * Auth: parent layout enforces `requireSuperAdmin()`; we re-call here
 * for defense-in-depth and to grab the actor's id (used to mark the
 * "self" row in the members table so the Disable button is hidden).
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import EntitlementForm from "@/components/admin/entitlement-form";
import { PlatformQuotaDetailsSection } from "@/components/admin/platform-quota-ui";
import UserPlatformActions from "@/components/admin/user-platform-actions";
import PlatformWorkspaceMemberRemoval from "@/components/admin/platform-workspace-member-removal";
import WorkspaceTestDeleteButton from "@/components/admin/workspace-test-delete-button";
import { buildQuotaChecks } from "@/lib/admin/platform-quotas";
import { platformRemovalAllowedPreview } from "@/lib/user-store";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Workspace",
  robots: { index: false, follow: false },
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

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

function userStatusClass(status: string): string {
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

function deviceOnlineClass(online: boolean): string {
  return online
    ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
    : "bg-neutral-500/10 text-neutral-400 ring-neutral-500/30";
}

export default async function AdminWorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireSuperAdmin();
  const { id } = await params;

  // Branch assignments are stored with `branchId` as a free-form string
  // (e.g. legacy "default"), so we cannot rely on a relation join from
  // UserBranchAssignment → Branch. We fetch the workspace's branches
  // separately and map by id ourselves.
  const [ws, branches, devices, members, branchAssignments, auditEvents, playlistCount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, email: true, role: true } },
        entitlement: true,
      },
    }),
    prisma.branch.findMany({
      where: { workspaceId: id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, city: true, country: true, status: true },
    }),
    prisma.device.findMany({
      where: { workspaceId: id },
      orderBy: [{ isOnline: "desc" }, { lastSeenAt: "desc" }, { name: "asc" }],
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.userBranchAssignment.findMany({
      where: { workspaceId: id },
      select: { userId: true, branchId: true, role: true },
    }),
    prisma.platformAuditLog.findMany({
      where: { targetWorkspaceId: id },
      include: { actor: { select: { id: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.playlist.count({ where: { workspaceId: id } }),
  ]);

  if (!ws) notFound();

  const branchById = new Map(branches.map((b) => [b.id, b]));
  const assignmentsByUser = new Map<string, typeof branchAssignments>();
  for (const a of branchAssignments) {
    const arr = assignmentsByUser.get(a.userId) ?? [];
    arr.push(a);
    assignmentsByUser.set(a.userId, arr);
  }

  const ent = ws.entitlement;
  const quota = buildQuotaChecks(ent, {
    branches: branches.length,
    devices: devices.length,
    members: members.length,
    playlists: playlistCount,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/platform"
          className="text-[12px] text-neutral-400 hover:text-neutral-200"
        >
          ← Back to workspaces
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{ws.name}</h1>
        <p className="font-mono text-xs text-neutral-500">{ws.slug}</p>
      </div>

      <section className="rounded-md border border-red-500/30 bg-red-950/20 p-4 text-sm text-neutral-200">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-300">
          Test / sandbox cleanup
        </h2>
        <p className="mb-3 text-xs text-neutral-400">
          There is no separate DB “archive” for workspaces — use Suspend on the main platform list
          for a soft business stop, or the button below for a full DB tear-down of this workspace only
          (see confirmation dialog for cascade + optional owner user removal). This removes database
          rows; it does not modify playback, desktop, WebSocket, or MPV code.
        </p>
        <WorkspaceTestDeleteButton
          workspaceId={ws.id}
          name={ws.name}
          slug={ws.slug}
          ownerId={ws.ownerId}
          ownerEmail={ws.owner.email}
          adminId={admin.id}
          ownerIsSuperAdmin={ws.owner.role === "SUPER_ADMIN"}
        />
      </section>

      {/* Workspace card */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-4 text-sm">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Workspace
        </h2>
        <dl className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Owner" value={ws.owner.email} />
          <Field label="Created" value={fmtDateTime(ws.createdAt)} />
          <Field label="Updated" value={fmtDateTime(ws.updatedAt)} />
        </dl>
      </section>

      {/* Entitlement card */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-4 text-sm">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Entitlement
          </h2>
          <span className="text-[11px] text-neutral-500">
            Suspend/Unsuspend/Extend trial → use the Actions column on the workspaces list.
          </span>
        </div>

        {!ent ? (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
            No entitlement row. Run{" "}
            <code className="rounded bg-neutral-900 px-1 py-0.5 text-[12px]">
              node scripts/backfill-workspace-entitlements.mjs
            </code>{" "}
            then refresh.
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field
                label="Status"
                value={
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusClass(
                      ent.status,
                    )}`}
                  >
                    {ent.status}
                  </span>
                }
              />
              <Field label="Plan" value={ent.planCode} />
              <Field
                label="Trial ends"
                value={
                  <>
                    <div>{fmtDate(ent.trialEndsAt)}</div>
                    <div className="text-[11px] text-neutral-500">{fmtRelative(ent.trialEndsAt)}</div>
                  </>
                }
              />
              <Field
                label="Limits B/D/U/P"
                value={
                  <span className="font-mono">
                    {ent.maxBranches}/{ent.maxDevices}/{ent.maxUsers}/{ent.maxPlaylists}
                  </span>
                }
              />
              {ent.suspendedAt ? (
                <>
                  <Field label="Suspended at" value={fmtDateTime(ent.suspendedAt)} />
                  <div className="md:col-span-3">
                    <Field label="Suspended reason" value={ent.suspendedReason ?? "—"} />
                  </div>
                </>
              ) : null}
              <div className="md:col-span-4">
                <Field label="Notes" value={ent.notes ?? "—"} multiline />
              </div>
            </dl>

            <EntitlementForm
              workspaceId={ws.id}
              workspaceName={ws.name}
              initial={{
                maxBranches: ent.maxBranches,
                maxDevices: ent.maxDevices,
                maxUsers: ent.maxUsers,
                maxPlaylists: ent.maxPlaylists,
                planCode: ent.planCode,
                notes: ent.notes,
              }}
            />
          </div>
        )}
      </section>

      {quota.hasEntitlement ? (
        <PlatformQuotaDetailsSection
          checks={quota.checks}
          hasEntitlement={quota.hasEntitlement}
          anyOver={quota.anyOver}
        />
      ) : null}

      {/* Members */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Members <span className="text-neutral-600">({members.length})</span>
          </h2>
          <span className="text-[11px] text-neutral-500">
            Two separate actions:{" "}
            <span className="text-neutral-400">Workspace</span> = membership only ·{" "}
            <span className="text-neutral-400">Platform login</span> = global account lock (not a DB delete).
          </span>
        </div>
        {members.length === 0 ? (
          <p className="text-sm text-neutral-500">No members.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="min-w-full divide-y divide-neutral-800 text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Branches</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Last login</th>
                  <th className="px-3 py-2 font-medium">Workspace</th>
                  <th className="px-3 py-2 font-medium">Platform login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {members.map((m) => {
                  const u = m.user;
                  const isOwner = ws.owner.id === u.id;
                  const branchAssignments = assignmentsByUser.get(u.id) ?? [];
                  const branchLabels = branchAssignments.map((a) => {
                    const b = branchById.get(a.branchId);
                    return b ? b.name : a.branchId;
                  });
                  const otherWorkspaceAdminCountExcludingTarget = members.filter(
                    (row) => row.role === "WORKSPACE_ADMIN" && row.user.id !== u.id,
                  ).length;
                  const canPlatformRemove = platformRemovalAllowedPreview({
                    workspaceOwnerUserId: ws.ownerId,
                    actingUserId: admin.id,
                    targetUserId: u.id,
                    membershipRole: m.role,
                    otherWorkspaceAdminCountExcludingTarget,
                  });
                  const workspaceRemovalDisabledHint =
                    ws.ownerId === u.id
                      ? "Cannot remove workspace owner."
                      : !canPlatformRemove
                        ? "Sole tenant admin: add another admin, or remove your own membership from your row."
                        : "";

                  return (
                    <tr key={m.id} className="hover:bg-neutral-900/40">
                      <td className="px-3 py-2 align-top">
                        <div className="text-neutral-100">{u.email}</div>
                        <div className="flex items-center gap-1 text-[11px] text-neutral-500">
                          {u.name ? <span>{u.name}</span> : null}
                          {isOwner ? <span className="text-amber-400">· owner</span> : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-neutral-300">{m.role}</td>
                      <td className="px-3 py-2 align-top text-neutral-300">
                        {branchLabels.length === 0 ? (
                          <span className="text-neutral-500">all branches</span>
                        ) : (
                          <span className="font-mono text-[12px]">{branchLabels.join(", ")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${userStatusClass(
                            u.status,
                          )}`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top text-neutral-400">
                        {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "never"}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <PlatformWorkspaceMemberRemoval
                          workspaceId={ws.id}
                          workspaceName={ws.name}
                          targetEmail={u.email}
                          canRemove={canPlatformRemove}
                          disabledHint={workspaceRemovalDisabledHint}
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <UserPlatformActions
                          userId={u.id}
                          userEmail={u.email}
                          status={u.status}
                          isSuperAdmin={u.role === "SUPER_ADMIN"}
                          isSelf={u.id === admin.id}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Devices */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Devices <span className="text-neutral-600">({devices.length})</span>
        </h2>
        {devices.length === 0 ? (
          <p className="text-sm text-neutral-500">No devices registered.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="min-w-full divide-y divide-neutral-800 text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Online</th>
                  <th className="px-3 py-2 font-medium">Last seen</th>
                  <th className="px-3 py-2 font-medium">IP</th>
                  <th className="px-3 py-2 font-medium">Version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {devices.map((d) => {
                  const b = branchById.get(d.branchId);
                  return (
                    <tr key={d.id} className="hover:bg-neutral-900/40">
                      <td className="px-3 py-2 align-top">
                        <div className="text-neutral-100">{d.name}</div>
                        <div className="font-mono text-[10px] text-neutral-500">{d.id.slice(0, 8)}</div>
                      </td>
                      <td className="px-3 py-2 align-top text-neutral-300">
                        <div>{d.type}</div>
                        <div className="text-[11px] text-neutral-500">{d.deviceKind}</div>
                      </td>
                      <td className="px-3 py-2 align-top text-neutral-300">
                        {b ? b.name : <span className="font-mono text-[11px]">{d.branchId}</span>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${deviceOnlineClass(d.isOnline)}`}
                        >
                          {d.isOnline ? "online" : "offline"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top text-neutral-400">
                        {d.lastSeenAt ? fmtDateTime(d.lastSeenAt) : "—"}
                      </td>
                      <td className="px-3 py-2 align-top font-mono text-[12px] text-neutral-300">
                        {d.ipAddress || "—"}
                      </td>
                      <td className="px-3 py-2 align-top font-mono text-[12px] text-neutral-300">
                        {d.agentVersion}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent platform audit events for this workspace */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Recent admin actions
          </h2>
          <Link
            href="/admin/platform/audit"
            className="text-[11px] text-neutral-400 hover:text-neutral-200"
          >
            All audit events →
          </Link>
        </div>
        {auditEvents.length === 0 ? (
          <p className="text-sm text-neutral-500">No platform audit events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="min-w-full divide-y divide-neutral-800 text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {auditEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-neutral-900/40">
                    <td className="px-3 py-2 align-top text-neutral-400">{fmtDateTime(ev.createdAt)}</td>
                    <td className="px-3 py-2 align-top text-neutral-300">
                      {ev.actor?.email ?? <span className="text-neutral-500">deleted user</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <code className="rounded bg-neutral-900 px-1 py-0.5 text-[11px] text-neutral-200">
                        {ev.action}
                      </code>
                    </td>
                    <td className="px-3 py-2 align-top text-[11px] text-neutral-400">
                      <AuditMetadataPreview value={ev.metadata} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  multiline,
}: {
  label: string;
  value: React.ReactNode;
  multiline?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd
        className={
          "mt-0.5 text-neutral-200 " + (multiline ? "whitespace-pre-wrap break-words" : "truncate")
        }
      >
        {value}
      </dd>
    </div>
  );
}

function AuditMetadataPreview({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") return <span className="text-neutral-600">—</span>;
  // Render a compact JSON line; full inspection is in the global audit page.
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    json = "[unserializable]";
  }
  if (json.length > 240) json = json.slice(0, 240) + "…";
  return <span className="font-mono">{json}</span>;
}
