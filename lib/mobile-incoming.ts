import type { StationPlaybackState } from "@/lib/remote-control/types";
import { isBlocking, targetKeyOf, type UrlTransition } from "@/lib/url-transition-intent";

/**
 * THE INCOMING SONG, SHOWN AT ONCE (owner 2026-11-19: "the background on the phone does not change within a second").
 *
 * A real station needs seconds to start a stream. Until it says "ready", the phone keeps the OLD song as now playing (P0 Gate 1f: the audible item is the
 * one shown — the item being loaded is never presented as playing by the shared display rule). That is right for the audio, but it left the phone silent
 * for those seconds: the person pressed a song and nothing moved — not the picture, not the title, not the colours.
 *
 * So the PHONE (and only the phone — `displayPlaybackState` is untouched) puts the incoming song's title, picture and colour on screen the moment it is
 * pressed, with the "Loading…" line under it and a stopped clock. It is a picture of where we are going, never a claim that it plays:
 *   - the position is 0 and no clock runs (the time reads "–:––") until the station really plays it;
 *   - if the station fails, the transition ends and the old song comes back by itself (`isBlocking` is false → no incoming);
 *   - nothing here is ever sent anywhere, and no playback / queue / intent logic reads it.
 */
export type Incoming = { title: string; cover: string | null };
/** the incoming item + the moment of the transition it belongs to (`UrlTransition.startedAt`) */
export type TappedIncoming = Incoming & { at: number };

/** the item the STATION says it is loading (it publishes the selection first) — only while the audible old item is held, i.e. while it differs from it */
export function incomingFromStation(
  live: StationPlaybackState | null | undefined,
  held: StationPlaybackState | null | undefined,
): (Incoming & { key: string | null }) | null {
  const title = live?.currentTrack?.title?.trim();
  if (!live || !held || !title) return null;
  const liveKey = targetKeyOf(live.currentSource?.id, live.currentTrackIndex);
  const heldKey = targetKeyOf(held.currentSource?.id, held.currentTrackIndex);
  if (!liveKey || liveKey === heldKey) return null;
  return { title, cover: live.currentTrack?.cover ?? live.currentSource?.cover ?? null, key: liveKey };
}

/** the song a Next (+1) / Previous (-1) goes to, when the session's own list says so (never guessed otherwise) */
export function followingOf(s: StationPlaybackState | null | undefined, dir: 1 | -1): Incoming | null {
  if (!s) return null;
  if (dir === 1) {
    const q = s.playNextQueue?.[0];
    if (q?.title) return { title: q.title, cover: q.cover ?? null };
  }
  const tracks = s.sessionTracks ?? [];
  const i = typeof s.currentTrackIndex === "number" ? s.currentTrackIndex : -1;
  if (tracks.length && i >= 0) {
    const t = tracks[i + dir];
    if (t?.title) return { title: t.title, cover: t.cover ?? null };
    return null;
  }
  if (dir === 1 && s.nextSessionTrack?.title) return { title: s.nextSessionTrack.title, cover: s.nextSessionTrack.cover ?? null };
  return null;
}

/**
 * Which item to show as incoming, or null.
 *  - nothing is pending → null (the live / held state is shown as always);
 *  - the station already told which item it is loading AND it is the one that was asked for (or a Next/Prev, which asks for no item in particular) → the station's own (the truest);
 *  - otherwise the item that was pressed (known before the station has answered), but only the one that belongs to THIS transition.
 */
export function pickIncoming(args: {
  transition: UrlTransition | null | undefined;
  tapped: TappedIncoming | null;
  live: StationPlaybackState | null | undefined;
  held: StationPlaybackState | null | undefined;
}): Incoming | null {
  const { transition: t, tapped, live, held } = args;
  if (!t || !isBlocking(t)) return null;
  const mine = tapped && tapped.at === t.startedAt ? tapped : null;
  const st = incomingFromStation(live, held);
  if (st && (t.targetKey === null || st.key === t.targetKey)) return { title: st.title, cover: st.cover };
  if (mine) return { title: mine.title, cover: mine.cover };
  return null;
}

/** the state to draw: the base one (live / held / remembered) with the incoming song in the place of the current one, its clock stopped */
export function withIncoming(base: StationPlaybackState | null, inc: Incoming): StationPlaybackState {
  const src = base?.currentSource ?? null;
  return {
    ...(base ?? ({ queue: [], queueIndex: 0, currentTrackIndex: 0 } as unknown as StationPlaybackState)),
    status: "playing",
    currentTrack: { title: inc.title, cover: inc.cover },
    currentSource: src ? { ...src, title: inc.title, cover: inc.cover } : null,
    // the old session's list and name are not the incoming song's
    sessionTitle: null,
    sessionTracks: [],
    nextSessionTrack: null,
    playNextQueue: [],
    // a stopped clock: "–:––" until the station really plays it
    position: 0,
    positionAt: undefined,
    duration: 0,
  };
}
