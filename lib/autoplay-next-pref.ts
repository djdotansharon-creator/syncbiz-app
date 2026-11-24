/**
 * "NEXT SONG, AUTOMATIC" — the preference behind the AutoplayRecommender (owner 2026-11-25: "bring it back": the next song is lined up in the first seconds of a song; with nothing queued the player takes the
 * platform's recommendation and prepares it, so Next / the end of the song is instant and the music never stops). It only fills the EXISTING Play Next queue (nothing in the playback chain changes).
 *
 *   stored "off" → off · stored "on" → on · nothing stored → ON in a browser / on the phone, OFF in the desktop app (the pilot station keeps the 2026-10-27 baseline rule: a branch computer starts the song
 *   again and never lines up a song the business did not choose, until the owner decides otherwise). Music started by a schedule is handled elsewhere (always allowed).
 */
export const AUTOPLAY_NEXT_KEY = "syncbiz:autoplayNext";

function inDesktopApp(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { syncbizDesktop?: unknown }).syncbizDesktop);
}

export function autoplayNextEnabled(): boolean {
  try {
    const v = window.localStorage.getItem(AUTOPLAY_NEXT_KEY);
    if (v === "on") return true;
    if (v === "off") return false;
  } catch {
    /* private mode — the default below */
  }
  return !inDesktopApp();
}

export function setAutoplayNext(on: boolean): void {
  try {
    window.localStorage.setItem(AUTOPLAY_NEXT_KEY, on ? "on" : "off");
    window.dispatchEvent(new Event("syncbiz-autoplay-next-changed"));
  } catch {
    /* ignore — the choice then only lasts until reload */
  }
}
