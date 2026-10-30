"use client";

/**
 * JoinPopup — a person who has just sent a join request appears as a small card for the approver, live (owner 2026-10-31: "like when two iPhones touch and the new contact pops up and asks how to save it"):
 * the name, the role to give (from the roles the business made) and Approve / Reject / Later. Shown on the control screens only (the owner's phone/computer, and the Player computer inside Settings) — never over
 * the music player. Only a request made in the last few minutes pops up; older ones wait behind the red circle and in Permissions, and "Later" keeps a card away for this session. Rides on the shared
 * pending-count poll (lib/use-join-pending.ts), which speeds up while a join code is on show; renders nothing unless the join feature is on and this person decides requests.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useTr } from "@/lib/i18n/use-tr";
import { JOIN_CHANGED_EVENT, useJoinPending } from "@/lib/use-join-pending";
import "./join-popup.css";

type Req = { id: string; email: string; firstName: string; lastName: string; requestedAt: string };
type Role = { id: string; name: string };

/** a request older than this is not "just now" any more — it waits behind the red circle instead of jumping out */
const FRESH_MS = 5 * 60_000;
const SEEN_KEY = "vono_join_popup_seen";

function readSeen(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(SEEN_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>): void {
  try {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-50)));
  } catch {
    /* private mode: the card may come back on the next check — harmless */
  }
}

export function JoinPopup(): ReactElement | null {
  const tr = useTr();
  const { enabled, count } = useJoinPending();
  const [req, setReq] = useState<Req | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seen = useRef<Set<string> | null>(null);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false); // the portal exists only in the browser (it must sit above the Permissions windows, which are portals too)

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(async () => {
      if (!enabled || count <= 0) {
        if (alive) setReq(null);
        return;
      }
      try {
        const r = await fetch("/api/join/requests", { credentials: "include", cache: "no-store" });
        if (!r.ok || !alive) return;
        const j = (await r.json()) as { requests?: Req[] };
        if (!seen.current) seen.current = readSeen();
        const fresh = (j.requests ?? [])
          .filter((x) => !seen.current!.has(x.id) && Date.now() - Date.parse(x.requestedAt) < FRESH_MS)
          .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))[0];
        if (!alive) return;
        setReq(fresh ?? null);
        if (fresh) {
          const xr = await fetch("/api/roles", { credentials: "include", cache: "no-store" }).catch(() => null);
          const xj = xr && xr.ok ? ((await xr.json()) as { enabled?: boolean; roles?: Role[] }) : null;
          const list = xj?.enabled ? (xj.roles ?? []) : [];
          if (alive) {
            setRoles(list);
            setPick((cur) => cur || (list.length > 0 ? list[list.length - 1].id : "MEMBER"));
          }
        }
      } catch {
        /* offline — the red circle still counts */
      }
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [enabled, count]);

  const dismiss = useCallback((id: string) => {
    if (!seen.current) seen.current = readSeen();
    seen.current.add(id);
    writeSeen(seen.current);
    setReq(null);
    setError("");
    setPick("");
  }, []);

  async function decide(decision: "approve" | "reject") {
    if (!req) return;
    setBusy(true);
    setError("");
    try {
      const chosen = pick || (roles.length > 0 ? roles[roles.length - 1].id : "MEMBER");
      const body = roles.length > 0 ? { decision, roleId: chosen } : { decision, role: chosen === "MANAGER" ? "MANAGER" : "MEMBER" };
      const r = await fetch(`/api/join/requests/${req.id}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        setError(tr("Something went wrong. Please try again."));
        return;
      }
      dismiss(req.id);
      window.dispatchEvent(new Event(JOIN_CHANGED_EVENT)); // the red circle re-counts at once
    } catch {
      setError(tr("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (!req || !mounted) return null;
  const name = `${req.firstName} ${req.lastName}`.trim();
  return createPortal(
    <div className="sb-jp" role="dialog" aria-label={tr("New join request")} aria-live="polite">
      <div className="sb-jp-head">
        <span className="sb-jp-avatar" aria-hidden>{(req.firstName || "?").slice(0, 1).toUpperCase()}</span>
        <div className="sb-jp-who">
          <small>{tr("New join request")}</small>
          <b>{name}</b>
          <span dir="ltr">{req.email}</span>
        </div>
      </div>
      <label className="sb-jp-role">
        <span>{tr("Role")}</span>
        <select value={pick || (roles.length > 0 ? roles[roles.length - 1].id : "MEMBER")} onChange={(e) => setPick(e.target.value)} aria-label={tr("Role")}>
          {roles.length > 0 ? roles.map((o) => <option key={o.id} value={o.id}>{o.name}</option>) : (<><option value="MEMBER">{tr("Member")}</option><option value="MANAGER">{tr("Manager")}</option></>)}
        </select>
      </label>
      <div className="sb-jp-actions">
        <button type="button" className="sb-jp-btn sb-jp-btn--main" disabled={busy} onClick={() => void decide("approve")}>{tr("Approve")}</button>
        <button type="button" className="sb-jp-btn" disabled={busy} onClick={() => void decide("reject")}>{tr("Reject")}</button>
        <button type="button" className="sb-jp-btn sb-jp-btn--quiet" disabled={busy} onClick={() => dismiss(req.id)}>{tr("Later")}</button>
      </div>
      {error ? <p className="sb-jp-err" role="alert">{error}</p> : null}
    </div>,
    document.body,
  );
}
