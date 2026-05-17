import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import type { Device, LogEntry } from "@/lib/types";

async function getData(): Promise<{ logs: LogEntry[]; devices: Device[] }> {
  try {
    const base = getApiBase();
    const [logsRes, devicesRes] = await Promise.all([
      fetch(`${base}/api/logs`, { cache: "no-store" }),
      fetch(`${base}/api/devices`, { cache: "no-store" }),
    ]);
    const [logs, devices] = (await Promise.all([
      logsRes.ok ? logsRes.json() : [],
      devicesRes.ok ? devicesRes.json() : [],
    ])) as [LogEntry[], Device[]];
    return {
      logs: Array.isArray(logs) ? logs : [],
      devices: Array.isArray(devices) ? devices : [],
    };
  } catch (e) {
    console.error("[logs] getData error:", e);
    return { logs: [], devices: [] };
  }
}

export default async function LogsPage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const { logs, devices } = await getData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">{t.logs}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {t.logsSubtitle}
        </p>
      </div>

      <div className="space-y-2">
        {logs.length === 0 ? (
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 py-12 text-center text-sm text-slate-500">
            {t.noLogEntriesYet}
          </div>
        ) : (
          logs.map((log) => {
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
                className="flex gap-3 rounded-xl border border-slate-800/60 bg-slate-950/50 px-4 py-3 text-sm"
              >
                <span
                  className={`shrink-0 self-start rounded-full border px-2 py-0.5 text-[10px] font-medium ${levelStyles}`}
                >
                  {log.level.toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-slate-200">{log.message}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>
                      {new Date(log.timestamp).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {device && (
                      <span className="rounded-full bg-slate-800 px-2 py-0.5">
                        {device.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
