"use client";

import { useCallback, useEffect, useState } from "react";

type StreamerDeviceRow = {
  id: string;
  deviceId: string;
  branchId: string;
  label: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function StreamerDeviceSettingsPanel() {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [devices, setDevices] = useState<StreamerDeviceRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDevices = useCallback(() => {
    fetch("/api/streamer/devices")
      .then(async (r) => {
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Could not load devices");
        }
        return r.json() as Promise<{ devices?: StreamerDeviceRow[] }>;
      })
      .then((data) => setDevices(data.devices ?? []))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Load failed");
      });
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const claimCode = async () => {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const r = await fetch("/api/streamer/pairing/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), label: label.trim() || undefined }),
      });
      const data = (await r.json()) as { error?: string; deviceId?: string };
      if (!r.ok) throw new Error(data.error ?? "Pairing failed");
      setMessage("Streamer paired. The TV should connect within a few seconds.");
      setCode("");
      loadDevices();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Pairing failed");
    } finally {
      setLoading(false);
    }
  };

  const revokeDevice = async (deviceId: string) => {
    setError(null);
    setMessage(null);
    const r = await fetch("/api/streamer/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    const data = (await r.json()) as { error?: string };
    if (!r.ok) {
      setError(data.error ?? "Revoke failed");
      return;
    }
    setMessage("Device revoked.");
    loadDevices();
  };

  const activeDevices = devices.filter((d) => !d.revokedAt);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className="block text-xs text-slate-500" htmlFor="streamer-pair-code">
            Pairing code (from TV)
          </label>
          <input
            id="streamer-pair-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 font-mono text-sm uppercase tracking-widest text-slate-100 outline-none focus:border-sky-600"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500" htmlFor="streamer-pair-label">
            Label (optional)
          </label>
          <input
            id="streamer-pair-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Lobby GOtv"
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-600"
          />
        </div>
        <button
          type="button"
          disabled={loading || code.trim().length < 6}
          onClick={() => void claimCode()}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          Pair streamer
        </button>
      </div>

      {message ? <p className="text-xs text-emerald-400">{message}</p> : null}
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}

      <div>
        <h3 className="text-xs font-semibold text-slate-300">Paired streamers</h3>
        {activeDevices.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No active streamer devices.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {activeDevices.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800/70 bg-slate-900/40 px-3 py-2"
              >
                <div>
                  <p className="text-sm text-slate-200">{d.label ?? "Branch streamer"}</p>
                  <p className="font-mono text-[11px] text-slate-500">{d.deviceId.slice(0, 8)}…</p>
                  <p className="text-[11px] text-slate-600">
                    Last seen: {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "never"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void revokeDevice(d.deviceId)}
                  className="rounded-md border border-rose-900/60 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950/40"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-slate-600">
        Open <span className="font-mono text-slate-500">/streamer/setup</span> on the TV to show a new code.
        Pair using the same account you use to control playback.
      </p>
    </div>
  );
}
