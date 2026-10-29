import Link from "next/link";
import { headers } from "next/headers";
import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import { mgmt } from "@/lib/i18n/management";
import type { Announcement, Device, LogEntry, Schedule } from "@/lib/types";
import { ManagementGate } from "@/components/management/management-gate";
import { ManagementTabs } from "@/components/management/management-tabs";

async function getData() {
  try {
    const base = getApiBase();
    const cookie = (await headers()).get("cookie");
    const withSession: Record<string, string> = cookie ? { cookie } : {};
    const [schedulesRes, devicesRes, announcementsRes, logsRes] = await Promise.all([
      fetch(`${base}/api/schedules`, { cache: "no-store" }),
      fetch(`${base}/api/devices`, { cache: "no-store" }),
      fetch(`${base}/api/announcements`, { cache: "no-store", headers: withSession }),
      fetch(`${base}/api/logs`, { cache: "no-store", headers: withSession }),
    ]);
    const [schedules, devices, announcements, logs] = (await Promise.all([
      schedulesRes.ok ? schedulesRes.json() : [],
      devicesRes.ok ? devicesRes.json() : [],
      announcementsRes.ok ? announcementsRes.json() : [],
      logsRes.ok ? logsRes.json() : [],
    ])) as [Schedule[], Device[], Announcement[], LogEntry[]];
    return {
      schedules: Array.isArray(schedules) ? schedules : [],
      devices: Array.isArray(devices) ? devices : [],
      announcements: Array.isArray(announcements) ? announcements : [],
      logs: Array.isArray(logs) ? logs : [],
    };
  } catch (e) {
    console.error("[dashboard] getData error:", e);
    return {
      schedules: [],
      devices: [],
      announcements: [],
      logs: [],
    };
  }
}

function isScheduleActiveToday(schedule: Schedule): boolean {
  const today = new Date().getDay();
  return schedule.enabled && schedule.daysOfWeek.includes(today);
}

/** Management area (security hotfix 2026-10-13): managers only; locked on a desktop station until unlocked. */
export default function DashboardPage() {
  return (
    <ManagementGate from="/dashboard">
      <DashboardContent />
    </ManagementGate>
  );
}

async function DashboardContent() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const L = mgmt(locale); // management screens: RTL in Hebrew
  const { schedules, devices, announcements, logs } = await getData();

  const onlineCount = devices.filter((d) => d.status === "online").length;
  const scheduledToday = schedules.filter(isScheduleActiveToday);
  const pendingAnnouncements = announcements.filter(
    (a) => a.status === "draft" || a.status === "scheduled"
  );
  const recentLogs = [...logs].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  ).slice(0, 8);

  return (
    // Management Mode: full screen, outside the player workspace rails — this page scrolls on its own (like Control Room)
    <div dir={L.dir} className="mgmt-type h-full space-y-8 overflow-y-auto px-4 pb-8 pt-2 sm:px-6">
      <ManagementTabs />
      <div>
        <h1 className="text-xl font-semibold text-slate-50">{t.dashboard}</h1>
        <p className="mt-1 text-sm text-slate-400">{t.dashboardOverview}</p>
      </div>

      {/* the first row: flat counters (owner 2026-10-20 — no frames): the title above the number, a faint wash only on hover */}
      <div className="cr-stats grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/devices" className="cr-stat cr-stat--link">
          <span className="cr-stat-label">{t.onlineDevices}</span>
          <span className="cr-stat-value">{onlineCount}<small>/ {devices.length} {t.total}</small></span>
        </Link>
        <Link href="/schedules" className="cr-stat cr-stat--link">
          <span className="cr-stat-label">{t.scheduledToday}</span>
          <span className="cr-stat-value">{scheduledToday.length}<small>{t.activeTimeBlocks}</small></span>
        </Link>
        <Link href="/announcements" className="cr-stat cr-stat--link">
          <span className="cr-stat-label">{t.pendingAnnouncements}</span>
          <span className="cr-stat-value">{pendingAnnouncements.length}<small>{t.draftOrScheduled}</small></span>
        </Link>
        <div className="cr-stat cr-stat--static">
          <span className="cr-stat-label">{t.agentsReporting}</span>
          <span className="cr-stat-value cr-stat-value--ok">{onlineCount}<small>{t.devices}</small></span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <h2 className="text-[15px] font-semibold text-slate-50">{t.deviceHealthSummary}</h2>
          <p className="mt-1 text-xs text-slate-500">{t.statusOfConnectedAgents}</p>
          {devices.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">{t.noDevicesYet}</p>
          ) : (
            <div className="mt-4 space-y-2">
              {devices.slice(0, 5).map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800/60 bg-slate-900/40 px-3 py-2 text-sm"
                >
                  <Link href={`/devices/${d.id}`} className="font-medium text-slate-200 hover:text-white" dir="auto">
                    {d.name}
                  </Link>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        d.status === "online"
                          ? "bg-emerald-400"
                          : d.status === "maintenance"
                            ? "bg-amber-400"
                            : "bg-slate-500"
                      }`}
                    />
                    <span className="text-slate-400">{d.status === "online" ? L.t("dash.statusOnline") : d.status === "maintenance" ? L.t("dash.maintenance") : d.status === "offline" ? L.t("dash.statusOffline") : d.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <h2 className="text-[15px] font-semibold text-slate-50">{t.recentActivity}</h2>
          <p className="mt-1 text-xs text-slate-500">{t.playbackAndControlEvents}</p>
          {recentLogs.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">{t.noRecentActivity}</p>
          ) : (
            <div className="mt-4 space-y-2">
              {recentLogs.map((log) => {
                const device = devices.find((d) => d.id === log.deviceId);
                const levelStyles =
                  log.level === "error"
                    ? "bg-rose-500/10 text-rose-200 border-rose-500/30"
                    : log.level === "warning"
                      ? "bg-amber-500/10 text-amber-200 border-amber-500/30"
                      : "bg-white/5 text-slate-300 border-white/10";
                return (
                  <div
                    key={log.id}
                    className="flex gap-3 rounded-lg border border-slate-800/60 bg-slate-900/40 px-3 py-2 text-sm"
                  >
                    <span
                      className={`shrink-0 self-start rounded-full border px-2 py-0.5 text-[10px] font-medium ${levelStyles}`}
                    >
                      {log.level.toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-slate-200">{log.message}</p>
                      <p className="mt-0.5 text-xs text-slate-500" dir="ltr">
                        {new Date(log.timestamp).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {device && ` · ${device.name}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <Link
            href="/logs"
            className="mt-4 inline-flex rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/[0.16]"
          >
            {t.logs} {L.dir === "rtl" ? "←" : "→"}
          </Link>
        </div>
      </div>
    </div>
  );
}
