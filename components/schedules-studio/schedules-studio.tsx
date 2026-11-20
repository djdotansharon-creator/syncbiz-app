"use client";

/**
 * Schedules Studio (owner 2026-11-10: "design the scheduling screen the way you think is most comfortable — minimal, guiding, the whole screen").
 *
 * One calm screen: the player folded into its slim bar on top (what plays NOW), the schedule in the middle — as a WEEK (a calendar: the days across, the hours down)
 * or as a DAY (the hours across, one row per branch) — and the owner's music on the side in a panel that opens and closes.
 *   · ‹ › move a week (or a day) back and forth, "Today" comes back; a one-time block lives in its own date, a weekly one repeats in every week;
 *   · drag a playlist / song / radio from the panel onto a day / row → it is scheduled there (the time follows the pointer, snapped to 15 min); or click any empty time;
 *   · click a block → a small card: what plays, start time, repeats weekly (or one date), days, on/off, play now, COPY, delete; drag a block along the time axis → it starts earlier / later;
 *   · COPY a block (button or Ctrl/⌘+C) and paste it on another day (click the day's title, or Ctrl/⌘+V over it): the same music at exactly the same hour, one time on that date.
 * What plays when follows the schedule engine: a block plays from its start until the next block starts (nothing is ever silent between blocks).
 * Every change is applied at once (optimistic) and saved through the same `/api/schedules` calls the old screen used; a failed save rolls back with a message.
 * Display + editing only — firing schedules is still `ScheduleAutoPlayer` / `runSchedulePlayback`, untouched.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { InfoIcon } from "@/components/info-icon";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTr } from "@/lib/i18n/use-tr";
import { useLocale, useTranslations } from "@/lib/locale-context";
import { fetchScheduleSwitch, saveScheduleSwitch } from "@/lib/schedule-switch-client";
import { useSchedulePlaybackHandlers } from "@/lib/use-schedule-playback-handlers";
import { runSchedulePlayback } from "@/lib/schedule-playback-client";
import { listBankPacks, type BankPackSummary } from "@/lib/music-bank/bank-play-source";
import { useScheduleBlockAuto } from "@/lib/use-schedule-block-auto";
import { resolveScheduleTargetBranchId, scheduleTargetKey } from "@/lib/schedule-target-helpers";
import { explicitEndMinutes, isSilenceBlock } from "@/lib/schedule-actions";
import { isSkippedOn, withSkipDate, ymdOf } from "@/lib/schedule-skip";
import { stationBranchIdNow, useStationBranchId } from "@/lib/station-branch";
import { JINGLE_SCHEDULE_EVENT, loadJingleSchedule } from "@/components/jingles-control/schedule-storage";
import { setJinglesOpenEdit, setJinglesOpenTab } from "@/components/jingles-control/open-tab";
import {
  DAY_MINUTES,
  WEEK_DAYS,
  addDays,
  buildDayScenes,
  dateKey,
  daysKind,
  formatMinutes,
  jinglesOnDay,
  minutesToTimeLocal,
  PALETTE_SIZE,
  BLUE_SHADES,
  COLOUR_FAMILIES,
  DEFAULT_BIZ_HOURS,
  DEFAULT_DISPLAY,
  closingPlan,
  parseBizHours,
  viewRange,
  familyShade,
  parseDisplay,
  toneFromPixels,
  paletteIndex,
  parseTypedTime,
  pastedScheduleBody,
  panWindow,
  clampWindow,
  snapMinutes,
  startMinutes,
  swapStarts,
  stepAside,
  tickStep,
  weekDatesFor,
  windowTicks,
  zoomWindow,
  type BizHours,
  type BlockTone,
  type ColourFamily,
  type DayHours,
  type JingleLike,
  type Scene,
  type StudioDisplay,
  type TimeWindow, changedFields, scheduleBody } from "@/lib/schedules-timeline";
import type { Playlist } from "@/lib/playlist-types";
import type { Device, Schedule, ScheduleTargetType, Source } from "@/lib/types";

const BASE_HOUR_H = 46; // px per hour in the week's columns until the screen is measured; then the hours FIT the height of the screen and stretch from there
const MIN_FIT_H = 24; // the hours never get squeezed below this to fit the screen (past that the column scrolls)
const MAX_HOUR_H = 360;
const PANEL_KEY = "syncbiz-schedule-lib-panel";
const VIEW_KEY = "syncbiz-schedule-view";
const POPOVER_W = 344;
const BLOCK_COLORS_KEY = "syncbiz-sched-block-colors-v1";
const HOURS_KEY = "syncbiz-sched-hours-v1"; // the business's opening hours — per browser (the closing quiet blocks themselves are saved with the schedule)
const DISPLAY_KEY = "syncbiz-sched-display-v1"; // how the blocks look (colour, picture / text, position, hours, length) — per browser
const JINGLES_KEY = "syncbiz-schedule-jingles"; // "off" hides the jingle markers on this browser
const RULER_ZOOM_PX = 170; // dragging this far along the hours changes the zoom by a factor of e (about 2.7)
const HISTORY_GROUP_MS = 900; // changes this close together are ONE undo step
const HISTORY_MAX = 40;
const END_MAX = 23 * 60 + 55; // the latest "ends at" a person can set (23:59 is the stored "until the next block")
const LIFT_MAX = 96; // how far (px) a carried block may float up or down with the pointer
const PROVISIONAL_MIN = 5; // the shortest block: all a song / playlist whose length cannot be had is drawn until an answer comes
const LOOKUP_WAIT_MS = 3000; // how long a dropped song waits for its length before it is drawn anyway
const CLOSING_NAME = "Closing"; // the quiet block the Day-hours dialog keeps for each closing time

type RadioRow = { id: string; name: string; branchId?: string | null };
type BranchRow = { id: string; name: string };
type Props = {
  initialSchedules: Schedule[];
  playlists: Playlist[];
  sources: Source[];
  radioStations: RadioRow[];
  devices: Device[];
  branches: BranchRow[];
};
type LibItem = {
  key: string;
  targetType: ScheduleTargetType;
  targetId: string;
  name: string;
  cover: string | null;
  kind: "playlist" | "song" | "radio" | "bank" | "quiet";
  sub: string;
  branchId: string;
  /** the Apple colour of this music: taken from its own cover (or a stable fallback) */
  ci: number;
  /** how long the song / playlist is, in seconds — null when it is not known */
  dur: number | null;
};
type Rect = { x: number; y: number; w: number; h: number };
type Editor =
  | { kind: "new"; day: number; min: number; rect: Rect; branchId?: string }
  | { kind: "edit"; id: string; rect: Rect; day: number };
type Orient = "v" | "h";

async function api<T = unknown>(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

function clearLocalAutoPrefs(id: string) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(`syncbiz-schedule-auto-${id}-`)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/** a block that is being dragged on a day it shares with others is drawn as a virtual copy ("#drag") while the pointer is down */
const baseId = (id: string) => (id.endsWith("#drag") ? id.slice(0, -5) : id);
const isMultiDayWeekly = (s: Schedule) => s.recurrence !== "one_off" && (s.daysOfWeek?.length ?? 0) > 1;
const isRtl = () => typeof document !== "undefined" && document.documentElement.getAttribute("dir") === "rtl";
const isTypingTarget = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** the total length of a playlist (a one-song playlist = the song) from the durations its tracks carry — only when EVERY song's length is known: a sum of the few that are is not the playlist's length
 *  (it would draw an 8-song playlist as 2 songs long). Otherwise the stored total, or null. */
function playlistSeconds(p: Playlist): number | null {
  const tracks = p.tracks ?? [];
  const known = (t: { durationSeconds?: number | null }) => typeof t.durationSeconds === "number" && t.durationSeconds > 0;
  if (tracks.length > 0 && tracks.every(known)) return tracks.reduce((a, t) => a + (t.durationSeconds as number), 0);
  return typeof p.durationSeconds === "number" && p.durationSeconds > 0 ? p.durationSeconds : null;
}

/** how many minutes a block holds the music it plays: its own length rounded UP to a whole minute (+20 s so a start delay never clips the last seconds); Infinity when the length is not known */
function fitMinutes(dur: number | null | undefined): number {
  return dur && dur > 0 ? Math.max(1, Math.ceil((dur + 20) / 60)) : Infinity; // a song of under three minutes is three minutes long, not five (owner 2026-11-16: "I can't shorten them")
}

/** the picture a fog block shows: a YouTube thumbnail in its true 16:9 shape (hqdefault / sddefault carry black bars above and below) */
function artUrl(cover: string): string {
  return cover.replace(/^(https:\/\/(?:i\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/[^/]+\/)(?:hq|sd|maxres)default\.(?:jpg|webp)/, "$1mqdefault.jpg");
}

/** the colour of a song's picture (a small copy of it is read); null when the picture cannot be read (a server that does not allow it) */
function sampleCover(url: string): Promise<BlockTone | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let timer = 0;
    const done = (t: BlockTone | null) => {
      window.clearTimeout(timer);
      resolve(t);
    };
    timer = window.setTimeout(() => done(null), 8000);
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 24;
        c.height = 24;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return done(null);
        ctx.drawImage(img, 0, 0, 24, 24);
        done(toneFromPixels(ctx.getImageData(0, 0, 24, 24).data));
      } catch {
        done(null);
      }
    };
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** a click on empty ground that only closed a card (a popup dismissed by pressing outside) must not also open a new one */
let lastPopupClose = 0;
const markPopupClose = () => {
  lastPopupClose = typeof performance !== "undefined" ? performance.now() : Date.now();
};
const justClosedPopup = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) - lastPopupClose < 450;

/** while a block is being dragged the pointer keeps ONE cursor wherever it goes — over the empty track it would otherwise turn into the "+" (copy) cursor of adding music */
function holdCursor(kind: "ew-resize" | "ns-resize" | "grabbing"): () => void {
  if (typeof document === "undefined") return () => {};
  const cls = `sb-ss-cursor-${kind}`;
  document.documentElement.classList.add(cls);
  return () => document.documentElement.classList.remove(cls);
}

