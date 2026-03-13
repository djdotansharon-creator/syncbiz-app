import { Suspense } from "react";
import { getApiBase } from "@/lib/api-base";
import type { Device } from "@/lib/types";
import { PlayerPage } from "@/components/player-page";
import { PlaybackBar } from "@/components/playback-bar";

async function getDevices(): Promise<Device[]> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/devices`, { cache: "no-store" });
    if (!res.ok) {
      console.error("[player] API error:", res.status, await res.text());
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[player] getDevices error:", e);
    return [];
  }
}

export default async function PlayerRoutePage() {
  const devices = await getDevices();
  return (
    <>
      <div className="pb-48">
        <Suspense fallback={<div className="mx-auto max-w-2xl rounded-2xl border border-slate-800/80 bg-slate-950/60 p-12 text-center text-slate-500">Loading player…</div>}>
          <PlayerPage devices={devices} />
        </Suspense>
      </div>
      <PlaybackBar />
    </>
  );
}
