import Link from "next/link";
import { DenseDataRowSurface } from "@/components/player-surface/dense-data-row-surface";
import {
  DENSE_ADMIN_DEVICES_TABLE_HEADER_CLASS,
  DENSE_ADMIN_DEVICES_TABLE_ROW_GRID_CLASS,
} from "@/lib/player-surface/dense-data-row-constants";
import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import type { Device, Source } from "@/lib/types";

async function getData(): Promise<{ devices: Device[]; sources: Source[] }> {
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
    return {
      devices: Array.isArray(devices) ? devices : [],
      sources: Array.isArray(sources) ? sources : [],
    };
  } catch (e) {
    console.error("[devices] getData error:", e);
    return { devices: [], sources: [] };
  }
}

export default async function DevicesPage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const { devices, sources } = await getData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">{t.devices}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {t.devicesSubtitle}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/50">
        <div className={DENSE_ADMIN_DEVICES_TABLE_HEADER_CLASS}>
          <div>{t.device}</div>
          <div>{t.playback}</div>
          <div>{t.platformHealth}</div>
          <div>{t.status}</div>
        </div>
        <div className="divide-y divide-slate-800/60">
          {devices.map((device) => {
            const source = sources.find((s) => s.id === device.currentSourceId);
            return (
              <DenseDataRowSurface
                key={device.id}
                gridClassName={DENSE_ADMIN_DEVICES_TABLE_ROW_GRID_CLASS}
                cells={[
                  <div key="device">
                    <Link
                      href={`/devices/${device.id}`}
                      className="font-medium text-slate-100 hover:text-sky-300"
                    >
                      {device.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {device.type.replace("-", " ")} · {device.ipAddress}
                    </p>
                  </div>,
                  <div key="playback">
                    <p className="text-slate-200">{source ? source.name : t.idle}</p>
                    <p className="text-xs text-slate-500">
                      {t.vol} {device.volume}
                    </p>
                  </div>,
                  <div key="health">
                    <p className="text-slate-200 capitalize">{device.platform}</p>
                    <p className="text-xs text-slate-500 capitalize">{device.health}</p>
                  </div>,
                  <div key="status" className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        device.status === "online"
                          ? "bg-emerald-400"
                          : device.status === "maintenance"
                            ? "bg-amber-400"
                            : "bg-slate-500"
                      }`}
                    />
                    <span className="capitalize text-slate-200">
                      {device.status === "online"
                        ? t.online
                        : device.status === "offline"
                          ? t.offline
                          : t.maintenance}
                    </span>
                  </div>,
                ]}
              />
            );
          })}
        </div>
        {devices.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-500">
            {t.noDevicesYetAdd}
          </div>
        )}
      </div>
    </div>
  );
}
