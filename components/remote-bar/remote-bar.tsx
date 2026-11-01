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
/** the song list of the player: its rows (jump to a song), the thin rows of the side strip (".sb-queue-rowline", owner 2026-11-01: a press on one made it flicker "pressed" and sent a jump) and the Play Next pad */
const LIST_AREA = ".queue-row, .play-next-pad, .sb-queue-rowline";
/** the same area plus the list's own box (the space between / under the rows): where the red X follows a held button */
const LIST_AREA_WITH_LIST = ".queue-row, .play-next-pad, .sb-queue-rowline, .sb-queue-list";

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

  // owner 2026-10-31: a REMOTE only SCROLLS the song list — it may not press a song, reorder or remove (a press used to mark a song and the mark could not be undone). While this screen is a Remote the list area is
  // shut: the pointer turns into a small red X (remote-bar.css) while the button is held down on it, and a click / double-click / Enter / drag there does nothing at all — nothing is sent, nothing is marked. Plain event capture; the playback code is not touched.
  useEffect(() => {
    if (!show) return;
    document.documentElement.setAttribute("data-sb-listlocked", "1");
    const shut = (e: Event) => {
      const t = e.target as Element | null;
      if (!t || typeof t.closest !== "function" || !t.closest(LIST_AREA)) return;
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Enter" && (e as KeyboardEvent).key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
    };
    const kinds = ["click", "dblclick", "keydown", "dragstart", "drop"] as const;
    for (const k of kinds) document.addEventListener(k, shut, true);
    // owner 2026-11-01: the WHOLE list area is "not for pressing" — once the button goes down inside it, the small red X stays on every row (and the gaps) until the button is released, even when the pointer slides to another song
    const html = document.documentElement;
    const pressOn = (e: Event) => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === "function" && t.closest(LIST_AREA_WITH_LIST)) html.setAttribute("data-sb-listpress", "1");
    };
    const pressOff = () => html.removeAttribute("data-sb-listpress");
    const moved = (e: Event) => { if (html.hasAttribute("data-sb-listpress") && (e as PointerEvent).buttons === 0) pressOff(); }; // a release outside the window never reached us
    document.addEventListener("pointerdown", pressOn, true);
    document.addEventListener("pointerup", pressOff, true);
    document.addEventListener("pointercancel", pressOff, true);
    document.addEventListener("dragend", pressOff, true);
    document.addEventListener("pointermove", moved, true);
    window.addEventListener("blur", pressOff);
    return () => {
      html.removeAttribute("data-sb-listlocked");
      pressOff();
      for (const k of kinds) document.removeEventListener(k, shut, true);
      document.removeEventListener("pointerdown", pressOn, true);
      document.removeEventListener("pointerup", pressOff, true);
      document.removeEventListener("pointercancel", pressOff, true);
      document.removeEventListener("dragend", pressOff, true);
      document.removeEventListener("pointermove", moved, true);
      window.removeEventListener("blur", pressOff);
    };
  }, [show]);

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
