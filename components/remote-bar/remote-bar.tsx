"use client";

/**
 * RemoteBar — the strip across the top of a REMOTE's screen (owner 2026-10-31: "the logo and the way back to the Control Room stay, everything else goes lower so it feels like a remote control and not the player;
 * in the gap, write the branch I am controlling"). Shown only on a screen that is NOT the player (a browser / phone that controls another computer), never on the control screens and never in the desktop app.
 * Centre: the branch it controls + whether that branch's player is online (a plain message when no player is connected, so a press on "play" is never a silent mystery); a person who manages
 * branches can change the branch from here (the same choice as Control Room → "Control this branch's player", stored by lib/control-branch.ts). Display only: it reads the device context and changes
 * no playback, election or socket. Styles: remote-bar.css (also hides the header's own logo + way-back icon while this strip shows them, via `html[data-sb-remote-view]`).
 */

import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import { getControlBranch } from "@/lib/control-branch";
import { useTr } from "@/lib/i18n/use-tr";
import { ControlBackIcon } from "@/components/control-screen/control-back-icon";
import { BranchPicker } from "@/components/remote-bar/branch-picker";
import "./remote-bar.css";

const SKIP_KEY = "vono_branch_pick_skipped";

export function RemoteBar({ canManage }: { canManage: boolean }): ReactElement | null {
  const tr = useTr();
  const ctx = useDevicePlayer();
  const isDesktopApp = useSyncExternalStore(() => () => {}, () => "syncbizDesktop" in window, () => true);
  const chosen = useSyncExternalStore(() => () => {}, () => JSON.stringify(getControlBranch()), () => "null");
  const branch = chosen && chosen !== "null" ? (JSON.parse(chosen) as { branchId: string; label: string }) : null;
  const [picking, setPicking] = useState(false);
  const [skipped, setSkipped] = useState(() => { try { return window.sessionStorage.getItem(SKIP_KEY) === "1"; } catch { return false; } });

  const isPlayer = !!ctx && (ctx.deviceMode === "MASTER" || ctx.isDesignatedAudioStation);
  const show = !!ctx && ctx.isActive && ctx.isBranchConnected && !isPlayer && !isDesktopApp;

  // the header's own logo + way-back icon give way to the ones in this strip (CSS keys off this attribute)
  useEffect(() => {
    if (!show) return;
    document.documentElement.setAttribute("data-sb-remote-view", "1");
    return () => document.documentElement.removeAttribute("data-sb-remote-view");
  }, [show]);

  if (!show) return null;

  const online = !!ctx.masterDeviceName;
  const name = branch?.label ?? (canManage ? "" : tr("Default branch"));
  // owner 2026-10-31: no branch chosen yet — ask BEFORE showing the remote (the window can be left for the default branch)
  const forced = canManage && !branch && !skipped;
  const closePicker = () => {
    if (forced) {
      try { window.sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* the question may come back on a reload */ }
      setSkipped(true);
    }
    setPicking(false);
  };

  return (
    <div className="sb-rb" role="region" aria-label={tr("Remote control")}>
      <span className="sb-rb-brand" role="img" aria-label="VONO"><span className="sb-brand-mark" aria-hidden /></span>
      <div className="sb-rb-mid">
        <button type="button" className="sb-rb-where" data-online={online ? "1" : "0"} disabled={!canManage} aria-haspopup="dialog" onClick={() => setPicking(true)}>
          <i className="sb-rb-dot" aria-hidden />
          <span className="sb-rb-name">{name || tr("Choose a branch to control")}</span>
          {canManage ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg> : null}
        </button>
        <span className="sb-rb-state" role="status">{online ? tr("Player online") : tr("No player is connected — nothing will play")}</span>
      </div>
      <span className="sb-rb-end">{canManage ? <ControlBackIcon /> : null}</span>
      {forced || picking ? <BranchPicker current={branch?.branchId ?? null} forced={forced} onClose={closePicker} /> : null}
    </div>
  );
}
