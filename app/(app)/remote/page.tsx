"use client";

import { useState } from "react";
import Link from "next/link";
import { useRemoteController } from "@/lib/remote-control/ws-client";

export default function RemoteControllerPage() {
  const { devices, masterDeviceId, status, sendCommand } = useRemoteController();
  const [loadUrl, setLoadUrl] = useState("");

  const statusColor =
    status === "connected"
      ? "bg-emerald-500/20 text-emerald-400"
      : status === "connecting"
        ? "bg-amber-500/20 text-amber-400"
        : "bg-slate-500/20 text-slate-400";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">Remote Controller</h1>
        <p className="mt-1 text-sm text-slate-400">
          Select a device and send playback commands.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
            {status}
          </span>
          <Link href="/remote-player" className="text-xs text-sky-400 hover:text-sky-300">
            Open player device →
          </Link>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-500">
              Target (MASTER only)
            </label>
            <p className="mt-1 text-sm text-slate-300">
              {masterDeviceId ? (
                <>Controlling: {masterDeviceId.slice(0, 12)}…</>
              ) : (
                "No MASTER. Open Remote Player on a device and switch to MASTER."
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => masterDeviceId && sendCommand(masterDeviceId, "PLAY")}
              disabled={!masterDeviceId || status !== "connected"}
              className="rounded-lg border border-slate-700/80 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700/80 disabled:opacity-50"
            >
              Play
            </button>
            <button
              onClick={() => masterDeviceId && sendCommand(masterDeviceId, "PAUSE")}
              disabled={!masterDeviceId || status !== "connected"}
              className="rounded-lg border border-slate-700/80 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700/80 disabled:opacity-50"
            >
              Pause
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-500">
              Load playlist (URL)
            </label>
            <div className="mt-1 flex gap-2">
              <input
                type="url"
                value={loadUrl}
                onChange={(e) => setLoadUrl(e.target.value)}
                placeholder="https://..."
                className="flex-1 rounded-lg border border-slate-700/80 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
              <button
                onClick={() =>
                  masterDeviceId &&
                  loadUrl &&
                  sendCommand(masterDeviceId, "LOAD_PLAYLIST", { url: loadUrl })
                }
                disabled={!masterDeviceId || !loadUrl || status !== "connected"}
                className="rounded-lg border border-sky-500/50 bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-300 transition hover:bg-sky-500/30 disabled:opacity-50"
              >
                Load
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
