"use client";

import { useEffect } from "react";
import { getDeviceId, initDeviceId } from "@/lib/device-id";
import { usePlayback } from "@/lib/playback-provider";
import { useRemoteControlWs } from "@/lib/remote-control/ws-client";
import { urlToUnifiedSource } from "@/lib/remote-control/url-to-source";
import type { RemoteCommand } from "@/lib/remote-control/types";

export function RemotePlayerPage() {
  const { play, pause, playSource } = usePlayback();
  const deviceId = getDeviceId();

  const { status } = useRemoteControlWs("device", deviceId, (cmd) => {
    const command = cmd.command as RemoteCommand;
    if (command === "PLAY") {
      play();
    } else if (command === "PAUSE") {
      pause();
    } else if (command === "LOAD_PLAYLIST" && cmd.payload?.url) {
      const source = urlToUnifiedSource(cmd.payload.url);
      playSource(source);
    }
  });

  useEffect(() => {
    initDeviceId();
  }, []);

  const statusColor =
    status === "connected"
      ? "bg-emerald-500/20 text-emerald-400"
      : status === "connecting"
        ? "bg-amber-500/20 text-amber-400"
        : "bg-slate-500/20 text-slate-400";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">Remote Player</h1>
        <p className="mt-1 text-sm text-slate-400">
          This device is ready for remote control. Open the controller to send commands.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Device ID</p>
            <p className="mt-1 font-mono text-sm text-slate-200 break-all">{deviceId}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Status</p>
            <p className={`mt-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
              {status}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
