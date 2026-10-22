"use client";

import { useEffect, useState } from "react";

/**
 * STATION ACTIVATION (Step B1, owner 2026-10-11) — desktop app only. A computer that is NOT yet the main station of a
 * branch shows "Activate this station": Station ID + 6-digit code (from the Control Room). On success:
 *   1. the server binds THIS computer to that branch as its main station (code burned; another branch's station is
 *      never moved — the Lenovo is protected server-side);
 *   2. MAIN's config gets the branch (saveConfig) + a fresh desktop token for that branch (applyDesktopAuth);
 *   3. MAIN reconnects into the new branch room (connectCloud) → designated MAIN station of its branch;
 *   4. the screen reloads → every live channel of the screen joins the same branch (lib/station-branch.ts).
 * A designated station (the Lenovo) never sees this. "Not now" hides it until VONO restarts. Browsers: renders nothing.
 */
const DISMISS_KEY = "vono-station-activation-not-now";

type Phase = "hidden" | "form" | "working" | "done";

export function StationActivationGate() {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [stationId, setStationId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [doneText, setDoneText] = useState("");

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.syncbizDesktop : undefined;
    if (!bridge?.getConfig || !bridge.saveConfig || !bridge.connectCloud || !bridge.applyDesktopAuth) return;
    try { if (sessionStorage.getItem(DISMISS_KEY) === "1") return; } catch { /* ignore */ }
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await bridge.getConfig();
        const id = cfg?.deviceId?.trim();
        if (!id || cancelled) return;
        const res = await fetch(`/api/stations/activate?deviceId=${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store" });
        if (!res.ok || cancelled) return; // not signed in / offline → never block the screen
        const d = (await res.json()) as { designated?: boolean };
        if (d.designated === false && !cancelled) { setDeviceId(id); setPhase("form"); }
      } catch { /* offline → nothing */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (phase === "hidden") return null;

  const activate = async () => {
    const bridge = window.syncbizDesktop;
    if (!bridge?.saveConfig || !bridge.connectCloud || !bridge.applyDesktopAuth || !deviceId) return;
    setPhase("working");
    setError(null);
    try {
      const res = await fetch("/api/stations/activate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationId, code, deviceId }),
      });
      const d = (await res.json().catch(() => ({}))) as { branchId?: string; branchName?: string; stationId?: string; error?: string };
      if (!res.ok || !d.branchId) { setError(d.error ?? `Could not activate (HTTP ${res.status}).`); setPhase("form"); return; }
      await bridge.saveConfig({ branchId: d.branchId });
      const t = await fetch("/api/auth/desktop/token-from-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, branchId: d.branchId, platform: "desktop" }),
      });
      const tok = (await t.json().catch(() => ({}))) as { token?: string; expiresAt?: string };
      if (t.ok && tok.token) await bridge.applyDesktopAuth({ token: tok.token, expiresAtIso: tok.expiresAt });
      await bridge.connectCloud();
      setDoneText(`${d.branchName ?? "Branch"} · ${d.stationId ?? stationId}`);
      setPhase("done");
      window.setTimeout(() => window.location.reload(), 2000);
    } catch {
      setError("Could not reach the server. Check the internet connection and try again.");
      setPhase("form");
    }
  };

  const notNow = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setPhase("hidden");
  };

  const input = "mt-1 w-full rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2.5 text-base text-white placeholder:text-white/30 focus:border-[#0a84ff] focus:outline-none";
  const ready = stationId.trim().length >= 3 && /^\d{6}$/.test(code.trim());

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Activate this station">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141416] p-6 text-white shadow-2xl">
        {phase === "done" ? (
          <div className="py-4 text-center">
            <div className="text-3xl">✓</div>
            <h2 className="mt-2 text-lg font-semibold">Station activated</h2>
            <p className="mt-1 text-sm text-white/60" dir="auto">{doneText}</p>
            <p className="mt-3 text-xs text-white/40">Connecting…</p>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Activate this station</h2>
            <p className="mt-1 text-sm text-white/60">Enter the Station ID and the 6-digit code from the Control Room.</p>
            <label className="mt-5 block">
              <span className="text-xs text-white/50">Station ID</span>
              <input value={stationId} onChange={(e) => setStationId(e.target.value.toUpperCase())} placeholder="e.g. UNV-094" autoFocus spellCheck={false} disabled={phase === "working"} className={input} />
            </label>
            <label className="mt-3 block">
              <span className="text-xs text-white/50">Activation code</span>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 digits" inputMode="numeric" disabled={phase === "working"} className={`${input} tracking-[0.3em]`} />
            </label>
            {error ? <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200" role="alert">{error}</p> : null}
            <div className="mt-6 flex items-center justify-between gap-3">
              <button type="button" onClick={notNow} disabled={phase === "working"} className="text-sm text-white/50 hover:text-white">Not now</button>
              <button type="button" onClick={() => void activate()} disabled={!ready || phase === "working"} className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-transform active:scale-95 disabled:opacity-40">
                {phase === "working" ? "Activating…" : "Activate"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
