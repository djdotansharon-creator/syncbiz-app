import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import type {
  Announcement,
  Device,
  LogEntry,
  Schedule,
} from "@/lib/types";

async function getDashboardData() {
  const base = getApiBase();
  const [devicesRes, schedulesRes, announcementsRes, logsRes] =
    await Promise.all([
      fetch(`${base}/api/devices`, { cache: "no-store" }),
      fetch(`${base}/api/schedules`, { cache: "no-store" }),
      fetch(`${base}/api/announcements`, { cache: "no-store" }),
      fetch(`${base}/api/logs`, { cache: "no-store" }),
    ]);

  const [devices, schedules, announcements, logs] = (await Promise.all([
    devicesRes.json(),
    schedulesRes.json(),
    announcementsRes.json(),
    logsRes.json(),
  ])) as [Device[], Schedule[], Announcement[], LogEntry[]];

  return { devices, schedules, announcements, logs };
}

export default async function DashboardPage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const { devices, schedules, announcements, logs } =
    await getDashboardData();

  const onlineDevices = devices.filter((d) => d.status === "online").length;
  const todayDayIndex = new Date().getDay();
  const scheduledToday = schedules.filter((s) =>
    s.daysOfWeek.includes(todayDayIndex),
  ).length;
  const pendingAnnouncements = announcements.filter(
    (a) => a.status === "draft" || a.status === "scheduled",
  ).length;
  const latestLogs = logs.slice(0, 8);
  const healthOk = devices.filter((d) => d.health === "ok").length;
  const healthTotal = devices.length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">{t.dashboard}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {t.dashboardOverview}
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t.onlineDevices}
          value={onlineDevices}
          hint={`${devices.length} ${t.total}`}
        />
        <KpiCard
          label={t.scheduledToday}
          value={scheduledToday}
          hint={t.activeTimeBlocks}
        />
        <KpiCard
          label={t.pendingAnnouncements}
          value={pendingAnnouncements}
          hint={t.draftOrScheduled}
        />
        <KpiCard
          label={t.deviceHealth}
          value={healthTotal > 0 ? `${healthOk}/${healthTotal} ${t.ok}` : "—"}
          hint={t.agentsReporting}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr,1fr]">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <h2 className="text-sm font-semibold text-slate-50">
            {t.recentActivity}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {t.playbackAndControlEvents}
          </p>
          <div className="mt-4 space-y-2">
            {latestLogs.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                {t.noRecentActivity}
              </p>
            ) : (
              latestLogs.map((log) => {
                const levelColor =
                  log.level === "error"
                    ? "bg-rose-500/80"
                    : log.level === "warning"
                      ? "bg-amber-400/80"
                      : "bg-sky-500/80";
                return (
                  <div
                    key={log.id}
                    className="flex gap-3 rounded-xl border border-slate-800/60 bg-slate-900/40 px-3 py-2.5 text-sm"
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${levelColor}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-slate-200">{log.message}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {new Date(log.timestamp).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <h2 className="text-sm font-semibold text-slate-50">
            {t.deviceHealthSummary}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {t.statusOfConnectedAgents}
          </p>
          <div className="mt-4 space-y-3">
            {devices.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">
                {t.noDevicesYet}
              </p>
            ) : (
              devices.slice(0, 6).map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-900/40 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      {d.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {d.platform} · v{d.agentVersion}
                    </p>
                  </div>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      d.status === "online"
                        ? "bg-emerald-400"
                        : d.status === "maintenance"
                          ? "bg-amber-400"
                          : "bg-slate-500"
                    }`}
                    title={d.status === "online" ? t.online : d.status === "offline" ? t.offline : t.maintenance}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-50">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
