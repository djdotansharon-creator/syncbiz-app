"use client";

/**
 * KioskDisplay — the business's DISPLAY SCREEN (owner 2026-10-25). What the restaurant / the shop / the supermarket shows on its screen: the song's square with its
 * progress, the three buttons and a quiet volume (up to the owner's limit), ONE panel at a time on the other side (up next · search · jingles · today) switched
 * by a few icons on the edge — and, in the corner, a slim password bar with a lock that opens the full controller.
 *
 * It is a COVER over the running app, not another page: when locked it paints over everything and makes the rest inert; the controller, the player, the
 * WebSocket and every provider stay mounted and keep running, so locking / typing the password / unlocking can never interrupt the music. This component
 * only READS playback state and sends the same commands the controller's own buttons send (`*OrSend`, jingles through `fireJingleOnAir`); the one thing it
 * changes on the provider is the ORDER of "Up next" (`reorderPlayNextItem` / `reorderSessionTrack` — the very calls the controller's drag makes).
 * What staff may do is the owner's choice (Access Control → Display screen); whatever he switches off is simply not on the screen (its icon is gone too).
 * Look (owner's reference, 2026-10-25): a background BUILT FROM the song's strongest colours (large soft colour glows that drift slowly — not a blurred picture),
 * content straight on it — no cards — big quiet type, soft pill chips. No blur layers anywhere (light enough for a simple computer). In Hebrew the whole
 * screen is laid out the OTHER way round from the language (owner 2026-10-25: "flip the design between Hebrew and English"): in Hebrew the song is on the left, the
 * panel + icons on the right and the lock top-left; in English the opposite. Text always keeps its own direction. Styles: app/kiosk-display.css.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { useDevicePlayer } from "@/lib/device-player-context";
import { useNowPosition } from "@/lib/now-position";
import { coverInfo, forgetPending, NO_COVER, paletteFor, type CoverInfo, type Palette } from "@/lib/cover-palette";
import { createGentle, type Gentle } from "@/lib/kiosk-fade";
import { useKioskDesign } from "@/lib/kiosk-design";
import { KioskTabIcon } from "@/components/kiosk-tab-icons";
import { JingleCreate } from "@/components/kiosk-jingle-create";
import { lockKiosk, setKioskTheme, tryUnlockKiosk, useKioskLocked, useKioskPermissions, useKioskTheme, verifyKioskPin, type KioskPermissions, type KioskTheme } from "@/lib/kiosk";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { getPlaylistTracks, type Playlist } from "@/lib/playlist-types";
import { classifyLibraryEntityContract, unifiedFoundationHints, type UnifiedSource } from "@/lib/source-types";
import { fetchUnifiedSourcesWithFallback } from "@/lib/unified-sources-client";
import { appendSourcesToPlaylistTracks } from "@/lib/playlist-append-sources";
import { useStationBranchId } from "@/lib/station-branch";
import { fetchCloudPads, padsFromCloud } from "@/components/jingles-control/cloud-pads";
import { bellUrl, fireJingleOnAir } from "@/components/jingles-control/fire-on-air";
import { jingleTint } from "@/components/jingles-control/jingle-tint";
import type { Schedule } from "@/lib/types";

const HE = {
  lockHint: "הקלידו סיסמה לפתיחת הבקר",
  check: "בדיקת הסיסמה",
  wrong: "הסיסמה שגויה",
  wait: (s: number) => `נסו שוב בעוד ${s} שניות`,
  search: "חפשו שיר…",
  add: "הוסיפו לתור",
  added: "נוסף ✓",
  upNext: "בתור הבא",
  nothingNext: "אין שיר בתור",
  jingles: "ג'ינגלים",
  noJingles: "אין ג'ינגלים",
  newJingle: "ג'ינגל חדש",
  onAir: "משודר",
  moveUp: "הזז למעלה",
  moveDown: "הזז למטה",
  grip: "גררו כדי לשנות סדר",
  playNow: "נגן עכשיו",
  playNext: "נגן הבא",
  addToList: "הוסף לפליילסט",
  scheduleIt: "תזמן",
  listWord: "פלייליסט",
  pickList: "בחרו פליילסט",
  noLists: "אין פליילסטים",
  dayToday: "היום",
  pickDate: "בחרו תאריך",
  prevMonth: "החודש הקודם",
  nextMonth: "החודש הבא",
  doSchedule: "תזמון",
  scheduled: "תוזמן ✓",
  addedTo: (n: string) => `נוסף אל ${n} ✓`,
  back: "חזרה",
  moreActions: "פעולות",
  now: "עכשיו",
  today: "היום",
  noSchedule: "אין תזמון להיום",
  nowPlaying: "מתנגן עכשיו",
  nothingPlaying: "אין שיר מתנגן",
  prev: "הקודם",
  next: "הבא",
  play: "נגן",
  pause: "השהה",
  volume: "עוצמה",
  themeAuto: "מראה אוטומטי לפי השיר",
  themeLight: "מראה בהיר",
  themeDark: "מראה כהה",
  more: "עוד",
  nextShort: "הבא",
  seek: "מיקום בשיר",
  songsCount: (n: number) => (n === 1 ? "שיר אחד" : `${n} שירים`),
  tabs: { next: "בתור הבא", search: "חיפוש", lists: "הפליילסטים שלי", jingles: "ג'ינגלים", day: "היום" },
};
const EN = {
  lockHint: "Type the password to open the controller",
  check: "Check the password",
  wrong: "Wrong password",
  wait: (s: number) => `Try again in ${s} s`,
  search: "Search a song…",
  add: "Add to queue",
  added: "Added ✓",
  upNext: "Up next",
  nothingNext: "Nothing queued",
  jingles: "Jingles",
  noJingles: "No jingles",
  newJingle: "New jingle",
  onAir: "On air",
  moveUp: "Move up",
  moveDown: "Move down",
  grip: "Drag to reorder",
  playNow: "Play now",
  playNext: "Play next",
  addToList: "Add to playlist",
  scheduleIt: "Schedule",
  listWord: "Playlist",
  pickList: "Choose a playlist",
  noLists: "No playlists",
  dayToday: "Today",
  pickDate: "Pick a date",
  prevMonth: "Previous month",
  nextMonth: "Next month",
  doSchedule: "Schedule",
  scheduled: "Scheduled ✓",
  addedTo: (n: string) => `Added to ${n} ✓`,
  back: "Back",
  moreActions: "Actions",
  now: "Now",
  today: "Today",
  noSchedule: "No schedule today",
  nowPlaying: "Now playing",
  nothingPlaying: "Nothing playing",
  prev: "Previous",
  next: "Next",
  play: "Play",
  pause: "Pause",
  volume: "Volume",
  themeAuto: "Look: automatic, follows the song",
  themeLight: "Look: light",
  themeDark: "Look: dark",
  more: "More",
  nextShort: "Next",
  seek: "Position in the song",
  songsCount: (n: number) => (n === 1 ? "1 song" : `${n} songs`),
  tabs: { next: "Up next", search: "Search", lists: "My playlists", jingles: "Jingles", day: "Today" },
};
type Words = typeof HE;

const pad = (n: number) => String(n).padStart(2, "0");
function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
/** "Artist - Title" → { artist, title } */
function splitTitle(raw: string): { title: string; artist: string | null } {
  const m = raw.match(/^(.+?)\s[–—-]\s(.+)$/);
  return { title: (m?.[2] ?? raw).trim(), artist: m ? m[1]!.trim() : null };
}

// ───────────────────────────────────────────────── what is playing (same rule as the library cards) ─────────────────────────────────────────────────

type Row = { key: string; title: string; artist: string | null; cover: string | null; group: "pn" | "session"; index: number; canUp: boolean; canDown: boolean };
type View = { title: string; artist: string | null; cover: string | null; status: string; rows: Row[]; movable: boolean; volume: number };

const MAX_ROWS = 5;

function row(key: string, raw: string, cover: string | null, group: Row["group"], index: number, canUp: boolean, canDown: boolean): Row {
  const { title, artist } = splitTitle(raw);
  return { key, title, artist, cover, group, index, canUp, canDown };
}

function useNowView(): View {
  const playback = usePlayback();
  const deviceCtx = useDevicePlayer();
  const controller = !!deviceCtx?.isBranchConnected && deviceCtx.deviceMode !== "MASTER";
  const ms = deviceCtx?.masterState ?? null;
  return useMemo(() => {
    if (controller && ms) {
      // a remote screen only SHOWS the station's queue — the station owns the order
      const raw = ms.currentTrack?.title ?? ms.currentSource?.title ?? "";
      const cur = ms.currentTrackIndex ?? 0;
      const rows: Row[] = [
        ...(ms.playNextQueue ?? []).map((q, i) => row(`pn-${q.id}`, q.title, q.cover, "pn", i, false, false)),
        ...(ms.sessionTracks ?? []).slice(cur + 1).map((r, i) => row(`s-${i}-${r.title}`, r.title, null, "session", cur + 1 + i, false, false)),
      ].slice(0, MAX_ROWS);
      const { title, artist } = splitTitle(raw);
      return { title, artist, cover: ms.currentTrack?.cover ?? ms.currentSource?.cover ?? null, status: ms.status, rows, movable: false, volume: typeof ms.volume === "number" ? ms.volume : 80 };
    }
    const raw = playback.currentTrack?.title ?? playback.currentSource?.title ?? "";
    const pn = playback.playNextQueue;
    const tracks = playback.currentPlaylist ? getPlaylistTracks(playback.currentPlaylist) : [];
    const cur = playback.currentTrackIndex;
    const rows: Row[] = [
      ...pn.map((q, i) => row(`pn-${q.id}`, q.title, q.cover ?? null, "pn", i, i > 0, i < pn.length - 1)),
      ...tracks.slice(cur + 1).map((t, i) => row(`s-${t.id}`, t.name, t.cover ?? null, "session", cur + 1 + i, i > 0, cur + 1 + i < tracks.length - 1)),
    ].slice(0, MAX_ROWS);
    const { title, artist } = splitTitle(raw);
    return { title, artist, cover: playback.currentTrack?.cover ?? playback.currentSource?.cover ?? null, status: playback.status, rows, movable: true, volume: playback.volume };
  }, [controller, ms, playback.currentTrack, playback.currentSource, playback.playNextQueue, playback.currentPlaylist, playback.currentTrackIndex, playback.status, playback.volume]);
}

