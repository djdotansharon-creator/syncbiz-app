/**
 * Graphics mode (owner 2026-10-23): the design has TWO looks that share every layout, colour and word —
 *   "full"  the design as it is (glass, blur, soft shadows) — nothing about it changes;
 *   "lite"  the same screens with the expensive effects replaced by flat translucent surfaces (see app/lite-fx.css),
 *           for simple / older computers where the glass layers made the library flicker or stall.
 * The choice lives on <html data-sb-fx="lite"> (absent = full). An explicit choice (menu switch or `?fx=lite` / `?fx=full` in the address)
 * is stored in localStorage `syncbiz-fx`; before any choice the computer decides: a software or old integrated graphics chip, or few CPU cores /
 * little memory → lite; a Mac and every normal computer → full. Display-only: no playback code reads or writes this.
 */
import { useSyncExternalStore } from "react";
import { FX_BOOT_SCRIPT, FX_STORAGE_KEY as STORAGE_KEY, FX_MIRROR_KEY as MIRROR_KEY, FX_MIRROR_OWNED_KEY as MIRROR_OWNED_KEY, FX_DISPLAY_KEY as DISPLAY_KEY } from "@/lib/fx-boot";

export { FX_BOOT_SCRIPT };

export type FxMode = "full" | "lite";

const CHANGE_EVENT = "syncbiz-fx-changed";

/** What the computer would pick on its own (no stored choice). Client only. */
export function detectWeakGraphics(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) return true;
  if (nav.deviceMemory && nav.deviceMemory <= 4) return true;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(renderer)) return true;
    if (/Windows/i.test(nav.userAgent) && /Intel\(R\) (UHD|HD) Graphics/i.test(renderer)) return true;
  } catch {
    /* unknown → keep the full look */
  }
  return false;
}

/** The mode currently applied to the page (the boot script put it on <html>). */
export function readFxMode(): FxMode {
  if (typeof document === "undefined") return "full";
  return document.documentElement.getAttribute("data-sb-fx") === "lite" ? "lite" : "full";
}

/** True once somebody chose a mode on purpose (menu switch or `?fx=`). */
export function hasChosenFx(): boolean {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "lite" || v === "full";
  } catch {
    return false;
  }
}

/** Switch the look now and remember the choice. */
export function writeFxMode(mode: FxMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode — still applies for this session */
  }
  if (mode === "lite") document.documentElement.setAttribute("data-sb-fx", "lite");
  else document.documentElement.removeAttribute("data-sb-fx");
  applyMirrorPolicy();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * The blurred "mirror" copy of the clip (a second muted YouTube player) is OFF in the Light graphics and in the black / white displays, ON in the
 * transparent display of the full look. Only a switch-off made by THIS rule is ever undone; a mirror the operator turned off stays off.
 * Runs on every change of graphics mode or display mode. The player re-reads its own flag on "syncbiz:deck-mirror-change".
 */
export function applyMirrorPolicy(): void {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    const display = ls.getItem(DISPLAY_KEY);
    const off = readFxMode() === "lite" || display === "black" || display === "white";
    if (off) {
      if (ls.getItem(MIRROR_KEY) !== "off") {
        ls.setItem(MIRROR_KEY, "off");
        ls.setItem(MIRROR_OWNED_KEY, "1");
        window.dispatchEvent(new Event("syncbiz:deck-mirror-change"));
      }
    } else if (ls.getItem(MIRROR_OWNED_KEY) === "1") {
      ls.removeItem(MIRROR_KEY);
      ls.removeItem(MIRROR_OWNED_KEY);
      window.dispatchEvent(new Event("syncbiz:deck-mirror-change"));
    }
  } catch {
    /* ignore */
  }
}

// a change of display mode (black / white / transparent) re-applies the rule; registered once, the first time this module loads in the browser
if (typeof window !== "undefined") {
  const w = window as unknown as { __sbFxMirrorWatch?: boolean };
  if (!w.__sbFxMirrorWatch) {
    w.__sbFxMirrorWatch = true;
    window.addEventListener("syncbiz:display-mode-change", applyMirrorPolicy);
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useFxMode(): FxMode {
  return useSyncExternalStore(subscribe, readFxMode, () => "full");
}