export function SchedulesStudio({ initialSchedules, playlists, sources, radioStations, devices, branches }: Props) {
  const router = useRouter();
  const tr = useTr();
  const { t } = useTranslations();
  const T = t as unknown as Record<string, string>;
  const { locale } = useLocale();
  const { setLastMessage, stop, stopScheduled, setQueue, playSource, route } = useSchedulePlaybackHandlers();

  const [items, setItems] = useState<Schedule[]>(initialSchedules);
  useEffect(() => setItems(initialSchedules), [initialSchedules]);
  const [now, setNow] = useState<Date | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [view, setView] = useState<"week" | "day">("day");
  const [focus, setFocus] = useState<Date | null>(null);
  const [branchFilter, setBranchFilter] = useState("all");
  const [clip, setClip] = useState<Schedule | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [menu, setMenu] = useState<{ id: string; rect: Rect; day: number } | null>(null);
  const [hover, setHover] = useState<{ key: string; min: number } | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  // the block being carried: where it is (start / end), the other day it hovers over, and — when it has passed the middle of a neighbour — that neighbour's place while it makes room (`preview`)
  // and the empty slot the carried block will land in (`slot`, in minutes; `row` = the branch of its row)
  const [drag, setDrag] = useState<{ id: string; day: number; start: number; end?: string; overDay?: number; preview?: { id: string; start: number; end: number }; slot?: { start: number; len: number; row: string } } | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  // the day picker (Day view): the day itself is the control — rest on it and the week's other days appear, or a date from a calendar
  // jingles (owner 2026-11-12): the Jingles screen keeps its own schedule in this browser (per branch); the studio only SHOWS it — a small bell on the timeline at the jingle's time
  const stationBranch = useStationBranchId() ?? stationBranchIdNow() ?? "default";
  const [jingles, setJingles] = useState<JingleLike[]>([]);
  const [showJingles, setShowJingles] = useState(true);
  // how the blocks look (owner 2026-11-12): colour from the cover or shades of one colour, where the picture / text sit, the hours, the length
  const [display, setDisplay] = useState<StudioDisplay>(DEFAULT_DISPLAY);
  const [dmenu, setDmenu] = useState<Rect | null>(null);
  const [coverTones, setCoverTones] = useState<Record<string, BlockTone | null>>({});
  const toneAsked = useRef<Set<string>>(new Set());
  // pictures that did not load, or are only a tiny placeholder (a removed video's grey thumbnail): a fog block melts its colour instead
  const [badArt, setBadArt] = useState<Record<string, true>>({});
  const markBadArt = useCallback((u: string) => setBadArt((prev) => (prev[u] ? prev : { ...prev, [u]: true })), []);
  // the business's opening hours, and which hours the timeline shows: the business's own (or what the schedule uses), or the whole day
  const [biz, setBiz] = useState<BizHours | null>(null);
  const range = useMemo(() => {
    // nothing scheduled is ever hidden: every block's start (a quiet one too) and every explicit end count (owner 2026-11-15: half of the day vanished — the hours were counted from non-quiet starts only)
    const live = items.filter((x) => x.enabled);
    return viewRange(display.hours, biz, items.map(startMinutes), live.map((x) => explicitEndMinutes(x)).filter((m): m is number => m !== null)); // a paused block is drawn too, so its start counts
  }, [display.hours, biz, items]);
  const FIRST_H = range.first;
  const LAST_H = range.last;
  // the height of an hour in the week's columns (stretch / squeeze the hours: scroll or drag on the hours, − / +)
  // null = the hours fit the height of the screen (like the day view: the whole stretch is in view, zoom from there); a number = stretched to that many px per hour
  const [zoomedH, setZoomedH] = useState<number | null>(null);
  const [scrollH, setScrollH] = useState(0);
  const fitH = scrollH > 0 ? Math.max(MIN_FIT_H, scrollH / Math.max(1, LAST_H - FIRST_H)) : BASE_HOUR_H;
  const hourH = zoomedH !== null ? Math.max(zoomedH, fitH) : fitH;
  // lengths of playlists that had none stored, looked up when one is placed (owner 2026-11-15: a song comes into the day with its own length)
  const [learned, setLearned] = useState<Record<string, number>>({});
  // one length lookup per playlist at a time, shared by everyone who asks (a drag that has only just begun, the drop, a paste)
  const lengthLookups = useRef<Map<string, Promise<number | null>>>(new Map());
  // a song dropped on the day whose length is still being looked up: a dashed spot holds its place until the block can be drawn at its true length
  const [pending, setPending] = useState<{ day: number; min: number; branchId?: string } | null>(null);
  const HOUR_H = hourH;
  // zooming + panning the hours (owner 2026-11-12): null = the whole range; otherwise the part of the day shown. It drives the horizontal views (the week's rows, the day's rows).
  const [zoomWin, setZoomWin] = useState<TimeWindow | null>(null);
  useEffect(() => {
    setZoomWin(null); // another range of hours (Active hours <-> Full day, other business hours): a window from the old range does not fit
  }, [FIRST_H, LAST_H]);
  const winA = zoomWin ? zoomWin.a : FIRST_H * 60;
  const winB = zoomWin ? zoomWin.b : LAST_H * 60;
  const SPAN = winB - winA;
  const pct = (min: number) => ((Math.min(Math.max(min, winA), winB) - winA) / SPAN) * 100;
  const topOf = (min: number) => ((Math.max(min, FIRST_H * 60) - FIRST_H * 60) * HOUR_H) / 60;
  /** "13 min", "2 h", "2 h 5 min" — how long a stretch of the day is */
  const spanText = (minutes: number): string => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes - h * 60);
    return [h > 0 ? tr("{n} h", { n: h }) : "", m > 0 || h === 0 ? tr("{n} min", { n: m }) : ""].filter(Boolean).join(" ");
  };
  // the hours named in the margin of the week's columns: every hour at the usual height, fewer when squeezed, quarters / halves when stretched
  const labelStep = hourH >= 300 ? 15 : hourH >= 150 ? 30 : hourH >= 34 ? 60 : hourH >= 20 ? 120 : 240;
  const hourLabels = useMemo(() => {
    const out: number[] = [];
    for (let m = FIRST_H * 60; m < LAST_H * 60; m += labelStep) out.push(m);
    return out;
  }, [FIRST_H, LAST_H, labelStep]);
  /** where in time is the pointer on a track (the week's day column runs down, the day's row runs along — against the reading direction in Hebrew) */
  const minuteAtPointer = (clientX: number, clientY: number, el: HTMLElement, orient: Orient): number => {
    const r = el.getBoundingClientRect();
    if (orient === "v") return snapMinutes(FIRST_H * 60 + ((clientY - r.top) * 60) / HOUR_H);
    let ratio = (clientX - r.left) / Math.max(1, r.width);
    if (isRtl()) ratio = 1 - ratio;
    return snapMinutes(winA + ratio * SPAN, placeStep);
  };

  // ── the zoom: wheel / pinch on the hours, the + / − buttons, drag the ruler to slide ──
  const [axisW, setAxisW] = useState(0);
  const axisObs = useRef<ResizeObserver | null>(null);
  const axisRef = useCallback((el: HTMLDivElement | null) => {
    axisObs.current?.disconnect();
    axisObs.current = null;
    if (!el) return;
    setAxisW(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAxisW(el.getBoundingClientRect().width));
    ro.observe(el);
    axisObs.current = ro;
  }, []);
  // how finely things snap follows the zoom: whole 5 minutes normally, single minutes once a minute is wide enough to aim at (placing a new block: 15 → 5 → 1)
  const pxPerMinNow = axisW > 0 ? axisW / SPAN : 1.2;
  const dragStep = pxPerMinNow >= 14 ? 1 : 5;
  const placeStep = pxPerMinNow >= 14 ? 1 : pxPerMinNow >= 4 ? 5 : 15;
  const [zooming, setZooming] = useState<"smooth" | "drag" | null>(null);
  const zoomTimer = useRef<number | null>(null);
  const nudgeZoom = useCallback((mode: "smooth" | "drag") => {
    setZooming(mode);
    if (zoomTimer.current !== null) window.clearTimeout(zoomTimer.current);
    zoomTimer.current = window.setTimeout(() => setZooming(null), mode === "smooth" ? 300 : 160);
  }, []);
  const zoomSrc = useRef({ a: 0, b: DAY_MINUTES, autoA: 0, autoB: DAY_MINUTES, zoomed: false });
  useEffect(() => {
    zoomSrc.current = { a: winA, b: winB, autoA: FIRST_H * 60, autoB: LAST_H * 60, zoomed: !!zoomWin };
  });
  const applyZoom = useCallback(
    (fn: (w: TimeWindow) => TimeWindow, mode: "smooth" | "drag" = "smooth") => {
      setZoomWin((prev) => {
        // the hours can be stretched (zoomed out) no further than the hours shown: Active hours stop at the business's own, only Full day goes to 24 h (owner 2026-11-16)
        const bounds = { a: zoomSrc.current.autoA, b: zoomSrc.current.autoB };
        const next = clampWindow(fn(prev ?? bounds), bounds);
        return Math.abs(next.a - bounds.a) < 0.5 && Math.abs(next.b - bounds.b) < 0.5 ? null : next; // back at the whole range = not zoomed
      });
      nudgeZoom(mode);
    },
    [nudgeZoom],
  );
  const [dvEl, setDvEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!dvEl) return;
    const onWheel = (e: WheelEvent) => {
      const ax = dvEl.querySelector<HTMLElement>(".ss-haxis");
      if (!ax) return;
      const r = ax.getBoundingClientRect();
      if (r.width < 10) return;
      const rtl = isRtl();
      const { a, b, zoomed } = zoomSrc.current;
      const tgt = e.target as Element | null;
      // scrolling on the hours zooms (owner 2026-11-15, like a music app); in the DAY view the whole timeline does (nothing there needs the wheel — the list under it does, so it is left alone)
      const onRuler = !!tgt?.closest?.(".ss-haxis") || (!dvEl.querySelector(".ss-hrows--week") && !!tgt?.closest?.(".ss-hrows"));
      const pinch = e.ctrlKey || e.metaKey; // a trackpad pinch arrives as ctrl + wheel
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (pinch || (onRuler && !e.shiftKey && !sideways)) {
        e.preventDefault();
        let ratio = (e.clientX - r.left) / r.width;
        if (rtl) ratio = 1 - ratio;
        // a plain wheel works the other way round (owner 2026-11-16: scroll DOWN stretches the hours, UP squeezes them — like the week's columns); a pinch keeps its own meaning (spread = closer)
        const factor = Math.exp((pinch ? 1 : -1) * e.deltaY * (pinch && Math.abs(e.deltaY) < 40 ? 0.012 : 0.0024));
        applyZoom((w) => zoomWindow(w, factor, ratio));
      } else if (zoomed && (e.shiftKey || sideways)) {
        e.preventDefault();
        const d = sideways ? e.deltaX : e.deltaY;
        applyZoom((w) => panWindow(w, ((rtl ? -d : d) * (b - a)) / r.width));
      }
    };
    dvEl.addEventListener("wheel", onWheel, { passive: false });
    return () => dvEl.removeEventListener("wheel", onWheel);
  }, [dvEl, applyZoom]);
  // Press on the hours and drag sideways, like the time ruler of a music app (owner 2026-11-15): right = closer (the bar gets longer), left = further away, around the
  // spot that was pressed. Shift + drag slides the hours instead (when they are zoomed in).
  // ── the time under the pointer, on the axis (owner 2026-11-15: "like the price label of a trading chart — anywhere I stand in the timeline, the time at that spot, to the minute, on the axis") ──
  // Over a block the axis also lights the stretch the block fills, with its start, end and length. Written straight into the DOM: a re-render of the whole studio per mouse move would lag.
  // The readout is ONE thing on the ruler at a time, as plain numbers (no frame): the time under the pointer; over a block — or while one is carried — the block's start and end in yellow.
  // Hour labels that sit under a number are hidden (the same time was written twice, one on top of the other).
  const carryLive = useRef(false); // a block is being carried: it writes the two times on the ruler itself
  const repaintH = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!dvEl) return;
    let at: { x: number; y: number } | null = null; // where the pointer last was — the readout is judged from there, so it follows what is UNDER it even when the content moves (zoom, scroll) and the pointer does not
    const hide = () => {
      at = null;
      dvEl.querySelectorAll<HTMLElement>(".ss-xcur, .ss-xpill").forEach((n) => { n.hidden = true; });
      dvEl.querySelectorAll<HTMLElement>(".ss-htick.is-covered").forEach((t) => t.classList.remove("is-covered"));
    };
    const paint = (px: number, py: number) => {
      if (carryLive.current) return; // a carried block writes its own two times, following it smoothly
      const ax = dvEl.querySelector<HTMLElement>(".ss-haxis");
      const cur = ax?.querySelector<HTMLElement>(".ss-xcur");
      const ps = ax?.querySelector<HTMLElement>(".ss-xpill--s");
      const pe = ax?.querySelector<HTMLElement>(".ss-xpill--e");
      if (!ax || !cur || !ps || !pe) return;
      const r = ax.getBoundingClientRect();
      if (r.width < 10) return;
      const { a, b } = zoomSrc.current;
      let ratio = (px - r.left) / r.width;
      if (isRtl()) ratio = 1 - ratio;
      const carried = dvEl.querySelector<HTMLElement>(".ss-block.is-dragging:not(.is-ghost)");
      if (!carried && (ratio < 0 || ratio > 1)) return hide();
      const m = Math.min(DAY_MINUTES - 1, Math.max(0, Math.round(a + ratio * (b - a))));
      const blk = carried ?? document.elementFromPoint(px, py)?.closest<HTMLElement>(".ss-block");
      const shown: number[] = [];
      if (blk?.dataset.start && blk.dataset.end && !blk.classList.contains("is-ghost")) {
        const s0 = Number(blk.dataset.start);
        const e0 = Number(blk.dataset.end);
        // the block's two exact times, each at its own edge on the axis (the start's outside the block's start, the end's outside its end — they never cover each other)
        ps.hidden = false;
        ps.style.insetInlineStart = `${Math.min(1, Math.max(0, (s0 - a) / (b - a))) * 100}%`;
        ps.textContent = formatMinutes(s0);
        pe.hidden = false;
        pe.style.insetInlineStart = `${Math.min(1, Math.max(0, (e0 - a) / (b - a))) * 100}%`;
        pe.textContent = formatMinutes(Math.min(DAY_MINUTES - 1, e0));
        cur.hidden = true; // on a block the two numbers say it all
        shown.push(s0, e0);
      } else {
        ps.hidden = true;
        pe.hidden = true;
        cur.hidden = false;
        cur.style.insetInlineStart = `${((m - a) / (b - a)) * 100}%`;
        cur.textContent = formatMinutes(m);
        shown.push(m);
      }
      ax.querySelectorAll<HTMLElement>(".ss-htick:not(.is-leaving)").forEach((t) => {
        const tm = Number(t.dataset.m);
        const covered = shown.some((x) => Math.abs(((tm - x) / (b - a)) * r.width) < 40);
        if (covered !== t.classList.contains("is-covered")) t.classList.toggle("is-covered", covered);
      });
    };
    const onMove = (e: PointerEvent) => {
      at = { x: e.clientX, y: e.clientY };
      paint(e.clientX, e.clientY);
    };
    repaintH.current = () => {
      if (at) paint(at.x, at.y);
    };
    dvEl.addEventListener("pointermove", onMove);
    dvEl.addEventListener("pointerleave", hide);
    return () => {
      repaintH.current = null;
      dvEl.removeEventListener("pointermove", onMove);
      dvEl.removeEventListener("pointerleave", hide);
    };
  }, [dvEl]);
  const onRulerPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width < 10) return;
    const start = { a: zoomSrc.current.a, b: zoomSrc.current.b };
    const panning = e.shiftKey && zoomSrc.current.zoomed;
    const sx = e.clientX;
    const rtl = isRtl();
    let ratio = (sx - rect.left) / rect.width;
    if (rtl) ratio = 1 - ratio;
    const pxPerMin = rect.width / (start.b - start.a);
    const releaseCursor = holdCursor(panning ? "grabbing" : "ew-resize");
    const move = (ev: PointerEvent) => {
      const dx = (rtl ? -1 : 1) * (ev.clientX - sx);
      applyZoom(() => (panning ? panWindow(start, -dx / pxPerMin) : zoomWindow(start, Math.exp(-dx / RULER_ZOOM_PX), ratio)), "drag");
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      releaseCursor();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const resetZoom = () => {
    setZoomWin(null);
    nudgeZoom("smooth");
  };
  const alive = useRef(true);
  const [jmenu, setJmenu] = useState<{ item: JingleLike; day: number; min: number; rect: Rect } | null>(null);
  const [clipDay, setClipDay] = useState<number | undefined>(undefined);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollObs = useRef<ResizeObserver | null>(null);
  const scrollNode = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    scrollObs.current?.disconnect();
    scrollObs.current = null;
    if (!el) return;
    setScrollH(el.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setScrollH(el.clientHeight));
    ro.observe(el);
    scrollObs.current = ro;
  }, []);
  const toastTimer = useRef<number | null>(null);

  // ── the hours of the week's columns: stretch / squeeze them like a music app's timeline (owner 2026-11-15) — scroll on the hours (or Ctrl + scroll anywhere), press on the hours and drag
  // down (closer) / up (further), − / +; the minute under the pointer stays where it is ──
  const hourRef = useRef(hourH);
  const vAnchor = useRef<{ min: number; y: number } | null>(null);
  const zoomHoursTo = useCallback(
    (target: number, clientY?: number, mode: "smooth" | "drag" = "smooth") => {
      const el = scrollRef.current;
      const next = Math.min(MAX_HOUR_H, Math.max(fitH, target)); // never squeezed past "the whole stretch fits the screen"
      const h = hourRef.current;
      if (!el || Math.abs(next - h) < 0.01) return;
      const y = clientY !== undefined ? clientY - el.getBoundingClientRect().top : el.clientHeight / 2;
      vAnchor.current = { min: FIRST_H * 60 + ((el.scrollTop + y) * 60) / h, y };
      hourRef.current = next;
      setZoomedH(next <= fitH + 0.5 ? null : next);
      nudgeZoom(mode); // the labels blur in and out while the hours zoom, like the day's ruler
    },
    [FIRST_H, fitH, nudgeZoom],
  );
  const zoomHours = useCallback((factor: number, clientY?: number) => zoomHoursTo(hourRef.current * factor, clientY), [zoomHoursTo]);
  const resetHours = useCallback(() => zoomHoursTo(fitH), [zoomHoursTo, fitH]);
  useLayoutEffect(() => {
    hourRef.current = hourH;
    const a = vAnchor.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    vAnchor.current = null;
    el.scrollTop = Math.max(0, ((a.min - FIRST_H * 60) * hourH) / 60 - a.y);
  }, [hourH, FIRST_H]);
  const columnsView = view === "week" && display.weekLayout === "columns";
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !columnsView) return;
    const onWheel = (e: WheelEvent) => {
      const onHours = !!(e.target as Element | null)?.closest?.(".ss-gutter");
      const pinch = e.ctrlKey || e.metaKey; // a trackpad pinch arrives as ctrl + wheel
      if (!pinch && !onHours) return;
      e.preventDefault();
      // a plain wheel works the other way round (owner 2026-11-16: scroll UP shrinks the hours, DOWN stretches them); a pinch keeps its own meaning (spread = closer)
      zoomHours(Math.exp((pinch ? -1 : 1) * e.deltaY * (pinch && Math.abs(e.deltaY) < 40 ? 0.012 : 0.0024)), e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [columnsView, zoomHours]);
  // the same readout for the week's columns: the time at the pointer on the hours at the side, and the stretch of the block it is on
  const repaintV = useRef<(() => void) | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !columnsView) return;
    let at: { x: number; y: number } | null = null;
    const hide = () => {
      at = null;
      el.querySelectorAll<HTMLElement>(".ss-gutter .ss-xcur, .ss-gutter .ss-xpill").forEach((n) => { n.hidden = true; });
      el.querySelectorAll<HTMLElement>(".ss-gutter .ss-hour.is-covered").forEach((t) => t.classList.remove("is-covered"));
    };
    const paint = (px: number, py: number) => {
      if (carryLive.current) return;
      const g = el.querySelector<HTMLElement>(".ss-gutter");
      const cur = g?.querySelector<HTMLElement>(".ss-xcur");
      const ps = g?.querySelector<HTMLElement>(".ss-xpill--s");
      const pe = g?.querySelector<HTMLElement>(".ss-xpill--e");
      const body = el.querySelector<HTMLElement>(".ss-body");
      if (!g || !cur || !ps || !pe || !body) return;
      const h = hourRef.current;
      const m = Math.round(FIRST_H * 60 + ((py - body.getBoundingClientRect().top) * 60) / h);
      const carried = el.querySelector<HTMLElement>(".ss-block.is-dragging:not(.is-ghost)");
      if (!carried && (m < FIRST_H * 60 || m > LAST_H * 60)) return hide();
      const blk = carried ?? document.elementFromPoint(px, py)?.closest<HTMLElement>(".ss-block");
      const shown: number[] = [];
      if (blk?.dataset.start && blk.dataset.end && !blk.classList.contains("is-ghost")) {
        const s0 = Number(blk.dataset.start);
        const e0 = Number(blk.dataset.end);
        ps.hidden = false;
        ps.style.top = `${((Math.max(FIRST_H * 60, s0) - FIRST_H * 60) * h) / 60}px`;
        ps.textContent = formatMinutes(s0);
        pe.hidden = false;
        pe.style.top = `${((Math.min(LAST_H * 60, e0) - FIRST_H * 60) * h) / 60}px`;
        pe.textContent = formatMinutes(Math.min(DAY_MINUTES - 1, e0));
        cur.hidden = true;
        shown.push(s0, e0);
      } else {
        ps.hidden = true;
        pe.hidden = true;
        cur.hidden = false;
        cur.style.top = `${((m - FIRST_H * 60) * h) / 60}px`;
        cur.textContent = formatMinutes(Math.min(DAY_MINUTES - 1, m));
        shown.push(m);
      }
      g.querySelectorAll<HTMLElement>(".ss-hour:not(.is-leaving)").forEach((t) => {
        const tm = Number(t.dataset.m);
        const covered = shown.some((x) => Math.abs(((tm - x) * h) / 60) < 15);
        if (covered !== t.classList.contains("is-covered")) t.classList.toggle("is-covered", covered);
      });
    };
    const onMove = (e: PointerEvent) => {
      at = { x: e.clientX, y: e.clientY };
      paint(e.clientX, e.clientY);
    };
    repaintV.current = () => {
      if (at) paint(at.x, at.y);
    };
    el.addEventListener("scroll", repaintV.current, { passive: true }); // the columns scroll under a still pointer
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", hide);
    const onScroll = repaintV.current;
    return () => {
      repaintV.current = null;
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", hide);
    };
  }, [columnsView, FIRST_H, LAST_H]);
  // The readout follows what is under the pointer even when the pointer does not move: after a trim, after the hours are zoomed / slid / scrolled, after the blocks change — otherwise two yellow times
  // stayed on the ruler for a block that had gone from under the pointer until the mouse was moved (owner 2026-11-16)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      repaintH.current?.();
      repaintV.current?.();
    });
    return () => cancelAnimationFrame(id);
  }, [drag, winA, winB, hourH, FIRST_H, LAST_H, view, items]);
  const onGutterPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sy = e.clientY;
    const h0 = hourRef.current;
    const releaseCursor = holdCursor("ns-resize");
    const move = (ev: PointerEvent) => zoomHoursTo(h0 * Math.exp((ev.clientY - sy) / RULER_ZOOM_PX), sy, "drag");
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      releaseCursor();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // the whole screen is the studio: the page's side rails are hidden while it is open (CSS: html[data-sb-studio])
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-sb-studio", "1");
    return () => {
      root.removeAttribute("data-sb-studio");
      // on the way back the side rails open again with the grid gliding: the page's heavy glass (blurs) is off while they move, exactly as when a rail is toggled by hand (owner 2026-11-16: the way back was not smooth)
      const grid = document.querySelector<HTMLElement>(".workspace-rail-grid");
      if (grid) {
        grid.setAttribute("data-moving", "1");
        window.setTimeout(() => grid.removeAttribute("data-moving"), 700);
      }
    };
  }, []);
  useEffect(() => {
    try {
      if (localStorage.getItem(PANEL_KEY) === "closed") setPanelOpen(false);
      if (localStorage.getItem(VIEW_KEY) === "week") setView("week");
      if (localStorage.getItem(JINGLES_KEY) === "off") setShowJingles(false);
      const rawDisplay = localStorage.getItem(DISPLAY_KEY);
      if (rawDisplay) setDisplay(parseDisplay(JSON.parse(rawDisplay)));
      const rawHours = localStorage.getItem(HOURS_KEY);
      if (rawHours) setBiz(parseBizHours(JSON.parse(rawHours)));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    const read = () => setJingles(loadJingleSchedule(stationBranch));
    Promise.resolve().then(read);
    window.addEventListener(JINGLE_SCHEDULE_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(JINGLE_SCHEDULE_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, [stationBranch]);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  const undoRef = useRef<() => void>(() => {});
  /** `undo` = the toast offers Undo, which is the same step as Cmd/Ctrl+Z (see "UNDO" below) */
  const showToast = useCallback((msg: string, undo?: boolean) => {
    setToast({ msg, undo: undo ? () => undoRef.current() : undefined });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), undo ? 7000 : 4200);
  }, []);
  const togglePanel = () => {
    setPanelOpen((v) => {
      try { localStorage.setItem(PANEL_KEY, v ? "closed" : "open"); } catch { /* ignore */ }
      return !v;
    });
  };
  const chooseDisplay = (patch: Partial<StudioDisplay> | null) => {
    setDisplay((prev) => {
      const next = patch === null ? DEFAULT_DISPLAY : { ...prev, ...patch };
      try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const toggleJingles = () => {
    setShowJingles((v) => {
      try { localStorage.setItem(JINGLES_KEY, v ? "off" : "on"); } catch { /* ignore */ }
      return !v;
    });
    setJmenu(null);
  };
  const chooseView = (v: "week" | "day") => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  };

  // ── branches (rows of the day view, the filter of the week view) ──
  const branchName = useCallback((id: string) => branches.find((b) => b.id === id)?.name ?? (id === "default" ? tr("Default") : id), [branches, tr]);
  const branchIds = useMemo(() => {
    const ids = Array.from(new Set(items.map((s) => (s.branchId ?? "default").trim() || "default")));
    return ids.sort((a, b) => branchName(a).localeCompare(branchName(b)));
  }, [items, branchName]);

  // ── the music the owner can schedule ──
  const [blockColors, setBlockColors] = useState<Record<string, number>>({});
  // the royalty-free music banks (the public Genre Packs + this business's private banks) — a category of their own (owner 2026-11-12)
  const [bankPacks, setBankPacks] = useState<BankPackSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listBankPacks().then((l) => { if (!cancelled) setBankPacks(l); }).catch(() => { /* the other music still shows */ });
    return () => { cancelled = true; };
  }, []);
  const lib = useMemo<LibItem[]>(() => {
    const out: LibItem[] = [];
    const colour = (targetType: string, targetId: string) => paletteIndex(`${targetType}:${targetId}`);
    const bid = (targetType: "SOURCE" | "PLAYLIST" | "RADIO", targetId: string) => resolveScheduleTargetBranchId({ targetType, targetId }, sources, playlists, radioStations);
    for (const p of playlists) {
      out.push({ key: scheduleTargetKey("PLAYLIST", p.id), targetType: "PLAYLIST", targetId: p.id, name: p.name, cover: (p.thumbnail || p.cover || "").trim() || null, kind: "playlist", sub: p.tracks?.length ? (p.tracks.length === 1 ? tr("1 song") : tr("{n} songs", { n: p.tracks.length })) : tr("Playlist"), branchId: bid("PLAYLIST", p.id), ci: colour("PLAYLIST", p.id), dur: playlistSeconds(p) ?? learned[p.id] ?? null });
    }
    for (const s of sources) {
      out.push({ key: scheduleTargetKey("SOURCE", s.id), targetType: "SOURCE", targetId: s.id, name: s.name, cover: (s.artworkUrl ?? "").trim() || null, kind: "song", sub: tr("Song"), branchId: bid("SOURCE", s.id), ci: colour("SOURCE", s.id), dur: null });
    }
    for (const r of radioStations) {
      out.push({ key: scheduleTargetKey("RADIO", r.id), targetType: "RADIO", targetId: r.id, name: r.name, cover: null, kind: "radio", sub: tr("Radio"), branchId: bid("RADIO", r.id), ci: colour("RADIO", r.id), dur: null });
    }
    // a bank is not branch content: it takes the branch of the row / filter it is dropped in (like a quiet block); its length is not its own — it plays for as long as the block lasts
    for (const b of bankPacks) {
      out.push({ key: scheduleTargetKey("BANK", b.id), targetType: "BANK", targetId: b.id, name: b.name, cover: null, kind: "bank", sub: b.isPrivate ? tr("Private music bank") : tr("Royalty-free"), branchId: "", ci: colour("BANK", b.id), dur: null });
    }
    return out;
  }, [playlists, sources, radioStations, bankPacks, learned, tr]);
  const libMap = useMemo(() => new Map(lib.map((l) => [l.key, l])), [lib]);
  const libFor = useCallback((s: Schedule) => libMap.get(scheduleTargetKey(s.targetType, (s.targetId || s.sourceId || "").trim())) ?? null, [libMap]);
  // "Quiet — no music": a block that stops the music at its start (the engine's SILENCE target). It lives in the music list as the first row.
  const quietItem = useMemo<LibItem>(() => ({ key: scheduleTargetKey("SILENCE", "silence"), targetType: "SILENCE", targetId: "silence", name: tr("Quiet"), cover: null, kind: "quiet", sub: tr("No music"), branchId: "", ci: 17, dur: null }), [tr]);
  const quietBranch = branchFilter !== "all" ? branchFilter : branchIds[0] ?? branches[0]?.id ?? "default";
  // The branch's SCHEDULE switch (owner 2026-11-16): "the schedule of THIS player is on / off", kept with the branch on the server — whoever can edit the branch's schedules flips it, from anywhere, and
  // the branch's player obeys. It belongs to the branch you are looking at (the filter), else to this window's own branch. null = not read yet.
  const switchBranch = branchFilter !== "all" ? branchFilter : stationBranch;
  const [sw, setSw] = useState<{ branch: string; enabled: boolean; switchable: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => {
      void fetchScheduleSwitch(switchBranch).then((r) => {
        if (alive && r) setSw((prev) => (prev && prev.branch === switchBranch && prev.enabled === r.enabled && prev.switchable === r.switchable ? prev : { branch: switchBranch, ...r }));
      });
    };
    read();
    const id = window.setInterval(read, 30_000); // somebody else may flip it from another screen
    const onVis = () => { if (document.visibilityState === "visible") read(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [switchBranch]);
  const scheduleOn = sw && sw.branch === switchBranch ? sw.enabled : true;
  const scheduleSwitchable = !!sw && sw.branch === switchBranch && sw.switchable;
  const flipSchedule = async () => {
    if (!scheduleSwitchable) return;
    const next = !scheduleOn;
    setSw({ branch: switchBranch, enabled: next, switchable: true }); // at once; the server's answer confirms it
    try {
      const saved = await saveScheduleSwitch(switchBranch, next);
      setSw({ branch: switchBranch, ...saved });
    } catch (e) {
      setSw({ branch: switchBranch, enabled: !next, switchable: true });
      showToast(`${tr("Couldn't save the change")} — ${e instanceof Error ? e.message : ""}`);
    }
  };
  const nameOf = (s: Schedule) => (isSilenceBlock(s) ? (s.name === CLOSING_NAME ? tr("Closing") : tr("Quiet")) : libFor(s)?.name ?? s.name ?? tr("Schedule"));
  // the colour of a block: the one the owner chose (remembered in this browser), else its base shade of blue
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(BLOCK_COLORS_KEY) || "{}") as Record<string, number>;
      if (raw && typeof raw === "object") Promise.resolve().then(() => setBlockColors(raw));
    } catch {
      /* ignore */
    }
  }, []);
  const setBlockColor = useCallback((id: string, idx: number | null) => {
    setBlockColors((prev) => {
      const next = { ...prev };
      if (idx === null) delete next[id];
      else next[id] = idx;
      try {
        localStorage.setItem(BLOCK_COLORS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const colourOf = (s: Schedule) => blockColors[baseId(s.id)] ?? libFor(s)?.ci ?? paletteIndex(`${s.targetType}:${s.targetId}`);
  // the look of a block's colour: a colour chosen for the block always wins; else the picture's own colour (when asked), else its shade of the chosen colour family (blue = the CSS palette)
  const toneOf = (s: Schedule): BlockTone | null => {
    if (blockColors[baseId(s.id)] !== undefined) return null;
    if (display.colour === "cover") {
      const c = libFor(s)?.cover;
      const t = c ? coverTones[c] : null;
      if (t) return t;
    }
    return familyShade(display.family, paletteIndex(`${s.targetType}:${s.targetId}`));
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (display.colour !== "cover") return;
    const urls: string[] = [];
    for (const s of items) {
      const c = libFor(s)?.cover;
      if (c && !toneAsked.current.has(c)) {
        toneAsked.current.add(c);
        urls.push(c);
      }
    }
    if (urls.length === 0) return;
    void (async () => {
      for (const url of urls) {
        const t = await sampleCover(url);
        if (!alive.current) return;
        setCoverTones((prev) => ({ ...prev, [url]: t }));
      }
    })();
  }, [display.colour, items, libFor]);

  // ── the time in view ──
  const clock = now ?? new Date();
  const focusDate = focus ?? clock;
  const todayKey = dateKey(clock);
  const focusKey = dateKey(focusDate);
  const weekDates = useMemo(() => weekDatesFor(focusDate), [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusDay = focusDate.getDay();
  const shiftFocus = (days: number) => setFocus(addDays(focusDate, days));
  const loc = locale === "he" ? "he-IL" : "en-GB";
  const dayName = (d: number, style: "short" | "long" = "short") => new Date(2026, 10, 8 + d).toLocaleDateString(loc, { weekday: style });
  const dateLabel = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y!, m! - 1, d!).toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short" });
  };
  const rangeLabel = (() => {
    if (view === "day") return new Date(focusDate.getFullYear(), focusDate.getMonth(), focusDate.getDate()).toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" });
    const a = new Date(`${weekDates[0]}T12:00:00`);
    const b = new Date(`${weekDates[6]}T12:00:00`);
    const sameMonth = a.getMonth() === b.getMonth();
    return `${a.toLocaleDateString(loc, { day: "numeric", ...(sameMonth ? {} : { month: "short" }) })} – ${b.toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" })}`;
  })();
  const isTodayInView = view === "day" ? focusKey === todayKey : weekDates.includes(todayKey);

  // ── what is scheduled ──
  const viewItems = useMemo(() => {
    if (!drag) return items;
    const src = items.find((s) => s.id === drag.id);
    if (!src) return items;
    const start = minutesToTimeLocal(drag.start);
    const edit = { startTimeLocal: start, ...(drag.end ? { endTimeLocal: drag.end } : {}) };
    // the neighbour the carried block has passed the middle of steps aside (its length stays what it was)
    const pv = drag.preview;
    const base = pv ? items.map((s) => (s.id === pv.id ? { ...s, startTimeLocal: minutesToTimeLocal(pv.start), endTimeLocal: minutesToTimeLocal(Math.min(END_MAX, pv.end)) } : s)) : items;
    // a block shared by several days: ONLY the day under the pointer moves (the others stay where they are)
    if (isMultiDayWeekly(src)) {
      return [...base.filter((s) => s.id !== src.id), { ...src, daysOfWeek: src.daysOfWeek.filter((d) => d !== drag.day) }, { ...src, id: `${src.id}#drag`, daysOfWeek: [drag.day], ...edit }];
    }
    return base.map((s) => (s.id === drag.id ? { ...s, ...edit } : s));
  }, [items, drag]);
  // the carried block floats outside the sequence of blocks (it never shortens, nor shortens, its neighbours)
  const floatingId = useMemo(() => {
    if (!drag) return undefined;
    const src = items.find((s) => s.id === drag.id);
    return src && isMultiDayWeekly(src) ? `${drag.id}#drag` : drag.id;
  }, [drag, items]);
  const shownItems = useMemo(() => (branchFilter === "all" ? viewItems : viewItems.filter((s) => ((s.branchId ?? "default").trim() || "default") === branchFilter)), [viewItems, branchFilter]);
  // how long a block's own music lasts (null = not known, or live): a block with no end of its own is drawn only that long (owner 2026-11-15)
  const musicMinutes = useCallback((s: Schedule): number | null => {
    const m = fitMinutes(libFor(s)?.dur);
    return Number.isFinite(m) ? m : null;
  }, [libFor]);
  const weekScenes = useMemo(() => {
    // every branch is its own sequence (the engine is per branch): another branch's block never cuts, hides or shadows this one's
    const norm = (x: Schedule) => (x.branchId ?? "default").trim() || "default";
    const ids = Array.from(new Set(shownItems.map(norm)));
    return WEEK_DAYS.map((d) =>
      ids.length <= 1 ? buildDayScenes(shownItems, d, weekDates, musicMinutes, floatingId) : ids.flatMap((id) => buildDayScenes(shownItems.filter((x) => norm(x) === id), d, weekDates, musicMinutes, floatingId)).sort((a, b) => a.start - b.start),
    );
  }, [shownItems, musicMinutes, weekDates, floatingId]);
  const dayRows = useMemo(() => {
    const ids = branchFilter !== "all" ? [branchFilter] : branchIds.length > 0 ? branchIds : [branches[0]?.id ?? "default"];
    return ids.map((id) => ({ id, name: branchName(id), scenes: buildDayScenes(viewItems.filter((s) => ((s.branchId ?? "default").trim() || "default") === id), focusDay, weekDates, musicMinutes, floatingId) }));
  }, [branchFilter, branchIds, branches, branchName, viewItems, focusDay, weekDates, musicMinutes, floatingId]);
  const nowMin = clock.getHours() * 60 + clock.getMinutes();
  const hoursBranches = useMemo(() => {
    const ids = Array.from(new Set([...branches.map((b) => b.id), ...branchIds]));
    return (ids.length ? ids : ["default"]).map((id) => ({ id, name: branchName(id) }));
  }, [branches, branchIds, branchName]);
  const editing = editor?.kind === "edit" ? items.find((s) => s.id === editor.id) ?? null : null;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // the first screen shows the working day: from 06:00 (morning) up to 07:30 (evening), following the clock — so the morning blocks are never cut at the top
    const topMin = Math.min(Math.max(nowMin - 8 * 60, FIRST_H * 60), Math.max(FIRST_H * 60, LAST_H * 60 - 600));
    el.scrollTop = Math.max(0, ((topMin - FIRST_H * 60) * HOUR_H) / 60 - 10); // a little above the hour so its label is not cut
    // once, when the week appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ── UNDO (owner 2026-11-15: "Ctrl/Cmd+Z takes back what I did on the schedule") ──
  // ONE history for every change made on this screen: before a change, the blocks as they were are remembered; changes that follow within a moment (the two writes of one
  // "move this day only", the many of "Day hours") are one step. Undo puts the blocks back: what was added is removed, what changed is changed back, what was deleted is made
  // again. The toast's Undo button is the same step. Only the schedule's own changes are in it (not colours, not the screen's settings).
  const itemsRef = useRef(items);
  const colorsRef = useRef(blockColors);
  const history = useRef<Array<{ items: Schedule[]; colors: Record<string, number> }>>([]);
  const lastChangeAt = useRef(0);
  const undoing = useRef(false);
  useEffect(() => {
    itemsRef.current = items;
    colorsRef.current = blockColors;
  });
  /** remembers the blocks before a change; true when it took a NEW snapshot (so a failed save can take it back) */
  const remember = useCallback((): boolean => {
    if (undoing.current) return false;
    const now = Date.now();
    let pushed = false;
    if (now - lastChangeAt.current > HISTORY_GROUP_MS) {
      history.current.push({ items: itemsRef.current.filter((x) => !x.id.startsWith("tmp-")), colors: { ...colorsRef.current } });
      if (history.current.length > HISTORY_MAX) history.current.shift();
      pushed = true;
    }
    lastChangeAt.current = now;
    return pushed;
  }, []);
  const touch = useCallback(() => {
    lastChangeAt.current = Date.now();
  }, []);

  // ── saving (optimistic, rolled back on a failure) ──
  const update = useCallback(
    async (id: string, patch: Partial<Schedule>) => {
      const before = itemsRef.current.find((s) => s.id === id) ?? items.find((s) => s.id === id);
      if (!before) return;
      const pushed = remember();
      setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      try {
        const saved = await api<Schedule>("PATCH", `/api/schedules/${encodeURIComponent(id)}`, patch);
        setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...saved } : s)));
      } catch (e) {
        setItems((prev) => prev.map((s) => (s.id === id ? before : s)));
        if (pushed) history.current.pop(); // nothing changed on the server: no step to undo
        showToast(`${tr("Couldn't save the change")} — ${e instanceof Error ? e.message : ""}`);
      }
      touch();
    },
    [items, showToast, tr, remember, touch],
  );

  const createFromBody = useCallback(
    async (body: Record<string, unknown>): Promise<Schedule | null> => {
      const pushed = remember();
      const tmp = { id: `tmp-${Date.now()}`, accountId: "", ...body } as unknown as Schedule;
      setItems((prev) => [...prev, tmp]);
      try {
        const created = await api<Schedule>("POST", "/api/schedules", body);
        setItems((prev) => prev.map((s) => (s.id === tmp.id ? created : s)));
        touch();
        return created;
      } catch (e) {
        setItems((prev) => prev.filter((s) => s.id !== tmp.id));
        if (pushed) history.current.pop();
        showToast(`${tr("Couldn't save the change")} — ${e instanceof Error ? e.message : ""}`);
        touch();
        return null;
      }
    },
    [showToast, tr, remember, touch],
  );

  // The length of a playlist that has none stored is asked for (YouTube) — once, shared: the drag already asks when it begins, the drop waits for the answer (owner 2026-11-16: a new song
  // must not be drawn at a guessed length, "the minutes can be loaded when I drop it, before it is shown"). Where it cannot be looked up here (a local file, no YouTube) the answer is null.
  const lookupLength = useCallback((item: LibItem): Promise<number | null> => {
    if (item.dur && item.dur > 0) return Promise.resolve(item.dur);
    if (item.targetType !== "PLAYLIST") return Promise.resolve(null);
    const known = lengthLookups.current.get(item.targetId);
    if (known) return known;
    const p = (async (): Promise<number | null> => {
      try {
        const res = await api<{ durationSeconds?: number | null }>("POST", `/api/playlists/${encodeURIComponent(item.targetId)}/refresh-duration`);
        const sec = res?.durationSeconds;
        if (typeof sec === "number" && sec > 0) {
          setLearned((prev) => ({ ...prev, [item.targetId]: sec }));
          return sec;
        }
      } catch {
        /* its length cannot be looked up here */
      }
      return null;
    })();
    lengthLookups.current.set(item.targetId, p);
    // an empty answer may be asked again later (a network blip) — not in a loop
    void p.then((v) => {
      if (v === null) window.setTimeout(() => lengthLookups.current.delete(item.targetId), 30_000);
    });
    return p;
  }, []);

  const create = useCallback(
    async (item: LibItem, day: number, min: number, branchId?: string) => {
      let dur = item.dur;
      if (item.targetType === "PLAYLIST" && !(dur && dur > 0)) {
        // the length first, THEN the block: a dashed spot holds the place for the moment it takes (never longer than LOOKUP_WAIT_MS)
        const mine = { day, min, branchId };
        setPending(mine);
        const sec = await Promise.race([lookupLength(item), new Promise<null>((r) => window.setTimeout(() => r(null), LOOKUP_WAIT_MS))]);
        setPending((p) => (p === mine ? null : p));
        if (sec) dur = sec;
      }
      const created = await createFromBody({
        name: item.targetType === "SILENCE" ? "Quiet" : item.name,
        // a quiet block belongs to the branch whose row / filter it was added in
        branchId: item.targetType === "SILENCE" || item.targetType === "BANK" ? branchId ?? quietBranch : item.branchId,
        targetType: item.targetType,
        targetId: item.targetId,
        sourceId: item.targetType === "SOURCE" ? item.targetId : undefined,
        recurrence: "weekly",
        daysOfWeek: [day],
        startTimeLocal: minutesToTimeLocal(min),
        // a dropped song / playlist is exactly as long as its music (owner 2026-11-12). Only when the length really cannot be had (a local file, no answer in time) it is drawn the shortest block
        // (PROVISIONAL_MIN) until an answer comes; when it runs past the day it stays "until the next block"
        ...(item.targetType !== "SILENCE" && Number.isFinite(fitMinutes(dur)) && min + fitMinutes(dur) <= END_MAX
          ? { endTimeLocal: minutesToTimeLocal(min + fitMinutes(dur)) }
          : (item.targetType === "PLAYLIST" || item.targetType === "SOURCE") && !Number.isFinite(fitMinutes(dur)) && min + PROVISIONAL_MIN <= END_MAX
            ? { endTimeLocal: minutesToTimeLocal(min + PROVISIONAL_MIN) }
            : {}),
        enabled: true,
        priority: 1,
      });
      if (created && !(dur && dur > 0)) void learnRef.current(item, created); // a late answer still gives the block its true length
      return created;
    },
    [createFromBody, quietBranch, lookupLength],
  );
  // a block drawn at the provisional length takes the music's own length when the answer comes (an end the person set in the meantime is theirs)
  const learnLength = useCallback(
    async (item: LibItem, created: Schedule) => {
      if (item.targetType !== "PLAYLIST" || item.dur) return;
      const sec = await lookupLength(item);
      if (!sec) return;
      try {
        const cur = itemsRef.current.find((x) => x.id === created.id);
        const start = startMinutes(created);
        const end = start + fitMinutes(sec);
        const e0 = cur ? explicitEndMinutes(cur) : null;
        if (cur && (e0 === null || e0 === start + PROVISIONAL_MIN)) {
          if (end <= END_MAX) await update(created.id, { endTimeLocal: minutesToTimeLocal(end) });
          else if (e0 !== null) await update(created.id, { endTimeLocal: "23:59:00" }); // longer than what is left of the day: "until the next block"
        }
      } catch {
        /* nothing to change */
      }
    },
    [update, lookupLength],
  );
  const learnRef = useRef(learnLength);
  useEffect(() => {
    learnRef.current = learnLength;
  });

  const removeNow = useCallback(
    async (id: string): Promise<boolean> => {
      const pushed = remember();
      try {
        await api("DELETE", `/api/schedules/${encodeURIComponent(id)}`);
      } catch (e) {
        if (!(e instanceof Error) || !/not found|404/i.test(e.message)) {
          if (pushed) history.current.pop();
          showToast(`${tr("Couldn't save the change")} — ${e instanceof Error ? e.message : ""}`);
          touch();
          return false;
        }
      }
      clearLocalAutoPrefs(id);
      setBlockColor(id, null);
      setItems((prev) => prev.filter((s) => s.id !== id));
      touch();
      return true;
    },
    [showToast, tr, setBlockColor, remember, touch],
  );

  // Deleting a block asks nothing (owner 2026-11-15: no second "are you sure"): it goes at once, and Undo — the toast button or Cmd/Ctrl+Z — brings it back.
  const deleteBlock = useCallback(
    async (s: Schedule) => {
      const name = isSilenceBlock(s) ? (s.name === CLOSING_NAME ? tr("Closing") : tr("Quiet")) : libFor(s)?.name ?? s.name ?? tr("Schedule");
      if (await removeNow(s.id)) {
        setEditor(null);
        showToast(tr("Deleted {name}", { name }), true);
      }
    },
    [removeNow, showToast, tr, libFor],
  );

  const undoLast = useCallback(async () => {
    if (undoing.current) return; // one undo at a time: a second press while the first is still writing would make the same block twice
    const snap = history.current.pop();
    if (!snap) {
      showToast(tr("Nothing to undo"));
      return;
    }
    undoing.current = true;
    try {
      const now = itemsRef.current.filter((x) => !x.id.startsWith("tmp-"));
      const was = new Map(snap.items.map((x) => [x.id, x]));
      const is = new Map(now.map((x) => [x.id, x]));
      for (const x of now) if (!was.has(x.id)) await removeNow(x.id); // made since → removed
      for (const [id, earlier] of was) {
        const current = is.get(id);
        if (!current) continue;
        const patch = changedFields(current, earlier);
        if (Object.keys(patch).length > 0) await update(id, patch); // changed since → changed back
      }
      for (const [id, earlier] of was) {
        if (is.has(id)) continue; // deleted since → made again
        const created = await createFromBody(scheduleBody(earlier));
        if (created && snap.colors[id] !== undefined) setBlockColor(created.id, snap.colors[id]!);
      }
      showToast(tr("Undone"));
    } finally {
      undoing.current = false;
      lastChangeAt.current = 0;
    }
  }, [removeNow, update, createFromBody, setBlockColor, showToast, tr]);
  useEffect(() => {
    undoRef.current = () => void undoLast();
  });

  async function playNow(s: Schedule) {
    if (isSilenceBlock(s)) {
      // a quiet block's "play now" is "stop now" — the Stop button's own path
      (stopScheduled ?? stop)();
      showToast(tr("Stopped"));
      return;
    }
    const sid = s.targetType === "SOURCE" ? s.targetId : s.sourceId;
    const source = sources.find((x) => x.id === (sid ?? "").trim()) ?? null;
    setLastMessage(null);
    try {
      await runSchedulePlayback(s, source, { stop, setQueue, playSource, setLastMessage, route }, router);
    } catch {
      /* the playback layer reports its own errors */
    }
  }

  // ── copy / paste: the same music at exactly the same hour, one time, on another date ──
  const copyBlock = useCallback(
    (s: Schedule, day?: number) => {
      setClip(s);
      setClipDay(day);
      showToast(tr("Copied — click a day's title to paste it there at the same hour."));
    },
    [showToast, tr],
  );
  const pasteOn = useCallback(
    async (ymd: string) => {
      if (!clip) return;
      const body = pastedScheduleBody(clip, ymd);
      // a pasted song is as long as its music, never "until the end of the day" (owner 2026-11-15)
      const li = libFor(clip);
      const fit = fitMinutes(li?.dur);
      if (explicitEndMinutes(clip) === null && Number.isFinite(fit) && startMinutes(clip) + fit <= END_MAX) body.endTimeLocal = minutesToTimeLocal(startMinutes(clip) + fit);
      const created = await createFromBody(body);
      if (created) {
        if (li) void learnRef.current(li, created);
        if (blockColors[clip.id] !== undefined) setBlockColor(created.id, blockColors[clip.id]!);
        showToast(`${tr("Pasted")} · ${dateLabel(ymd)} ${formatMinutes(startMinutes(created))}`, true);
      }
    },
    [clip, createFromBody, removeNow, showToast, tr, blockColors, setBlockColor, libFor], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // ── editing ONE day's block: its start (a move) and / or its END (owner 2026-11-11: "when I stand on a specific song, it moves by itself") ──
  // A block that repeats on several days is one schedule in the data. Editing one day's block detaches that day: the others keep their time, the edited
  // day becomes its own weekly block (Undo puts it back). A block of one day, or a one-time block, is simply edited. A block that has an END keeps its length when it moves.
  const editOccurrence = useCallback(
    async (src: Schedule, day: number, edit: { start?: number; end?: number | null; toDay?: number }, opts?: { quiet?: boolean }): Promise<string | null> => {
      const oldStart = startMinutes(src);
      const oldEnd = explicitEndMinutes(src);
      let newStart = edit.start ?? oldStart;
      // a move keeps the block's length: it can go no later than the end of the day allows (the length is never squeezed)
      if (edit.end === undefined && oldEnd !== null) newStart = Math.min(newStart, Math.max(oldStart, END_MAX - (oldEnd - oldStart)));
      let newEnd: number | null = edit.end !== undefined ? edit.end : oldEnd !== null ? Math.min(END_MAX, oldEnd + (newStart - oldStart)) : null;
      if (newEnd !== null && newEnd <= newStart) newEnd = null;
      const toDay = edit.toDay !== undefined && edit.toDay !== day ? edit.toDay : null; // moved to another day of the week (owner 2026-11-15)
      if (newStart === oldStart && newEnd === oldEnd && toDay === null) return src.id;
      remember();
      const patch: Partial<Schedule> = {};
      if (newStart !== oldStart) patch.startTimeLocal = minutesToTimeLocal(newStart);
      if (newEnd !== oldEnd) patch.endTimeLocal = newEnd === null ? "23:59:00" : minutesToTimeLocal(newEnd);
      if (toDay !== null && !isMultiDayWeekly(src)) {
        if (src.recurrence === "one_off") patch.oneOffDateLocal = weekDates[toDay];
        else patch.daysOfWeek = [toDay];
      }
      const dayNote = toDay !== null ? `${tr("Moved to {day}", { day: dayName(toDay, "long") })} · ${formatMinutes(newStart)}` : "";
      const endNote = dayNote || (newEnd !== oldEnd ? (newEnd === null ? tr("Runs until the next block") : tr("Ends {time}", { time: formatMinutes(newEnd) })) : "");
      if (!isMultiDayWeekly(src)) {
        await update(src.id, patch);
        if (endNote && !opts?.quiet) showToast(endNote, true);
        return src.id;
      }
      const rest = src.daysOfWeek.filter((d) => d !== day);
      const before = items;
      const tmp: Schedule = { ...src, id: `tmp-${Date.now()}`, daysOfWeek: [toDay ?? day], ...patch };
      setItems((prev) => [...prev.map((x) => (x.id === src.id ? { ...x, daysOfWeek: rest } : x)), tmp]);
      const tid = (src.targetId || src.sourceId || "").trim();
      try {
        const created = await api<Schedule>("POST", "/api/schedules", {
          name: src.name,
          branchId: src.branchId,
          targetType: src.targetType,
          targetId: tid,
          sourceId: src.targetType === "SOURCE" ? tid : undefined,
          deviceId: src.deviceId || undefined,
          recurrence: "weekly",
          daysOfWeek: [toDay ?? day],
          startTimeLocal: patch.startTimeLocal ?? src.startTimeLocal,
          endTimeLocal: patch.endTimeLocal ?? (src.endTimeLocal || undefined),
          enabled: src.enabled,
          priority: typeof src.priority === "number" ? src.priority : 1,
          ...(typeof src.volume === "number" ? { volume: src.volume } : {}), // "this day only" keeps the block's volume
        });
        try {
          await api("PATCH", `/api/schedules/${encodeURIComponent(src.id)}`, { daysOfWeek: rest });
        } catch (e) {
          await api("DELETE", `/api/schedules/${encodeURIComponent(created.id)}`).catch(() => {});
          throw e;
        }
        setItems((prev) => prev.map((x) => (x.id === tmp.id ? created : x)));
        touch();
        if (blockColors[src.id] !== undefined) setBlockColor(created.id, blockColors[src.id]!);
        if (!opts?.quiet) {
          showToast(`${endNote || `${tr("Moved")} · ${dayName(day)} ${formatMinutes(newStart)}`} — ${tr("this day only")}`, true);
        }
        return created.id;
      } catch (e) {
        setItems(before);
        showToast(`${tr("Couldn't save the change")} — ${e instanceof Error ? e.message : ""}`);
        touch();
        return null;
      }
    },
    [items, update, removeNow, blockColors, setBlockColor, showToast, tr, remember, touch], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const removeFromDay = useCallback(
    (src: Schedule, day: number) => {
      const rest = src.daysOfWeek.filter((d) => d !== day);
      if (rest.length === 0) return;
      void update(src.id, { daysOfWeek: rest });
      showToast(tr("Removed from {day}", { day: dayName(day, "long") }), true);
    },
    [update, showToast, tr], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── SWAP (owner 2026-11-12: "swap songs like icons on a phone — without moving the others"): drop a block ON another block of the same row and the two trade places ──
  // The pair covers the same stretch of day as before (lib/schedules-timeline.ts swapStarts), so no other block moves. Each edit is a normal per-day edit (a block shared
  // by several days is detached for this day only); one toast with one Undo covers both.
  const editRef = useRef(editOccurrence); // always the LATEST edit (an Undo seconds later must see the blocks as they are then, not as they were at the swap)
  useEffect(() => {
    editRef.current = editOccurrence;
  });
  const [swapWith, setSwapWith] = useState<{ bid: string; day: number } | null>(null);
  const swapBlocks = useCallback(
    async (a: Scene, b: Scene, place?: { a: number; b: number }) => {
      const to = place ?? swapStarts(a, b);
      if (to.a === a.start && to.b === b.start) return;
      const cur = (sc: Scene) => itemsRef.current.find((x) => x.id === baseId(sc.schedule.id)) ?? sc.schedule;
      const idA = await editRef.current(cur(a), a.day, { start: to.a }, { quiet: true });
      const idB = idA ? await editRef.current(cur(b), b.day, { start: to.b }, { quiet: true }) : null;
      if (!idA || !idB) return; // a failed edit already said so (and rolled itself back)
      showToast(tr("Swapped {a} and {b}", { a: nameOf(a.schedule), b: nameOf(b.schedule) }), true);
    },
    [showToast, tr], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Day hours: a closing time per day = one weekly quiet block named "Closing" for each distinct time (days that share a time share a block) ──
  // New blocks are created first, then the old ones that are no longer wanted are removed, so a failure never leaves a day without its closing.
  const saveClosing = useCallback(
    async (branchId: string, desired: (number | null)[]): Promise<boolean> => {
      const inBranch = (x: Schedule) => ((x.branchId ?? "default").trim() || "default") === branchId;
      const existing = items.filter((x) => isSilenceBlock(x) && x.name === CLOSING_NAME && x.recurrence !== "one_off" && inBranch(x));
      const groups = new Map<number, number[]>();
      desired.forEach((m, d) => {
        if (m !== null) groups.set(m, [...(groups.get(m) ?? []), d]);
      });
      const keep = new Set<string>();
      const toCreate: { m: number; days: number[] }[] = [];
      for (const [m, days] of groups) {
        const hit = existing.find((e) => !keep.has(e.id) && e.enabled && startMinutes(e) === m && e.daysOfWeek.length === days.length && days.every((d) => e.daysOfWeek.includes(d)));
        if (hit) keep.add(hit.id);
        else toCreate.push({ m, days });
      }
      for (const g of toCreate) {
        const created = await createFromBody({ name: CLOSING_NAME, branchId, targetType: "SILENCE", targetId: "silence", recurrence: "weekly", daysOfWeek: g.days, startTimeLocal: minutesToTimeLocal(g.m), enabled: true, priority: 1 });
        if (!created) return false;
      }
      for (const e of existing) {
        if (keep.has(e.id)) continue;
        if (!(await removeNow(e.id))) return false;
      }
      showToast(tr("Closing saved"));
      return true;
    },
    [items, createFromBody, removeNow, showToast, tr],
  );

  const pasteHint = tr("Point at a day (or open the Day view), then paste.");
  const editorDay = editor?.day;
  // Delete / Backspace on the block that is open, else the one under the pointer (or the focused one): a block of several days loses only THAT day, a single block is deleted — both undoable
  const removeAt = useCallback(
    (id: string, day: number | undefined) => {
      const sc = itemsRef.current.find((x) => x.id === id);
      if (!sc) return;
      if (day !== undefined && isMultiDayWeekly(sc)) removeFromDay(sc, day);
      else void deleteBlock(sc);
    },
    [removeFromDay, deleteBlock],
  );
  const latest = useRef({ editing, editorDay, clip, hoverDate, view, focusKey, pasteOn, copyBlock, say: showToast, hint: pasteHint, removeAt, undo: undoLast });
  useEffect(() => {
    latest.current = { editing, editorDay, clip, hoverDate, view, focusKey, pasteOn, copyBlock, say: showToast, hint: pasteHint, removeAt, undo: undoLast };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.altKey) return;
      const L = latest.current;
      const mod = e.metaKey || e.ctrlKey;
      const isKey = (latin: string) => e.key.toLowerCase() === latin || e.code === `Key${latin.toUpperCase()}`; // a Hebrew layout types ז for Z: the physical key counts too
      if (mod && isKey("c") && L.editing) {
        e.preventDefault();
        L.copyBlock(L.editing, L.editorDay);
      } else if (mod && isKey("v") && L.clip) {
        const ymd = L.hoverDate ?? (L.view === "day" ? L.focusKey : null);
        e.preventDefault();
        if (!ymd) {
          L.say(L.hint);
          return;
        }
        void L.pasteOn(ymd);
      } else if (mod && isKey("z") && !e.shiftKey) {
        e.preventDefault();
        if (!e.repeat) void L.undo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod && !e.shiftKey) {
        let target: { id: string; day: number | undefined } | null = L.editing ? { id: L.editing.id, day: L.editorDay } : null;
        if (!target && !document.querySelector("[role='dialog'], .ss-menu")) {
          const el = document.querySelector<HTMLElement>(".ss-block:hover") ?? (document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>(".ss-block") : null);
          if (el?.dataset.bid) target = { id: el.dataset.bid, day: el.dataset.day !== undefined ? Number(el.dataset.day) : undefined };
        }
        if (target) {
          e.preventDefault();
          L.removeAt(target.id, target.day);
        }
      } else if (e.key === "Escape" && L.clip && !document.querySelector(".ss-pop, .ss-menu")) {
        setClip(null);
      }
    };
    // capture phase: it sees Escape BEFORE the open card closes itself, so one Escape closes the card and the next one clears the clipboard
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ── the pointer on a track (a day column in the week, a branch row in the day) ──
  const trackMove = (e: React.PointerEvent<HTMLDivElement>, key: string, ymd: string, orient: Orient) => {
    setHoverDate(ymd);
    // the week has no dashed guide that follows the pointer from 15 minutes to 15 minutes (owner 2026-11-16); the day's rows keep theirs. (A song dragged in from the list still shows where it will land.)
    if (key[0] !== "r") {
      if (hover) setHover(null);
      return;
    }
    if (e.target !== e.currentTarget || drag) {
      if (hover) setHover(null);
      return;
    }
    const m = minuteAtPointer(e.clientX, e.clientY, e.currentTarget, orient);
    if (!hover || hover.key !== key || hover.min !== m) setHover({ key, min: m });
  };
  const trackClick = (e: React.MouseEvent<HTMLDivElement>, day: number, orient: Orient, branchId?: string) => {
    if (e.target !== e.currentTarget) return;
    if (justClosedPopup()) return; // this click only closed the card that was open
    setEditor({ kind: "new", day, min: minuteAtPointer(e.clientX, e.clientY, e.currentTarget, orient), rect: { x: e.clientX, y: e.clientY, w: 0, h: 0 }, branchId });
  };
  const trackDragOver = (e: React.DragEvent<HTMLDivElement>, key: string, orient: Orient) => {
    if (!Array.from(e.dataTransfer.types).includes("application/x-ss-lib")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const m = minuteAtPointer(e.clientX, e.clientY, e.currentTarget, orient);
    if (!hover || hover.key !== key || hover.min !== m) setHover({ key, min: m });
  };
  const trackDrop = async (e: React.DragEvent<HTMLDivElement>, day: number, orient: Orient, branchId?: string) => {
    const key = e.dataTransfer.getData("application/x-ss-lib");
    if (!key) return;
    e.preventDefault();
    const m = minuteAtPointer(e.clientX, e.clientY, e.currentTarget, orient);
    setHover(null);
    const item = key === quietItem.key ? quietItem : libMap.get(key);
    if (!item) return;
    // a dropped song is simply placed: its card opens only when it is clicked afterwards
    await create(item, day, m, branchId);
  };

  // a block: click = open its card, drag = move it in time
  // The two times of a CARRIED block, on the ruler: their numbers change on the snapped minute, their place follows the block exactly (never step to step) — written straight into the DOM
  const paintCarried = (o: Orient, raw: number, snapped: number, len: number) => {
    const startText = formatMinutes(snapped);
    const endText = formatMinutes(Math.min(DAY_MINUTES - 1, snapped + len));
    if (o === "h") {
      const ax = dvEl?.querySelector<HTMLElement>(".ss-haxis");
      const cur = ax?.querySelector<HTMLElement>(".ss-xcur");
      const ps = ax?.querySelector<HTMLElement>(".ss-xpill--s");
      const pe = ax?.querySelector<HTMLElement>(".ss-xpill--e");
      if (!ax || !cur || !ps || !pe) return;
      const { a, b } = zoomSrc.current;
      const rel = (m: number) => Math.min(1.02, Math.max(-0.02, (m - a) / (b - a)));
      cur.hidden = true;
      ps.hidden = false;
      pe.hidden = false;
      ps.style.insetInlineStart = `${rel(raw) * 100}%`;
      pe.style.insetInlineStart = `${rel(raw + len) * 100}%`;
      if (ps.textContent !== startText) ps.textContent = startText;
      if (pe.textContent !== endText) pe.textContent = endText;
      ax.querySelectorAll<HTMLElement>(".ss-htick:not(.is-leaving)").forEach((t) => {
        const tm = Number(t.dataset.m);
        const covered = Math.abs(((tm - raw) / (b - a)) * axisW) < 40 || Math.abs(((tm - raw - len) / (b - a)) * axisW) < 40;
        if (covered !== t.classList.contains("is-covered")) t.classList.toggle("is-covered", covered);
      });
    } else {
      const g = scrollRef.current?.querySelector<HTMLElement>(".ss-gutter");
      const cur = g?.querySelector<HTMLElement>(".ss-xcur");
      const ps = g?.querySelector<HTMLElement>(".ss-xpill--s");
      const pe = g?.querySelector<HTMLElement>(".ss-xpill--e");
      if (!g || !cur || !ps || !pe) return;
      const h = hourRef.current;
      const y = (m: number) => ((Math.min(LAST_H * 60, Math.max(FIRST_H * 60, m)) - FIRST_H * 60) * h) / 60;
      cur.hidden = true;
      ps.hidden = false;
      pe.hidden = false;
      ps.style.top = `${y(raw)}px`;
      pe.style.top = `${y(raw + len)}px`;
      if (ps.textContent !== startText) ps.textContent = startText;
      if (pe.textContent !== endText) pe.textContent = endText;
      g.querySelectorAll<HTMLElement>(".ss-hour:not(.is-leaving)").forEach((t) => {
        const tm = Number(t.dataset.m);
        const covered = Math.abs(((tm - raw) * h) / 60) < 15 || Math.abs(((tm - raw - len) * h) / 60) < 15;
        if (covered !== t.classList.contains("is-covered")) t.classList.toggle("is-covered", covered);
      });
    }
  };

  const onBlockPointerDown = (e: React.PointerEvent<HTMLDivElement>, sc: Scene, orient: Orient) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = e.currentTarget;
    const track = el.parentElement as HTMLElement;
    const startPt = orient === "v" ? e.clientY : e.clientX;
    const perMin = orient === "v" ? HOUR_H / 60 : (track.getBoundingClientRect().width / SPAN) * (isRtl() ? -1 : 1);
    const startMin = startMinutes(sc.schedule);
    const wasOpen = editor?.kind === "edit" && editor.id === sc.schedule.id && editor.day === sc.day;
    // dropping this block ON another music block of the same row swaps the two (see swapBlocks)
    const canSwap = !sc.quiet && !sc.paused && !sc.shadowed;
    const everyScene = [...weekScenes.flat(), ...dayRows.flatMap((r) => r.scenes)];
    // A block with a length of its own (its music's, or an end set on it) KEEPS that length while it is carried (owner 2026-11-15: "it must never shrink"): it floats above its neighbours,
    // and once its middle has passed the middle of a neighbour that neighbour steps aside and an empty slot of exactly its size opens where it will land; let go before that
    // and it settles flush against the neighbour it was pressed to. A block that runs "until the next one" (a station, a quiet block, music of unknown length) moves as before.
    const own0 = explicitEndMinutes(sc.schedule);
    const openEnd = sc.schedule.targetType === "RADIO" || sc.schedule.targetType === "BANK" || sc.schedule.targetType === "SILENCE";
    const fixedLen = !openEnd && (own0 !== null || musicMinutes(sc.schedule) !== null);
    // the length the block has ON SCREEN when it is picked up — a block cut short by the one that follows it (a quiet "Closing" after it, say) is carried exactly that long: the moment it is lifted it
    // must not grow back to its full length (owner 2026-11-16: "it just widens from the side and doesn't move")
    const L = Math.max(1, Math.min(sc.end, END_MAX) - sc.start);
    const startY = e.clientY;
    // The carried block follows the pointer EXACTLY: its layout stays where it was picked up and it is moved by a `translate` written straight into the DOM — no re-render per mouse move, so
    // nothing stutters however fine the minutes are (owner 2026-11-16: "it is not smooth enough, it feels unnatural"). The snapped minute it will land on is shown in the two yellow numbers and,
    // when a neighbour steps aside, by that neighbour and the dashed slot (those do re-render, but only when they change).
    let carried: HTMLElement = el;
    const live = () => (carried.isConnected ? carried : (carried = document.querySelector<HTMLElement>(".ss-block.is-dragging:not(.is-ghost)") ?? carried));
    el.style.translate = "";
    let drawn = "";
    let rawNow = startMin; // where the pointer holds the block, unsnapped
    let dyNow = 0;
    const rowOf = (x: Schedule) => (x.branchId ?? "default").trim() || "default";
    const neighbours = fixedLen
      ? everyScene.filter((x) => x.day === sc.day && baseId(x.schedule.id) !== baseId(sc.schedule.id) && !x.paused && !x.shadowed && !x.quiet && rowOf(x.schedule) === rowOf(sc.schedule) && (x.endSet || musicMinutes(x.schedule) !== null))
      : [];
    let swapTarget: Scene | null = null;
    let swapPlace: { a: number; b: number } | undefined; // where the two land if the block is let go now
    let moved = false;
    let releaseCursor: (() => void) | null = null;
    let last = startMin;
    let overDay = sc.day; // the week's day under the pointer: drop on another day's column / row and the block moves to that day
    const inWeek = view === "week";
    const move = (ev: PointerEvent) => {
      const d = (orient === "v" ? ev.clientY : ev.clientX) - startPt;
      if (!moved && Math.abs(d) < 5) return;
      if (!moved) {
        setHover(null);
        releaseCursor = holdCursor("grabbing");
      }
      moved = true;
      // a block never slides off the edge of the hours shown, and one that has an end keeps its LENGTH there: it stops at the edge instead of being clipped or squeezed shorter
      // by dragging on (and never past the end of the day) — only the strips change the length
      const keep = L;
      const lo = Math.min(FIRST_H * 60, startMin);
      const hi = Math.max(startMin, Math.min(LAST_H * 60, END_MAX) - keep);
      const rawStart = Math.min(Math.max(startMin + d / perMin, lo), hi);
      rawNow = rawStart;
      last = Math.min(Math.max(snapMinutes(startMin + d / perMin, dragStep), lo), hi);
      if (inWeek) {
        const dayEl = document.elementsFromPoint(ev.clientX, ev.clientY).find((n): n is HTMLElement => n instanceof HTMLElement && n.dataset.day !== undefined && (n.classList.contains("ss-col") || n.classList.contains("ss-hrow")));
        if (dayEl) overDay = Number(dayEl.dataset.day);
      }
      let pv: { id: string; start: number; end: number } | undefined;
      let slot: { start: number; len: number; row: string } | undefined;
      swapTarget = null;
      swapPlace = undefined;
      if (canSwap && fixedLen && overDay === sc.day) {
        const cd = last + L / 2;
        for (const o of neighbours) {
          if (!(last < o.end && last + L > o.start)) continue;
          // passed the middle of it, coming from the side it was on — or, when the carried block is the longer one, as soon as it covers the neighbour whole (it does not have to pass the middle of what it already covers)
          const covers = last <= o.start && last + L >= o.end;
          if (covers || (startMin < o.start ? cd >= (o.start + o.end) / 2 : cd <= (o.start + o.end) / 2)) {
            swapTarget = o;
            break;
          }
        }
        if (swapTarget) {
          const o = swapTarget;
          // two songs with a GAP between them and room around: the carried block lands exactly where it is held and the neighbour steps aside, flush against it (it follows while the block
          // is over its old place); songs that touch, or another block in the way: the two trade places, as before (owner: that swap is right)
          const others = neighbours.filter((x) => baseId(x.schedule.id) !== baseId(o.schedule.id));
          const gap0 = startMin < o.start ? o.start - (startMin + L) : startMin - o.end;
          const aside = gap0 > 0 ? stepAside(last, L, { start: o.start, end: o.end }, startMin > o.start, others, { min: Math.min(FIRST_H * 60, startMin), max: END_MAX }) : null;
          const to = aside ?? swapStarts({ start: startMin, end: startMin + L }, { start: o.start, end: o.end });
          swapPlace = to;
          const lb = o.end - o.start;
          pv = { id: baseId(o.schedule.id), start: to.b, end: to.b + lb };
          slot = { start: to.a, len: L, row: rowOf(sc.schedule) };
        }
      }
      // the block is lifted: it follows the pointer a little up or down too (only a horizontal block floats; the week's column keeps up / down for the hours)
      const dy = orient === "h" && overDay === sc.day ? Math.max(-LIFT_MAX, Math.min(LIFT_MAX, ev.clientY - startY)) : 0;
      dyNow = dy;
      // React hears of it only when something it draws changes (the neighbour that steps aside, the day under the pointer): over its own day the block's layout does not move at all. Over another day the
      // see-through copy needs the snapped minute, so then it does (at once, flushSync, together with the shift).
      const layoutStart = overDay !== sc.day ? last : startMin;
      const key = `${overDay}|${pv?.id ?? ""}:${pv?.start ?? ""}|${slot?.start ?? ""}${overDay !== sc.day ? `|${last}` : ""}`;
      if (!carryLive.current) {
        carryLive.current = true;
        dvEl?.querySelectorAll<HTMLElement>(".ss-xcur").forEach((n) => { n.hidden = true; });
      }
      if (key !== drawn) {
        drawn = key;
        flushSync(() => setDrag({ id: baseId(sc.schedule.id), day: sc.day, start: layoutStart, end: minutesToTimeLocal(Math.min(END_MAX, layoutStart + L)), ...(inWeek && overDay !== sc.day ? { overDay } : {}), ...(pv ? { preview: pv, slot } : {}) }));
      }
      const off = (rawStart - layoutStart) * perMin; // the pointer's way from the block's layout place, in px (sign = reading direction)
      live().style.translate = orient === "h" ? `${off}px ${dy}px` : `0px ${off}px`;
      paintCarried(orient, rawStart, last, L);
      if (canSwap && !fixedLen && overDay === sc.day) {
        const over = document
          .elementsFromPoint(ev.clientX, ev.clientY)
          .find((n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains("ss-block") && n.parentElement === track && n.dataset.bid !== baseId(sc.schedule.id) && !/\bis-(quiet|paused|shadowed)\b/.test(n.className));
        swapTarget = over ? everyScene.find((x) => baseId(x.schedule.id) === over.dataset.bid && x.day === sc.day) ?? null : null;
        const key = swapTarget ? { bid: baseId(swapTarget.schedule.id), day: swapTarget.day } : null;
        setSwapWith((prev) => (prev?.bid === key?.bid && prev?.day === key?.day ? prev : key));
      }
    };
    let cancelled = false;
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      // The block settles into its place: it is left where the pointer let go of it (the translate is made relative to its NEW place) and then springs there (the CSS transition on `translate`).
      // Two frames later, so the new place and the removed "carried" look have been drawn first.
      const settle = (landedStart: number | null) => {
        const c = live();
        if (landedStart === null) {
          c.style.translate = "";
        } else {
          const px = (rawNow - landedStart) * perMin;
          c.style.translate = orient === "h" ? `${px}px ${dyNow}px` : `0px ${px}px`;
          void c.getBoundingClientRect(); // computed NOW (the carried look has no transition): otherwise the spring would start from the old offset, measured from the old place
          requestAnimationFrame(() => requestAnimationFrame(() => { c.style.translate = ""; }));
        }
      };
      const endReadout = () => {
        carryLive.current = false;
        dvEl?.querySelectorAll<HTMLElement>(".ss-xcur, .ss-xpill").forEach((n) => { n.hidden = true; });
        scrollRef.current?.querySelectorAll<HTMLElement>(".ss-gutter .ss-xcur, .ss-gutter .ss-xpill").forEach((n) => { n.hidden = true; });
        dvEl?.querySelectorAll<HTMLElement>(".ss-htick.is-covered").forEach((t) => t.classList.remove("is-covered"));
        scrollRef.current?.querySelectorAll<HTMLElement>(".ss-gutter .ss-hour.is-covered").forEach((t) => t.classList.remove("is-covered"));
      };
      if (cancelled) {
        // the system took the pointer away (a touch scroll, a gesture): the block goes back, nothing is saved
        if (moved) settle(startMin);
        endReadout();
        releaseCursor?.();
        setDrag(null);
        setSwapWith(null);
        return;
      }
      if (!moved) {
        // a second click on the block whose card is already open closes it
        if (wasOpen) {
          setEditor(null);
          return;
        }
        const r = el.getBoundingClientRect();
        setEditor({ kind: "edit", id: sc.schedule.id, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, day: sc.day });
        return;
      }
      endReadout();
      releaseCursor?.();
      setDrag(null);
      setSwapWith(null);
      markPopupClose(); // (same: the click that ends a drag opens nothing)
      if (swapTarget && overDay === sc.day) {
        settle(swapPlace?.a ?? last);
        void swapBlocks(sc, swapTarget, swapPlace); // past the middle of a neighbour: it has already stepped aside — the block lands where it is held (or, with others in the way, the two trade places)
        return;
      }
      // let go while pressed against a neighbour but not past its middle: the block settles flush against it, on the side it came from
      let landed = last;
      if (fixedLen && overDay === sc.day) {
        for (const o of neighbours) {
          if (landed < o.end && landed + L > o.start) landed = startMin < o.start ? o.start - L : o.end;
        }
        landed = Math.min(Math.max(landed, 0), END_MAX - L);
      }
      // the block keeps what was drawn: when its stored end is not that length (no end of its own, or cut short on screen by the next block) the end is written, so it does not change size when it lands
      settle(overDay !== sc.day ? null : landed);
      const endEdit = own0 !== null && own0 - startMin === L ? undefined : landed + L >= END_MAX ? null : landed + L;
      if (landed !== startMin || overDay !== sc.day) void editOccurrence(items.find((x) => x.id === baseId(sc.schedule.id)) ?? sc.schedule, sc.day, { start: landed, ...(endEdit !== undefined ? { end: endEdit } : {}), ...(overDay !== sc.day ? { toDay: overDay } : {}) });
    };
    const cancel = () => {
      cancelled = true;
      up();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // the empty slot a carried block will land in once a neighbour has stepped aside for it: a dashed outline exactly its size
  const slotFor = (day: number, orient: Orient, rowId?: string) => {
    let box: { start: number; len: number } | null = null;
    let waiting = false;
    if (pending && pending.day === day && (rowId === undefined || pending.branchId === undefined || pending.branchId === rowId)) {
      box = { start: pending.min, len: PROVISIONAL_MIN };
      waiting = true;
    } else if (drag?.slot && drag.day === day && drag.overDay === undefined && (rowId === undefined || drag.slot.row === rowId)) {
      box = drag.slot;
    }
    if (!box) return null;
    const { start, len } = box;
    const end = start + len;
    const style: CSSProperties =
      orient === "v"
        ? { top: topOf(start), height: Math.max(26, ((Math.min(end, LAST_H * 60) - Math.max(start, FIRST_H * 60)) * HOUR_H) / 60 - 3) }
        : { insetInlineStart: `${pct(start)}%`, width: `calc(${Math.max(1.2, pct(end) - pct(start))}% - 4px)` };
    return <div className={`ss-slot ss-slot--${orient}${waiting ? " is-pending" : ""}`} style={style} aria-hidden />;
  };
  // while a block is carried over ANOTHER day of the week, a see-through copy shows where it will land
  const ghostFor = (d: number, orient: Orient) => {
    if (!drag || drag.overDay !== d || drag.day === d) return null;
    const from = (weekScenes[drag.day] ?? []).find((x) => baseId(x.schedule.id) === drag.id);
    if (!from) return null;
    const len = from.end - from.start;
    return renderBlock({ ...from, day: d, start: drag.start, end: drag.start + len, shadowed: false }, orient, true);
  };

  // a jingle is a moment, not a stretch: it plays ON TOP of the music, so it is drawn as a small bell at its time (never as a block)
  const jinglePins = (day: number, ymd: string, orient: Orient) => {
    if (!showJingles) return null;
    return jinglesOnDay(jingles, new Date(`${ymd}T12:00:00`))
      .filter((p) => (orient === "v" ? p.min >= FIRST_H * 60 && p.min <= LAST_H * 60 : p.min >= winA && p.min <= winB))
      .map((p) => (
        <button
          key={`${p.item.id}-${orient}`}
          type="button"
          className={`ss-jpin ss-jpin--${orient}${jmenu?.item.id === p.item.id && jmenu.day === day ? " is-open" : ""}`}
          style={orient === "v" ? { top: topOf(p.min) } : { insetInlineStart: `${pct(p.min)}%` }}
          title={`${formatMinutes(p.min)} · ${p.item.label}`}
          aria-label={`${tr("Jingle")}: ${p.item.label} ${formatMinutes(p.min)}`}
          aria-haspopup="menu"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setJmenu({ item: p.item, day, min: p.min, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
          }}
        >
          <BellIcon />
        </button>
      ));
  };

  // TRIMMING a block (owner 2026-11-12): a strip on each edge — the far edge cuts from the end, the near edge from the start. Both snap to 5 minutes. A block can be cut shorter
  // and stretched back, but never beyond the music's own length (when it is known; when it is not, the strips only cut). "Until the next block" is the card's choice.
  const maxLenOf = (s: Schedule): number => fitMinutes(libFor(s)?.dur);
  const onTrimPointerDown = (e: React.PointerEvent<HTMLElement>, sc: Scene, orient: Orient, side: "start" | "end") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setHover(null);
    const releaseCursor = holdCursor(orient === "v" ? "ns-resize" : "ew-resize");
    const track = (e.currentTarget.closest(".ss-block") as HTMLElement).parentElement as HTMLElement;
    const startPt = orient === "v" ? e.clientY : e.clientX;
    const perMin = orient === "v" ? HOUR_H / 60 : (track.getBoundingClientRect().width / SPAN) * (isRtl() ? -1 : 1);
    const begin = startMinutes(sc.schedule);
    const maxLen = maxLenOf(sc.schedule);
    const live = sc.schedule.targetType === "RADIO" || sc.schedule.targetType === "BANK" || sc.schedule.targetType === "SILENCE"; // a live station (24/7) or a music bank has no length of its own: its strips stretch to any length the person wants
    const base = items.find((x) => x.id === baseId(sc.schedule.id)) ?? sc.schedule;
    const ownEnd = explicitEndMinutes(base);
    const naturalEnd = Math.min(sc.end, DAY_MINUTES - 1);
    // a block that runs "until the next block" holds its music only for the music's own length: that is where it really ends (a trim measures from there, never from the far end of the day)
    const musicEnd = Number.isFinite(maxLen) ? Math.min(naturalEnd, begin + maxLen) : naturalEnd;
    const from = side === "end" ? ownEnd ?? musicEnd : begin;
    let last: number | null = side === "end" ? ownEnd : begin;
    const minLen = dragStep; // the shortest a block can be cut to: the step the hours snap to (5 minutes, one minute once the hours are zoomed in far enough to aim at a minute)
    const move = (ev: PointerEvent) => {
      const d = (orient === "v" ? ev.clientY : ev.clientX) - startPt;
      const m = snapMinutes(from + d / perMin, dragStep);
      if (side === "end") {
        // a strip never stretches a block past the last hour shown (Active hours = the business's own hours)
        const capEnd = Math.min(END_MAX, LAST_H * 60);
        if (Number.isFinite(maxLen)) last = Math.min(Math.max(begin + minLen, m), begin + maxLen, capEnd);
        else if (live) last = LAST_H * 60 >= END_MAX ? (m >= END_MAX ? null : Math.max(begin + minLen, m)) : Math.min(Math.max(begin + minLen, m), capEnd);
        else {
          // the music's length is not known: the strip only CUTS — it never takes the block past where it ends now (the card's "Ends at" sets any time exactly)
          const cut = Math.min(m, from);
          last = ownEnd === null && cut >= from ? null : Math.max(begin + minLen, cut);
        }
        setDrag({ id: baseId(sc.schedule.id), day: sc.day, start: begin, end: last === null ? "23:59:00" : minutesToTimeLocal(last) });
      } else {
        const endNow = ownEnd ?? musicEnd;
        const lo = Number.isFinite(maxLen) ? Math.max(FIRST_H * 60, endNow - maxLen) : live ? FIRST_H * 60 : begin; // unknown length: only cut, never earlier than it starts now (a live station stretches freely)
        last = Math.min(Math.max(lo, m), endNow - minLen);
        setDrag({ id: baseId(sc.schedule.id), day: sc.day, start: last });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      releaseCursor();
      setDrag(null);
      markPopupClose(); // the click a drag ends with can land on the empty track under the pointer — it must not open "Add music" there
      // an end dragged back onto where the block already ends (or capped there by the music's length) changes nothing
      if (side === "end") {
        if (ownEnd === null && last === naturalEnd) return;
        void editOccurrence(base, sc.day, { end: last });
      }
      else if (last !== null && last !== begin) void editOccurrence(base, sc.day, { start: last, end: ownEnd ?? (musicEnd < naturalEnd ? musicEnd : null) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const renderBlock = (sc: Scene, orient: Orient, ghost = false) => {
    if (sc.end <= FIRST_H * 60) return null;
    if (orient === "v" && sc.start >= LAST_H * 60) return null;
    if (orient === "h" && (sc.end <= winA || sc.start >= winB)) return null; // zoomed in: this block is out of sight
    const li = libFor(sc.schedule);
    const end = Math.min(sc.end, orient === "v" ? LAST_H * 60 : DAY_MINUTES); // a block never runs out of the body of the hours (the week's columns end at the last hour shown)
    const vHeight = Math.max(26, ((end - Math.max(sc.start, FIRST_H * 60)) * HOUR_H) / 60 - 3);
    const style: CSSProperties =
      orient === "v"
        ? { top: topOf(sc.start), height: vHeight }
        : { insetInlineStart: `${pct(sc.start)}%`, width: `calc(${Math.max(1.2, pct(end) - pct(sc.start))}% - 4px)` };
    const cls = `ss-block ss-block--${orient}${drag?.preview && drag.preview.id === baseId(sc.schedule.id) ? " is-making-room" : ""}${ghost ? " is-ghost" : ""}${!ghost && drag && drag.overDay !== undefined && drag.overDay !== drag.day && drag.id === baseId(sc.schedule.id) && drag.day === sc.day ? " is-leaving" : ""}${sc.quiet ? " is-quiet" : ""}${sc.endSet ? " has-end" : ""}${sc.paused ? " is-paused" : ""}${sc.shadowed ? " is-shadowed" : ""}${drag && drag.id === baseId(sc.schedule.id) && drag.day === sc.day ? " is-dragging" : ""}${editing?.id === sc.schedule.id && editor?.day === sc.day ? " is-selected" : ""}${menu?.id === sc.schedule.id && menu.day === sc.day ? " is-menu" : ""}${clip?.id === sc.schedule.id && (clipDay === undefined || clipDay === sc.day) ? " is-copied" : ""}`;
    const tall = orient === "v" && vHeight > 60;
    const plain = sc.paused || sc.quiet;
    const tone = plain ? null : toneOf(sc.schedule);
    const blockStyle: CSSProperties = tone ? { ...style, ["--c1" as string]: tone.c1, ["--c2" as string]: tone.c2 } : style;
    // what shows: the picture (a small placeholder when the music has none and only the picture was asked for), the name, the hours, the length
    // "fog": the picture fills the whole block and melts into black / white; the details sit in the solid part below. Music without a picture (or "text only") gets its colour instead.
    const fog = display.style === "fog" && !plain;
    const artSrc = li?.cover ? artUrl(li.cover) : null;
    const artEl = fog ? (
      artSrc && display.content !== "text" && !badArt[artSrc] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="ss-b-art" src={artSrc} alt="" draggable={false} loading="lazy" onLoad={(e) => { if (e.currentTarget.naturalWidth < 200) markBadArt(artSrc); }} onError={() => markBadArt(artSrc)} />
      ) : (
        <span className="ss-b-art ss-b-art--tone" aria-hidden />
      )
    ) : null;
    const coverEl =
      fog || plain || display.content === "text" ? null : li?.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="ss-b-cover" src={li.cover} alt="" draggable={false} loading="lazy" />
      ) : display.content === "image" ? (
        <span className="ss-b-cover ss-b-cover--ph" aria-hidden>{sc.schedule.targetType === "RADIO" ? "◉" : "♪"}</span>
      ) : null;
    const lines: string[] = [];
    const range = !sc.paused && !sc.shadowed && (orient === "h" || tall) ? ` – ${formatMinutes(Math.min(sc.end, DAY_MINUTES - 1))}` : "";
    if (display.times || plain) lines.push(`${formatMinutes(sc.start)}${range}`);
    if (display.length && !plain) lines.push(spanText(Math.min(sc.end, DAY_MINUTES) - sc.start));
    if (typeof sc.schedule.volume === "number" && !plain) lines.push(tr("Volume {n}%", { n: sc.schedule.volume })); // the block carries its own volume (owner 2026-11-17)
    return (
      <div
        key={`${ghost ? "ghost-" : ""}${baseId(sc.schedule.id)}-${orient}-${sc.day}`}
        className={`${cls}${swapWith && swapWith.bid === baseId(sc.schedule.id) && swapWith.day === sc.day ? " is-swap-target" : ""}${swapWith && drag && drag.id === baseId(sc.schedule.id) && drag.day === sc.day ? " is-swapping" : ""}`}
        data-bid={baseId(sc.schedule.id)}
        data-day={sc.day}
        data-start={sc.start}
        data-end={Math.min(sc.end, DAY_MINUTES)}
        aria-hidden={ghost || undefined}
        data-c={colourOf(sc.schedule)}
        style={blockStyle}
        aria-label={`${nameOf(sc.schedule)} ${formatMinutes(sc.start)} – ${formatMinutes(Math.min(sc.end, DAY_MINUTES - 1))} · ${spanText(Math.min(sc.end, DAY_MINUTES) - sc.start)}`}
        onPointerDown={(e) => onBlockPointerDown(e, sc, orient)}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ id: sc.schedule.id, rect: { x: e.clientX, y: e.clientY, w: 0, h: 0 }, day: sc.day });
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setEditor({ kind: "edit", id: sc.schedule.id, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, day: sc.day });
          }
        }}
        title={sc.shadowed ? tr("Won't play — another block starts at the same time") : sc.paused ? tr("Paused") : undefined}
      >
        {artEl}
        {coverEl}
        <span className="ss-b-text">
          <span className="ss-b-name">{nameOf(sc.schedule)}</span>
          {lines.map((ln, i) => <span key={i} className="ss-b-time">{ln}</span>)}
        </span>
        {!sc.shadowed && !sc.paused && !ghost ? (
          <>
            <span className="ss-b-resize ss-b-resize--start" onPointerDown={(e) => onTrimPointerDown(e, sc, orient, "start")} title={tr("Drag the edge to cut from the start")} aria-hidden />
            <span className="ss-b-resize" onPointerDown={(e) => onTrimPointerDown(e, sc, orient, "end")} title={tr("Drag the edge to cut from the end")} aria-hidden />
          </>
        ) : null}
      </div>
    );
  };

  const onDayHeadClick = (d: number) => {
    const ymd = weekDates[d]!;
    if (clip) void pasteOn(ymd);
    else {
      setFocus(new Date(`${ymd}T12:00:00`));
      chooseView("day");
    }
  };

  return (
    <div className="ss" data-schedule={scheduleOn ? "on" : "off"} data-carry={drag ? "1" : undefined} data-panel={panelOpen ? "open" : "closed"} data-pos={display.pos} data-content={display.content} data-style={display.style}>
      <div className="ss-main">
        <header className="ss-top">
          <div className="ss-titles">
            <h1 className="ss-title">{T.schedules ?? tr("Schedule")}</h1>
          </div>
          <div className="ss-top-actions">
            <button type="button" role="switch" aria-checked={scheduleOn} aria-disabled={!scheduleSwitchable || undefined} className="ss-switch" data-on={scheduleOn} data-inert={!scheduleSwitchable || undefined} onClick={() => void flipSchedule()}>
              <span className="ss-switch-label">{scheduleOn ? tr("Schedule: On") : tr("Schedule: Off")}{branches.length > 1 ? <bdi className="ss-switch-branch"> · {branchName(switchBranch)}</bdi> : null}</span>
              <span className="ss-switch-track"><span className="ss-switch-knob" /></span>
            </button>
            <button type="button" className="ss-btn ss-btn--ghost" onClick={() => setHoursOpen(true)}>{tr("Business hours")}</button>
            {/* the circle at the very end of the header: a plus on a white disc (a black disc on the white display); standing on it names it; pressing it opens the music list (the list with the
                search, at the side) and the plus turns in place into an X — pressing again closes it (owner 2026-11-16; this one button replaced "+ Add music" and the arrow) */}
            <div className="ss-add" aria-hidden={panelOpen || undefined}>
              <button type="button" className="ss-add-btn" onClick={togglePanel} aria-expanded={panelOpen} tabIndex={panelOpen ? -1 : 0} aria-label={tr("Add music")}>
                <span className="ss-add-label" aria-hidden>{tr("Add music")}</span>
                <span className="ss-add-ico" aria-hidden>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </span>
              </button>
            </div>
          </div>
        </header>

        <div className="ss-toolbar">
          <div className="ss-nav">
            {/* the date, its two arrows and the calendar are ONE piece: the calendar is the same pane grown downward (owner 2026-11-16) */}
            <DateNav
              label={rangeLabel}
              prevLabel={view === "day" ? tr("Previous day") : tr("Previous week")}
              nextLabel={view === "day" ? tr("Next day") : tr("Next week")}
              onStep={(n) => shiftFocus(view === "day" ? n : n * 7)}
              focusKey={focusKey}
              todayKey={todayKey}
              loc={loc}
              onPick={(ymd) => setFocus(new Date(`${ymd}T12:00:00`))}
            />
            {/* "Today" is there only when the day (week) on screen is not today */}
            {focus !== null && !isTodayInView ? <button type="button" className="ss-pill ss-today" onClick={() => setFocus(null)}>{tr("Today")}</button> : null}
          </div>
          <div className="ss-toolbar-end">
            {branchIds.length > 1 ? (
              <select className="ss-select ss-select--sm" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label={tr("Branch")}>
                <option value="all">{tr("All branches")}</option>
                {branchIds.map((id) => <option key={id} value={id}>{branchName(id)}</option>)}
              </select>
            ) : null}
            {clip ? (
              <span className="ss-clip" role="status">
                <span className="ss-clip-text">{tr("Copied")}: <strong><bdi>{nameOf(clip)}</bdi></strong> <bdi>{formatMinutes(startMinutes(clip))}</bdi></span>
                {view === "day" ? <button type="button" className="ss-pill ss-pill--on" onClick={() => void pasteOn(focusKey)}>{tr("Paste here")}</button> : <span className="ss-clip-hint">{tr("click a day's title to paste")}</span>}
                <button type="button" className="ss-clip-x" onClick={() => setClip(null)} aria-label={tr("Clear")}>×</button>
              </span>
            ) : null}
            <button type="button" className={`ss-iconbtn ss-iconbtn--sm ss-dtoggle${dmenu ? " is-open" : ""}`} aria-haspopup="dialog" aria-expanded={!!dmenu} title={tr("Display")} aria-label={tr("Display")} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setDmenu(dmenu ? null : { x: r.left, y: r.top, w: r.width, h: r.height }); }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></svg>
            </button>
            {jingles.length > 0 ? (
              <button type="button" className={`ss-iconbtn ss-iconbtn--sm ss-jtoggle${showJingles ? " is-on" : ""}`} aria-pressed={showJingles} onClick={toggleJingles} title={showJingles ? tr("Hide jingles") : tr("Show jingles")} aria-label={showJingles ? tr("Hide jingles") : tr("Show jingles")}>
                <BellIcon />
              </button>
            ) : null}
            <div className="ss-seg ss-seg--view" role="tablist" aria-label={tr("View")}>
              <button type="button" role="tab" aria-selected={view === "day"} className={view === "day" ? "is-on" : ""} onClick={() => chooseView("day")}>{tr("Day")}</button>
              <button type="button" role="tab" aria-selected={view === "week"} className={view === "week" ? "is-on" : ""} onClick={() => chooseView("week")}>{tr("Week")}</button>
            </div>
          </div>
        </div>

        {view === "week" && display.weekLayout === "rows" ? (
          <div className="ss-cal ss-cal--day ss-cal--rows" style={{ opacity: now ? 1 : 0 }}>
            <div className={`ss-dayview${zooming ? ` is-zoom-${zooming}` : ""}`} ref={setDvEl}>
              <div className="ss-hrow ss-hrow--axis has-label" aria-hidden>
                <span className="ss-hlabel" />
                <HoursRuler a={winA} b={winB} width={axisW} zooming={zooming} zoomed={!!zoomWin} axisRef={axisRef} onPanStart={onRulerPointerDown} onReset={resetZoom} />
              </div>
              <div className="ss-hrows ss-hrows--week">
                {WEEK_DAYS.map((d) => (
                  <div key={d} className={`ss-hrow has-label${drag?.overDay === d ? " is-drop-day" : ""}`} data-day={d}>
                    <button type="button" className={`ss-wlabel${weekDates[d] === todayKey ? " is-today" : ""}${clip ? " can-paste" : ""}`} onClick={() => onDayHeadClick(d)} title={clip ? tr("Paste here") : tr("Open this day")}>
                      <span className="ss-dayname">{dayName(d)}</span>
                      <span className="ss-daydate">{Number(weekDates[d]!.slice(8))}</span>
                    </button>
                    <div
                      className="ss-htrack"
                      onPointerMove={(e) => trackMove(e, `w${d}`, weekDates[d]!, "h")}
                      onPointerLeave={() => { setHover(null); setHoverDate(null); }}
                      onClick={(e) => trackClick(e, d, "h")}
                      onDragOver={(e) => trackDragOver(e, `w${d}`, "h")}
                      onDragLeave={() => setHover(null)}
                      onDrop={(e) => void trackDrop(e, d, "h")}
                    >
                      {(weekScenes[d] ?? []).map((sc) => renderBlock(sc, "h"))}
                      {ghostFor(d, "h")}
                      {slotFor(d, "h")}
                      {branchFilter === "all" || branchFilter === stationBranch ? jinglePins(d, weekDates[d]!, "h") : null}
                      {hover?.key === `w${d}` ? (
                        <div className="ss-hhover" style={{ insetInlineStart: `${pct(hover.min)}%` }} aria-hidden><span>{formatMinutes(hover.min)}</span></div>
                      ) : null}
                      {weekDates[d] === todayKey && nowMin >= winA && nowMin <= winB ? (
                        <div className="ss-hnow" style={{ insetInlineStart: `${pct(nowMin)}%` }} aria-hidden><span>{tr("Now")}</span></div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {items.length === 0 ? <p className="ss-empty">{tr("Drag music onto a day, or click any time to add.")}</p> : null}
            </div>
          </div>
        ) : view === "week" ? (
          <div className="ss-cal" style={{ opacity: now ? 1 : 0 }}>
            <div className="ss-head">
              <div className="ss-gutter-h" />
              {WEEK_DAYS.map((d) => (
                <button key={d} type="button" className={`ss-dayhead${weekDates[d] === todayKey ? " is-today" : ""}${clip ? " can-paste" : ""}`} onClick={() => onDayHeadClick(d)} title={clip ? tr("Paste here") : tr("Open this day")}>
                  <span className="ss-dayname">{dayName(d)}</span>
                  <span className="ss-daydate">{Number(weekDates[d]!.slice(8))}</span>
                </button>
              ))}
            </div>
            <div className="ss-scroll" ref={scrollNode}>
              <div className="ss-body" style={{ height: (LAST_H - FIRST_H) * HOUR_H }}>
                <div className={`ss-gutter${zooming ? ` is-${zooming}` : ""}`} title={tr("Zoom: drag along the hours, or Ctrl + scroll")} onPointerDown={onGutterPointerDown} onDoubleClick={resetHours}>
                  <GutterHours minutes={hourLabels} first={FIRST_H * 60} hourH={HOUR_H} />
                  <div className="ss-xpill ss-xpill--v ss-xpill--s" hidden aria-hidden />
                  <div className="ss-xpill ss-xpill--v ss-xpill--e" hidden aria-hidden />
                  <div className="ss-xcur ss-xcur--v" hidden aria-hidden />
                </div>
                {WEEK_DAYS.map((d) => (
                  <div
                    key={d}
                    className={`ss-col${weekDates[d] === todayKey ? " is-today" : ""}${drag?.overDay === d ? " is-drop-day" : ""}`}
                    data-day={d}
                    onPointerMove={(e) => trackMove(e, `d${d}`, weekDates[d]!, "v")}
                    onPointerLeave={() => { setHover(null); setHoverDate(null); }}
                    onClick={(e) => trackClick(e, d, "v")}
                    onDragOver={(e) => trackDragOver(e, `d${d}`, "v")}
                    onDragLeave={() => setHover(null)}
                    onDrop={(e) => void trackDrop(e, d, "v")}
                  >
                    {(weekScenes[d] ?? []).map((sc) => renderBlock(sc, "v"))}
                    {ghostFor(d, "v")}
                    {slotFor(d, "v")}
                    {branchFilter === "all" || branchFilter === stationBranch ? jinglePins(d, weekDates[d]!, "v") : null}
                    {hover?.key === `d${d}` ? (
                      <div className="ss-hover" style={{ top: topOf(hover.min) }} aria-hidden><span>{formatMinutes(hover.min)}</span></div>
                    ) : null}
                    {weekDates[d] === todayKey && nowMin >= FIRST_H * 60 && nowMin <= LAST_H * 60 ? (
                      <div className="ss-nowline" style={{ top: topOf(nowMin) }} aria-hidden><span>{formatMinutes(nowMin)}</span></div>
                    ) : null}
                  </div>
                ))}
                {items.length === 0 ? <p className="ss-empty">{tr("Drag music onto a day, or click any time to add.")}</p> : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="ss-cal ss-cal--day" style={{ opacity: now ? 1 : 0 }}>
            <div className={`ss-dayview${zooming ? ` is-zoom-${zooming}` : ""}`} style={{ ["--rows" as string]: dayRows.length }} ref={setDvEl}>
              <div className={`ss-hrow ss-hrow--axis${dayRows.length > 1 ? " has-label" : ""}`} aria-hidden>
                {dayRows.length > 1 ? <span className="ss-hlabel" /> : null}
                <HoursRuler a={winA} b={winB} width={axisW} zooming={zooming} zoomed={!!zoomWin} axisRef={axisRef} onPanStart={onRulerPointerDown} onReset={resetZoom} />
              </div>
              <div className="ss-hrows">
                {dayRows.map((row) => (
                  <div key={row.id} className={`ss-hrow${dayRows.length > 1 ? " has-label" : ""}`}>
                    {dayRows.length > 1 ? <span className="ss-hlabel"><strong>{row.name}</strong></span> : null}
                    <div
                      className="ss-htrack"
                      onPointerMove={(e) => trackMove(e, `r${row.id}`, focusKey, "h")}
                      onPointerLeave={() => { setHover(null); setHoverDate(null); }}
                      onClick={(e) => trackClick(e, focusDay, "h", dayRows.length > 1 ? row.id : undefined)}
                      onDragOver={(e) => trackDragOver(e, `r${row.id}`, "h")}
                      onDragLeave={() => setHover(null)}
                      onDrop={(e) => void trackDrop(e, focusDay, "h", dayRows.length > 1 ? row.id : undefined)}
                    >
                      {row.scenes.map((sc) => renderBlock(sc, "h"))}
                      {slotFor(focusDay, "h", row.id)}
                      {row.id === stationBranch || dayRows.length === 1 ? jinglePins(focusDay, focusKey, "h") : null}
                      {hover?.key === `r${row.id}` ? (
                        <div className="ss-hhover" style={{ insetInlineStart: `${pct(hover.min)}%` }} aria-hidden><span>{formatMinutes(hover.min)}</span></div>
                      ) : null}
                      {isTodayInView && nowMin >= winA && nowMin <= winB ? (
                        <div className="ss-hnow" style={{ insetInlineStart: `${pct(nowMin)}%` }} aria-hidden><span>{tr("Now")}</span></div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {dayRows.length === 1 && dayRows[0]!.scenes.some((sc) => !sc.shadowed) ? (
                <ul className="ss-agenda" aria-label={tr("The day, hour by hour")}>
                  {dayRows[0]!.scenes.filter((sc) => !sc.shadowed).map((sc) => {
                    const li = libFor(sc.schedule);
                    const live = isTodayInView && !sc.paused && sc.start <= nowMin && nowMin < sc.end;
                    return (
                      <li key={sc.schedule.id} className="ss-ag-li">
                        <button
                          type="button"
                          className={`ss-ag${live ? " is-live" : ""}${sc.paused ? " is-paused" : ""}${sc.quiet ? " is-quiet" : ""}`}
                          data-c={colourOf(sc.schedule)}
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setEditor({ kind: "edit", id: sc.schedule.id, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, day: sc.day });
                          }}
                        >
                          <span className="ss-ag-time" dir="ltr">{formatMinutes(sc.start)} – {formatMinutes(Math.min(sc.end, DAY_MINUTES - 1))}</span>
                          {sc.quiet ? <Cover item={quietItem} /> : li ? <Cover item={li} /> : <span className="ss-cover ss-cover--ph" aria-hidden>♪</span>}
                          <span className="ss-ag-name"><bdi>{nameOf(sc.schedule)}</bdi></span>
                          {live ? <span className="ss-ag-live">{tr("Now")}</span> : sc.paused ? <span className="ss-ag-live ss-ag-live--dim">{tr("Paused")}</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {items.length === 0 ? <p className="ss-empty">{tr("Drag music onto a day, or click any time to add.")}</p> : null}
            </div>
          </div>
        )}
      </div>

      <aside className="ss-panel" aria-hidden={!panelOpen} inert={!panelOpen}>
        <LibraryPanel lib={lib} quiet={quietItem} onWarm={(it) => void lookupLength(it)} onClose={togglePanel} onAddNext={(it) => { const m = Math.min(snapMinutes(Math.max(nowMin + 15, FIRST_H * 60 + 60)), Math.max(FIRST_H * 60, LAST_H * 60 - 120)); const day = view === "day" ? focusDay : clock.getDay(); void create(it, day, m).then((c) => c && setEditor({ kind: "edit", id: c.id, rect: { x: window.innerWidth / 2 - 40, y: 150, w: 0, h: 0 }, day })); }} />
      </aside>

      {menu && items.find((x) => x.id === menu.id) ? (
        <BlockMenu
          key={menu.id}
          menu={menu}
          schedule={items.find((x) => x.id === menu.id)!}
          quiet={isSilenceBlock(items.find((x) => x.id === menu.id)!)}
          onClose={() => setMenu(null)}
          onEdit={() => { setEditor({ kind: "edit", id: menu.id, rect: menu.rect, day: menu.day }); setMenu(null); }}
          onPlay={() => { const sc = items.find((x) => x.id === menu.id); setMenu(null); if (sc) void playNow(sc); }}
          onCopy={() => { const sc = items.find((x) => x.id === menu.id); const d = menu.day; setMenu(null); if (sc) copyBlock(sc, d); }}
          multiDay={isMultiDayWeekly(items.find((x) => x.id === menu.id)!)}
          dayLabel={dayName(menu.day, "long")}
          onRemoveDay={() => { const sc = items.find((x) => x.id === menu.id); const d = menu.day; setMenu(null); if (sc) removeFromDay(sc, d); }}
          onNudge={(delta) => { const sc = items.find((x) => x.id === menu.id); const d = menu.day; setMenu(null); if (sc) void editOccurrence(sc, d, { start: Math.min(DAY_MINUTES - 1, Math.max(0, startMinutes(sc) + delta)) }); }}
          colour={colourOf(items.find((x) => x.id === menu.id)!)}
          onColour={(i) => { setBlockColor(menu.id, i); setMenu(null); }}
          onMoreColours={() => { setEditor({ kind: "edit", id: menu.id, rect: menu.rect, day: menu.day }); setMenu(null); }}
          onToggle={() => { const sc = items.find((x) => x.id === menu.id); setMenu(null); if (sc) void update(sc.id, { enabled: !sc.enabled }); }}
          onDelete={() => { const sc = items.find((x) => x.id === menu.id); setMenu(null); if (sc) void deleteBlock(sc); }}
        />
      ) : null}


      {dmenu ? <DisplayMenu rect={dmenu} display={display} onChange={chooseDisplay} onClose={() => setDmenu(null)} /> : null}

      {jmenu ? (
        <JingleMenu
          key={`${jmenu.item.id}-${jmenu.day}`}
          menu={jmenu}
          dayName={dayName}
          dateLabel={dateLabel}
          onClose={() => setJmenu(null)}
          onOpen={() => {
            const id = jmenu.item.id;
            setJmenu(null);
            // the Jingles screen is where jingles are made and scheduled — open it on its Schedule tab, on THIS jingle's own settings (time, days)
            setJinglesOpenTab("schedule");
            setJinglesOpenEdit(id);
            router.push("/jingles");
          }}
        />
      ) : null}

      {editor ? (
        <ScenePopover
          key={editor.kind === "edit" ? editor.id : `new-${editor.day}-${editor.min}`}
          editor={editor}
          schedule={editing}
          maxLen={editing ? maxLenOf(editing) : Infinity}
          lib={[quietItem, ...(editor.kind === "new" && editor.branchId ? lib.filter((l) => l.kind === "bank" || l.branchId === editor.branchId) : lib)]}
          libFor={libFor}
          devices={devices}
          colour={editing ? colourOf(editing) : 0}
          onColour={(i) => editing && setBlockColor(editing.id, i)}
          occurrenceDate={weekDates[editor.day] ?? weekDates[0]!}
          dayName={dayName}
          dateLabel={dateLabel}
          onClose={() => setEditor(null)}
          onPick={async (item) => {
            if (editor.kind === "new") {
              const created = await create(item, editor.day, editor.min, editor.branchId);
              if (created) setEditor({ kind: "edit", id: created.id, rect: editor.rect, day: editor.day });
              else setEditor(null);
            } else if (editing) {
              void update(editing.id, {
                name: item.targetType === "SILENCE" ? "Quiet" : item.name,
                targetType: item.targetType,
                targetId: item.targetId,
                // null (not undefined): JSON drops undefined, and the old song id would stay on the server and win over the new music
                sourceId: (item.targetType === "SOURCE" ? item.targetId : null) as unknown as undefined,
                ...(item.targetType === "SILENCE" || item.targetType === "BANK" ? {} : { branchId: item.branchId }),
              });
            }
          }}
          onPatch={(patch) => editing && void update(editing.id, patch)}
          onDelete={() => { if (editing) void deleteBlock(editing); }}
          onPlay={() => editing && void playNow(editing)}
          onCopy={() => { if (editing) { copyBlock(editing, editor?.day); setEditor(null); } }}
        />
      ) : null}

      {hoursOpen ? (
        <BusinessHoursDialog
          branches={hoursBranches}
          initialBranch={hoursBranches.some((b) => b.id === quietBranch) ? quietBranch : hoursBranches[0]!.id}
          initial={biz}
          dayName={dayName}
          onClose={() => setHoursOpen(false)}
          onSave={async (branchId, next) => {
            setBiz(next);
            try { localStorage.setItem(HOURS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return saveClosing(branchId, closingPlan(next));
          }}
        />
      ) : null}

      <div className={`ss-toast${toast ? " is-on" : ""}`} role="status" aria-live="polite">
        <span>{toast?.msg}</span>
        {toast?.undo ? <button type="button" onClick={() => { toast.undo?.(); setToast(null); }}>{tr("Undo")}</button> : null}
      </div>
    </div>
  );
}

// ───────────────────────────── the music list (side panel) ─────────────────────────────

function useFilteredLib(lib: LibItem[]) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | LibItem["kind"]>("all");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lib.filter((l) => (kind === "all" || l.kind === kind) && (!needle || l.name.toLowerCase().includes(needle)));
  }, [lib, q, kind]);
  return { q, setQ, kind, setKind, shown };
}

function Cover({ item }: { item: LibItem }) {
  if (item.kind === "quiet") return <span className="ss-cover ss-cover--quiet" aria-hidden />;
  return item.cover ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="ss-cover" src={item.cover} alt="" draggable={false} loading="lazy" />
  ) : (
    <span className="ss-cover ss-cover--ph" data-c={item.ci} aria-hidden>{item.kind === "radio" ? "◉" : item.kind === "bank" ? "♫" : "♪"}</span>
  );
}

function FilterBar({ f, tr, lead }: { f: ReturnType<typeof useFilteredLib>; tr: (s: string, v?: Record<string, string | number>) => string; lead?: ReactNode }) {
  return (
    <>
      <div className="ss-searchrow">
        {lead}
        {/* the search shows nothing of what can be searched — only the magnifier (owner 2026-11-16); the name is for screen readers */}
        <label className="ss-search">
          <svg className="ss-search-ico" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.6-4.6" /></svg>
          <input value={f.q} onChange={(e) => f.setQ(e.target.value)} aria-label={tr("Search playlists, songs, radio…")} />
        </label>
      </div>
      <div className="ss-chips" role="tablist">
        {(["all", "playlist", "song", "radio", "bank"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={f.kind === k} className={`ss-chip${f.kind === k ? " is-on" : ""}`} onClick={() => f.setKind(k)}>
            {k === "all" ? tr("All") : k === "playlist" ? tr("Playlists") : k === "song" ? tr("Songs") : k === "radio" ? tr("Radio") : tr("Royalty-free")}
          </button>
        ))}
      </div>
    </>
  );
}

/** a small "i": standing on it (or focusing it) shows what the thing does, in a few words — there are no native tooltips in the app */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="ss-info" tabIndex={0} role="img" aria-label={text} onPointerDown={(e) => e.stopPropagation()} draggable={false}>
      <InfoIcon size={17} />
      <span className="ss-info-bubble" role="tooltip">{text}</span>
    </span>
  );
}

function LibraryPanel({ lib, quiet, onAddNext, onWarm, onClose }: { lib: LibItem[]; quiet: LibItem; onAddNext: (it: LibItem) => void; onWarm: (it: LibItem) => void; onClose: () => void }) {
  const tr = useTr();
  const f = useFilteredLib(lib);
  return (
    <div className="ss-panel-in">
      {/* no title: the round button that closes the list sits where it was, with the search beside it */}
      <FilterBar
        f={f}
        tr={tr}
        lead={
          <button type="button" className="ss-add-btn ss-add-btn--panel" onClick={onClose} aria-label={tr("Close the music list")}>
            <span className="ss-add-ico" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </span>
          </button>
        }
      />
      <ul className="ss-list ss-list--quiet">
        <li
          className="ss-row ss-row--quiet"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-ss-lib", quiet.key);
            e.dataTransfer.effectAllowed = "copy";
          }}
        >
          <Cover item={quiet} />
          <span className="ss-row-text">
            <span className="ss-row-name">{tr("Quiet — no music")}</span>
          </span>
          <InfoTip text={tr("Quiet block: the music stops when it starts, until the next block.")} />
          <button type="button" className="ss-row-add" onClick={() => onAddNext(quiet)} aria-label={tr("Add quiet")}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg></button>
        </li>
      </ul>
      <ul className="ss-list">
        {f.shown.map((it) => (
          <li
            key={it.key}
            className="ss-row"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-ss-lib", it.key);
              e.dataTransfer.effectAllowed = "copy";
              onWarm(it); // its length is asked for as the drag begins, so it is usually known by the drop
            }}
          >
            <Cover item={it} />
            <span className="ss-row-text">
              <span className="ss-row-name">{it.name}</span>
              <span className="ss-row-sub">{it.sub}</span>
            </span>
            <button type="button" className="ss-row-add" onClick={() => onAddNext(it)} aria-label={`${tr("Add music")}: ${it.name}`}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg></button>
          </li>
        ))}
        {f.shown.length === 0 ? <li className="ss-none">{tr("Nothing found")}</li> : null}
      </ul>
      <p className="ss-panel-hint">{tr("Drag onto a day to schedule it.")}</p>
    </div>
  );
}

/** the colour choices: eight shades of blue (the base), then ten more */
function ColorSwatches({ value, onPick }: { value: number; onPick: (i: number) => void }) {
  const tr = useTr();
  const sw = (i: number) => (
    <button key={i} type="button" className={`ss-sw${value === i ? " is-on" : ""}`} data-c={i} aria-label={`${tr("Color")} ${i + 1}`} aria-pressed={value === i} onClick={() => onPick(i)} />
  );
  return (
    <div className="ss-swatches" role="group" aria-label={tr("Color")}>
      <div className="ss-sw-row">{Array.from({ length: BLUE_SHADES }, (_, i) => sw(i))}</div>
      <div className="ss-sw-row">{Array.from({ length: PALETTE_SIZE - BLUE_SHADES }, (_, i) => sw(BLUE_SHADES + i))}</div>
    </div>
  );
}

/**
 * The VOLUME of a block (owner 2026-11-17: "when I stand on a song I can decide how loud the player is at that time"). "The player's own" = the block leaves the volume as it is; "Set" gives the
 * block its own, applied when it starts. The slider is saved when the finger / mouse is let go (not at every step). Someone who raises the volume above it during the block is asked first.
 */
function BlockVolume({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const tr = useTr();
  const [moving, setMoving] = useState<number | null>(null); // the slider while it is being moved; null = it shows the saved value
  const set = value !== null;
  const shown = moving ?? value ?? 60;
  const commit = () => {
    if (moving !== null && moving !== value) onChange(moving);
    setMoving(null);
  };
  return (
    <div className="ss-vol">
      <div className="ss-endmode" role="group" aria-label={tr("Volume")}>
        <button type="button" className={!set ? "is-on" : ""} aria-pressed={!set} onClick={() => set && onChange(null)}>{tr("The player's own")}</button>
        <button type="button" className={set ? "is-on" : ""} aria-pressed={set} onClick={() => !set && onChange(shown)}>{tr("Set for this block")}</button>
      </div>
      {set ? (
        <div className="ss-vol-row">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={shown}
            aria-label={tr("Volume")}
            onChange={(e) => setMoving(Number(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
          <span className="ss-vol-n">{shown}%</span>
        </div>
      ) : null}
    </div>
  );
}

// ───────────────────────────── the "⋯" menu of a block (also a right-click) ─────────────────────────────

const MENU_W = 224;

function BlockMenu({
  menu, schedule, quiet, multiDay, dayLabel, onRemoveDay, colour, onColour, onMoreColours, onClose, onEdit, onPlay, onCopy, onNudge, onToggle, onDelete,
}: {
  menu: { id: string; rect: Rect; day: number };
  schedule: Schedule;
  quiet: boolean;
  multiDay: boolean;
  dayLabel: string;
  onRemoveDay: () => void;
  colour: number;
  onColour: (i: number) => void;
  onMoreColours: () => void;
  onClose: () => void;
  onEdit: () => void;
  onPlay: () => void;
  onCopy: () => void;
  onNudge: (deltaMinutes: number) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const tr = useTr();
  const { t } = useTranslations();
  const T = t as unknown as Record<string, string>;
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rtl = isRtl();
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const r = menu.rect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // under the "⋯" button, opening toward the middle of the page; flipped above when there is no room below
    let left = rtl ? r.x + r.w - MENU_W : r.x;
    left = Math.min(Math.max(8, left), vw - MENU_W - 8);
    let top = r.y + r.h + 6;
    if (top + h > vh - 8) top = Math.max(8, r.y - h - 6);
    const id = requestAnimationFrame(() => setPos({ top, left }));
    return () => cancelAnimationFrame(id);
  }, [menu.rect, rtl]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node | null;
      if (n && ref.current?.contains(n)) return;
      markPopupClose();
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const item = (label: string, onClick: () => void, opts?: { hint?: string; danger?: boolean }) => (
    <button type="button" role="menuitem" className={`ss-menu-item${opts?.danger ? " is-danger" : ""}`} onClick={onClick}>
      <span>{label}</span>
      {opts?.hint ? <span className="ss-menu-hint" dir="ltr">{opts.hint}</span> : null}
    </button>
  );
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={tr("More actions")}
      className="ss-menu"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_W, visibility: pos ? "visible" : "hidden" }}
    >
      {item(T.edit ?? tr("Edit"), onEdit)}
      {item(quiet ? tr("Stop now") : T.playNow ?? tr("Play now"), onPlay)}
      {item(tr("Copy"), onCopy, { hint: mac ? "⌘C" : "Ctrl+C" })}
      <hr />
      {item(tr("15 minutes earlier"), () => onNudge(-15))}
      {item(tr("15 minutes later"), () => onNudge(15))}
      {item(schedule.enabled ? tr("Pause") : tr("Resume"), onToggle)}
      {quiet ? null : <hr />}
      {quiet ? null : <div className="ss-menu-colors" role="group" aria-label={tr("Color")}>
        {Array.from({ length: BLUE_SHADES }, (_, i) => (
          <button key={i} type="button" className={`ss-sw${colour === i ? " is-on" : ""}`} data-c={i} aria-label={`${tr("Color")} ${i + 1}`} aria-pressed={colour === i} onClick={() => onColour(i)} />
        ))}
        <button type="button" className={`ss-sw ss-sw--more${colour >= BLUE_SHADES ? " is-on" : ""}`} data-c={colour >= BLUE_SHADES ? colour : undefined} aria-label={tr("More colors")} title={tr("More colors")} onClick={onMoreColours}><i /><i /><i /></button>
      </div>}
      <hr />
      {multiDay ? item(tr("Remove from {day}", { day: dayLabel }), onRemoveDay) : null}
      {item(multiDay ? tr("Delete all days") : (T.delete ?? tr("Delete")), onDelete, { danger: true })}
    </div>,
    document.body,
  );
}

// ───────────────────────────── the card that opens next to a block / a clicked time ─────────────────────────────

/** a 24-hour time box ("07:30"): type it, Enter / leave the box to save; something that is not a time snaps back */
function TimeInput({ minutes, onCommit, label }: { minutes: number; onCommit: (m: number) => void; label: string }) {
  const shown = formatMinutes(minutes);
  const [draft, setDraft] = useState(shown);
  const commit = () => {
    const m = parseTypedTime(draft);
    if (m === null || m === minutes) {
      setDraft(shown);
      return;
    }
    onCommit(m);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      aria-label={label}
      dir="ltr"
    />
  );
}

function ScenePopover({
  editor, schedule, maxLen, lib, libFor, devices, colour, onColour, occurrenceDate, dayName, dateLabel, onClose, onPick, onPatch, onDelete, onPlay, onCopy,
}: {
  editor: Editor;
  schedule: Schedule | null;
  /** the music's own length in minutes (Infinity when it is not known) — a block cannot be stretched beyond it */
  maxLen: number;
  lib: LibItem[];
  libFor: (s: Schedule) => LibItem | null;
  devices: Device[];
  colour: number;
  onColour: (i: number) => void;
  /** the date (YYYY-MM-DD) of the occurrence that was clicked */
  occurrenceDate: string;
  dayName: (d: number, style?: "short" | "long") => string;
  dateLabel: (ymd: string) => string;
  onClose: () => void;
  onPick: (it: LibItem) => void | Promise<void>;
  onPatch: (p: Partial<Schedule>) => void;
  onDelete: () => void;
  onPlay: () => void;
  onCopy: () => void;
}) {
  const tr = useTr();
  const { t } = useTranslations();
  const T = t as unknown as Record<string, string>;
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [choosing, setChoosing] = useState(editor.kind === "new");
  const f = useFilteredLib(lib);
  const { autoPlaybackOff, setAutoPlaybackOff } = useScheduleBlockAuto(schedule?.id ?? "none");
  const quiet = !!schedule && isSilenceBlock(schedule);
  const li = schedule && !quiet ? libFor(schedule) : null;
  const rtl = isRtl();

  // place it beside the block (or the click), keep it inside the window
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const r = editor.rect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rtl ? r.x - POPOVER_W - 10 : r.x + r.w + 10;
    if (left + POPOVER_W > vw - 8) left = r.x - POPOVER_W - 10;
    if (left < 8) left = Math.min(Math.max(8, r.x + r.w / 2 - POPOVER_W / 2), vw - POPOVER_W - 8);
    const top = Math.min(Math.max(8, r.y - 12), Math.max(8, vh - h - 8));
    setPos({ top, left });
  }, [editor.rect, choosing, schedule?.id, schedule?.recurrence, schedule?.targetId, rtl]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node | null;
      if (n && ref.current?.contains(n)) return;
      if (n instanceof Element && n.closest(".ss-block, [role='dialog']")) return; // clicking another block switches; the delete dialog is its own
      markPopupClose();
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role='dialog']:not(.ss-pop)")) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const days = schedule?.daysOfWeek ?? [];
  const oneOff = schedule?.recurrence === "one_off";
  const toggleDay = (d: number) => {
    if (!schedule) return;
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b);
    if (next.length === 0) return; // at least one day
    onPatch({ daysOfWeek: next });
  };
  const kind = daysKind(days);
  const startMin = schedule ? startMinutes(schedule) : 0;
  // a block that has an END keeps its length when its start changes
  const endMin = schedule ? explicitEndMinutes(schedule) : null;
  const patchStart = (want: number) => {
    // the length stays: a block with an end can start no later than the end of the day allows
    const m = endMin !== null ? Math.min(want, Math.max(startMin, END_MAX - (endMin - startMin))) : want;
    const next: Partial<Schedule> = { startTimeLocal: minutesToTimeLocal(m) };
    if (endMin !== null) {
      const e = Math.min(END_MAX, endMin + (m - startMin));
      next.endTimeLocal = e > m ? minutesToTimeLocal(e) : "23:59:00";
    }
    onPatch(next);
  };
  const stepStart = (delta: number) => patchStart(Math.min(DAY_MINUTES - 1, Math.max(0, startMin + delta)));
  const setEnd = (m: number) => onPatch({ endTimeLocal: minutesToTimeLocal(Math.min(END_MAX, startMin + maxLen, Math.max(startMin + 1, m))) });
  const canEnd = startMin + 1 <= END_MAX;
  const weekdayOfDate = (ymd: string) => new Date(`${ymd}T12:00:00`).getDay();
  const repeatLabel = !oneOff && days.length === 1 ? tr("Repeats every {day}", { day: dayName(days[0]!, "long") }) : tr("Repeats weekly");

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={schedule ? (li?.name ?? schedule.name ?? tr("Schedule")) : tr("Add music")}
      className="ss-pop"
      data-c={colour}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: POPOVER_W, visibility: pos ? "visible" : "hidden" }}
    >
      {choosing || !schedule ? (
        <div className="ss-pop-pick">
          <div className="ss-pop-head">
            <strong>{editor.kind === "new" ? `${tr("Add music")} · ${dayName(editor.day)} ${formatMinutes(editor.min)}` : tr("Choose what plays")}</strong>
            {schedule ? <button type="button" className="ss-linkbtn" onClick={() => setChoosing(false)}>{tr("Back")}</button> : null}
          </div>
          <FilterBar f={f} tr={tr} />
          <ul className="ss-list ss-list--pop">
            {f.shown.map((it) => (
              <li key={it.key}>
                <button
                  type="button"
                  className="ss-row ss-row--btn"
                  onClick={async () => {
                    await onPick(it);
                    setChoosing(false);
                  }}
                >
                  <Cover item={it} />
                  <span className="ss-row-text">
                    <span className="ss-row-name">{it.name}</span>
                    <span className="ss-row-sub">{it.sub}</span>
                  </span>
                </button>
              </li>
            ))}
            {f.shown.length === 0 ? <li className="ss-none">{tr("Nothing found")}</li> : null}
          </ul>
        </div>
      ) : (
        <div className="ss-pop-edit">
          <div className="ss-pop-what">
            {quiet ? <span className="ss-cover ss-cover--quiet" aria-hidden /> : li ? <Cover item={li} /> : <span className="ss-cover ss-cover--ph" data-c={colour} aria-hidden>♪</span>}
            <span className="ss-row-text">
              <span className="ss-row-name">{quiet ? (schedule.name === CLOSING_NAME ? tr("Closing") : tr("Quiet")) : li?.name ?? schedule.name ?? tr("Schedule")}</span>
              <span className="ss-row-sub">{quiet ? tr("No music") : li?.sub ?? ""}</span>
            </span>
            <button type="button" className="ss-linkbtn" onClick={() => setChoosing(true)}>{tr("Change")}</button>
          </div>

          <div className="ss-field">
            <span className="ss-label">{tr("Starts at")}</span>
            <div className="ss-stepper">
              <button type="button" onClick={() => stepStart(-15)} aria-label="−15">−</button>
              <TimeInput key={formatMinutes(startMin)} minutes={startMin} onCommit={(m) => patchStart(m)} label={tr("Starts at")} />
              <button type="button" onClick={() => stepStart(15)} aria-label="+15">+</button>
            </div>
          </div>

          {quiet ? null : (
            <div className="ss-field">
              <span className="ss-label">{tr("Ends at")}</span>
              <div className="ss-endmode" role="group" aria-label={tr("Ends at")}>
                <button type="button" className={endMin === null ? "is-on" : ""} aria-pressed={endMin === null} onClick={() => endMin !== null && onPatch({ endTimeLocal: "23:59:00" })}>{tr("Until the next block")}</button>
                <button type="button" className={endMin !== null ? "is-on" : ""} aria-pressed={endMin !== null} disabled={!canEnd} onClick={() => endMin === null && setEnd(startMin + 60)}>{tr("At a time")}</button>
              </div>
              {endMin !== null ? (
                <div className="ss-stepper">
                  <button type="button" onClick={() => setEnd(endMin - 15)} aria-label="−15">−</button>
                  <TimeInput key={formatMinutes(endMin)} minutes={endMin} onCommit={setEnd} label={tr("Ends at")} />
                  <button type="button" onClick={() => setEnd(endMin + 15)} aria-label="+15">+</button>
                </div>
              ) : null}
            </div>
          )}

          <div className="ss-field">
            <button
              type="button"
              role="switch"
              aria-checked={!oneOff}
              className="ss-switch ss-switch--row"
              data-on={!oneOff}
              onClick={() =>
                oneOff
                  ? onPatch({ recurrence: "weekly", daysOfWeek: [weekdayOfDate(schedule.oneOffDateLocal || occurrenceDate)] })
                  : onPatch({ recurrence: "one_off", oneOffDateLocal: occurrenceDate, daysOfWeek: [] })
              }
            >
              <span className="ss-switch-label">{repeatLabel}</span>
              <span className="ss-switch-track"><span className="ss-switch-knob" /></span>
            </button>
            {oneOff ? (
              <div className="ss-date-row">
                <span className="ss-date-label">{dateLabel(schedule.oneOffDateLocal || occurrenceDate)}</span>
                <input className="ss-date" type="date" value={schedule.oneOffDateLocal ?? ""} onChange={(e) => e.target.value && onPatch({ oneOffDateLocal: e.target.value })} aria-label={T.scheduleOneOffDateLabel} />
              </div>
            ) : (
              <>
                <div className="ss-days">
                  {WEEK_DAYS.map((d) => (
                    <button key={d} type="button" className={days.includes(d) ? "is-on" : ""} onClick={() => toggleDay(d)} aria-pressed={days.includes(d)} title={dayName(d, "long")}>
                      {dayName(d).replace(/^יום\s*/, "").slice(0, 3)}
                    </button>
                  ))}
                </div>
                <div className="ss-quick">
                  <button type="button" className={kind === "weekdays" ? "is-on" : ""} onClick={() => onPatch({ daysOfWeek: [1, 2, 3, 4, 5] })}>{T.weekdays}</button>
                  <button type="button" className={kind === "weekend" ? "is-on" : ""} onClick={() => onPatch({ daysOfWeek: [0, 6] })}>{tr("Weekends")}</button>
                  <button type="button" className={kind === "every" ? "is-on" : ""} onClick={() => onPatch({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })}>{T.everyDay}</button>
                </div>
              </>
            )}
          </div>

          {quiet ? null : (
            <div className="ss-field">
              <span className="ss-label">{tr("Color")}</span>
              <ColorSwatches value={colour} onPick={onColour} />
            </div>
          )}

          {quiet ? null : (
            <div className="ss-field">
              <span className="ss-label">{tr("Volume")}</span>
              <BlockVolume value={typeof schedule.volume === "number" ? schedule.volume : null} onChange={(v) => onPatch({ volume: v })} />
            </div>
          )}

          {devices.length > 0 && !quiet ? (
            <div className="ss-field">
              <span className="ss-label">{T.device}</span>
              <select className="ss-select" value={schedule.deviceId ?? ""} onChange={(e) => onPatch({ deviceId: (e.target.value || null) as unknown as undefined })}>
                <option value="">{T.anyCompatibleDevice}</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          ) : null}

          <div className="ss-pop-toggles">
            <button type="button" role="switch" aria-checked={schedule.enabled} className="ss-switch ss-switch--sm" data-on={schedule.enabled} onClick={() => onPatch({ enabled: !schedule.enabled })}>
              <span className="ss-switch-label">{tr("Active")}</span>
              <span className="ss-switch-track"><span className="ss-switch-knob" /></span>
            </button>
            {schedule.enabled && schedule.recurrence !== "one_off" && occurrenceDate ? (
              // the father 2026-11-18: switch off ONE block for ONE day — the block before it then plays on until the next block that is on (lib/schedule-skip.ts)
              <button
                type="button"
                role="switch"
                aria-checked={!isSkippedOn(schedule, occurrenceDate)}
                className="ss-switch ss-switch--sm"
                data-on={!isSkippedOn(schedule, occurrenceDate)}
                title={tr("Off for this day only — the block before it plays on until the next one")}
                onClick={() => onPatch({ skipDates: withSkipDate(schedule.skipDates, occurrenceDate, !isSkippedOn(schedule, occurrenceDate), ymdOf(new Date())) })}
              >
                <span className="ss-switch-label">{tr("Plays on {date}", { date: dateLabel(occurrenceDate) })}</span>
                <span className="ss-switch-track"><span className="ss-switch-knob" /></span>
              </button>
            ) : null}
            {autoPlaybackOff ? (
              <button type="button" className="ss-linkbtn" onClick={() => setAutoPlaybackOff(false)} title={tr("This block was switched off on this computer only")}>{tr("Off on this computer — turn on")}</button>
            ) : null}
          </div>

          <div className="ss-pop-actions">
            <button type="button" className="ss-btn ss-btn--ghost" onClick={onPlay}>{quiet ? `■ ${tr("Stop now")}` : `▶ ${T.playNow}`}</button>
            <button type="button" className="ss-btn ss-btn--ghost" onClick={onCopy} title="Ctrl/⌘ + C">{tr("Copy")}</button>
            <button type="button" className="ss-btn ss-btn--danger" onClick={onDelete}>{T.delete}</button>
            <button type="button" className="ss-btn ss-btn--primary" onClick={onClose}>{tr("Done")}</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ───────────────────────────── jingles on the schedule ─────────────────────────────

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 21h4" />
    </svg>
  );
}

/** the little card of a jingle marker: its name, when it plays, and "Edit" — that jingle's own settings on the Jingles screen (owner 2026-11-19) */
function JingleMenu({
  menu, dayName, dateLabel, onClose, onOpen,
}: {
  menu: { item: JingleLike; day: number; min: number; rect: Rect };
  dayName: (d: number, style?: "short" | "long") => string;
  dateLabel: (ymd: string) => string;
  onClose: () => void;
  onOpen: () => void;
}) {
  const tr = useTr();
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rtl = isRtl();
  const W = 248;
  const { item } = menu;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const r = menu.rect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rtl ? r.x + r.w - W : r.x;
    left = Math.min(Math.max(8, left), vw - W - 8);
    let top = r.y + r.h + 6;
    if (top + h > vh - 8) top = Math.max(8, r.y - h - 6);
    const id = requestAnimationFrame(() => setPos({ top, left }));
    return () => cancelAnimationFrame(id);
  }, [menu.rect, rtl]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node | null;
      if (n && ref.current?.contains(n)) return;
      markPopupClose();
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // "Every day" / "Mon, Wed" / "Every Tuesday" / "Once · Thu, 12 Nov"
  const repeat = item.repeat ?? "once";
  const base = item.scheduledAtIso ? new Date(item.scheduledAtIso) : null;
  const baseOk = base && !Number.isNaN(base.getTime());
  const days = item.days && item.days.length > 0 ? item.days : [0, 1, 2, 3, 4, 5, 6];
  const when =
    repeat === "weekdays"
      ? days.length === 7 ? tr("Every day") : days.map((d) => dayName(d)).join(", ")
      : repeat === "daily"
        ? tr("Every day")
        : repeat === "weekly" && baseOk
          ? tr("Every {day}", { day: dayName(base!.getDay(), "long") })
          : baseOk
            ? `${tr("Once")} · ${dateLabel(`${base!.getFullYear()}-${String(base!.getMonth() + 1).padStart(2, "0")}-${String(base!.getDate()).padStart(2, "0")}`)}`
            : tr("Once");

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${tr("Jingle")}: ${item.label}`}
      className="ss-menu ss-jmenu"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: W, visibility: pos ? "visible" : "hidden" }}
    >
      <div className="ss-jmenu-head">
        <span className="ss-jmenu-ico" aria-hidden><BellIcon /></span>
        <span className="ss-jmenu-text">
          <span className="ss-jmenu-name"><bdi>{item.label}</bdi></span>
          <span className="ss-jmenu-sub"><bdi dir="ltr">{formatMinutes(menu.min)}</bdi> · {when}</span>
        </span>
      </div>
      <button type="button" role="menuitem" className="ss-menu-item" onClick={onOpen}>
        <span>{tr("Edit")}</span>
      </button>
    </div>,
    document.body,
  );
}

// ───────────────────────────── how the blocks look (a small settings card) ─────────────────────────────

function DisplayMenu({
  rect, display, onChange, onClose,
}: {
  rect: Rect;
  display: StudioDisplay;
  onChange: (patch: Partial<StudioDisplay> | null) => void;
  onClose: () => void;
}) {
  const tr = useTr();
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rtl = isRtl();
  const W = 312;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rtl ? rect.x : rect.x + rect.w - W;
    left = Math.min(Math.max(8, left), vw - W - 8);
    let top = rect.y + rect.h + 8;
    if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    const id = requestAnimationFrame(() => setPos({ top, left }));
    return () => cancelAnimationFrame(id);
  }, [rect, rtl]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node | null;
      if (n && ref.current?.contains(n)) return;
      if (n instanceof Element && n.closest(".ss-dtoggle")) return; // the button toggles it itself
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const seg = <T extends string>(label: string, value: T, options: { v: T; t: string }[], set: (v: T) => void) => (
    <div className="ss-field">
      <span className="ss-label">{label}</span>
      <div className="ss-endmode" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.v} type="button" className={value === o.v ? "is-on" : ""} aria-pressed={value === o.v} onClick={() => set(o.v)}>{o.t}</button>
        ))}
      </div>
    </div>
  );
  const sw = (label: string, on: boolean, set: (v: boolean) => void) => (
    <button type="button" role="switch" aria-checked={on} className="ss-switch ss-switch--row" data-on={on} onClick={() => set(!on)}>
      <span className="ss-switch-label">{label}</span>
      <span className="ss-switch-track"><span className="ss-switch-knob" /></span>
    </button>
  );
  const familyName = (f: ColourFamily) => ({ blue: tr("Blue"), violet: tr("Violet"), teal: tr("Teal"), green: tr("Green"), rose: tr("Rose"), orange: tr("Orange"), graphite: tr("Graphite") })[f];

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={tr("Display")}
      className="ss-menu ss-dmenu"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: W, visibility: pos ? "visible" : "hidden" }}
    >
      <div className="ss-dmenu-in">
        {seg(tr("Hours shown"), display.hours, [{ v: "active", t: tr("Active hours") }, { v: "day", t: tr("Full day") }], (v) => onChange({ hours: v }))}
        {seg(tr("Week"), display.weekLayout, [{ v: "rows", t: tr("Rows") }, { v: "columns", t: tr("Columns") }], (v) => onChange({ weekLayout: v }))}
        {seg(tr("Style"), display.style, [{ v: "fog", t: tr("Fog") }, { v: "solid", t: tr("Solid") }], (v) => onChange({ style: v }))}
        {display.style === "solid" ? seg(tr("Colours"), display.colour, [{ v: "palette", t: tr("Palette") }, { v: "cover", t: tr("Cover") }], (v) => onChange({ colour: v })) : null}
        {display.style === "solid" && display.colour === "palette" ? (
          <div className="ss-sw-row ss-dmenu-fam" role="group" aria-label={tr("Palette")}>
            {COLOUR_FAMILIES.map((f) => {
              const t = familyShade(f, 3);
              return (
                <button
                  key={f}
                  type="button"
                  className={`ss-sw${display.family === f ? " is-on" : ""}`}
                  data-c={f === "blue" ? 1 : undefined}
                  style={t ? { ["--c1" as string]: t.c1, ["--c2" as string]: t.c2 } : undefined}
                  aria-label={familyName(f)}
                  aria-pressed={display.family === f}
                  title={familyName(f)}
                  onClick={() => onChange({ family: f })}
                />
              );
            })}
          </div>
        ) : null}
        {seg(tr("Show"), display.content, [{ v: "both", t: tr("Image + text") }, { v: "text", t: tr("Text only") }, { v: "image", t: tr("Image only") }], (v) => onChange({ content: v }))}
        {display.style === "solid" ? seg(tr("Position"), display.pos, [{ v: "top", t: tr("Top") }, { v: "middle", t: tr("Middle") }, { v: "bottom", t: tr("Bottom") }], (v) => onChange({ pos: v })) : null}
        <div className="ss-field">
          {sw(tr("Hours"), display.times, (v) => onChange({ times: v }))}
          {sw(tr("Length of the song / playlist"), display.length, (v) => onChange({ length: v }))}
        </div>
        <button type="button" className="ss-linkbtn ss-dmenu-reset" onClick={() => onChange(null)}>{tr("Reset to default")}</button>
      </div>
    </div>,
    document.body,
  );
}

// ───────────────────────────── the date + its arrows + its calendar: one pane that grows downward ─────────────────────────────

/** a text that rolls: when it changes the old one leaves upward (or downward) and the new one comes in from the other side — direction 1 = forward / later, -1 = back / earlier */
function RollText({ text, dir }: { text: string; dir: 1 | -1 }) {
  const [v, setV] = useState({ cur: text, prev: null as string | null, n: 0 });
  if (v.cur !== text) setV({ cur: text, prev: v.cur, n: v.n + 1 }); // (React: adjusting state while rendering, when a prop changed)
  useEffect(() => {
    if (v.prev === null) return;
    const id = window.setTimeout(() => setV((x) => (x.prev === null ? x : { ...x, prev: null })), 360);
    return () => window.clearTimeout(id);
  }, [v.n, v.prev]);
  return (
    <span className="ss-roll" data-dir={dir}>
      {v.prev !== null ? <span key={`o${v.n}`} className="ss-roll-out" aria-hidden><bdi>{v.prev}</bdi></span> : null}
      <span key={`i${v.n}`} className={v.prev !== null ? "ss-roll-in" : undefined}><bdi>{v.cur}</bdi></span>
    </span>
  );
}

/**
 * Closed: the date between two plain arrows (day / week back and forward). A click on the date grows the same pane downward into one month — the date becomes the month's name and the
 * arrows step months — and it folds back up on a pick, a click outside or Esc. Nothing opens on hover. The pane is the same width as the date row plus a little, centred on it.
 */
function DateNav({
  label, prevLabel, nextLabel, onStep, focusKey, todayKey, loc, onPick,
}: {
  label: string;
  prevLabel: string;
  nextLabel: string;
  onStep: (n: number) => void;
  focusKey: string;
  todayKey: string;
  loc: string;
  onPick: (ymd: string) => void;
}) {
  const tr = useTr();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false); // the month stays drawn while the pane folds up
  const [dir, setDir] = useState<1 | -1>(1); // which way the text rolls: later = up, earlier = down
  const [textW, setTextW] = useState(0); // the width of the date, kept by its place while the pane is open — the arrows stay where they are and the month's name rolls in between them
  const ghostText = useRef<HTMLSpanElement | null>(null);
  const [cursor, setCursor] = useState(() => ({ y: Number(focusKey.slice(0, 4)), m: Number(focusKey.slice(5, 7)) - 1 }));

  const foldTimer = useRef<number | null>(null);
  const openPane = () => {
    if (foldTimer.current) window.clearTimeout(foldTimer.current);
    foldTimer.current = null;
    setCursor({ y: Number(focusKey.slice(0, 4)), m: Number(focusKey.slice(5, 7)) - 1 });
    setTextW(Math.ceil(ghostText.current?.getBoundingClientRect().width ?? 0));
    setDir(1);
    setShown(true);
    setOpen(true);
  };
  const closePane = useCallback(() => {
    setOpen(false);
    setDir(-1);
    if (foldTimer.current) window.clearTimeout(foldTimer.current);
    foldTimer.current = window.setTimeout(() => { setShown(false); setTextW(0); }, 380); // the month is taken out once the pane has folded up
  }, []);
  useEffect(() => () => { if (foldTimer.current) window.clearTimeout(foldTimer.current); }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      closePane();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePane();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, closePane]);

  const toggle = () => (open ? closePane() : openPane());
  // the month grid: weeks start on Sunday; five rows are enough when the sixth would be a whole week of the next month
  const first = new Date(cursor.y, cursor.m, 1);
  const gridStart = new Date(cursor.y, cursor.m, 1 - first.getDay());
  const rows = new Date(cursor.y, cursor.m, 1 - first.getDay() + 35).getMonth() === cursor.m ? 6 : 5;
  const cells = Array.from({ length: rows * 7 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const monthTitle = first.toLocaleDateString(loc, { month: "long", year: "numeric" });
  const stepMonth = (n: number) => { setDir(n > 0 ? 1 : -1); setCursor((c) => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; }); };
  const stepDay = (n: number) => { setDir(n > 0 ? 1 : -1); onStep(n); };
  const weekday = (d: number) => new Date(2023, 0, 1 + d).toLocaleDateString(loc, { weekday: "narrow" }); // 1 Jan 2023 was a Sunday

  return (
    <div className="ss-datenav-slot" ref={rootRef}>
      {/* an invisible copy of the closed row holds the room in the toolbar (the pane itself floats) */}
      <span className="ss-dn-ghost" aria-hidden>
        <span className="ss-dn-sp" />
        <span className="ss-range ss-daypick" ref={ghostText}><bdi>{label}</bdi></span>
        <span className="ss-dn-sp" />
      </span>
      <div className={`ss-datenav${open ? " is-open" : ""}`}>
        <div className="ss-dn-row">
          <div className="ss-dn-group">
            <button type="button" className="ss-dn-arrow" onClick={() => (open ? stepMonth(-1) : stepDay(-1))} aria-label={open ? tr("Previous month") : prevLabel}><span className="ss-arrow ss-arrow--prev" aria-hidden /></button>
            <button type="button" className="ss-range ss-daypick" aria-haspopup="dialog" aria-expanded={open} aria-live="polite" onClick={toggle} style={open && textW ? { minWidth: textW } : undefined}>
              <RollText text={open ? monthTitle : label} dir={dir} />
            </button>
            <button type="button" className="ss-dn-arrow" onClick={() => (open ? stepMonth(1) : stepDay(1))} aria-label={open ? tr("Next month") : nextLabel}><span className="ss-arrow ss-arrow--next" aria-hidden /></button>
          </div>
        </div>
        <div className="ss-dn-cal" aria-hidden={!open}>
          <div className="ss-dn-cal-in">
            {shown || open ? (
              <div className="ss-dp-grid" role="group" aria-label={tr("Choose a day")}>
                {WEEK_DAYS.map((d) => <span key={d} className="ss-dp-wd">{weekday(d)}</span>)}
                {cells.map((c) => {
                  const key = dateKey(c);
                  return (
                    <button key={key} type="button" tabIndex={open ? 0 : -1} className={`ss-dp-cell${c.getMonth() !== cursor.m ? " is-out" : ""}${key === focusKey ? " is-on" : ""}${key === todayKey ? " is-today" : ""}`} aria-pressed={key === focusKey} onClick={() => { setDir(key >= focusKey ? 1 : -1); onPick(key); closePane(); }}>
                      {c.getDate()}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── the hours ruler + the zoom control ─────────────────────────────

const hh = (m: number) => String(Math.floor(m / 60) % 24).padStart(2, "0");
const mm = (m: number) => String(Math.round(m % 60)).padStart(2, "0");

/** one hour label: it fades in out of a blur when it appears (never on the very first paint) */
function RulerTick({ m, a, span, live, leaving }: { m: number; a: number; span: number; live: boolean; leaving?: boolean }) {
  const [fresh] = useState(live); // true only for labels that arrive after the ruler was first drawn
  return (
    <span className={`ss-htick${leaving ? " is-leaving" : fresh ? " is-fresh" : ""}`} data-m={m} style={{ insetInlineStart: `${((m - a) / span) * 100}%` }} aria-hidden={leaving || undefined}>
      {hh(m)}
      <span className="ss-htick-min">:{mm(m)}</span>
    </span>
  );
}

/** the hours down the side of the week's columns: labels that leave blur out, ones that arrive blur in — the same effect as the day's ruler (owner 2026-11-15) */
function GutterHours({ minutes, first, hourH }: { minutes: number[]; first: number; hourH: number }) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setLive(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const prev = useRef<number[]>(minutes);
  const [ghosts, setGhosts] = useState<number[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const now = new Set(minutes);
    const gone = prev.current.filter((m) => !now.has(m));
    prev.current = minutes;
    if (gone.length === 0) return;
    setGhosts((g) => Array.from(new Set([...g, ...gone])));
    timers.current.push(window.setTimeout(() => setGhosts((g) => g.filter((m) => !gone.includes(m))), 260));
  }, [minutes]);
  useEffect(() => {
    const ids = timers.current;
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, []);
  const shown = new Set(minutes);
  return (
    <>
      {minutes.map((m) => <GutterTick key={`t${m}`} m={m} first={first} hourH={hourH} live={live} />)}
      {ghosts.filter((m) => !shown.has(m)).map((m) => <GutterTick key={`g${m}`} m={m} first={first} hourH={hourH} live={live} leaving />)}
    </>
  );
}
function GutterTick({ m, first, hourH, live, leaving }: { m: number; first: number; hourH: number; live: boolean; leaving?: boolean }) {
  const [fresh] = useState(live);
  return (
    <span className={`ss-hour${leaving ? " is-leaving" : fresh ? " is-fresh" : ""}`} data-m={m} style={{ top: ((m - first) * hourH) / 60 }} aria-hidden={leaving || undefined}>
      {formatMinutes(m)}
    </span>
  );
}

/** the hours along the top of the day: the step between labels follows the zoom (whole hours … 5 / 2 / 1 minute); labels that leave blur out, ones that arrive blur in */
function HoursRuler({
  a, b, width, zooming, zoomed, axisRef, onPanStart, onReset,
}: {
  a: number;
  b: number;
  width: number;
  zooming: "smooth" | "drag" | null;
  zoomed: boolean;
  axisRef: (el: HTMLDivElement | null) => void;
  onPanStart: (e: React.PointerEvent<HTMLElement>) => void;
  onReset: () => void;
}) {
  const span = Math.max(1, b - a);
  const step = tickStep(width > 0 ? width / span : 1.2);
  const mins = useMemo(() => windowTicks({ a, b }, step), [a, b, step]);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setLive(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const prev = useRef<number[]>(mins);
  const [ghosts, setGhosts] = useState<number[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const now = new Set(mins);
    const gone = prev.current.filter((m) => !now.has(m) && m > a && m < b);
    prev.current = mins;
    if (gone.length === 0) return;
    setGhosts((g) => Array.from(new Set([...g, ...gone])));
    timers.current.push(window.setTimeout(() => setGhosts((g) => g.filter((m) => !gone.includes(m))), 260));
  }, [mins, a, b]);
  useEffect(() => {
    const ids = timers.current;
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, []);
  const shown = new Set(mins);
  return (
    <div
      ref={axisRef}
      className={`ss-haxis${step < 60 ? " is-fine" : ""}${zoomed ? " is-zoomed" : ""}${zooming ? ` is-${zooming}` : ""}`}
      onPointerDown={onPanStart}
      onDoubleClick={onReset}
    >
      {mins.map((m) => <RulerTick key={`t${m}`} m={m} a={a} span={span} live={live} />)}
      {ghosts.filter((m) => !shown.has(m)).map((m) => <RulerTick key={`g${m}`} m={m} a={a} span={span} live={live} leaving />)}
      {/* the time under the pointer, and the stretch of the block the pointer is on — written straight into the DOM by the studio (no re-render per mouse move) */}
      <div className="ss-xpill ss-xpill--s" hidden aria-hidden />
      <div className="ss-xpill ss-xpill--e" hidden aria-hidden />
      <div className="ss-xcur" hidden aria-hidden />
    </div>
  );
}

// ───────────────────────────── business hours: a clock for when the day starts and ends ─────────────────────────────

/** one wheel of a clock: big digits, a chevron above and below, the mouse wheel and the arrow keys turn it (it wraps round) */
function Wheel({ value, max, step, label, onChange }: { value: number; max: number; step: number; label: string; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const bump = (d: number) => onChange((((value + d * step) % (max + 1)) + (max + 1)) % (max + 1));
  const bumpRef = useRef(bump);
  useEffect(() => {
    bumpRef.current = bump;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let acc = 0;
    // a native, NON-passive listener so the page behind never scrolls
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 28) return;
      bumpRef.current(acc < 0 ? 1 : -1);
      acc = 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return (
    <div
      ref={ref}
      className="ss-wheel"
      role="spinbutton"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          bump(e.key === "ArrowUp" ? 1 : -1);
        }
      }}
    >
      <button type="button" tabIndex={-1} className="ss-wheel-btn" aria-label={`${label} +`} onClick={() => bump(1)}><span className="ss-wheel-chev ss-wheel-chev--up" aria-hidden /></button>
      <span className="ss-wheel-num">{String(value).padStart(2, "0")}</span>
      <button type="button" tabIndex={-1} className="ss-wheel-btn" aria-label={`${label} −`} onClick={() => bump(-1)}><span className="ss-wheel-chev ss-wheel-chev--down" aria-hidden /></button>
    </div>
  );
}

function Clock({ label, minutes, onChange }: { label: string; minutes: number; onChange: (m: number) => void }) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return (
    <div className="ss-clock">
      <span className="ss-label">{label}</span>
      <div className="ss-clock-face" dir="ltr">
        <Wheel value={Math.floor(m / 60)} max={23} step={1} label={`${label} — h`} onChange={(h) => onChange(h * 60 + (m % 60))} />
        <span className="ss-clock-colon" aria-hidden>:</span>
        <Wheel value={m % 60} max={59} step={5} label={`${label} — min`} onChange={(mm) => onChange(Math.floor(m / 60) * 60 + mm)} />
      </div>
    </div>
  );
}

function BusinessHoursDialog({
  branches, initialBranch, initial, dayName, onClose, onSave,
}: {
  branches: BranchRow[];
  initialBranch: string;
  initial: BizHours | null;
  dayName: (d: number, style?: "short" | "long") => string;
  onClose: () => void;
  onSave: (branchId: string, hours: BizHours) => Promise<boolean>;
}) {
  const tr = useTr();
  const [branch, setBranch] = useState(initialBranch);
  const [draft, setDraft] = useState<BizHours>(initial ?? DEFAULT_BIZ_HOURS);
  const [sel, setSel] = useState(() => new Date().getDay());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cur: DayHours = draft.same || draft.h24 ? draft.all : draft.days[sel] ?? null;
  const setCur = (patch: Partial<{ open: number; close: number }>) =>
    setDraft((d) => (d.same ? { ...d, all: { ...d.all, ...patch } } : { ...d, days: d.days.map((h, i) => (i === sel ? { ...(h ?? d.all), ...patch } : h)) }));
  const setClosed = (closed: boolean) => setDraft((d) => ({ ...d, days: d.days.map((h, i) => (i === sel ? (closed ? null : { ...d.all }) : h)) }));
  const setSame = (same: boolean) => setDraft((d) => (same ? { ...d, same: true } : { ...d, same: false, days: d.days.map(() => ({ ...d.all })) }));
  const sw = (label: string, on: boolean, set: (v: boolean) => void) => (
    <button type="button" role="switch" aria-checked={on} className="ss-switch ss-switch--row ss-bh-sw" data-on={on} onClick={() => set(!on)}>
      <span className="ss-switch-label">{label}</span>
      <span className="ss-switch-track"><span className="ss-switch-knob" /></span>
    </button>
  );

  return createPortal(
    <div className="ss-modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ss-modal ss-bh" role="dialog" aria-modal="true" aria-label={tr("Business hours")}>
        <div className="ss-modal-head">
          <div>
            <h2 className="ss-modal-title">{tr("Business hours")}</h2>
            <p className="ss-modal-sub">{tr("Music plays while you are open and goes quiet at closing time.")}</p>
          </div>
          {branches.length > 1 ? (
            <select className="ss-select ss-select--sm" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label={tr("Branch")}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : null}
        </div>
        <div className="ss-bh-body">
          {sw(tr("Open 24 hours"), draft.h24, (v) => setDraft((d) => ({ ...d, h24: v })))}
          {!draft.h24 ? (
            <>
              {sw(tr("Same hours every day"), draft.same, setSame)}
              {!draft.same ? (
                <div className="ss-bh-days" role="group" aria-label={tr("Choose a day")}>
                  {WEEK_DAYS.map((d) => (
                    <button key={d} type="button" className={`ss-bh-day${sel === d ? " is-on" : ""}${draft.days[d] === null ? " is-closed" : ""}`} aria-pressed={sel === d} onClick={() => setSel(d)} title={dayName(d, "long")}>
                      {dayName(d).replace(/^יום\s*/, "").slice(0, 3)}
                    </button>
                  ))}
                </div>
              ) : null}
              {cur === null ? (
                <p className="ss-bh-closed">{tr("Closed")}</p>
              ) : (
                <div className="ss-bh-clock">
                  <Clock label={tr("Opens")} minutes={cur.open} onChange={(m) => setCur({ open: m })} />
                  <span className="ss-bh-dash" aria-hidden />
                  <Clock label={tr("Closes")} minutes={cur.close} onChange={(m) => setCur({ close: m })} />
                </div>
              )}
              {!draft.same ? sw(tr("Closed this day"), cur === null, setClosed) : null}
            </>
          ) : null}
        </div>
        <div className="ss-modal-foot">
          <span className="ss-modal-spacer" />
          <button type="button" className="ss-btn ss-btn--ghost" onClick={onClose}>{tr("Cancel")}</button>
          <button
            type="button"
            className="ss-btn ss-btn--primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onSave(branch, draft);
              setSaving(false);
              if (ok) onClose();
            }}
          >
            {tr("Save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
