"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlaybackControls } from "@/components/playback-controls";
import { usePlayback } from "@/lib/playback-context";
import type { Device, Source } from "@/lib/types";

type DevicePlaybackCardProps = {
  device: Device;
  source: Source | null;
};

export function DevicePlaybackCard({ device, source }: DevicePlaybackCardProps) {
  const router = useRouter();
  const { setLastMessage } = usePlayback();
  const [volume, setVolume] = useState(device.volume ?? 50);

  async function handlePlay() {
    if (source) {
      const target = (source.target ?? source.uriOrPath ?? "").trim();
      if (target) {
        setLastMessage(null);
        const res = await fetch("/api/commands/play-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            browserPreference: source.browserPreference ?? "default",
          }),
        });
        setLastMessage(res.ok ? "Local playback command sent" : `Failed: ${(await res.json().catch(() => ({}))).error ?? "Unknown error"}`);
      }
      router.refresh();
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5">
      <h2 className="text-sm font-semibold text-slate-50">Playback</h2>
      <p className="mt-1 text-slate-200">
        {source ? source.name : "Idle"}
      </p>
      {source && (
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {source.target ?? source.uriOrPath}
        </p>
      )}
      <div className="mt-4">
        <PlaybackControls
          onPlay={handlePlay}
          onPause={() => {}}
          onStop={() => {}}
          volume={volume}
          onVolumeChange={setVolume}
          compact
          disabled={!source}
        />
      </div>
    </div>
  );
}
