"use client";

import { useEffect, useMemo, useState } from "react";
import type { RemoteCommand } from "@/lib/remote-control/types";
import { DOT_FILL, type MapDotStatus } from "@/components/control-room/branch-map";

/**
 * CONTROL ROOM — Broadcast (owner-approved 2026-10-09): pick a jingle → pick one / several / all online branches → Send.
 * Each branch gets the EXISTING remote PLAY_INTERRUPT (the station ducks the music, plays the jingle, restores the
 * music — accepted jingle path). The server answers per branch: "Delivered to station" (handed to the station — NOT
 * "played") or "Not delivered". One unavailable branch never stops the others. Schedule / automation = later.
 * Recipients (owner 2026-10-11): the brand chosen at the top of the Control Room scopes the list (no brand = every
 * branch). "All" = EVERY branch of that scope: online ones get the command, offline / not installed ones are reported
 * "Not delivered" (no command sent). "Selected" = the checked online branches of that scope.
 */

type Jingle = { id: string; title: string; url: string; durationSec: number | null };

export type BroadcastTarget = {
  id: string;
  name: string;
  branchNumber: string | null;
  status: MapDotStatus;
  /** raw branch id the server routes on; present only while the station is online */
  liveBranchId: string | null;
  /** brand of the branch (the default Brand when unassigned) */
  brandId: string | null;
};

/** the brand chosen at the top of the Control Room (null = all brands) */
export type BroadcastScope = { name: string; color: string | null } | null;
type Mode = "all" | "selected";

type Result = { delivered: boolean; reason?: string };

const REASON_TEXT: Record<string, string> = {
  no_station: "Station not connected",
  not_authorized: "No permission for this branch",
  no_response: "No answer from the server",
  not_connected: "Control Room disconnected",
};

