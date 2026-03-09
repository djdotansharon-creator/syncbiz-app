import { getApiBase } from "@/lib/api-base";
import type { Device } from "@/lib/types";
import { PlayerPage } from "@/components/player-page";

async function getDevices(): Promise<Device[]> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/devices`, { cache: "no-store" });
  return res.json();
}

export default async function PlayerRoutePage() {
  const devices = await getDevices();
  return <PlayerPage devices={devices} />;
}
