"use client";

/**
 * ConnectVeil — a browser that is not connected to a branch does NOT turn itself into a player (owner 2026-11-01: "a Remote in the browser must not get its own player and the 'not connected' look —
 * it opens blurred, with a small window that says to choose a branch to control"). Until the server has answered once for this page, the whole screen sits under a blur with a small "Connecting…" pill;
 * if it still has not connected after a few seconds, a small window says so — a manager who has not chosen a branch gets the branch picker (components/remote-bar/branch-picker.tsx), anyone else a
 * "can't reach the branch" note with "Try again". Nothing is pressable underneath (the veil covers it and the keyboard is held), so the standalone player of an unconnected browser can never be started by accident.
 * The one way past it is a small, deliberate "Use this browser as the Player (emergency)" link: it is remembered (localStorage) only until the browser connects, and it gives back exactly the old standalone behaviour.
 * What it never touches: the desktop app (never veiled), the control screens, and a browser that has connected once in this page (a later network blip does not veil a screen that is playing / controlling).
 * Display + one stored flag: it reads `isActive` / `isBranchConnected` from the device context, sends nothing, owns no socket and changes no playback state. Styles: components/connect-veil.css.
 */

import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
import { usePathname } from "next/navigation";
import { useDevicePlayer } from "@/lib/device-player-context";
import { isControlScreenPath } from "@/lib/control-screen";
import { getControlBranch } from "@/lib/control-branch";
import { BranchPicker } from "@/components/remote-bar/branch-picker";
import { useTr } from "@/lib/i18n/use-tr";
import "@/components/connect-veil.css";

/** the deliberate "use this browser as the Player" choice — kept only until the browser connects */
export const EMERGENCY_PLAYER_KEY = "vono_emergency_player";
/** how long a screen may stay "connecting" before the small window explains */
export const VEIL_WINDOW_AFTER_MS = 5000;
const FADE_MS = 260;

function readEmergency(): boolean {
  try { return window.localStorage.getItem(EMERGENCY_PLAYER_KEY) === "1"; } catch { return false; }
}

export function ConnectVeil({ canManage }: { canManage: boolean }): ReactElement | null {
  const tr = useTr();
  const pathname = usePathname();
  const ctx = useDevicePlayer();
  const isDesktopApp = useSyncExternalStore(() => () => {}, () => "syncbizDesktop" in window, () => true);
  const chosen = useSyncExternalStore(() => () => {}, () => JSON.stringify(getControlBranch()), () => "null");
  const [everConnected, setEverConnected] = useState(false);
  const [emergency, setEmergency] = useState(() => (typeof window === "undefined" ? false : readEmergency()));
  const [slow, setSlow] = useState(false);
  const [pickerOff, setPickerOff] = useState(false); // "Not now" in the picker: the plain "can't reach" window takes over
  const [fading, setFading] = useState(false);
  const [wasActive, setWasActive] = useState(false);

  const connected = !!ctx && ctx.isBranchConnected;
  const active = !!ctx && ctx.isActive && !isDesktopApp && !isControlScreenPath(pathname) && !connected && !everConnected && !emergency;

  // the first connection ends the veil for good in this page (adjusted while rendering — no effect needed)
  if (connected && !everConnected) setEverConnected(true);
  useEffect(() => {
    // an emergency choice is forgotten once the browser is really connected
    if (connected) { try { window.localStorage.removeItem(EMERGENCY_PLAYER_KEY); } catch { /* ignore */ } }
  }, [connected]);

  // the small window explains after a few seconds of "connecting"; it resets whenever the veil is not up
  if (!active && slow) setSlow(false);
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setSlow(true), VEIL_WINDOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  // a short fade when it lifts (the flag is set while rendering, cleared by a timer)
  if (wasActive !== active) {
    setWasActive(active);
    if (wasActive && !active) setFading(true);
  }
  useEffect(() => {
    if (!fading) return;
    const t = window.setTimeout(() => setFading(false), FADE_MS);
    return () => window.clearTimeout(t);
  }, [fading]);

  // nothing underneath may be pressed from the keyboard while the veil is up (Tab and Escape stay free so the window can be reached)
  useEffect(() => {
    if (!active) return;
    const hold = (e: KeyboardEvent) => {
      if (e.key === "Tab" || e.key === "Escape") return;
      const t = e.target as Element | null;
      if (t && typeof t.closest === "function" && t.closest(".vono-veil, .sb-bp-back, .vono-veil-emergency")) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", hold, true);
    return () => document.removeEventListener("keydown", hold, true);
  }, [active]);

  if (!active && !fading) return null;

  const branch = chosen && chosen !== "null" ? (JSON.parse(chosen) as { branchId: string }) : null;
  const needPicker = active && slow && canManage && !branch && !pickerOff;
  const useAsPlayer = () => {
    try { window.localStorage.setItem(EMERGENCY_PLAYER_KEY, "1"); } catch { /* the choice still holds for this page */ }
    setEmergency(true);
  };

  return (
    <>
      <div className={`vono-veil${active ? "" : " is-leaving"}`} role="status" aria-live="polite" aria-label={tr("Connecting…")}>
        {!slow ? <span className="vono-veil-pill"><i className="vono-veil-spin" aria-hidden />{tr("Connecting…")}</span> : null}
        {slow && !needPicker ? (
          <div className="vono-veil-win">
            <h2 className="vono-veil-title">{tr("Can't reach the branch")}</h2>
            <p className="vono-veil-note">{tr("Nothing plays on this computer until it is connected.")}</p>
            <button type="button" className="vono-veil-btn" onClick={() => window.location.reload()}>{tr("Try again")}</button>
          </div>
        ) : null}
      </div>
      {needPicker ? <BranchPicker current={null} forced onClose={() => setPickerOff(true)} /> : null}
      {active && slow ? <button type="button" className="vono-veil-emergency" onClick={useAsPlayer}>{tr("Use this browser as the Player (emergency)")}</button> : null}
    </>
  );
}