/** play / pause / next / previous / volume — the controller's own buttons' commands */
function useTransport() {
  const playback = usePlayback();
  const d = useDevicePlayer();
  return {
    next: () => (d?.nextOrSend ? d.nextOrSend() : playback.next()),
    prev: () => (d?.prevOrSend ? d.prevOrSend() : playback.prev()),
    play: () => (d?.playOrSend ? d.playOrSend() : playback.play()),
    pause: () => (d?.pauseOrSend ? d.pauseOrSend() : playback.pause()),
    volume: (v: number) => (d?.setVolumeOrSend ? d.setVolumeOrSend(v) : playback.setVolume(v)),
    /** play a source right now (the controller's own play) — only from the ⋯ menu of a search result */
    playNow: (s: UnifiedSource) => (d?.playSourceOrSend ? d.playSourceOrSend(s) : playback.playSource(s)),
    /** move within the song (only on screens where the owner allowed it) */
    seek: (sec: number) => (d?.seekOrSend ? d.seekOrSend(sec) : playback.seekTo(sec)),
    queueNext: (s: UnifiedSource) => (d?.queueNextOrSend ? d.queueNextOrSend(s) : playback.addPlayNextSources([s])),
    /** move one row of "Up next" one step — the same calls the controller's drag makes */
    move: (r: Row, dir: -1 | 1) => (r.group === "pn" ? playback.reorderPlayNextItem(r.index, r.index + dir) : playback.reorderSessionTrack(r.index, r.index + dir)),
    /** move a row to another place of its own group (the same two provider calls, now to any index — used by the drag handle) */
    moveTo: (r: Row, to: number) => (r.group === "pn" ? playback.reorderPlayNextItem(r.index, to) : playback.reorderSessionTrack(r.index, to)),
    deviceCtx: d,
  };
}

// ───────────────────────────────────────────────── the colour field behind everything ─────────────────────────────────────────────────

/**
 * The background: the song's STRONG colours as four large soft glows on a dark base (lib/cover-palette.ts), slowly drifting (transform only). A new song crossfades
 * to its own colours: two layers, the hidden one holds still. No blur filter anywhere.
 */
type Colors = { a: Palette; b: Palette; front: 0 | 1 };

/**
 * What the display knows about the song's cover (its main colours, how bright it is). The last answer STAYS until the next cover has been read — a moment without a cover
 * (normal between two songs) never flashes the idle colours; only after 2.5 s without any cover does the screen settle on them.
 */
function useCoverInfo(cover: string | null, seed: string, initial: CoverInfo | null): CoverInfo {
  const [info, setInfo] = useState<CoverInfo>(initial ?? NO_COVER);
  const [back, setBack] = useState(0);
  // when the window comes back to the front (another desktop, another tab) look at the cover again — a read that was stuck in the background is asked again
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === "visible") setBack((n) => n + 1);
    };
    document.addEventListener("visibilitychange", on);
    window.addEventListener("focus", on);
    return () => {
      document.removeEventListener("visibilitychange", on);
      window.removeEventListener("focus", on);
    };
  }, []);
  useEffect(() => {
    let off = false;
    if (!cover) {
      const id = setTimeout(() => !off && setInfo(NO_COVER), 2500);
      return () => {
        off = true;
        clearTimeout(id);
      };
    }
    if (back > 0) forgetPending(cover);
    void coverInfo(cover, seed).then((i) => {
      if (!off) setInfo(i);
    });
    return () => {
      off = true;
    };
  }, [cover, seed, back]);
  return info;
}

const hslOf = (c: string): [number, number, number] => {
  const m = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(c);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
};
/** two palettes that look the same (a thumbnail re-read at another size) are the same — no crossfade for a change nobody can see */
function similar(a: Palette, b: Palette): boolean {
  return a.every((c, i) => {
    const [h1, s1, l1] = hslOf(c);
    const [h2, s2, l2] = hslOf(b[i]!);
    const dh = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
    return dh <= 10 && Math.abs(s1 - s2) <= 10 && Math.abs(l1 - l2) <= 7;
  });
}

/** the glow colours on screen: a new palette goes onto the hidden layer, which then fades in (calmly, once — never back and forth) */
function useCrossfade(palette: Palette): Colors {
  const key = palette.join("|");
  const [st, setSt] = useState<Colors>({ a: palette, b: palette, front: 0 });
  const now = st.front === 0 ? st.a : st.b;
  if (now.join("|") !== key && !similar(now, palette)) setSt(st.front === 0 ? { ...st, b: palette, front: 1 } : { ...st, a: palette, front: 0 });
  return st;
}

