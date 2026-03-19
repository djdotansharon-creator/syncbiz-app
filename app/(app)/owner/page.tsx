"use client";

import { useState } from "react";
import Link from "next/link";
import { useRemoteOwner } from "@/lib/remote-control/ws-client";

export default function OwnerControlPage() {
  const {
    branches,
    selectedBranchId,
    setSelectedBranchId,
    selectedBranch,
    remoteState,
    status,
    sendCommand,
    refreshBranchList,
  } = useRemoteOwner();
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
        <h1 className="text-xl font-semibold text-slate-50">Owner Control</h1>
        <p className="mt-1 text-sm text-slate-400">
          Control branch players from anywhere. No local Wi-Fi required.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
            {status}
          </span>
          <div className="flex gap-2">
            <button
              onClick={refreshBranchList}
              disabled={status !== "connected"}
              className="rounded-lg border border-slate-700/80 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700/80 disabled:opacity-50"
            >
              Refresh
            </button>
            <Link href="/remote-player" className="text-xs text-sky-400 hover:text-sky-300">
              Open player →
            </Link>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-500">
              Target branch
            </label>
            <select
              value={selectedBranchId ?? ""}
              onChange={(e) => setSelectedBranchId(e.target.value || null)}
              disabled={status !== "connected"}
              className="mt-1 w-full rounded-lg border border-slate-700/80 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-50"
            >
              <option value="">Select branch</option>
              {branches.map((b) => (
                <option key={b.branchId} value={b.branchId}>
                  {b.branchName ?? b.branchId} {b.masterDeviceId ? ` (${b.masterDeviceId.slice(0, 8)}…)` : ""}
                </option>
              ))}
              {branches.length === 0 && status === "connected" && (
                <option value="" disabled>No branches with connected players</option>
              )}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {selectedBranch
                ? `Master: ${selectedBranch.masterDeviceId.slice(0, 12)}…`
                : "Connect a player at a branch first."}
            </p>
          </div>

          {remoteState && (
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-3">
              <p className="text-xs text-slate-500">Now playing</p>
              <p className="text-sm font-medium text-slate-200">
                {remoteState.currentTrack?.title ?? remoteState.currentSource?.title ?? "—"}
              </p>
              <p className="text-xs text-slate-400">{remoteState.status}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => sendCommand("PLAY")}
              disabled={!selectedBranchId || status !== "connected"}
              className="rounded-lg border border-slate-700/80 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700/80 disabled:opacity-50"
            >
              Play
            </button>
            <button
              onClick={() => sendCommand("PAUSE")}
              disabled={!selectedBranchId || status !== "connected"}
              className="rounded-lg border border-slate-700/80 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700/80 disabled:opacity-50"
            >
              Pause
            </button>
            <button
              onClick={() => sendCommand("STOP")}
              disabled={!selectedBranchId || status !== "connected"}
              className="rounded-lg border border-slate-700/80 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700/80 disabled:opacity-50"
            >
              Stop
            </button>
            <button
              onClick={() => sendCommand("NEXT")}
              disabled={!selectedBranchId || status !== "connected"}
              className="rounded-lg border border-slate-700/80 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700/80 disabled:opacity-50"
            >
              Next
            </button>
            <button
              onClick={() => sendCommand("PREV")}
              disabled={!selectedBranchId || status !== "connected"}
              className="rounded-lg border border-slate-700/80 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700/80 disabled:opacity-50"
            >
              Prev
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
                onClick={() => {
                  if (loadUrl.trim()) sendCommand("LOAD_PLAYLIST", { url: loadUrl.trim() });
                }}
                disabled={!selectedBranchId || status !== "connected"}
                className="rounded-lg border border-sky-500/50 bg-sky-600/20 px-4 py-2 text-sm font-medium text-sky-200 hover:bg-sky-600/30 disabled:opacity-50"
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
