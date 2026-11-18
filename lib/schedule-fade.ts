/**
 * A scheduled STOP ends with a FADE-OUT (the father 2026-11-18: "when it stops, it should end with a 9-second fade-out") — PURE helpers for `components/schedule-auto-player.tsx`.
 *
 * Done in the renderer through the Player's own volume path (`setVolume` = MAIN's SET_VOLUME on a station / controller, else the local one) — no change to MPV / MAIN, so it needs no installer.
 * The volume is brought down in small steps over `FADE_OUT_MS`, the music is stopped, and only then is the volume put back to what it was, so the next block starts at the right level.
 *  · only the FIRST try of a stop fades (a stop that had to be repeated is a hard stop — it must not take 9 s more each time);
 *  · never at the first look after a restart (music restored after closing time stops at once);
 *  · the volume to put back is kept in the browser while the fade runs, so a window closed in the middle of a fade cannot leave the player quiet (`readFadeRestore`, used at the next start).
 */

export const FADE_OUT_MS = 9000;
export const FADE_STEP_MS = 450;

/** the volume levels (whole percent, strictly falling, ending at 0) for a fade from `from`: a gentle curve — quick at first, slow near the end, where the ear is most sensitive */
export function fadeOutLevels(from: number, durationMs: number = FADE_OUT_MS, stepMs: number = FADE_STEP_MS): number[] {
  const start = Math.round(from);
  if (!Number.isFinite(start) || start <= 0) return [];
  const steps = Math.max(1, Math.round(durationMs / stepMs));
  const out: number[] = [];
  for (let i = 1; i <= steps; i++) {
    const v = i === steps ? 0 : Math.round(start * Math.pow(1 - i / steps, 1.6));
    if (out.length === 0 || v < out[out.length - 1]!) out.push(v);
  }
  if (out[out.length - 1] !== 0) out.push(0);
  return out;
}

/** does this stop fade? */
export function shouldFadeStop(i: { firstLook: boolean; tryNo: number; audible: boolean; volume: number | null; canSetVolume: boolean }): boolean {
  return !i.firstLook && i.tryNo === 1 && i.audible && i.canSetVolume && typeof i.volume === "number" && i.volume > 0;
}

const RESTORE_KEY = "syncbiz-schedule-fade-restore";
export function writeFadeRestore(v: number | null): void {
  try {
    if (v === null) localStorage.removeItem(RESTORE_KEY);
    else localStorage.setItem(RESTORE_KEY, String(Math.round(v)));
  } catch {
    /* only a help */
  }
}
/** the volume a fade that never finished must give back (null = none) */
export function readFadeRestore(): number | null {
  try {
    const raw = localStorage.getItem(RESTORE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n) : null;
  } catch {
    return null;
  }
}