function Field({ st }: { st: Colors }): ReactElement {
  return (
    <div className="sb-kiosk-field" aria-hidden>
      {([st.a, st.b] as const).map((p, i) => (
        <div key={i} className="sb-kiosk-glow" data-front={st.front === i ? "1" : "0"} style={{ ["--c1" as string]: p[0], ["--c2" as string]: p[1], ["--c3" as string]: p[2], ["--c4" as string]: p[3] } as CSSProperties}>
          <i />
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────── the cover square ─────────────────────────────────────────────────

/** The cover. When the song changes the old picture stays underneath and sinks away slowly while the new one comes up with a soft, slow zoom. */
function CoverArt({ cover }: { cover: string | null }): ReactElement {
  const [shown, setShown] = useState<{ cur: string | null; prev: string | null }>({ cur: cover, prev: null });
  if (shown.cur !== cover) setShown({ cur: cover, prev: shown.cur });
  useEffect(() => {
    if (!shown.prev) return;
    const id = setTimeout(() => setShown((x) => ({ ...x, prev: null })), 2200);
    return () => clearTimeout(id);
  }, [shown.prev]);
  return (
    <div className="sb-kiosk-art">
      {shown.cur === null ? (
        <svg viewBox="0 0 24 24" width="36%" height="36%" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      ) : null}
      {shown.prev ? <img key={`old-${shown.prev}`} className="sb-kiosk-art-old" src={shown.prev} alt="" draggable={false} /> : null}
      {shown.cur ? <img key={`new-${shown.cur}`} className="sb-kiosk-art-new" src={shown.cur} alt="" draggable={false} /> : null}
    </div>
  );
}

// ───────────────────────────────────────────────── the slim password bar ─────────────────────────────────────────────────

const LockIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
    <path d="M7 10V8a5 5 0 0 1 10 0v2h.5A2.5 2.5 0 0 1 20 12.5v6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-6A2.5 2.5 0 0 1 6.5 10H7Zm2 0h6V8a3 3 0 0 0-6 0v2Z" />
  </svg>
);
const CheckIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

/** the success mark: the ✓ is drawn, its line carries on round into a ring, the ring melts away again and a quick green ✓ stays */
const OkMark = () => (
  <svg className="sb-kiosk-okmark" viewBox="0 0 24 24" width="1.7em" height="1.7em" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle className="ring" cx="12" cy="12" r="9.6" pathLength="1" />
    <path className="tick" d="m6.2 12.6 4 4 7.6-8.6" pathLength="1" />
  </svg>
);

/**
 * The lock opens ONE slim bar in the middle of the screen — no frame, no word: a blinking line says "type". The icon sits on the same side as the corner lock (the left in
 * Hebrew): a lock; a grey ✓ once something is typed; pressing it (or Enter) checks the password — wrong: the lock turns red and the bar shakes; right: the ✓ draws itself into a
 * ring and back into a quick green ✓ (the bar itself never changes colour) and the controller opens. Escape, a click outside or 20 quiet seconds put it away.
 */
function PinBar({ t, onClose }: { t: Words; onClose: () => void }): ReactElement {
  const [pin, setPin] = useState("");
  const [state, setState] = useState<"idle" | "bad" | "ok">("idle");
  const [tries, setTries] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!waitUntil) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [waitUntil]);
  const waiting = waitUntil > now ? Math.ceil((waitUntil - now) / 1000) : 0;
  useEffect(() => {
    if (state === "ok") return;
    const id = setTimeout(onClose, 20_000);
    return () => clearTimeout(id);
  }, [pin, state, onClose]);
  const check = async () => {
    if (!pin || waiting > 0 || state === "ok") return;
    if (await verifyKioskPin(pin)) {
      setState("ok"); // the ✓ draws itself, then the lock opens and the screen fades away
      window.setTimeout(() => void tryUnlockKiosk(pin), 900);
      return;
    }
    setState("bad");
    setPin("");
    const n = tries + 1;
    setTries(n);
    if (n >= 5) {
      setTries(0);
      setNow(Date.now());
      setWaitUntil(Date.now() + 30_000);
    }
    window.setTimeout(() => setState("idle"), 1300);
    input.current?.focus();
  };
  const typed = pin.length > 0;
  const icon = state === "ok" ? <OkMark /> : state === "bad" ? <LockIcon /> : typed ? <CheckIcon /> : <LockIcon />;
  return (
    <div className="sb-kiosk-pinbar" data-state={state} data-typed={typed ? "1" : undefined} title={waiting > 0 ? t.wait(waiting) : state === "bad" ? t.wrong : t.lockHint} onPointerDown={() => window.setTimeout(() => input.current?.focus(), 0)}>
      <button type="button" className="sb-kiosk-pin-btn" onClick={() => void check()} disabled={!typed || state === "ok" || waiting > 0} aria-label={typed ? t.check : t.lockHint} tabIndex={typed ? 0 : -1}>
        {icon}
      </button>
      <span className="sb-kiosk-pin-field">
        {/* nothing typed yet → no word, just a blinking line that says "type here" */}
        {!typed && waiting === 0 && state === "idle" ? <i className="sb-kiosk-caret" aria-hidden /> : null}
        <input
          ref={input}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          placeholder={waiting > 0 ? t.wait(waiting) : undefined}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => (e.key === "Enter" ? void check() : e.key === "Escape" ? onClose() : undefined)}
          aria-label={t.lockHint}
          autoFocus
          disabled={waiting > 0 || state === "ok"}
        />
      </span>
    </div>
  );
}

// ───────────────────────────────────────────────── search ─────────────────────────────────────────────────

type Hit =
  | { kind: "song"; id: string; title: string; url: string; cover: string | null; vid: string }
  | { kind: "list"; id: string; title: string; cover: string | null; src: UnifiedSource; playlist: Playlist };

const songSource = (h: Extract<Hit, { kind: "song" }>): UnifiedSource =>
  ({
    id: `search-play-${h.vid}`,
    title: h.title,
    genre: "Search",
    cover: h.cover,
    type: "youtube",
    url: h.url,
    origin: "playlist",
    ...unifiedFoundationHints("playlist", "youtube", h.url),
  }) as UnifiedSource;

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** a small month calendar for the schedule sheet: days before today cannot be picked; the week starts on Sunday (as in Israel and the US) */
function CalendarPicker({ t, he, value, today, onPick }: { t: Words; he: boolean; value: Date; today: Date; onPick: (d: Date) => void }): ReactElement {
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  const loc = he ? "he-IL" : "en-US";
  const y = month.getFullYear();
  const m = month.getMonth();
  const lead = month.getDay();
  const count = new Date(y, m + 1, 0).getDate();
  const cells: Array<Date | null> = [...Array.from({ length: lead }, () => null), ...Array.from({ length: count }, (_, i) => new Date(y, m, i + 1))];
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(loc, { weekday: "narrow" })); // 1 Jan 2023 was a Sunday
  const canPrev = y > today.getFullYear() || (y === today.getFullYear() && m > today.getMonth());
  const chevron = (d: string) => (
    <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
  return (
    <div className="sb-kiosk-cal" role="group" aria-label={t.pickDate}>
      <div className="sb-kiosk-cal-head">
        <button type="button" className="sb-kiosk-cal-nav" data-dir="prev" disabled={!canPrev} aria-label={t.prevMonth} onClick={() => setMonth(new Date(y, m - 1, 1))}>{chevron("m15 6-6 6 6 6")}</button>
        <b>{month.toLocaleDateString(loc, { month: "long", year: "numeric" })}</b>
        <button type="button" className="sb-kiosk-cal-nav" data-dir="next" aria-label={t.nextMonth} onClick={() => setMonth(new Date(y, m + 1, 1))}>{chevron("m9 6 6 6-6 6")}</button>
      </div>
      <div className="sb-kiosk-cal-grid">
        {weekdays.map((w, i) => <span key={i} aria-hidden>{w}</span>)}
        {cells.map((d, i) =>
          d ? (
            <button key={i} type="button" className="sb-kiosk-cal-day" disabled={d < today} data-today={sameDay(d, today) ? "1" : undefined} data-on={sameDay(d, value) ? "1" : undefined} onClick={() => onPick(d)}>
              {d.getDate()}
            </button>
          ) : (
            <i key={i} aria-hidden />
          ),
        )}
      </div>
    </div>
  );
}

function SheetItem({ icon, label, onClick }: { icon: ReactElement; label: string; onClick: () => void }): ReactElement {
  return (
    <button type="button" className="sb-kiosk-sheet-item" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}
const sheetIcon = (d: string): ReactElement => (
  <svg viewBox="0 0 24 24" width="1.4em" height="1.4em" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

/** the glass sheet of a search result: Play now · Play next · Add to playlist · Schedule — opens beside the list (toward the middle), never over it */
function ResultSheet({ t, he, hit, top, lists, onClose }: { t: Words; he: boolean; hit: Hit; top: number; lists: Playlist[] | null; onClose: () => void }): ReactElement | null {
  const tr = useTransport();
  const perms = useKioskPermissions();
  const branch = useStationBranchId() ?? "default";
  const [view, setView] = useState<"root" | "lists" | "when">("root");
  const [note, setNote] = useState<string | null>(null);
  // "Today" by default, half an hour from now (rounded up to five minutes — which may already be after midnight); a calendar opens from the date button for any other day
  const [today] = useState(() => startOfDay(new Date()));
  const [soon] = useState(() => new Date(Math.ceil((Date.now() + 30 * 60_000) / 300_000) * 300_000));
  const [date, setDate] = useState(() => startOfDay(soon));
  const [cal, setCal] = useState(false);
  const [time, setTime] = useState(() => `${pad2(soon.getHours())}:${pad2(soon.getMinutes())}`);
  const host = typeof document !== "undefined" ? document.querySelector(".sb-kiosk-panel") : null;
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".sb-kiosk-sheet, .sb-kiosk-dots")) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  if (!host) return null;
  const done = (msg: string) => {
    setNote(msg);
    window.setTimeout(onClose, 900);
  };
  const src = hit.kind === "song" ? songSource(hit) : hit.src;
  const canLibrary = perms.library;

  const addToList = async (pl: Playlist) => {
    try {
      const getRes = await fetch(`/api/playlists/${pl.id}`);
      if (!getRes.ok) return;
      const current = (await getRes.json()) as Playlist;
      const { tracks, order, addedCount } = appendSourcesToPlaylistTracks(current, [src]);
      if (addedCount > 0) {
        const putRes = await fetch(`/api/playlists/${pl.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tracks, order }) });
        if (!putRes.ok) return;
        window.dispatchEvent(new Event("library-updated"));
      }
      done(t.addedTo(pl.name));
    } catch {
      /* nothing was changed */
    }
  };

  const schedule = async () => {
    try {
      let targetId = hit.kind === "list" ? hit.playlist.id : "";
      if (hit.kind === "song") {
        // a song is kept in the library as a one-song playlist (how the library stores a saved search result) — it needs to be there to be scheduled
        const res = await fetch("/api/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: hit.title, url: hit.url, type: "youtube", genre: "Search", thumbnail: hit.cover ?? "", branchId: branch }) });
        if (!res.ok) return;
        targetId = ((await res.json()) as Playlist).id;
      }
      const [hh = "0", mm = "0"] = time.split(":");
      const startMin = Number(hh) * 60 + Number(mm);
      const length = hit.kind === "list" ? 60 : 8; // a song's window is a few minutes, a playlist's an hour
      const endMin = Math.min(23 * 60 + 59, startMin + length);
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: hit.title, branchId: branch, targetType: "PLAYLIST", targetId, recurrence: "one_off", oneOffDateLocal: ymdOf(date), daysOfWeek: [], startTimeLocal: `${pad2(Number(hh))}:${pad2(Number(mm))}`, endTimeLocal: `${pad2(Math.floor(endMin / 60))}:${pad2(endMin % 60)}`, enabled: true }),
      });
      if (!res.ok) return;
      window.dispatchEvent(new Event("library-updated"));
      done(t.scheduled);
    } catch {
      /* nothing was scheduled */
    }
  };

  return createPortal(
    <div className="sb-kiosk-sheet" data-view={view === "when" && cal ? "cal" : undefined} style={{ ["--top" as string]: `${top}px` } as CSSProperties} role="menu">
      {note ? (
        <p className="sb-kiosk-sheet-note">{note}</p>
      ) : view === "root" ? (
        <>
          <SheetItem icon={<svg viewBox="0 0 24 24" width="1.4em" height="1.4em" fill="currentColor" aria-hidden><path d="M7.4 5.2c0-1 1.1-1.6 1.9-1.1l11 6.8c.7.4.7 1.4 0 1.8l-11 6.8c-.8.5-1.9-.1-1.9-1.1V5.2Z" /></svg>} label={t.playNow} onClick={() => { tr.playNow(src); onClose(); }} />
          <SheetItem icon={sheetIcon("M4 6.5h11M4 12h8M4 17.5h6M16 13.5l5 3-5 3z")} label={t.playNext} onClick={() => { tr.queueNext(src); done(t.added); }} />
          {canLibrary && hit.kind === "song" ? <SheetItem icon={sheetIcon("M4 7h11M4 12h8M4 17h5M18 13v6M15 16h6")} label={t.addToList} onClick={() => setView("lists")} /> : null}
          {canLibrary ? <SheetItem icon={sheetIcon("M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 8v4.5l3 1.8")} label={t.scheduleIt} onClick={() => setView("when")} /> : null}
        </>
      ) : view === "lists" ? (
        <>
          <button type="button" className="sb-kiosk-sheet-back" onClick={() => setView("root")}>{t.back}</button>
          <div className="sb-kiosk-sheet-scroll">
            {lists === null ? null : lists.length === 0 ? <p className="sb-kiosk-empty">{t.noLists}</p> : lists.map((pl) => <SheetItem key={pl.id} icon={sheetIcon("M4 7h11M4 12h11M4 17h7M18 15V6l3 1")} label={pl.name} onClick={() => void addToList(pl)} />)}
          </div>
        </>
      ) : (
        <>
          <button type="button" className="sb-kiosk-sheet-back" onClick={() => (cal ? setCal(false) : setView("root"))}>{t.back}</button>
          {cal ? (
            <CalendarPicker
              t={t}
              he={he}
              value={date}
              today={today}
              onPick={(d) => {
                setDate(d);
                setCal(false);
              }}
            />
          ) : (
            <div className="sb-kiosk-when">
              <button type="button" className="sb-kiosk-when-day" onClick={() => setCal(true)} aria-label={t.pickDate} aria-expanded={cal}>
                <svg viewBox="0 0 24 24" width="1.3em" height="1.3em" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
                  <path d="M3.5 10h17M8 3v4M16 3v4" />
                </svg>
                <span>{sameDay(date, today) ? t.dayToday : date.toLocaleDateString(he ? "he-IL" : "en-US", { weekday: "short", day: "numeric", month: "short" })}</span>
              </button>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} dir="ltr" aria-label={t.scheduleIt} />
              <button type="button" className="sb-kiosk-when-go" onClick={() => void schedule()}>{t.doSchedule}</button>
            </div>
          )}
        </>
      )}
    </div>,
    host,
  );
}

/** the search shows the FIRST four results; "More" shows four more (the search itself brings at most 15) */
const HITS_FIRST = 4;
const HITS_STEP = 4;

function Search({ t, he, lists }: { t: Words; he: boolean; lists: UnifiedSource[] | null }): ReactElement {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(HITS_FIRST);
  const wrap = useRef<HTMLDivElement>(null);
  const [songs, setSongs] = useState<Hit[]>([]);
  const [menu, setMenu] = useState<{ id: string; top: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    let off = false;
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/sources/search?q=${encodeURIComponent(query)}`);
        const j = (await r.json()) as { results?: Array<{ title: string; url: string; cover?: string | null; type?: string }> };
        if (off) return;
        const out: Hit[] = [];
        for (const x of j.results ?? []) {
          const vid = x.type === "youtube" ? getYouTubeVideoId(x.url) : null;
          if (vid && !out.some((o) => o.kind === "song" && o.vid === vid)) out.push({ kind: "song", id: `s-${vid}`, title: x.title, url: x.url, cover: x.cover ?? null, vid }); // the same video can come back twice
          if (out.length >= 15) break;
        }
        setSongs(out);
      } catch {
        if (!off) setSongs([]);
      }
    }, 350);
    return () => {
      off = true;
      clearTimeout(id);
    };
  }, [q]);
  const query = q.trim();
  const mine: Hit[] =
    query.length >= 2 && lists
      ? lists
          .filter((x) => x.title.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 4)
          .map((x) => ({ kind: "list" as const, id: `l-${x.playlist!.id}`, title: x.title, cover: x.cover ?? null, src: x, playlist: x.playlist! }))
      : [];
  const shown: Hit[] = query.length >= 2 ? [...mine, ...songs] : [];
  const open = menu ? shown.find((h) => h.id === menu.id) ?? null : null;
  return (
    <div className="sb-kiosk-searchbox">
      <div className="sb-kiosk-search" data-typed={q.length > 0 ? "1" : undefined}>
        <svg className="sb-kiosk-search-ico" viewBox="0 0 24 24" width="1.35em" height="1.35em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16.5 16.5 4 4" />
        </svg>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(HITS_FIRST);
          }}
          aria-label={t.search}
          dir={q ? "auto" : he ? "rtl" : "ltr"}
        />
      </div>
      {shown.length > 0 ? (
        <div className="sb-kiosk-hits-wrap" ref={wrap} data-long={limit > HITS_FIRST ? "1" : undefined}>
          <ul className="sb-kiosk-hits">
            {shown.slice(0, limit).map((h, n) => (
              <li key={h.id} style={{ ["--i" as string]: n % HITS_STEP } as CSSProperties}>
                <span className="sb-kiosk-hit-art">{h.cover ? <img src={h.cover} alt="" draggable={false} /> : null}</span>
                <span className="sb-kiosk-hit-name">
                  <b dir="auto">{h.title}</b>
                  {h.kind === "list" ? <small>{t.listWord}</small> : null}
                </span>
                <button
                  type="button"
                  className="sb-kiosk-dots"
                  aria-label={t.moreActions}
                  aria-haspopup="menu"
                  aria-expanded={menu?.id === h.id}
                  onClick={(e) => {
                    const li = e.currentTarget.closest("li");
                    const panel = li?.closest(".sb-kiosk-panel");
                    if (!li || !panel) return;
                    setMenu(menu?.id === h.id ? null : { id: h.id, top: li.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8 });
                  }}
                >
                  <svg viewBox="0 0 24 24" width="1.5em" height="1.5em" fill="currentColor" aria-hidden>
                    <circle cx="5.5" cy="12" r="1.7" />
                    <circle cx="12" cy="12" r="1.7" />
                    <circle cx="18.5" cy="12" r="1.7" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
          {shown.length > limit ? (
            <button
              type="button"
              className="sb-kiosk-more"
              onClick={() => {
                const from = limit;
                setLimit(from + HITS_STEP);
                // the new rows rise in under the old ones; the list eases down so the first new one is in view
                window.setTimeout(() => {
                  const box = wrap.current;
                  const li = box?.querySelectorAll("li")[from] as HTMLElement | undefined;
                  if (box && li) box.scrollTo({ top: li.offsetTop - 6, behavior: "smooth" });
                }, 60);
              }}
            >
              {t.more}
            </button>
          ) : null}
        </div>
      ) : null}
      {open ? <ResultSheet key={open.id} t={t} he={he} hit={open} top={menu?.top ?? 0} lists={lists === null ? null : lists.map((x) => x.playlist!)} onClose={closeMenu} /> : null}
    </div>
  );
}

/**
 * The library's PLAYLISTS (collections — not single songs), exactly as the library itself lists them. Loaded once when the display comes up and quietly refreshed when the
 * search / playlists page opens or the library changes — the old list stays on screen meanwhile, so nothing fills in late while a page slides.
 */
function useLibraryLists(active: boolean, page: string | null): UnifiedSource[] | null {
  const [lists, setLists] = useState<UnifiedSource[] | null>(null);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (!active) return;
    const again = () => setBump((n) => n + 1);
    window.addEventListener("library-updated", again);
    return () => window.removeEventListener("library-updated", again);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    let off = false;
    void fetchUnifiedSourcesWithFallback()
      .then((items) => !off && setLists(items.filter((x) => x.origin === "playlist" && !!x.playlist && classifyLibraryEntityContract(x).entityKind === "collection")))
      .catch(() => !off && setLists((cur) => cur ?? []));
    return () => {
      off = true;
    };
  }, [active, page, bump]);
  return lists;
}