export function BroadcastPanel({
  targets,
  scope,
  onClose,
  sendCommandWithAck,
}: {
  /** the branches of the current scope (already filtered by the brand chosen at the top) */
  targets: BroadcastTarget[];
  scope: BroadcastScope;
  onClose: () => void;
  sendCommandWithAck: (targetBranchId: string, command: RemoteCommand, payload?: { url?: string }) => Promise<Result>;
}) {
  const [jingles, setJingles] = useState<Jingle[] | null>(null);
  const [jingleError, setJingleError] = useState(false);
  const [jingleId, setJingleId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("all");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Record<string, Result> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jingles/library", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: Jingle[] }) => {
        if (cancelled) return;
        setJingles((d.items ?? []).filter((j) => j && typeof j.url === "string" && j.url));
      })
      .catch(() => { if (!cancelled) setJingleError(true); });
    return () => { cancelled = true; };
  }, []);

  const online = useMemo(() => targets.filter((t) => !!t.liveBranchId), [targets]);
  const allOnlineSelected = online.length > 0 && online.every((t) => selected.has(t.id));
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const jingle = jingles?.find((j) => j.id === jingleId) ?? null;
  // recipients: All = every branch of the scope (offline → Not delivered); Selected = the checked online ones
  const chosen = mode === "all" ? targets : online.filter((t) => selected.has(t.id));
  const listed = targets; // the parent re-mounts this panel when the brand at the top changes (fresh selection)
  const canSend = !!jingle && chosen.length > 0 && !sending;

  const send = async () => {
    if (!jingle || chosen.length === 0) return;
    setSending(true);
    setResults(null);
    // all branches in parallel: each answers on its own, a failure never blocks the others
    const settled = await Promise.all(
      chosen.map(async (t) => [t.id, t.liveBranchId ? await sendCommandWithAck(t.liveBranchId, "PLAY_INTERRUPT", { url: jingle.url }) : { delivered: false, reason: "no_station" }] as const),
    );
    setResults(Object.fromEntries(settled));
    setSending(false);
  };

  const deliveredCount = results ? Object.values(results).filter((r) => r.delivered).length : 0;
  const notDeliveredCount = results ? Object.values(results).filter((r) => !r.delivered).length : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[color:var(--sb-border)] px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--sb-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--sb-text)]"
          aria-label="Back to all branches"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div>
          <h2 className="text-base font-semibold text-[var(--sb-text)]">Broadcast</h2>
          <p className="flex items-center gap-1.5 text-xs text-[var(--sb-text-secondary)]">
            {scope ? <span className="h-2 w-2 rounded-full" style={{ background: scope.color ?? "#8e8e93" }} aria-hidden /> : null}
            <span dir="auto">{scope ? `Send a jingle to ${scope.name}` : "Send a jingle to your branches"}</span>
          </p>
        </div>
      </div>

      {/* 1. jingle */}
      <section className="border-b border-[color:var(--sb-border)] px-6 py-5">
        <div className="text-xs text-[var(--sb-text-tertiary)]">1 · Jingle</div>
        {jingleError ? (
          <p className="mt-3 text-sm text-[var(--sb-text-secondary)]">Could not load the jingle library.</p>
        ) : jingles === null ? (
          <p className="mt-3 text-sm text-[var(--sb-text-secondary)]">Loading jingles…</p>
        ) : jingles.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--sb-text-secondary)]">No jingles in the library yet.</p>
        ) : (
          <ul className="mt-2 max-h-44 overflow-y-auto">
            {jingles.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => { setJingleId(j.id); setResults(null); }}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                    j.id === jingleId ? "bg-white/[0.07] text-[var(--sb-text)]" : "text-[var(--sb-text-secondary)] hover:bg-white/[0.03] hover:text-[var(--sb-text)]"
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${j.id === jingleId ? "bg-[var(--sb-accent)]" : "bg-white/15"}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate" dir="auto">{j.title}</span>
                  {typeof j.durationSec === "number" ? <span className="shrink-0 text-xs tabular-nums text-[var(--sb-text-tertiary)]">{Math.round(j.durationSec)}s</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. branches */}
      <section className="flex-1 border-b border-[color:var(--sb-border)] px-6 py-5">
        <div className="text-xs text-[var(--sb-text-tertiary)]">2 · Branches</div>
        <div className="mt-3 flex items-center gap-5 border-b border-[color:var(--sb-border)]" role="tablist">
          {(["all", "selected"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              disabled={sending}
              onClick={() => { setMode(m); setResults(null); }}
              className={`-mb-px border-b-2 pb-2 text-sm transition-colors ${mode === m ? "border-white font-medium text-[var(--sb-text)]" : "border-transparent text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)]"}`}
            >
              <span dir="auto">{m === "all" ? (scope ? `All ${scope.name}` : "All branches") : "Selected"}</span>
              <span className="ml-1.5 text-xs text-[var(--sb-text-tertiary)]">{m === "all" ? targets.length : online.length}</span>
            </button>
          ))}
        </div>
        <div className={`mt-3 items-center justify-end ${mode === "selected" ? "flex" : "hidden"}`}>
          <button
            type="button"
            disabled={online.length === 0}
            onClick={() => { setSelected(allOnlineSelected ? new Set() : new Set(online.map((t) => t.id))); setResults(null); }}
            className="text-xs font-medium text-[var(--sb-accent)] hover:underline disabled:opacity-40 disabled:no-underline"
          >
            {allOnlineSelected ? "Clear" : `All online (${online.length})`}
          </button>
        </div>
        {listed.length === 0 ? <p className="mt-3 text-sm text-[var(--sb-text-secondary)]">No branches here yet.</p> : null}
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
          {listed.map((t) => {
            const isOnline = !!t.liveBranchId;
            const r = results?.[t.id];
            return (
              <li key={t.id}>
                <label className={`flex items-center gap-3 rounded-lg px-2 py-2 ${mode === "selected" ? (isOnline ? "cursor-pointer hover:bg-white/[0.04]" : "opacity-50") : isOnline ? "" : "opacity-60"}`}>
                  {mode === "selected" ? (
                    <input
                      type="checkbox"
                      disabled={!isOnline || sending}
                      checked={isOnline && selected.has(t.id)}
                      onChange={() => { toggle(t.id); setResults(null); }}
                      className="h-4 w-4 accent-[var(--sb-accent)]"
                    />
                  ) : null}
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT_FILL[t.status] }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--sb-text)]">
                    {t.name}
                    {t.branchNumber ? <span className="ml-2 text-xs text-[var(--sb-text-tertiary)]">Branch {t.branchNumber}</span> : null}
                  </span>
                  {r ? (
                    r.delivered ? (
                      <span className="shrink-0 text-xs font-medium text-emerald-400">Delivered to station</span>
                    ) : (
                      <span className="shrink-0 text-xs font-medium text-amber-300" title={REASON_TEXT[r.reason ?? ""] ?? undefined}>
                        Not delivered{r.reason && REASON_TEXT[r.reason] ? ` · ${REASON_TEXT[r.reason]}` : ""}
                      </span>
                    )
                  ) : !isOnline ? (
                    <span className="shrink-0 text-xs text-[var(--sb-text-tertiary)]">{t.status === "install" ? "Needs installation" : "Offline"}</span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 3. send */}
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <p className="text-xs text-[var(--sb-text-secondary)]">
          {results
            ? `${deliveredCount} delivered to station${notDeliveredCount ? ` · ${notDeliveredCount} not delivered` : ""}`
            : chosen.length > 0
              ? `${chosen.length} branch${chosen.length === 1 ? "" : "es"} · ${chosen.filter((t) => !!t.liveBranchId).length} online`
              : "Select a jingle and branches"}
        </p>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void send()}
          className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-transform active:scale-95 disabled:opacity-40"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
          </svg>
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
