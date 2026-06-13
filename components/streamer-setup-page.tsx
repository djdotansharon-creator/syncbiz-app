"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { initDeviceId, getDeviceId } from "@/lib/device-id";
import {
  clearStreamerDeviceCredentials,
  hasStreamerDeviceToken,
  persistStreamerDeviceCredentials,
} from "@/lib/streamer-device-client";
import { persistStreamerDeviceFlag } from "@/lib/streamer-device-mode";

type PairingState = {
  code: string;
  expiresAt: string;
  deviceId: string;
};

export function StreamerSetupPage() {
  const router = useRouter();
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Starting pairing…");

  useEffect(() => {
    persistStreamerDeviceFlag();
    if (hasStreamerDeviceToken()) {
      router.replace("/streamer?device=streamer&mode=player");
      return;
    }

    const deviceId = initDeviceId();
    fetch("/api/streamer/pairing/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Could not start pairing");
        }
        return r.json() as Promise<PairingState>;
      })
      .then((data) => {
        setPairing(data);
        setStatusText("Waiting for admin to pair this device…");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Pairing failed");
      });
  }, [router]);

  useEffect(() => {
    if (!pairing?.deviceId) return;
    let cancelled = false;

    const poll = () => {
      fetch(`/api/streamer/pairing/status?deviceId=${encodeURIComponent(pairing.deviceId)}`)
        .then((r) => r.json())
        .then(
          async (data: {
            status?: string;
            deviceToken?: string;
            branchId?: string;
            error?: string;
          }) => {
            if (cancelled) return;
            if (data.status === "paired" && data.deviceToken) {
              persistStreamerDeviceCredentials(data.deviceToken, data.branchId ?? "default");
              await fetch("/api/streamer/auth/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deviceToken: data.deviceToken }),
              }).catch(() => undefined);
              router.replace("/streamer?device=streamer&mode=player");
              return;
            }
            if (data.status === "paired") {
              setStatusText("Already paired — opening player…");
              router.replace("/streamer?device=streamer&mode=player");
              return;
            }
            if (data.status === "revoked") {
              clearStreamerDeviceCredentials();
              await fetch("/api/streamer/auth/session", { method: "DELETE" }).catch(() => undefined);
              setError("This device was revoked. Ask an admin to pair again.");
              return;
            }
            if (data.status === "expired") {
              setError("Pairing code expired. Refresh this page.");
            }
          },
        )
        .catch(() => {
          if (!cancelled) setStatusText("Reconnecting…");
        });
    };

    poll();
    const id = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pairing, router]);

  const refreshPairing = useCallback(() => {
    setError(null);
    setPairing(null);
    setStatusText("Starting pairing…");
    const deviceId = getDeviceId();
    fetch("/api/streamer/pairing/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Could not start pairing");
        }
        return r.json() as Promise<PairingState>;
      })
      .then((data) => {
        setPairing(data);
        setStatusText("Waiting for admin to pair this device…");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Pairing failed");
      });
  }, []);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-xl flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-400/90">SyncBiz Branch Player</p>
        <h1 className="text-2xl font-bold text-slate-50">Pair this streamer</h1>
        <p className="text-sm text-slate-400">
          On your phone or desktop, open Settings → Branch streamer and enter the code below.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-950/70 px-6 py-8 text-center">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Pairing code</p>
        <p className="mt-3 font-mono text-5xl font-bold tracking-[0.35em] text-sky-300">
          {pairing?.code ?? "······"}
        </p>
        {pairing?.expiresAt ? (
          <p className="mt-3 text-xs text-slate-500">
            Expires {new Date(pairing.expiresAt).toLocaleTimeString()}
          </p>
        ) : null}
        <p className="mt-4 text-sm text-slate-400">{statusText}</p>
        {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
        {error ? (
          <button
            type="button"
            onClick={refreshPairing}
            className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            New code
          </button>
        ) : null}
      </section>

      <footer className="text-[11px] text-slate-600">
        <p>Device id: {pairing?.deviceId ?? getDeviceId()}</p>
        <p className="mt-1">Pair while logged in as the account that controls this branch.</p>
      </footer>
    </div>
  );
}
