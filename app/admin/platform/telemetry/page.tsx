/**
 * Platform owner — playback telemetry / reliability monitor.
 *
 * Central visibility into playback health across EVERY customer: freezes,
 * self-heal re-dispatches, recovery skips, and recoveries reported by each
 * player (see lib/playback-telemetry-client.ts → /api/telemetry/incidents).
 * The point is to see a customer's stall BEFORE they complain.
 *
 * SUPER_ADMIN only — the parent layout (app/admin/layout.tsx) enforces
 * requireSuperAdmin(); re-called here for defense-in-depth.
 */

import { requireSuperAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Playback telemetry",
  robots: { index: false, follow: false },
};

const HOUR_MS = 60 * 60 * 1000;

function kindClass(kind: string): string {
  switch (kind) {
    case "recovered":
      return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
    case "freeze":
      return "bg-rose-500/15 text-rose-300 ring-rose-500/30";
    case "self_heal_redispatch":
      return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
    case "skip_recover":
      return "bg-orange-500/15 text-orange-300 ring-orange-500/30";
    case "stall_error":
      return "bg-red-500/20 text-red-300 ring-red-500/40";
    default:
      return "bg-neutral-500/15 text-neutral-300 ring-neutral-500/30";
  }
}

function fmtTime(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

type Incident = {
  id: string;
  createdAt: Date;
  kind: string;
  deviceId: string | null;
  branchId: string | null;
  workspaceId: string | null;
  userEmail: string | null;
  deviceMode: string | null;
  platform: string | null;
  sourceType: string | null;
  urlHost: string | null;
  attempt: number | null;
  frozenMs: number | null;
  recovered: boolean | null;
};

export default async function PlaybackTelemetryPage() {
  await requireSuperAdmin();

  let incidents: Incident[] = [];
  let tableMissing = false;
  try {
    incidents = await prisma.playbackIncident.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  } catch {
    tableMissing = true;
  }

  const now = Date.now();
  const in24h = incidents.filter((i) => now - i.createdAt.getTime() < 24 * HOUR_MS);
  const freezes24h = in24h.filter((i) => i.kind === "freeze").length;
  const recovered24h = in24h.filter((i) => i.kind === "recovered").length;
  const skips24h = in24h.filter((i) => i.kind === "skip_recover").length;
  const affectedWorkspaces = new Set(in24h.map((i) => i.workspaceId ?? i.branchId ?? "—")).size;
  const recoveryRate =
    freezes24h > 0 ? Math.round((recovered24h / freezes24h) * 100) : freezes24h === 0 ? 100 : 0;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 text-neutral-200">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Playback telemetry</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Playback-reliability events reported by every player. Watch for freezes that don&apos;t
          recover — those are the ones a customer feels.
        </p>
      </div>

      {tableMissing ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          The <code>PlaybackIncident</code> table isn&apos;t migrated yet. Run{" "}
          <code className="rounded bg-black/40 px-1">npx prisma migrate deploy</code> against the
          production database, then reload.
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Freezes (24h)", value: freezes24h, tone: freezes24h > 0 ? "text-rose-300" : "text-neutral-200" },
              { label: "Recovery rate (24h)", value: `${recoveryRate}%`, tone: recoveryRate >= 90 ? "text-emerald-300" : "text-amber-300" },
              { label: "Hard skips (24h)", value: skips24h, tone: skips24h > 0 ? "text-orange-300" : "text-neutral-200" },
              { label: "Sites affected (24h)", value: affectedWorkspaces, tone: "text-neutral-200" },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3">
                <div className="text-xs text-neutral-400">{c.label}</div>
                <div className={`mt-1 text-2xl font-semibold ${c.tone}`}>{c.value}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="min-w-full divide-y divide-neutral-800 text-sm">
              <thead className="bg-neutral-900/80 text-left text-xs uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Time (UTC)</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Workspace / branch</th>
                  <th className="px-3 py-2 font-medium">Device</th>
                  <th className="px-3 py-2 font-medium">Mode</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Host</th>
                  <th className="px-3 py-2 font-medium">Try</th>
                  <th className="px-3 py-2 font-medium">Frozen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/70">
                {incidents.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-neutral-500">
                      No incidents yet — that&apos;s good. Events appear here as players report them.
                    </td>
                  </tr>
                ) : (
                  incidents.map((i) => (
                    <tr key={i.id} className="hover:bg-neutral-900/40">
                      <td className="whitespace-nowrap px-3 py-2 text-neutral-400">{fmtTime(i.createdAt)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ring-1 ${kindClass(i.kind)}`}>
                          {i.kind}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-neutral-200">{i.workspaceId ?? "—"}</div>
                        <div className="text-xs text-neutral-500">{i.userEmail ?? i.branchId ?? ""}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-neutral-400">
                        {i.deviceId ? i.deviceId.slice(0, 12) : "—"}
                      </td>
                      <td className="px-3 py-2 text-neutral-300">{i.deviceMode ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-300">{i.sourceType ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-400">{i.urlHost ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-400">{i.attempt ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-400">
                        {typeof i.frozenMs === "number" ? `${(i.frozenMs / 1000).toFixed(1)}s` : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-neutral-500">Showing the {incidents.length} most recent events.</p>
        </>
      )}
    </div>
  );
}
