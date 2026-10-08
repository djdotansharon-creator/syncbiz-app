"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * P0 Video V1 (owner-approved 2026-10-09) — renderer side of MPV-rendered video: the picture comes from the SAME MPV
 * player as the sound on THIS station (one clock → truly synced), drawn by MAIN in its own window over the player's
 * video slot. Feature-detected: browsers / phones / older desktop installers have no bridge → `supported:false` and
 * everything stays exactly as before (the muted YouTube dock).
 *
 * `enabled` = the saved per-station switch (applies at the next VONO start); `active` = this session runs MPV video.
 */
export type MpvVideoOutputState = { supported: boolean; enabled: boolean; active: boolean };

type Bridge = {
  getVideoOutput?: () => Promise<{ enabled: boolean; active: boolean }>;
  setVideoOutputEnabled?: (enabled: boolean) => Promise<{ enabled: boolean; active: boolean }>;
  setVideoDockRect?: (rect: { x: number; y: number; width: number; height: number } | null) => Promise<void>;
};

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { syncbizDesktop?: Bridge }).syncbizDesktop;
  return b && typeof b.getVideoOutput === "function" && typeof b.setVideoDockRect === "function" ? b : null;
}

const UNSUPPORTED: MpvVideoOutputState = { supported: false, enabled: false, active: false };
let state: MpvVideoOutputState = UNSUPPORTED;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => { for (const l of [...listeners]) l(); };

function load(): void {
  if (loaded) return;
  loaded = true;
  const b = bridge();
  if (!b?.getVideoOutput) return;
  void b.getVideoOutput().then((s) => {
    state = { supported: true, enabled: s?.enabled === true, active: s?.active === true };
    emit();
  }).catch(() => { /* unsupported → stays off */ });
}

export function useMpvVideoOutput(): MpvVideoOutputState {
  useEffect(() => { load(); }, []);
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => state,
    () => UNSUPPORTED,
  );
}

/** Save the per-station switch (takes effect at the next VONO start — MPV is never restarted under playing audio). */
export async function setMpvVideoOutputEnabled(enabled: boolean): Promise<void> {
  const b = bridge();
  if (!b?.setVideoOutputEnabled) return;
  try {
    const s = await b.setVideoOutputEnabled(enabled);
    state = { supported: true, enabled: s?.enabled === true, active: s?.active === true };
    emit();
  } catch { /* non-fatal */ }
}

/** Report the video slot (CSS px in the viewport) — or null: no picture now. */
export function reportMpvVideoSlot(rect: { x: number; y: number; width: number; height: number } | null): void {
  const b = bridge();
  if (!b?.setVideoDockRect) return;
  void b.setVideoDockRect(rect).catch(() => { /* non-fatal */ });
}
