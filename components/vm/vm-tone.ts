"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { decideTone, lastTone, rememberLastTone, rememberedTone, sampleHs, type Hs, type ToneMode, type ToneState } from "@/lib/cover-tone";
import { nameHue } from "@/components/vm/vm-parts";

/**
 * THE SONG'S COLOURS (owner 2026-11-17: "why isn't the background in the colours of the song?") — the Now Playing sheet, the mini-player and a branch's screen
 * take the colour of the cover that plays, like Apple Music. A small copy of the picture is read (the same reading the Schedules Studio uses for its blocks:
 * `toneFromPixels` = the picture's most vivid hue; a grey picture gives a calm grey). The colour glides on a change (CSS `@property` in mobile-app.css).
 * Reading, remembering and reading-ahead of the colours lives in lib/cover-tone.ts.
 *
 * Rules (owner 2026-11-19: "at the start there is a green background and then the picture"; "I put a song — the picture was already the song's but the background did not change colour"):
 *  - NOTHING IS MADE UP WHILE WE DO NOT KNOW. While the branch list is still being read / the phone is connecting, the colour is the remembered one (the last song's) or the neutral dark —
 *    never a colour made from a NAME (a name with no branch yet was the "green").
 *  - A NEW PICTURE HAS ITS OWN ANSWER. While it is being read the colour on screen stays (and then glides); when the picture has answered "no colour" (none, or it cannot be read) the colour comes from the
 *    song's name — it does NOT stay the previous song's colour (that was the "background did not change").
 */
export type { Hs, ToneMode };

const nameHs = (name: string): Hs => ({ h: nameHue(name || "·"), s: 0.42 });

/** the two colours the dark backgrounds are drawn from: a deeper (top) and a darker (bottom) shade of the song's hue */
export function toneVars(hs: Hs, deep = false): CSSProperties {
  const s = Math.min(0.7, Math.max(0.06, hs.s));
  // `deep` = a darker shade of the same hue (a person's page: "more dark") — the song's own background stays as it is
  return {
    ["--vm-t1" as string]: `hsl(${Math.round(hs.h)} ${Math.round(s * 85)}% ${deep ? 21 : 30}%)`,
    ["--vm-t2" as string]: `hsl(${Math.round(hs.h)} ${Math.round(s * 72)}% ${deep ? 10 : 15}%)`,
  } as CSSProperties;
}

/** the neutral dark of the app before any colour is known (the same one the CSS starts from) */
const NEUTRAL_HS: Hs = { h: 240, s: 0.06 };

/**
 * The colour of a cover as CSS variables (`--vm-t1`, `--vm-t2`).
 * `nowPlaying` = this is the colour of what the branch PLAYS (not a picture in a list): remembered as "the last song's colour" for the next open.
 */
export function useCoverTone(cover: string | null | undefined, name: string, mode: ToneMode, nowPlaying = false): CSSProperties {
  const pic = cover ?? null;
  const [st, setSt] = useState<ToneState>({ cover: null, hs: null, held: null, settled: false });
  useEffect(() => {
    if (mode === "calm") return;
    let alive = true;
    // the first frame: the colour remembered for THIS picture; and, only while we do not know yet, the last song's colour as the one that "stays" — read after mount (the server renders without a phone's storage).
    // The last song's colour is never taken for THIS picture's own (a picture that cannot be read must not wear it).
    const own = rememberedTone(pic);
    const stay = !own && mode === "wait" && nowPlaying ? lastTone() : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the remembered colour of a phone's storage, read once the picture is known
    setSt((cur) => (cur.cover === pic && cur.hs ? cur : { cover: pic, hs: own, held: stay ?? cur.hs ?? cur.held, settled: false }));
    if (!pic) {
      // no picture at all: a playing song then wears its name's colour; while we do not know yet nothing is decided
      if (mode === "song") setSt((cur) => (cur.cover === pic ? { ...cur, settled: true } : cur));
      return () => {
        alive = false;
      };
    }
    void sampleHs(pic).then((hs) => {
      if (!alive) return;
      setSt((cur) => (cur.cover === pic ? { ...cur, hs: hs ?? cur.hs, settled: true } : cur));
      if (hs && nowPlaying && mode === "song") rememberLastTone(hs);
    });
    return () => {
      alive = false;
    };
  }, [pic, mode, nowPlaying]);
  const d = decideTone(st, pic, mode);
  if (d.use === "calm") return toneVars({ h: nameHue(name || "·"), s: 0.1 });
  if (d.use === "own") return toneVars(d.hs);
  if (d.use === "name") return toneVars(nameHs(name));
  return toneVars(d.hs ?? NEUTRAL_HS);
}

/** true only once `flag` has stayed true for `ms` (and false at once when it ends) */
function useHeldFor(flag: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!flag) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the wait starts over each time the condition begins
      setHeld(false);
      return;
    }
    const t = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return flag && held;
}

/** how long "nothing plays" must stay true before the background goes calm — the station reports a quick "idle" while it connects, and a one-frame grey flash is worse than a short wait */
const CALM_AFTER_MS = 700;

/** the colour of what the SELECTED branch plays now (for the dock's mini-player, the Now Playing sheet, a branch's screen) */
export function useNowTone(): CSSProperties {
  const f = useMobileFleet();
  const b = f.selected;
  const s = f.display.shown;
  const cover = s?.currentTrack?.cover ?? s?.currentSource?.cover ?? null;
  const title = s?.currentTrack?.title || s?.currentSource?.title || "";
  // we do not KNOW yet: the branch list is being read, the phone is still connecting (a branch that is not live YET is not "away" until the live list has been heard — `known`), or the branch's state has not arrived —
  // the song that played last stays, its colour at once
  const waiting = !f.loaded || !b || b.status === "unknown" || (b.online && !s) || !f.known;
  // we KNOW nothing plays: the branch is away, or its player is idle
  const quiet = !b || !b.online || !s || s.status === "idle" || s.status === "stopped";
  const calm = useHeldFor(!waiting && quiet, CALM_AFTER_MS);
  const mode: ToneMode = waiting ? "wait" : quiet ? (calm ? "calm" : "wait") : "song";
  return useCoverTone(mode === "calm" ? null : cover, title || b?.name || "", mode, true);
}
