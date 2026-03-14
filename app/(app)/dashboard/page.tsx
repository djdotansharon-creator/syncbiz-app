import Link from "next/link";
import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import type { Announcement, Device, LogEntry, Schedule } from "@/lib/types";

async function getData() {
  try {
    const base = getApiBase();
    const [schedulesRes, devicesRes, announcementsRes, logsRes] = await Promise.all([
      fetch(`${base}/api/schedules`, { cache: "no-store" }),
      fetch(`${base}/api/devices`, { cache: "no-store" }),
      fetch(`${base}/api/announcements`, { cache: "no-store" }),
      fetch(`${base}/api/logs`, { cache: "no-store" }),
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

export default async function DashboardPage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
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
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">{t.dashboard}</h1>
        <p className="mt-1 text-sm text-slate-400">{t.dashboardOverview}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/devices"
          className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5 transition hover:border-slate-700 hover:bg-slate-900/40"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {t.onlineDevices}
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">
            {onlineCount} <span className="text-sm font-normal text-slate-500">/ {devices.length} {t.total}</span>
          </p>
        </Link>
        <Link
          href="/schedules"
          className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5 transition hover:border-slate-700 hover:bg-slate-900/40"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {t.scheduledToday}
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">
            {scheduledToday.length} {t.activeTimeBlocks}
          </p>
        </Link>
        <Link
          href="/announcements"
          className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5 transition hover:border-slate-700 hover:bg-slate-900/40"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {t.pendingAnnouncements}
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">
            {pendingAnnouncements.length} {t.draftOrScheduled}
          </p>
        </Link>
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {t.agentsReporting}
          </p>
          <p className="mt-1 text-2xl font-semibold text-emerald-400">
            {onlineCount} {t.devices}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <h2 className="text-sm font-semibold text-slate-50">{t.deviceHealthSummary}</h2>
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
                  <Link href={`/devices/${d.id}`} className="font-medium text-slate-200 hover:text-sky-300">
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
                    <span className="capitalize text-slate-400">{d.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <h2 className="text-sm font-semibold text-slate-50">{t.recentActivity}</h2>
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
                      : "bg-sky-500/10 text-sky-200 border-sky-500/30";
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
                      <p className="mt-0.5 text-xs text-slate-500">
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
            className="mt-4 inline-block text-sm text-sky-400 hover:text-sky-300"
          >
            {t.logs} →
          </Link>
        </div>
      </div>
    </div>
  );
}