/** "My playlists": the business's ready-made playlists — one press on ▶ puts one on, ⋯ opens the same glass sheet as a search result (Play now · Play next · Schedule) */
function Playlists({ t, he, lists }: { t: Words; he: boolean; lists: UnifiedSource[] | null }): ReactElement {
  const tr = useTransport();
  const [menu, setMenu] = useState<{ id: string; top: number } | null>(null);
  const [fired, setFired] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const items: Hit[] = (lists ?? []).map((x) => ({ kind: "list" as const, id: `l-${x.playlist!.id}`, title: x.title, cover: x.cover ?? null, src: x, playlist: x.playlist! }));
  const open = menu ? items.find((h) => h.id === menu.id) ?? null : null;
  const count = (h: Hit) => (h.kind === "list" ? getPlaylistTracks(h.playlist).length : 0);
  return (
    <div className="sb-kiosk-plists">
      {lists === null ? null : items.length === 0 ? (
        <p className="sb-kiosk-empty">{t.noLists}</p>
      ) : (
        <div className="sb-kiosk-hits-wrap" data-long={items.length > 4 ? "1" : undefined}>
          <ul className="sb-kiosk-hits">
            {items.map((h, n) => (
              <li key={h.id} style={{ ["--i" as string]: n % 4 } as CSSProperties}>
                <span className="sb-kiosk-hit-art">{h.cover ? <img src={h.cover} alt="" draggable={false} /> : null}</span>
                <span className="sb-kiosk-hit-name">
                  <b dir="auto">{h.title}</b>
                  {count(h) > 0 ? <small>{t.songsCount(count(h))}</small> : null}
                </span>
                <span className="sb-kiosk-plist-acts">
                  <button
                    type="button"
                    className="sb-kiosk-plist-play"
                    data-fired={fired === h.id ? "1" : undefined}
                    aria-label={t.playNow}
                    onClick={() => {
                      if (h.kind !== "list") return;
                      tr.playNow(h.src);
                      setFired(h.id);
                      window.setTimeout(() => setFired((cur) => (cur === h.id ? null : cur)), 1600);
                    }}
                  >
                    {fired === h.id ? (
                      <CheckIcon size={20} />
                    ) : (
                      <svg viewBox="0 0 24 24" width="1.4em" height="1.4em" fill="currentColor" aria-hidden>
                        <path d="M7.4 5.2c0-1 1.1-1.6 1.9-1.1l11 6.8c.7.4.7 1.4 0 1.8l-11 6.8c-.8.5-1.9-.1-1.9-1.1V5.2Z" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className="sb-kiosk-dots"
                    aria-label={t.moreActions}
                    aria-haspopup="menu"
                    aria-expanded={menu?.id === h.id}
                    onClick={(e) => {
                      const li = e.currentTarget.closest("li");
                      const panel = li?.closest(".sb-kiosk-panel");
                      if (!li || !panel) return;
                      setMenu(menu?.id === h.id ? null : { id: h.id, top: li.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8 });
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="1.5em" height="1.5em" fill="currentColor" aria-hidden>
                      <circle cx="5.5" cy="12" r="1.7" />
                      <circle cx="12" cy="12" r="1.7" />
                      <circle cx="18.5" cy="12" r="1.7" />
                    </svg>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open ? <ResultSheet key={open.id} t={t} he={he} hit={open} top={menu?.top ?? 0} lists={null} onClose={closeMenu} /> : null}
    </div>
  );
}

// ───────────────────────────────────────────────── the day ─────────────────────────────────────────────────

type Block = { id: string; name: string; from: number; to: number };

function useToday(): { blocks: Block[]; minutes: number; date: Date } {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [date, setDate] = useState(() => new Date());
  useEffect(() => {
    let off = false;
    const load = () =>
      fetch("/api/schedules")
        .then((r) => (r.ok ? r.json() : []))
        .then((j: unknown) => !off && Array.isArray(j) && setSchedules(j as Schedule[]))
        .catch(() => {});
    load();
    const refresh = setInterval(load, 5 * 60_000);
    const tick = setInterval(() => setDate(new Date()), 15_000);
    const back = () => {
      if (document.visibilityState !== "visible") return;
      setDate(new Date());
      load();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      off = true;
      clearInterval(refresh);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const dow = date.getDay();
  const blocks = useMemo(() => {
    const mins = (s: string) => {
      const p = (s ?? "").split(":");
      return (parseInt(p[0] ?? "0", 10) || 0) * 60 + (parseInt(p[1] ?? "0", 10) || 0);
    };
    return schedules
      .filter((s) => s.enabled && (s.recurrence === "one_off" ? (s.oneOffDateLocal ?? "").trim() === ymd : (s.daysOfWeek ?? []).includes(dow)))
      .map((s) => {
        const from = mins(s.startTimeLocal);
        let to = mins(s.endTimeLocal);
        if (to <= from) to = 24 * 60; // an overnight window is drawn to the end of today
        return { id: s.id, name: s.name?.trim() || "", from, to };
      })
      .sort((x, y) => x.from - y.from);
  }, [schedules, ymd, dow]);
  return { blocks, minutes: date.getHours() * 60 + date.getMinutes(), date };
}

const PALETTE = ["#3b82f6", "#ff5a4f", "#2dd4bf", "#f5b53d", "#a78bfa"];
const hhmm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/** today, as a quiet list: what is on now and what is still to come */
function DayList({ t, blocks, minutes }: { t: Words; blocks: Block[]; minutes: number }): ReactElement {
  const rest = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.to > minutes);
  return (
    <section className="sb-kiosk-day">
      {rest.length === 0 ? (
        <p className="sb-kiosk-empty">{t.noSchedule}</p>
      ) : (
        <ol>
          {rest.map(({ b, i }) => {
            const current = b.from <= minutes;
            return (
              <li key={b.id} data-current={current ? "1" : undefined}>
                <i style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden />
                <span className="sb-kiosk-day-name" dir="auto" title={b.name}>{b.name || "—"}</span>
                <small dir="ltr">{current ? t.now : `${hhmm(b.from)} – ${hhmm(b.to)}`}</small>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ───────────────────────────────────────────────── up next, jingles, what staff may do ─────────────────────────────────────────────────

function UpNext({ t, he, view, canMove, onMove, onMoveTo }: { t: Words; he: boolean; view: View; canMove: boolean; onMove: (r: Row, dir: -1 | 1) => void; onMoveTo: (r: Row, to: number) => void }): ReactElement {
  const handles = canMove && view.movable;
  const list = useRef<HTMLOListElement>(null);
  const tops = useRef<Map<string, number>>(new Map());
  const drop = useRef<{ key: string; offset: number } | null>(null);
  const gesture = useRef<{ key: string; from: number; min: number; max: number; startY: number; step: number } | null>(null);
  const [drag, setDrag] = useState<{ key: string; from: number; to: number; dy: number; step: number } | null>(null);

  // when a row changes place (the queue moved on, or a song was dropped in a new place) it SLIDES to its new place instead of jumping — display-only, transform only
  useLayoutEffect(() => {
    const ol = list.current;
    if (!ol) return;
    const next = new Map<string, number>();
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dropped = drop.current;
    ol.querySelectorAll<HTMLElement>(":scope > li[data-k]").forEach((li) => {
      const k = li.dataset.k ?? "";
      const top = li.offsetTop; // layout position inside the card — a card that is sliding does not make the rows think they moved
      const was = tops.current.get(k);
      if (dropped) {
        // a drop: the other rows are already standing in their new places (the drag moved them), only the dropped row eases from where it was let go
        if (k === dropped.key && !still && Math.abs(dropped.offset) > 1) li.animate([{ transform: `translateY(${dropped.offset}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      } else if (!still && was !== undefined && Math.abs(was - top) > 1) {
        li.animate([{ transform: `translateY(${was - top}px)` }, { transform: "none" }], { duration: 340, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      }
      next.set(k, top);
    });
    drop.current = null;
    tops.current = next;
  });

  const finish = (r: Row, cancel: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    const d = drag;
    setDrag(null);
    if (!g || !d) return;
    const moved = !cancel && d.to !== g.from;
    drop.current = { key: g.key, offset: moved ? d.dy - (d.to - g.from) * g.step : d.dy };
    if (moved) {
      const target = view.rows[d.to];
      if (target) onMoveTo(r, target.index);
    }
  };

  return (
    <section className="sb-kiosk-next" dir={he ? "rtl" : "ltr"}>
      {view.rows.length === 0 ? (
        <p className="sb-kiosk-empty">{t.nothingNext}</p>
      ) : (
        <ol ref={list}>
          {view.rows.map((r, n) => {
            const off = !drag ? 0 : r.key === drag.key ? drag.dy : drag.from < drag.to && n > drag.from && n <= drag.to ? -drag.step : drag.from > drag.to && n >= drag.to && n < drag.from ? drag.step : 0;
            const mine = drag?.key === r.key;
            return (
              <li
                key={r.key}
                data-k={r.key}
                data-drag={mine ? "1" : undefined}
                style={{ ["--i" as string]: n, transform: off ? `translateY(${off}px)${mine ? " scale(1.03)" : ""}` : undefined, transition: mine ? "none" : drag ? "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined } as CSSProperties}
              >
                <span className="sb-kiosk-next-art">{r.cover ? <img src={r.cover} alt="" draggable={false} /> : null}</span>
                <span className="sb-kiosk-next-text">
                  <b dir="auto">{r.title}</b>
                  {r.artist ? <small dir="auto">{r.artist}</small> : null}
                </span>
                {handles ? (
                  <button
                    type="button"
                    className="sb-kiosk-grip"
                    aria-label={t.grip}
                    onPointerDown={(e) => {
                      if (e.pointerType === "mouse" && e.button !== 0) return;
                      const ol = list.current;
                      const li = e.currentTarget.closest("li");
                      if (!ol || !li) return;
                      const lis = [...ol.querySelectorAll<HTMLElement>(":scope > li[data-k]")];
                      const from = lis.indexOf(li as HTMLElement);
                      const same = view.rows.map((x, j) => (x.group === r.group ? j : -1)).filter((j) => j >= 0);
                      const step = lis.length > 1 ? lis[1]!.offsetTop - lis[0]!.offsetTop : (li as HTMLElement).offsetHeight;
                      gesture.current = { key: r.key, from, min: Math.min(...same), max: Math.max(...same), startY: e.clientY, step };
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDrag({ key: r.key, from, to: from, dy: 0, step });
                    }}
                    onPointerMove={(e) => {
                      const g = gesture.current;
                      if (!g || g.key !== r.key) return;
                      const dy = Math.min((g.max - g.from) * g.step, Math.max((g.min - g.from) * g.step, e.clientY - g.startY));
                      setDrag({ key: g.key, from: g.from, to: Math.min(g.max, Math.max(g.min, g.from + Math.round(dy / g.step))), dy, step: g.step });
                    }}
                    onPointerUp={() => finish(r, false)}
                    onPointerCancel={() => finish(r, true)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp" && r.canUp) onMove(r, -1);
                      else if (e.key === "ArrowDown" && r.canDown) onMove(r, 1);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="1.5em" height="1.5em" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden>
                      <path d="M5 7.5h14M7.5 12h9M5 16.5h14" />
                    </svg>
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

type Jingle = { id: string; label: string; url: string; color: string; bell: string | null };

const PAD_COLORS: Record<string, string> = { default: "#9ca3af", sky: "#38bdf8", violet: "#c084fc", pink: "#f472b6", amber: "#fbbf24", rose: "#fb7185", teal: "#2dd4bf", lime: "#a3e635", indigo: "#818cf8" };

async function loadJingles(): Promise<Jingle[]> {
  const out: Jingle[] = [];
  try {
    for (const p of padsFromCloud(await fetchCloudPads())) {
      if (p.url) out.push({ id: p.id, label: p.label, url: p.url, color: PAD_COLORS[p.color ?? "default"] ?? PAD_COLORS.default!, bell: p.preRoll ? bellUrl(p.bellStyle ?? "ding") : null });
    }
  } catch {
    /* no pads for this account */
  }
  try {
    const res = await fetch("/api/jingles/library", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { items?: Array<{ id: string; title: string; url: string }> };
      // a jingle that is already a button (saved from the Jingles console or from here) is not listed a second time
      const onScreen = new Set(out.map((o) => o.url));
      for (const i of data.items ?? []) if (i.url && !onScreen.has(i.url)) out.push({ id: `lib-${i.id}`, label: i.title || "Jingle", url: i.url, color: jingleTint(i.id), bell: null });
    }
  } catch {
    /* no library */
  }
  return out.slice(0, 8);
}

/** The jingles, loaded when the display comes up (so the page never fills in late and jumps while it slides in) and again — quietly, the old buttons stay on screen — after a new one was added. */
function useJingles(active: boolean, version: number): Jingle[] | null {
  const [items, setItems] = useState<Jingle[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let off = false;
    void loadJingles().then((j) => !off && setItems(j));
    return () => {
      off = true;
    };
  }, [active, version]);
  return items;
}

function Jingles({ t, he, items, canCreate, onAdded }: { t: Words; he: boolean; items: Jingle[] | null; canCreate: boolean; onAdded: () => void }): ReactElement | null {
  const { deviceCtx } = useTransport();
  const [fired, setFired] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const fire = (j: Jingle) => {
    if (j.bell) fireJingleOnAir(deviceCtx, j.bell);
    fireJingleOnAir(deviceCtx, j.url);
    setFired(j.id);
    window.setTimeout(() => setFired((cur) => (cur === j.id ? null : cur)), 1100);
  };
  if (items === null) return null;
  if (making) return <JingleCreate he={he} onClose={() => setMaking(false)} onAdded={onAdded} />;
  return (
    <section className="sb-kiosk-jg" dir={he ? "rtl" : "ltr"}>
      {items.length === 0 ? <p className="sb-kiosk-empty">{t.noJingles}</p> : null}
      <div className="sb-kiosk-chips">
        {items.map((j) => (
          <button key={j.id} type="button" className="sb-kiosk-chip is-btn" data-fired={fired === j.id ? "1" : undefined} onClick={() => fire(j)}>
            <i style={{ background: j.color }} aria-hidden />
            <span dir="auto">{fired === j.id ? t.onAir : j.label}</span>
          </button>
        ))}
        {canCreate ? (
          <button type="button" className="sb-kiosk-chip is-btn is-new" onClick={() => setMaking(true)}>
            <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>{t.newJingle}</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The volume, drawn the way the controller's own volume is (Apple-Music style): a speaker and a thin capsule with a fill and NO knob; it thickens a little under the
 * pointer. The capsule's far end IS the owner's limit (no numbers, no marks). Drag, click or use the arrow keys; commands are throttled so a drag cannot flood the link.
 * Smooth by default: pressing a spot makes the fill GLIDE there; while dragging it follows the pointer (a hair of easing, no lag you can feel); after letting go it stays
 * where it was put until the player has reported the same level (never a step back and forth); any other change (a fade, the controller) eases to its place.
 */
function Volume({ t, value, cap, onChange }: { t: Words; value: number; cap: number; onChange: (v: number) => void }): ReactElement {
  const v = Math.min(cap, Math.max(0, Math.round(value)));
  const line = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const downX = useRef(0);
  const glideTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null); // the level under the pointer while it is held
  const [glide, setGlide] = useState(false);
  const [hold, setHold] = useState<number | null>(null); // the level that was just set, until the player reports it
  if (hold !== null && drag === null && Math.abs(v - hold) <= 1) setHold(null);
  const levelAt = (clientX: number): number | null => {
    const r = line.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return null;
    return Math.min(cap, Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * cap));
  };
  const send = (next: number, force: boolean) => {
    const now = Date.now();
    if (force || now - last.current > 70) {
      last.current = now;
      onChange(next);
    }
  };
  const shown = drag ?? hold ?? v;
  return (
    <div className="sb-kiosk-vol" data-drag={drag !== null ? "1" : undefined} data-glide={glide ? "1" : undefined} style={{ ["--v" as string]: `${(shown / cap) * 100}%` } as CSSProperties}>
      <svg className="sb-kiosk-vol-ico" viewBox="0 0 24 24" width="1.5em" height="1.5em" fill="currentColor" aria-hidden>
        <path d="M4 9v6h4l5 4V5L8 9H4Z" />
        {shown === 0 ? <path d="m16 9.5 5 5m0-5-5 5" stroke="#ff453a" strokeWidth="2" strokeLinecap="round" fill="none" /> : <path d="M16.2 8.6a5 5 0 0 1 0 6.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />}
      </svg>
      <div
        ref={line}
        className="sb-kiosk-vol-line"
        role="slider"
        tabIndex={0}
        aria-label={t.volume}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={v}
        onPointerDown={(e) => {
          const next = levelAt(e.clientX);
          if (next === null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          downX.current = e.clientX;
          if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
          if (glideTimer.current !== null) window.clearTimeout(glideTimer.current);
          setGlide(true); // the fill glides to the spot that was pressed …
          glideTimer.current = window.setTimeout(() => setGlide(false), 400);
          setDrag(next);
          send(next, true);
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          const next = levelAt(e.clientX);
          if (next === null) return;
          if (glide && Math.abs(e.clientX - downX.current) > 5) setGlide(false); // … but once the pointer really drags, the fill follows it at once
          setDrag(next);
          send(next, false);
        }}
        onPointerUp={(e) => {
          const next = levelAt(e.clientX) ?? drag;
          if (next !== null) {
            send(next, true);
            setHold(next);
            holdTimer.current = window.setTimeout(() => setHold(null), 1600);
          }
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(cap, v + 5));
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(0, v - 5));
        }}
      >
        <i className="sb-kiosk-vol-track">
          <b />
        </i>
      </div>
    </div>
  );
}

/** A transport button: no circle behind it — it only grows under the pointer; a press squeezes it, nudges its icon the way it points and sends out one soft ring. The big play / pause
 * button keeps its icon mounted (the two shapes melt into each other, see PlayPauseIcon) — only the squeeze and the ring answer a press. */
function CtlButton({ label, kind, main, onClick, children }: { label: string; kind: "prev" | "next" | "play"; main?: boolean; onClick: () => void; children: ReactElement }): ReactElement {
  const [hit, setHit] = useState(0);
  return (
    <button
      type="button"
      className={main ? "is-main" : undefined}
      data-kind={kind}
      onClick={() => {
        setHit((n) => n + 1);
        onClick();
      }}
      aria-label={label}
    >
      <span className="sb-kiosk-ico" key={kind === "play" ? "play" : hit} data-hit={kind !== "play" && hit > 0 ? "1" : undefined}>
        {children}
      </span>
      {hit > 0 ? <i className="sb-kiosk-pulse" key={`p${hit}`} aria-hidden /> : null}
    </button>
  );
}

/** pause and play drawn on top of each other: the one that is not shown shrinks and fades while the other grows in (CSS transitions — nothing re-mounts, so nothing flickers) */
function PlayPauseIcon({ playing }: { playing: boolean }): ReactElement {
  return (
    <span className="sb-kiosk-swap">
      <svg data-on={playing ? "1" : "0"} viewBox="0 0 24 24" width="3.9em" height="3.9em" fill="currentColor" aria-hidden><rect x="5.2" y="4" width="4.9" height="16" rx="1.9" /><rect x="13.9" y="4" width="4.9" height="16" rx="1.9" /></svg>
      <svg data-on={playing ? "0" : "1"} viewBox="0 0 24 24" width="3.9em" height="3.9em" fill="currentColor" aria-hidden><path d="M7.4 5.2c0-1 1.1-1.6 1.9-1.1l11 6.8c.7.4.7 1.4 0 1.8l-11 6.8c-.8.5-1.9-.1-1.9-1.1V5.2Z" /></svg>
    </span>
  );
}

const AutoIcon = () => (
  <svg viewBox="0 0 24 24" width="1.6em" height="1.6em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
  </svg>
);
const SunIcon = () => (
  <svg viewBox="0 0 24 24" width="1.6em" height="1.6em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </svg>
);
const MoonIcon = () => (
  <svg viewBox="0 0 24 24" width="1.6em" height="1.6em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 14.2A8 8 0 0 1 9.8 4 8 8 0 1 0 20 14.2Z" />
  </svg>
);

/**
 * The progress bar: only a thin line. Resting the mouse on it swells it a little and shows the current minute under its left end (no start / end times). Where the owner
 * switched "move within the song" on, the bar can also be dragged (or clicked): the minute under the pointer is shown and the song jumps there when it is let go.
 * Smooth by default: pressing a spot makes the fill GLIDE there; while dragging it follows the pointer (a hair of easing, no lag you can feel); after letting go it stays
 * where it was put until the player's position has arrived there (never a jump back to the old spot and forward again).
 */
function SeekBar({ position, duration, canSeek, onSeek, label }: { position: number; duration: number; canSeek: boolean; onSeek: (sec: number) => void; label: string }): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const downX = useRef(0);
  const glideTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null); // 0..1 while held
  const [glide, setGlide] = useState(false);
  const [hold, setHold] = useState<number | null>(null); // 0..1 just after letting go, until the player's position has arrived
  if (hold !== null && scrub === null && duration > 0 && Math.abs(position - hold * duration) < 1.5) setHold(null);
  const frac = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    return r && r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
  };
  const shownFrac = scrub ?? hold ?? (duration > 0 ? Math.min(1, position / duration) : 0);
  const at = duration > 0 ? mmss(scrub !== null ? scrub * duration : hold !== null ? hold * duration : position) : "";
  return (
    <div
      ref={box}
      className="sb-kiosk-seek"
      data-seek={canSeek ? "1" : undefined}
      data-scrub={scrub !== null ? "1" : undefined}
      data-glide={glide ? "1" : undefined}
      style={{ ["--p" as string]: `${shownFrac * 100}%` } as CSSProperties}
      {...(canSeek
        ? {
            role: "slider",
            "aria-label": label,
            "aria-valuemin": 0,
            "aria-valuemax": Math.round(duration),
            "aria-valuenow": Math.round(shownFrac * duration),
            tabIndex: 0,
            onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              downX.current = e.clientX;
              if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
              if (glideTimer.current !== null) window.clearTimeout(glideTimer.current);
              setGlide(true); // the fill glides to the spot that was pressed …
              glideTimer.current = window.setTimeout(() => setGlide(false), 440);
              setScrub(frac(e.clientX));
            },
            onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
              if (scrub === null) return;
              if (glide && Math.abs(e.clientX - downX.current) > 5) setGlide(false); // … but once the pointer really drags, the fill follows it at once
              setScrub(frac(e.clientX));
            },
            onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
              const f = frac(e.clientX);
              setScrub(null);
              setHold(f);
              holdTimer.current = window.setTimeout(() => setHold(null), 1600);
              onSeek(f * duration);
            },
            onPointerCancel: () => setScrub(null),
            onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "ArrowRight") onSeek(Math.min(duration, position + 10));
              else if (e.key === "ArrowLeft") onSeek(Math.max(0, position - 10));
            },
          }
        : { "aria-hidden": true })}
    >
      <div className="sb-kiosk-prog">
        <span style={{ width: `${shownFrac * 100}%` }} />
      </div>
      <span className="sb-kiosk-at" dir="ltr">{at}</span>
    </div>
  );
}

// ───────────────────────────────────────────────── the side panel's icons ─────────────────────────────────────────────────

type TabId = "next" | "search" | "lists" | "jingles" | "day";
const TABS: Array<{ id: TabId; icon: ReactElement }> = [
  { id: "next", icon: <KioskTabIcon id="next" /> },
  { id: "search", icon: <KioskTabIcon id="search" /> },
  { id: "lists", icon: <KioskTabIcon id="lists" /> },
  { id: "jingles", icon: <KioskTabIcon id="jingles" /> },
  { id: "day", icon: <KioskTabIcon id="day" /> },
];

/**
 * The small square of the "supermarket" look (lock-screen design): in the top corner next to the colour (sun / moon) button; under it a thin bar that ALWAYS shows how far the song has got
 * (owner 2026-10-26); the song's name (and artist) beside it slides out only while the pointer rests on the square. Resting on the square also shows the two pause bars, a press pauses
 * (and resumes); while it is paused the play triangle stays on it so nobody wonders why it is silent. Where the owner did not allow pause it is just the picture. A screen with no pointer
 * (touch) has no "resting", so there the name is simply always shown.
 */
function MiniBar({ t, view, has, playing, canPause, onToggle, position, duration }: { t: Words; view: View; has: boolean; playing: boolean; canPause: boolean; onToggle: () => void; position: number; duration: number }): ReactElement {
  const inner = (
    <>
      <CoverArt cover={view.cover} />
      <span className="sb-kiosk-mini-veil" aria-hidden />
      {canPause ? (
        <span className="sb-kiosk-mini-ico" aria-hidden>
          <PlayPauseIcon playing={playing} />
        </span>
      ) : null}
    </>
  );
  const frac = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  return (
    <div className="sb-kiosk-minibar">
      <div className="sb-kiosk-mini-wrap">
        {canPause ? (
          <button type="button" className="sb-kiosk-mini" data-paused={playing ? undefined : "1"} onClick={onToggle} aria-label={playing ? t.pause : t.play}>
            {inner}
          </button>
        ) : (
          <div className="sb-kiosk-mini">{inner}</div>
        )}
        <div className="sb-kiosk-mini-prog" aria-hidden>
          <span style={{ width: `${frac * 100}%` }} />
        </div>
      </div>
      <span className="sb-kiosk-mini-text" key={view.title}>
        <b dir="auto">{has ? view.title : t.nothingPlaying}</b>
        {view.artist ? <em dir="auto">{view.artist}</em> : null}
      </span>
    </div>
  );
}

/** One page of the side panel: its heading (the search has none — only its bar) and its content. Pages are stacked like cards; `state` drives the slide when the page is swapped for another. */
function PanelCard({ id, state, dir, t, he, view, perms, move, moveTo, today, jingles, lists, canCreateJingle, onJingleAdded }: { id: TabId; state: "idle" | "in" | "out"; dir: 1 | -1; t: Words; he: boolean; view: View; perms: KioskPermissions; move: (r: Row, dir: -1 | 1) => void; moveTo: (r: Row, to: number) => void; today: { blocks: Block[]; minutes: number }; jingles: Jingle[] | null; lists: UnifiedSource[] | null; canCreateJingle: boolean; onJingleAdded: () => void }): ReactElement {
  return (
    <div className="sb-kiosk-card" data-id={id} data-state={state} data-dir={dir} aria-hidden={state === "out" ? true : undefined}>
      {id !== "search" ? <h3>{t.tabs[id]}</h3> : null}
      <div className="sb-kiosk-pane">
        {id === "next" ? <UpNext t={t} he={he} view={view} canMove={perms.reorder} onMove={move} onMoveTo={moveTo} /> : null}
        {id === "search" ? <Search t={t} he={he} lists={lists} /> : null}
        {id === "lists" ? <Playlists t={t} he={he} lists={lists} /> : null}
        {id === "jingles" ? <Jingles t={t} he={he} items={jingles} canCreate={canCreateJingle} onAdded={onJingleAdded} /> : null}
        {id === "day" ? <DayList t={t} blocks={today.blocks} minutes={today.minutes} /> : null}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────── the last screen ─────────────────────────────────────────────────

const SNAP_KEY = "syncbiz-kiosk-last";
type Snap = { title: string; artist: string | null; cover: string | null; info: CoverInfo };
function readSnap(): Snap | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(SNAP_KEY) ?? "null") as Snap | null;
    return v && typeof v.title === "string" && v.info && Array.isArray(v.info.main) ? v : null;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────── the screen ─────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export function KioskDisplay(): ReactElement | null {
  const locked = useKioskLocked();
  const themePref = useKioskTheme();
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const live = useNowView();
  // What was on the screen last time is what comes up first (owner: "show the last screen when I come back, then load whatever loads"): until the player has said what is playing
  // (but no longer than 8 s after the page started) the screen shows the last song and its colours — never the empty "nothing playing" / idle colours first.
  const [snap] = useState<Snap | null>(() => (typeof window === "undefined" ? null : readSnap()));
  const [cold, setCold] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setCold(false), 8000);
    return () => clearTimeout(id);
  }, []);
  const view: View = cold && snap && !live.title ? { ...live, title: snap.title, artist: snap.artist, cover: snap.cover, status: "paused" } : live;
  const info = useCoverInfo(view.cover, view.title, snap?.info ?? null);
  useEffect(() => {
    if (!live.title) return;
    try {
      window.localStorage.setItem(SNAP_KEY, JSON.stringify({ title: live.title, artist: live.artist, cover: live.cover, info } satisfies Snap));
    } catch {
      /* ignore */
    }
  }, [live.title, live.artist, live.cover, info]);
  // the look: by the song (a white cover gives a white screen with black text — the default) unless the sun / moon pinned it
  // (a band between "clearly dark" and "clearly white" keeps the current look: a cover in the middle never makes the screen flicker between the two)
  const [autoLight, setAutoLight] = useState(false);
  if (!autoLight && info.lum >= 0.52) setAutoLight(true);
  else if (autoLight && info.lum < 0.4) setAutoLight(false);
  const theme: "light" | "dark" = themePref === "auto" ? (autoLight ? "light" : "dark") : themePref;
  const colors = useCrossfade(paletteFor(info, theme));
  const transport = useTransport();
  const pos = useNowPosition();
  const today = useToday();
  const perms = useKioskPermissions();
  const design = useKioskDesign();
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [intro, setIntro] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const closePin = useCallback(() => setPinOpen(false), []);
  // nothing on the side is open at first: the player stands in the MIDDLE and the next song shows as a small notice in the corner; opening one of the side icons slides
  // the player aside and shows that panel (the same icon again closes it)
  const [tab, setTab] = useState<TabId | null>(null);
  // the panel's pages are cards: moving between them always goes UP — the old page leaves upward while the new one comes up from below
  const [cards, setCards] = useState<{ cur: TabId; prev: TabId | null; dir: 1 | -1; epoch: number; n: number }>({ cur: "next", prev: null, dir: 1, epoch: 0, n: 0 });
  const [touched, setTouched] = useState(0);
  const [jingleVer, setJingleVer] = useState(0);
  const jingles = useJingles(shown && perms.jingles, jingleVer);

  // appear when locked (the colours of the song first, then everything rises into place); fade away a moment after the lock opens
  if (locked && (!shown || leaving)) {
    setShown(true);
    setLeaving(false);
    setIntro(true);
    setPinOpen(false); // always the plain screen — never the password bar left over from the last time
    setTab(null);
  }
  useEffect(() => {
    if (locked || !shown) return;
    const start = setTimeout(() => setLeaving(true), 0);
    const end = setTimeout(() => {
      setShown(false);
      setLeaving(false);
    }, 420);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, [locked, shown]);
  useEffect(() => {
    if (!(locked && shown)) return;
    const done = setTimeout(() => setIntro(false), 2800);
    // a screen that BOOTED locked had a plain cover from the first paint (lib/fx-boot.ts); it goes once this cover has faded in over it
    const boot = setTimeout(() => document.documentElement.removeAttribute("data-sb-kiosk-boot"), 1500);
    return () => {
      clearTimeout(done);
      clearTimeout(boot);
    };
  }, [locked, shown]);

  // `?display=1` in the address locks this screen once per browser session (a store screen starts straight in the display)
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("display") === "1" && !window.sessionStorage.getItem("syncbiz-kiosk-url")) {
        window.sessionStorage.setItem("syncbiz-kiosk-url", "1");
        lockKiosk();
      }
    } catch {
      /* ignore */
    }
  }, []);

  // while the display is up everything underneath is inert (no focus, no clicks, no keys) — and only inert: nothing is hidden or unmounted
  useEffect(() => {
    if (!(locked && shown)) return;
    const kids = Array.from(document.body.children).filter((el) => !el.classList.contains("sb-kiosk-root") && el.tagName !== "SCRIPT" && el.tagName !== "NEXTJS-PORTAL") as HTMLElement[];
    const was = kids.map((el) => el.hasAttribute("inert"));
    kids.forEach((el) => el.setAttribute("inert", ""));
    document.documentElement.setAttribute("data-sb-kiosk", "locked");
    return () => {
      kids.forEach((el, i) => !was[i] && el.removeAttribute("inert"));
      document.documentElement.removeAttribute("data-sb-kiosk");
    };
  }, [locked, shown]);

  const setVolume = useCallback((v: number) => transport.volume(v), [transport]);

  // Pause and play are GENTLE (owner 2026-10-25): the song is lowered over ~¾ s and then paused; on play it starts silent and comes up to where it was. The volume is put
  // back exactly (also if anything goes wrong), the slider keeps showing the real level meanwhile, and the button changes at once.
  const volNow = useRef(view.volume);
  useEffect(() => {
    volNow.current = view.volume;
  }, [view.volume]);
  const gentleRef = useRef<Gentle | null>(null);
  const trRef = useRef(transport);
  useEffect(() => {
    trRef.current = transport;
  });
  const shieldTimer = useRef<number | null>(null);
  const wantTimer = useRef<number | null>(null);
  const [shield, setShield] = useState<number | null>(null);
  const [want, setWant] = useState<boolean | null>(null);
  // Fast clicks: the LAST click wins (the running fade stops at its next step and the new one carries on from where the song is) — a click is never swallowed. The button follows the
  // click at once and keeps showing it until the player confirms (a song that is still loading does not flip the button back); after 6 s without a confirmation it shows the truth.
  const gentle = (toPlay: boolean) => {
    gentleRef.current ??= createGentle({ volume: (v) => trRef.current.volume(v), play: () => trRef.current.play(), pause: () => trRef.current.pause(), sleep });
    const g = gentleRef.current;
    if (shieldTimer.current !== null) window.clearTimeout(shieldTimer.current);
    if (wantTimer.current !== null) window.clearTimeout(wantTimer.current);
    setShield((cur) => cur ?? Math.max(0, Math.round(volNow.current)));
    setWant(toPlay);
    void g
      .toggle(toPlay, volNow.current)
      .catch(() => undefined)
      .finally(() => {
        if (g.busy()) return; // a newer click took over
        // the slider keeps the real level a moment longer so the restored volume never shows as a blip
        shieldTimer.current = window.setTimeout(() => setShield(null), 450);
        wantTimer.current = window.setTimeout(() => setWant(null), 6000);
      });
  };
  // the real state caught up with the click → the button goes back to following the player
  const settled = want !== null && shield === null && (view.status === "playing") === want;
  if (settled) setWant(null);

  // the side panel shows ONE thing at a time, switched by the icons; whatever the owner switched off has no icon, and a panel nobody touches for a minute goes back to "Up next"
  // an icon is on the screen when the DESIGN includes it (Lock screen design) AND staff are allowed to use it (Display screen settings)
  const tabs = useMemo(() => TABS.filter((x) => design.icons.includes(x.id) && (x.id === "search" ? perms.search : x.id === "lists" ? perms.playlists : x.id === "jingles" ? perms.jingles : true)), [design.icons, perms.search, perms.playlists, perms.jingles]);
  const open: TabId | null = tab !== null && tabs.some((x) => x.id === tab) ? tab : null;
  const curId: TabId = tabs.some((x) => x.id === cards.cur) ? cards.cur : "next";
  const lists = useLibraryLists(shown && (perms.search || perms.playlists), open === "search" || open === "lists" ? open : null);
  const choose = (id: TabId) => {
    if (open === id) {
      setTab(null);
      return;
    }
    if (open === null) {
      setCards((c) => ({ cur: id, prev: null, dir: 1, epoch: c.epoch + 1, n: c.n })); // opening: a fresh card (its rows rise in)
    } else {
      setCards((c) => ({ cur: id, prev: c.cur, dir: 1, epoch: c.epoch, n: c.n + 1 })); // between pages: always UP — the old page leaves upward, the new one comes up from below
    }
    setTab(id);
  };
  useEffect(() => {
    if (!cards.prev) return;
    const id = setTimeout(() => setCards((c) => ({ ...c, prev: null })), 1100);
    return () => clearTimeout(id);
  }, [cards.n, cards.prev]);
  useEffect(() => {
    if (open === null) return;
    const id = setTimeout(() => setTab(null), 60_000);
    return () => clearTimeout(id);
  }, [open, touched]);
  if (typeof document === "undefined" || !shown) return null;

  const playing = want ?? view.status === "playing";
  const has = !!view.title;
  const clock = `${pad(today.date.getHours())}:${pad(today.date.getMinutes())}`;
  const dateText = today.date.toLocaleDateString(he ? "he-IL" : "en-US", { weekday: "long", day: "numeric", month: "long" });
  // the sun / moon button steps through: by the song → light → dark → by the song …
  const nextTheme: KioskTheme = themePref === "auto" ? "light" : themePref === "light" ? "dark" : "auto";
  const themeLabel = themePref === "auto" ? t.themeAuto : themePref === "light" ? t.themeLight : t.themeDark;

  return createPortal(
    <div className="sb-kiosk-root">
      <div
        className="sb-kiosk"
        data-leaving={leaving ? "1" : undefined}
        data-intro={intro ? "1" : undefined}
        data-theme={theme}
        dir={he ? "rtl" : "ltr"}
        lang={locale}
        data-song={he ? "left" : "right"}
        data-pin={pinOpen ? "1" : undefined}
        data-layout={design.layout}
        data-panel={open !== null ? "1" : undefined}
        style={{ ["--k-tint" as string]: (colors.front === 0 ? colors.a : colors.b)[0], ["--k-layout-dir" as string]: he ? "ltr" : "rtl", ["--k-text-dir" as string]: he ? "rtl" : "ltr", ["--k-sign" as string]: he ? 1 : -1 } as CSSProperties}
      >
        <Field st={colors} />

        {/* the lock and the sun / moon sit in the two top corners at the SAME distance from the top and from the side */}
        <button type="button" className="sb-kiosk-lock" onClick={() => setPinOpen(true)} aria-label={t.lockHint} title={t.lockHint} aria-expanded={pinOpen}>
          <LockIcon size={22} />
        </button>
        <button type="button" className="sb-kiosk-theme" onClick={() => setKioskTheme(nextTheme)} aria-label={themeLabel} title={themeLabel}>
          {themePref === "auto" ? <AutoIcon /> : themePref === "light" ? <SunIcon /> : <MoonIcon />}
        </button>
        {design.layout === "mini" ? <MiniBar t={t} view={view} has={has} playing={playing} canPause={perms.pause} onToggle={() => gentle(!playing)} position={pos.position} duration={pos.duration} /> : null}

        <div className="sb-kiosk-stage">
          {design.clock ? (
            <header className="sb-kiosk-top">
              <span aria-hidden />
              <div className="sb-kiosk-clock" dir="ltr">
                <b>{clock}</b>
                <small>{dateText}</small>
              </div>
              <span className="sb-kiosk-top-end" aria-hidden />
            </header>
          ) : null}

          {design.layout === "full" ? (
          <section className="sb-kiosk-now" aria-label={t.nowPlaying}>
            {(
              <>
                <CoverArt cover={view.cover} />
                <div className="sb-kiosk-meta" key={view.title}>
                  <p className="sb-kiosk-title" dir="auto" title={view.title}>{has ? view.title : t.nothingPlaying}</p>
                  {view.artist ? <p className="sb-kiosk-artist" dir="auto">{view.artist}</p> : null}
                </div>
                {/* no start / end times: the bar swells a little when the mouse rests on it and the current minute appears under its left end; where the owner allowed it, the bar can be dragged to move within the song */}
                <SeekBar position={pos.position} duration={pos.duration} canSeek={perms.seek && pos.duration > 0} onSeek={transport.seek} label={t.seek} />
                {perms.skip || perms.pause ? (
                  <div className="sb-kiosk-ctl">
                    {perms.skip ? (
                      <CtlButton kind="prev" label={t.prev} onClick={transport.prev}>
                        <svg viewBox="0 0 24 24" width="2.6em" height="2.6em" fill="currentColor" aria-hidden><rect x="4.4" y="4.6" width="2.8" height="14.8" rx="1.4" /><path d="M20 5.7c0-.8-.9-1.3-1.6-.8l-9 6.3c-.6.4-.6 1.3 0 1.7l9 6.3c.7.5 1.6 0 1.6-.8V5.7Z" /></svg>
                      </CtlButton>
                    ) : null}
                    {perms.pause ? (
                      <CtlButton kind="play" main label={playing ? t.pause : t.play} onClick={() => gentle(!playing)}>
                        <PlayPauseIcon playing={playing} />
                      </CtlButton>
                    ) : null}
                    {perms.skip ? (
                      <CtlButton kind="next" label={t.next} onClick={transport.next}>
                        <svg viewBox="0 0 24 24" width="2.6em" height="2.6em" fill="currentColor" aria-hidden><rect x="16.8" y="4.6" width="2.8" height="14.8" rx="1.4" /><path d="M4 5.7c0-.8.9-1.3 1.6-.8l9 6.3c.6.4.6 1.3 0 1.7l-9 6.3c-.7.5-1.6 0-1.6-.8V5.7Z" /></svg>
                      </CtlButton>
                    ) : null}
                  </div>
                ) : null}
                {perms.volume ? <Volume t={t} value={shield ?? view.volume} cap={perms.volumeMax} onChange={setVolume} /> : null}
              </>
            )}
          </section>
          ) : null}

          {tabs.length > 0 ? (
            <section className="sb-kiosk-side">
              <div className="sb-kiosk-panel" dir={he ? "rtl" : "ltr"} onPointerDownCapture={() => setTouched((n) => n + 1)} onKeyDownCapture={() => setTouched((n) => n + 1)}>
                {design.layout === "mini" && open !== null ? (
                  <button type="button" className="sb-kiosk-panel-close" onClick={() => setTab(null)} aria-label={t.back}>
                    <svg viewBox="0 0 24 24" width="1.3em" height="1.3em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                ) : null}
                <div className="sb-kiosk-panel-box" aria-hidden={open === null} data-moving={cards.prev && cards.prev !== curId ? "1" : undefined}>
                  {cards.prev && cards.prev !== curId ? <PanelCard key={`${cards.prev}:${cards.epoch}`} id={cards.prev} state="out" dir={cards.dir} t={t} he={he} view={view} perms={perms} move={transport.move} moveTo={transport.moveTo} today={today} jingles={jingles} lists={lists} canCreateJingle={perms.createJingles} onJingleAdded={() => setJingleVer((n) => n + 1)} /> : null}
                  <PanelCard key={`${curId}:${cards.epoch}`} id={curId} state={cards.prev && cards.prev !== curId ? "in" : "idle"} dir={cards.dir} t={t} he={he} view={view} perms={perms} move={transport.move} moveTo={transport.moveTo} today={today} jingles={jingles} lists={lists} canCreateJingle={perms.createJingles} onJingleAdded={() => setJingleVer((n) => n + 1)} />
                </div>
              </div>
              <nav className="sb-kiosk-rail" aria-label={t.tabs.next}>
                {tabs.map((x) => (
                  <button key={x.id} type="button" onClick={() => choose(x.id)} data-active={open === x.id ? "1" : undefined} aria-pressed={open === x.id} aria-label={t.tabs[x.id]} title={t.tabs[x.id]}>
                    {x.icon}
                  </button>
                ))}
              </nav>
            </section>
          ) : null}
        </div>

        {/* the next song as a small notice in the corner (the rail's side) while no panel is open */}
        {design.notice && view.rows[0] ? (
          <div className="sb-kiosk-notice" key={view.rows[0].key} aria-live="polite" dir={he ? "rtl" : "ltr"}>
            <span className="sb-kiosk-notice-art">{view.rows[0].cover ? <img src={view.rows[0].cover} alt="" draggable={false} /> : null}</span>
            <span className="sb-kiosk-notice-text">
              <small>{t.nextShort}</small>
              <b dir="auto" title={view.rows[0].title}>{view.rows[0].title}</b>
              {view.rows[0].artist ? <em dir="auto">{view.rows[0].artist}</em> : null}
            </span>
          </div>
        ) : null}

        {pinOpen ? (
          <div className="sb-kiosk-scrim" onPointerDown={(e) => e.target === e.currentTarget && setPinOpen(false)}>
            <PinBar t={t} onClose={closePin} />
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
