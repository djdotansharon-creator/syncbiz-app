import Link from "next/link";
import { notFound } from "next/navigation";
import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import type { Device, Source } from "@/lib/types";
import { DevicePlaybackCard } from "@/components/device-playback-card";

async function getDevice(deviceId: string): Promise<{
  device: Device | null;
  source: Source | null;
}> {
  try {
    const base = getApiBase();
    const [devicesRes, sourcesRes] = await Promise.all([
      fetch(`${base}/api/devices`, { cache: "no-store" }),
      fetch(`${base}/api/sources`, { cache: "no-store" }),
    ]);
    const [devices, sources] = (await Promise.all([
      devicesRes.ok ? devicesRes.json() : [],
      sourcesRes.ok ? sourcesRes.json() : [],
    ])) as [Device[], Source[]];
    const devs = Array.isArray(devices) ? devices : [];
    const srcs = Array.isArray(sources) ? sources : [];
    const device = devs.find((d) => d.id === deviceId) ?? null;
    const source = device?.currentSourceId
      ? srcs.find((s) => s.id === device.currentSourceId) ?? null
      : null;
    return { device, source };
  } catch (e) {
    console.error("[devices/[deviceId]] getDevice error:", e);
    return { device: null, source: null };
  }
}

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = await params;
  const locale = await getLocale();
  const t = getTranslations(locale);
  const { device, source } = await getDevice(deviceId);
  if (!device) notFound();

  const statusLabel =
    device.status === "online"
      ? t.online
      : device.status === "offline"
        ? t.offline
        : t.maintenance;
  const healthLabel =
    device.health === "ok"
      ? t.ok
      : device.health === "degraded"
        ? t.degraded
        : t.error;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-slate-500">
          <Link href="/devices" className="hover:text-sky-400">
            {t.devicesBreadcrumb}
          </Link>
          {" / "}
          {device.name}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-50">
          {device.name}
        </h1>
        <p className="text-sm text-slate-400">
          {device.type.replace("-", " ")} · {device.platform} ·{" "}
          {device.ipAddress}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <DevicePlaybackCard device={device} source={source} />
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
          <h2 className="text-sm font-semibold text-slate-50">{t.health}</h2>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                device.status === "online"
                  ? "bg-emerald-400"
                  : device.status === "maintenance"
                    ? "bg-amber-400"
                    : "bg-slate-500"
              }`}
            />
            <span className="capitalize text-slate-200">{statusLabel}</span>
            <span className="text-slate-500">·</span>
            <span className="capitalize text-slate-400">{healthLabel}</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {t.lastHeartbeat}:{" "}
            {new Date(device.lastHeartbeat).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Agent v{device.agentVersion}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
        <h2 className="text-sm font-semibold text-slate-50">{t.capabilities}</h2>
        <p className="mt-2 text-xs text-slate-400">
          {device.capabilities.join(", ")}
        </p>
      </div>
    </div>
  );
}
