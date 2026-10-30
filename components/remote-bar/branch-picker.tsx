"use client";

/**
 * BranchPicker — "which branch do I control?" (owner 2026-10-31: "before you show me a remote, let me choose a branch: a window with the branches in a scrolling list, a search bar above, and the list shows the branches
 * that are playing live"). Live branches come from the same live list the Control Room uses (lib/remote-control/ws-client.ts, read only); the branch names come from /api/branches. Live branches first, with what is playing;
 * when none is live the rest are listed dimmed so the screen is never a dead end. The choice is the Control Room's own (lib/control-branch.ts: stored in this browser + a full page load so every socket joins that branch).
 * Shown by itself when this browser has not chosen a branch yet (`forced`), and again from the strip's branch name. Display + a stored choice only: no playback command, election or socket of its own.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useRemoteOwner } from "@/lib/remote-control/ws-client";
import { setControlBranch } from "@/lib/control-branch";
import { useTr } from "@/lib/i18n/use-tr";
import "./branch-picker.css";

type DbBranch = { id: string; name: string; city?: string };

export function BranchPicker({ current, forced, onClose }: { current: string | null; forced: boolean; onClose: () => void }): ReactElement | null {
  const tr = useTr();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const { branches: live, remoteStateByDeviceId } = useRemoteOwner();
  const [db, setDb] = useState<DbBranch[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/branches", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: unknown) => { if (alive) setDb(Array.isArray(rows) ? (rows as DbBranch[]).filter((b) => b && typeof b.id === "string") : []); })
      .catch(() => { if (alive) setDb([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (forced) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [forced, onClose]);

  const rows = useMemo(() => {
    const byId = new Map((db ?? []).map((b) => [b.id, b] as const));
    const liveRows = live.map((l) => {
      const canon = l.canonicalBranchId ?? l.branchId;
      const meta = byId.get(canon) ?? byId.get(l.branchId);
      const track = (remoteStateByDeviceId[l.masterDeviceId] as { currentTrack?: { title?: string } | null } | undefined)?.currentTrack?.title ?? "";
      return { id: l.branchId, name: meta?.name ?? l.branchName ?? canon, city: meta?.city ?? "", live: true, track, canon };
    });
    const liveCanon = new Set(liveRows.map((r) => r.canon));
    const offline = (db ?? []).filter((b) => !liveCanon.has(b.id)).map((b) => ({ id: b.id, name: b.name, city: b.city ?? "", live: false, track: "", canon: b.id }));
    const needle = q.trim().toLowerCase();
    const match = (r: { name: string; city: string }) => !needle || r.name.toLowerCase().includes(needle) || r.city.toLowerCase().includes(needle);
    // live branches first; the others only when nothing is live (or when searching for one) so the list is "who is playing now"
    const shown = [...liveRows.filter(match), ...(liveRows.length === 0 || needle ? offline.filter(match) : [])];
    return { shown, anyLive: liveRows.length > 0 };
  }, [live, db, remoteStateByDeviceId, q]);

  if (!mounted) return null;
  const choose = (r: { id: string; name: string }) => {
    setControlBranch({ branchId: r.id, label: r.name });
    window.location.assign("/sources"); // a full load, so every socket joins the chosen branch room
  };
  const loading = db === null;

  return createPortal(
    <div className="sb-bp-back" role="dialog" aria-modal="true" aria-label={tr("Choose a branch to control")}>
      <div className="sb-bp-win">
        {forced ? null : <button type="button" className="sb-bp-x" onClick={onClose} aria-label={tr("Close")}>×</button>}
        <h2 className="sb-bp-title">{tr("Choose a branch to control")}</h2>
        <label className="sb-bp-search">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search branches")} aria-label={tr("Search branches")} autoFocus />
        </label>
        <div className="sb-bp-list" role="listbox" aria-label={tr("Branches")}>
          {loading ? <p className="sb-bp-note">{tr("Looking for live branches…")}</p> : null}
          {!loading && !rows.anyLive ? <p className="sb-bp-note">{tr("No branch is playing live right now")}</p> : null}
          {!loading && rows.shown.length === 0 && (q.trim() !== "" || rows.anyLive || (db ?? []).length === 0) ? <p className="sb-bp-note">{tr("Nothing found")}</p> : null}
          {rows.shown.map((r) => (
            <button key={r.id} type="button" role="option" aria-selected={current === r.id} className="sb-bp-row" data-live={r.live ? "1" : "0"} onClick={() => choose(r)}>
              <i className="sb-bp-dot" aria-hidden />
              <span className="sb-bp-main">
                <b>{r.name}</b>
                <small>{r.live ? (r.track ? `${tr("Playing live")} · ${r.track}` : tr("Player online")) : tr("Offline")}{r.city ? ` · ${r.city}` : ""}</small>
              </span>
            </button>
          ))}
        </div>
        {forced ? <button type="button" className="sb-bp-skip" onClick={onClose}>{tr("Not now — use the default branch")}</button> : null}
      </div>
    </div>,
    document.body,
  );
}
