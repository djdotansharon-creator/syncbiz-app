"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * CONTROL ROOM — station activation for one branch (owner; Step A = management side only).
 * Station ID ("<network code>-<branch number>") + a one-time 6-digit code: random, valid 60 minutes, single use, shown
 * ONCE (only its hash is stored; it can never be shown again). "Replace main station" creates a NEW code — the current
 * station keeps playing until a new computer is activated with it (Step B). A new code revokes the previous one.
 */

type Status = { stationId: string | null; networkCodeSet: boolean; active: { expiresAt: string; purpose: string } | null };
type Fresh = { stationId: string; code: string; expiresAt: string; purpose: string };

function useCountdown(iso: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "expired";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function StationActivation({ branchId, hasMainStation }: { branchId: string; hasMainStation: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = `/api/control-room/branches/${encodeURIComponent(branchId)}/activation-code`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as Status & { error?: string };
      if (!res.ok) { setError(data.error ?? "Could not load the activation status."); return; }
      setStatus(data);
    } catch {
      setError("Could not reach the server.");
    }
  }, [url]);
  useEffect(() => { setFresh(null); setError(null); void load(); }, [load]);

  const generate = async () => {
    setBusy(true); setError(null); setCopied(false);
    try {
      const res = await fetch(url, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as Fresh & { error?: string };
      if (!res.ok) { setError(data.error ?? "Could not create a code."); return; }
      setFresh(data);
      void load();
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    setBusy(true); setError(null);
    try {
      await fetch(url, { method: "DELETE" });
      setFresh(null);
      void load();
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(`Station ID: ${fresh.stationId}\nActivation code: ${fresh.code}`);
      setCopied(true);
    } catch { /* clipboard blocked — the code is on screen */ }
  };

  const freshLeft = useCountdown(fresh?.expiresAt ?? null);
  const activeLeft = useCountdown(!fresh && status?.active ? status.active.expiresAt : null);
  const showFresh = fresh && freshLeft !== "expired";

  return (
    <section className="border-t border-[color:var(--sb-border)] px-6 py-5">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--sb-text-tertiary)]">Station activation</div>
        {status?.stationId ? <div className="font-mono text-sm tracking-wide text-[var(--sb-text)]">{status.stationId}</div> : null}
      </div>

      {status && !status.networkCodeSet ? (
        <p className="mt-3 text-sm text-[var(--sb-text-secondary)]">Set your network code (top of the Control Room) to create Station IDs.</p>
      ) : showFresh ? (
        <div className="mt-3 rounded-xl border border-[color:var(--sb-accent-border)] bg-[var(--sb-accent-soft)] p-4">
          <div className="text-xs text-[var(--sb-text-secondary)]">
            {fresh!.purpose === "replace" ? "Code to replace the main station" : "Code to install the station"} · shown only now
          </div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div>
              <div className="font-mono text-3xl font-bold tracking-[0.3em] text-[var(--sb-text)]">{fresh!.code}</div>
              <div className="mt-1 text-xs text-[var(--sb-text-tertiary)]">Station ID {fresh!.stationId} · valid {freshLeft} · single use</div>
            </div>
            <button type="button" onClick={() => void copy()} className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black active:scale-95">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : status?.active && activeLeft !== "expired" ? (
        <p className="mt-3 text-sm text-[var(--sb-text-secondary)]">
          An activation code is active ({activeLeft} left). It cannot be shown again. Create a new one if needed.
        </p>
      ) : (
        <p className="mt-3 text-sm text-[var(--sb-text-secondary)]">
          {hasMainStation ? "This branch has a main station." : "No station installed yet."}
        </p>
      )}

      {status?.networkCodeSet && status.stationId ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="rounded-full border border-[color:var(--sb-border-strong)] px-4 py-1.5 text-sm text-[var(--sb-text)] hover:bg-white/[0.06] disabled:opacity-40"
          >
            {hasMainStation ? "Replace main station" : status.active || fresh ? "New code" : "Create activation code"}
          </button>
          {status.active || showFresh ? (
            <button type="button" disabled={busy} onClick={() => void revoke()} className="rounded-full px-3 py-1.5 text-sm text-[var(--sb-text-tertiary)] hover:text-[var(--sb-text)] disabled:opacity-40">
              Cancel code
            </button>
          ) : null}
        </div>
      ) : status && status.networkCodeSet && !status.stationId ? (
        <p className="mt-3 text-sm text-[var(--sb-text-secondary)]">Add a branch number (Edit) to create its Station ID.</p>
      ) : null}

      {hasMainStation && (status?.active || showFresh) ? (
        <p className="mt-3 text-xs text-[var(--sb-text-tertiary)]">The current station keeps playing until a new computer is activated with this code.</p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-amber-200" role="alert">{error}</p> : null}
    </section>
  );
}
