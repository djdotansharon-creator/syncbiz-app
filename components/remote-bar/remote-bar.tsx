"use client";

/**
 * RemoteBar — the strip across the top of a REMOTE's screen (owner 2026-10-31: "the logo and the way back to the Control Room stay, everything else goes lower so it feels like a remote control and not the player;
 * in the gap, write the branch I am controlling"). Shown only on a screen that is NOT the player (a browser / phone that controls another computer), never on the control screens and never in the desktop app.
 * Centre: the branch it controls + whether that branch's player is online (a plain message when no player is connected, so a press on "play" is never a silent mystery); a person who manages
 * branches can change the branch from here (the same choice as Control Room → "Control this branch's player", stored by lib/control-branch.ts). Display only: it reads the device context and changes
 * no playback, election or socket. Styles: remote-bar.css (also hides the header's own logo + way-back icon while this strip shows them, via `html[data-sb-remote-view]`).
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import { getControlBranch, setControlBranch } from "@/lib/control-branch";
import { useTr } from "@/lib/i18n/use-tr";
import { ControlBackIcon } from "@/components/control-screen/control-back-icon";
import "./remote-bar.css";

type Branch = { id: string; name: string; city?: string };

export function RemoteBar({ canManage }: { canManage: boolean }): ReactElement | null {
  const tr = useTr();
  const ctx = useDevicePlayer();
  const isDesktopApp = useSyncExternalStore(() => () => {}, () => "syncbizDesktop" in window, () => true);
  const chosen = useSyncExternalStore(() => () => {}, () => JSON.stringify(getControlBranch()), () => "null");
  const branch = chosen && chosen !== "null" ? (JSON.parse(chosen) as { branchId: string; label: string }) : null;
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const isPlayer = !!ctx && (ctx.deviceMode === "MASTER" || ctx.isDesignatedAudioStation);
  const show = !!ctx && ctx.isActive && ctx.isBranchConnected && !isPlayer && !isDesktopApp;

  // the header's own logo + way-back icon give way to the ones in this strip (CSS keys off this attribute)
  useEffect(() => {
    if (!show) return;
    document.documentElement.setAttribute("data-sb-remote-view", "1");
    return () => document.documentElement.removeAttribute("data-sb-remote-view");
  }, [show]);

  useEffect(() => {
    if (!open || branches) return;
    let alive = true;
    fetch("/api/branches", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: unknown) => { if (alive) setBranches(Array.isArray(rows) ? (rows as Branch[]).filter((b) => b && typeof b.id === "string") : []); })
      .catch(() => { if (alive) setBranches([]); });
    return () => { alive = false; };
  }, [open, branches]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!show) return null;

  const online = !!ctx.masterDeviceName;
  const name = branch?.label ?? (canManage ? "" : tr("Default branch"));
  const choose = (b: Branch) => {
    setControlBranch({ branchId: b.id, label: b.name });
    window.location.assign("/sources"); // a full load, so every socket joins the chosen branch room (same as the Control Room button)
  };

  return (
    <div className="sb-rb" role="region" aria-label={tr("Remote control")}>
      <span className="sb-rb-brand" role="img" aria-label="VONO"><span className="sb-brand-mark" aria-hidden /></span>
      <div className="sb-rb-mid" ref={rootRef}>
        <button type="button" className="sb-rb-where" data-online={online ? "1" : "0"} disabled={!canManage} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <i className="sb-rb-dot" aria-hidden />
          <span className="sb-rb-name">{name || tr("Choose a branch to control")}</span>
          {canManage ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg> : null}
        </button>
        <span className="sb-rb-state" role="status">{online ? tr("Player online") : tr("No player is connected — nothing will play")}</span>
        {open ? (
          <div className="sb-rb-menu" role="menu">
            {branches === null ? <span className="sb-rb-note">…</span> : branches.length === 0 ? <span className="sb-rb-note">{tr("No branches yet")}</span> : branches.map((b) => (
              <button key={b.id} type="button" role="menuitemradio" className="sb-rb-opt" aria-checked={branch?.branchId === b.id} onClick={() => choose(b)}>
                {b.name}{b.city ? <small>{b.city}</small> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <span className="sb-rb-end">{canManage ? <ControlBackIcon /> : null}</span>
    </div>
  );
}
