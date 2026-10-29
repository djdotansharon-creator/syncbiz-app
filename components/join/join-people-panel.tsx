"use client";

/**
 * "People joining" — the owner's side of join-by-code (docs/ACCOUNTS_JOIN_DESIGN.md): make a one-time code, see who asked to join, approve with a role or reject.
 * Shown at the top of Access Control. It draws NOTHING unless the feature is on (SYNCBIZ_JOIN_BY_CODE=1) and the caller is a workspace admin — a flag-off server answers `enabled:false`.
 * Calm: one read on open, one on window focus, and every 30 s while the page is visible; no flood. Stage 3 moves this into the Control Room "people" icon.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";

type Req = { id: string; email: string; firstName: string; lastName: string; phone: string; hasAccount: boolean; requestedAt: string; expiresAt: string };
type Role = "MANAGER" | "MEMBER";

const ERRORS: Record<string, string> = {
  limit: "This business has no room for more people. Free a seat or raise the limit first.",
  not_pending: "This request was already handled.",
  too_many_codes: "There are already 10 unused codes. Wait for one to expire.",
};

function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function JoinPeoplePanel() {
  const tr = useTr();
  const [enabled, setEnabled] = useState(false);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/join/requests", { credentials: "include", cache: "no-store" });
      if (!r.ok) return; // not an admin / not signed in: stay hidden
      const j = (await r.json()) as { enabled?: boolean; requests?: Req[] };
      if (!alive.current) return;
      setEnabled(Boolean(j.enabled));
      setReqs(j.requests ?? []);
    } catch {
      /* offline — keep what is shown */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(t);
    };
  }, [load]);

  // the countdown ticks only while a code is on screen
  useEffect(() => {
    if (!code) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [code]);

  async function makeCode() {
    setBusy("code");
    setError("");
    try {
      const r = await fetch("/api/join/codes", { method: "POST", credentials: "include" });
      const j = (await r.json().catch(() => ({}))) as { code?: string; expiresAt?: string; error?: string };
      if (!r.ok || !j.code || !j.expiresAt) {
        setError(tr(ERRORS[j.error ?? ""] ?? "Something went wrong. Please try again."));
        return;
      }
      setCode({ code: j.code, expiresAt: new Date(j.expiresAt).getTime() });
      setNow(Date.now());
      setCopied(false);
    } catch {
      setError(tr("Something went wrong. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    setError("");
    try {
      const r = await fetch(`/api/join/requests/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, role: roles[id] ?? "MEMBER" }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(tr(ERRORS[j.error ?? ""] ?? "Something went wrong. Please try again."));
      }
      await load();
    } catch {
      setError(tr("Something went wrong. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
    } catch {
      /* clipboard blocked — the code is on screen anyway */
    }
  }

  if (!enabled) return null;
  const left = code ? code.expiresAt - now : 0;
  const live = code && left > 0;

  return (
    <section className="mb-5 rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5" aria-label={tr("People joining")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">{tr("People joining")}</h2>
        <button
          type="button"
          onClick={() => void makeCode()}
          disabled={busy === "code"}
          className="rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-60"
        >
          {tr("Create join code")}
        </button>
      </div>

      {live ? (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl bg-white/[0.06] px-5 py-4">
          <span className="font-mono text-3xl font-semibold tracking-[0.16em]" dir="ltr">{code.code}</span>
          <button type="button" onClick={() => void copy()} className="text-xs font-medium text-slate-300 underline-offset-4 hover:text-white hover:underline">
            {copied ? tr("Copied") : tr("Copy")}
          </button>
          <span className="ms-auto text-xs tabular-nums text-slate-400">{tr("Works once · expires in {t}", { t: fmtLeft(left) })}</span>
        </div>
      ) : null}

      <div className="mt-4">
        <div className="text-xs font-medium text-slate-400">{tr("Waiting for approval")}</div>
        {reqs.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">{tr("No one is waiting.")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5">
            {reqs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.firstName} {r.lastName}</div>
                  <div className="truncate text-xs text-slate-400" dir="ltr" style={{ textAlign: "start" }}>
                    {r.email}{r.phone ? ` · ${r.phone}` : ""}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{r.hasAccount ? tr("Already has an account") : tr("New account")}</div>
                </div>
                <select
                  value={roles[r.id] ?? "MEMBER"}
                  onChange={(e) => setRoles((s) => ({ ...s, [r.id]: e.target.value as Role }))}
                  className="rounded-full border-0 bg-white/10 px-3 py-1.5 text-xs text-white outline-none"
                  aria-label={tr("Role")}
                >
                  <option value="MEMBER" className="text-slate-900">{tr("Member")}</option>
                  <option value="MANAGER" className="text-slate-900">{tr("Manager")}</option>
                </select>
                <button type="button" onClick={() => void decide(r.id, "approve")} disabled={busy === r.id} className="rounded-full bg-emerald-400/90 px-4 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:opacity-60">
                  {tr("Approve")}
                </button>
                <button type="button" onClick={() => void decide(r.id, "reject")} disabled={busy === r.id} className="text-xs font-medium text-slate-400 underline-offset-4 hover:text-white hover:underline disabled:opacity-60">
                  {tr("Reject")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? <p className="mt-3 text-xs text-red-400" role="alert">{error}</p> : null}
    </section>
  );
}
