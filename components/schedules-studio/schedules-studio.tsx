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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTr } from "@/lib/i18n/use-tr";
import { useLocale, useTranslations } from "@/lib/locale-context";
import { useScheduleEngine } from "@/lib/schedule-engine-context";
import { useSchedulePlaybackHandlers } from "@/lib/use-schedule-playback-handlers";
import { runSchedulePlayback } from "@/lib/schedule-playback-client";
import { useScheduleBlockAuto } from "@/lib/use-schedule-block-auto";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { resolveScheduleTargetBranchId, scheduleTargetKey } from "@/lib/schedule-target-helpers";
import {
  DAY_MINUTES,
  WEEK_DAYS,
  addDays,
  buildDayScenes,
  dateKey,
  daysKind,
  formatMinutes,
  minutesToTimeLocal,
  nowAndNext,
  PALETTE_SIZE,
  BLUE_SHADES,
  paletteIndex,
  parseTypedTime,
  pastedScheduleBody,
  snapMinutes,
  startMinutes,
  weekDatesFor,
  type Scene,
} from "@/lib/schedules-timeline";
import type { Playlist } from "@/lib/playlist-types";
import type { Device, Schedule, ScheduleTargetType, Source } from "@/lib/types";

const FIRST_H = 5; // the schedule shows 05:00 → 24:00
const LAST_H = 24;
const SPAN = (LAST_H - FIRST_H) * 60;
const HOUR_H = 46; // px per hour in the week view
const PANEL_KEY = "syncbiz-schedule-lib-panel";
const VIEW_KEY = "syncbiz-schedule-view";
const POPOVER_W = 344;
const BLOCK_COLORS_KEY = "syncbiz-sched-block-colors-v1";

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
  kind: "playlist" | "song" | "radio";
  sub: string;
  branchId: string;
  /** the Apple colour of this music: taken from its own cover (or a stable fallback) */
  ci: number;
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

const isRtl = () => typeof document !== "undefined" && document.documentElement.getAttribute("dir") === "rtl";
const pct = (min: number) => ((Math.min(Math.max(min, FIRST_H * 60), LAST_H * 60) - FIRST_H * 60) / SPAN) * 100;
const topOf = (min: number) => ((Math.max(min, FIRST_H * 60) - FIRST_H * 60) * HOUR_H) / 60;
const isTypingTarget = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** where in time is the pointer on a track (the week's day column runs down, the day's row runs along — against the reading direction in Hebrew) */
function minuteAtPointer(clientX: number, clientY: number, el: HTMLElement, orient: Orient): number {
  const r = el.getBoundingClientRect();
  if (orient === "v") return snapMinutes(FIRST_H * 60 + ((clientY - r.top) * 60) / HOUR_H);
  let ratio = (clientX - r.left) / Math.max(1, r.width);
  if (isRtl()) ratio = 1 - ratio;
  return snapMinutes(FIRST_H * 60 + ratio * SPAN);
}

export function SchedulesStudio({ initialSchedules, playlists, sources, radioStations, devices, branches }: Props) {
  const router = useRouter();
  const tr = useTr();
  const { t } = useTranslations();
  const T = t as unknown as Record<string, string>;
  const { locale } = useLocale();
  const { engineEnabled, setEngineEnabled } = useScheduleEngine();
  const { setLastMessage, stop, setQueue, playSource, route } = useSchedulePlaybackHandlers();

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
  const [drag, setDrag] = useState<{ id: string; start: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<number | null>(null);

  // the whole screen is the studio: the page's side rails are hidden while it is open (CSS: html[data-sb-studio])
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-sb-studio", "1");
    return () => root.removeAttribute("data-sb-studio");
  }, []);
  useEffect(() => {
    try {
      if (localStorage.getItem(PANEL_KEY) === "closed") setPanelOpen(false);
      if (localStorage.getItem(VIEW_KEY) === "week") setView("week");
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  const showToast = useCallback((msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), undo ? 7000 : 4200);
  }, []);
  const togglePanel = () => {
    setPanelOpen((v) => {
      try { localStorage.setItem(PANEL_KEY, v ? "closed" : "open"); } catch { /* ignore */ }
      return !v;
    });
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
  const lib = useMemo<LibItem[]>(() => {
    const out: LibItem[] = [];
    const colour = (targetType: string, targetId: string) => paletteIndex(`${targetType}:${targetId}`);
    const bid = (targetType: ScheduleTargetType, targetId: string) => resolveScheduleTargetBranchId({ targetType, targetId }, sources, playlists, radioStations);
    for (const p of playlists) {
      out.push({ key: scheduleTargetKey("PLAYLIST", p.id), targetType: "PLAYLIST", targetId: p.id, name: p.name, cover: (p.thumbnail || p.cover || "").trim() || null, kind: "playlist", sub: p.tracks?.length ? (p.tracks.length === 1 ? tr("1 song") : tr("{n} songs", { n: p.tracks.length })) : tr("Playlist"), branchId: bid("PLAYLIST", p.id), ci: colour("PLAYLIST", p.id) });
    }
    for (const s of sources) {
      out.push({ key: scheduleTargetKey("SOURCE", s.id), targetType: "SOURCE", targetId: s.id, name: s.name, cover: (s.artworkUrl ?? "").trim() || null, kind: "song", sub: tr("Song"), branchId: bid("SOURCE", s.id), ci: colour("SOURCE", s.id) });
    }
    for (const r of radioStations) {
      out.push({ key: scheduleTargetKey("RADIO", r.id), targetType: "RADIO", targetId: r.id, name: r.name, cover: null, kind: "radio", sub: tr("Radio"), branchId: bid("RADIO", r.id), ci: colour("RADIO", r.id) });
    }
    return out;
  }, [playlists, sources, radioStations, tr]);
  const libMap = useMemo(() => new Map(lib.map((l) => [l.key, l])), [lib]);
  const libFor = useCallback((s: Schedule) => libMap.get(scheduleTargetKey(s.targetType, (s.targetId || s.sourceId || "").trim())) ?? null, [libMap]);
  const nameOf = (s: Schedule) => libFor(s)?.name ?? s.name ?? tr("Schedule");
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
  const colourOf = (s: Schedule) => blockColors[s.id] ?? libFor(s)?.ci ?? paletteIndex(`${s.targetType}:${s.targetId}`);

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
  const viewItems = useMemo(() => (drag ? items.map((s) => (s.id === drag.id ? { ...s, startTimeLocal: minutesToTimeLocal(drag.start) } : s)) : items), [items, drag]);
  const shownItems = useMemo(() => (branchFilter === "all" ? viewItems : viewItems.filter((s) => ((s.branchId ?? "default").trim() || "default") === branchFilter)), [viewItems, branchFilter]);
  const weekScenes = useMemo(() => WEEK_DAYS.map((d) => buildDayScenes(shownItems, d, weekDates)), [shownItems, weekDates]);
  const dayRows = useMemo(() => {
    const ids = branchFilter !== "all" ? [branchFilter] : branchIds.length > 0 ? branchIds : [branches[0]?.id ?? "default"];
    return ids.map((id) => ({ id, name: branchName(id), scenes: buildDayScenes(viewItems.filter((s) => ((s.branchId ?? "default").trim() || "default") === id), focusDay, weekDates) }));
  }, [branchFilter, branchIds, branches, branchName, viewItems, focusDay, weekDates]);
  const todayScenes = useMemo(() => buildDayScenes(items, clock.getDay(), weekDatesFor(clock)), [items, todayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const nowMin = clock.getHours() * 60 + clock.getMinutes();
  const { now: nowScene, next: nextScene } = useMemo(() => nowAndNext(todayScenes, nowMin), [todayScenes, nowMin]);
  const editing = editor?.kind === "edit" ? items.find((s) => s.id === editor.id) ?? null : null;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // the first screen shows the working day: from 06:00 (morning) up to 07:30 (evening), following the clock — so the morning blocks are never cut at the top
    const topMin = Math.min(Math.max(nowMin - 8 * 60, 6 * 60), 7 * 60 + 30);
    el.scrollTop = Math.max(0, ((topMin - FIRST_H * 60) * HOUR_H) / 60 - 10); // a little above the hour so its label is not cut
    // once, when the week appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ── saving (optimistic, rolled back on a failure) ──
  const update = useCallback(
    async (id: string, patch: Partial<Schedule>) => {
      const before = items.find((s) => s.id === id);
      if (!before) return;
      setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      try {
        const saved = await api<Schedule>("PATCH", `/api/schedules/${encodeURIComponent(id)}`, patch);
        setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...saved } : s)));
      } catch (e) {
        setItems((prev) => prev.map((s) => (s.id === id ? before : s)));
        showToast(`${tr("Couldn't save the change")} — ${e instanceof Error ? e.message : ""}`);
      }
    },
    [items, showToast, tr],
  );

  const createFromBody = useCallback(
    async (body: Record<string, unknown>): Promise<Schedule | null> => {
      const tmp = { id: `tmp-${Date.now()}`, accountId: "", ...body } as unknown as Schedule;
      setItems((prev) => [...prev, tmp]);
      try {
        const created = await api<Schedule>("POST", "/api/schedules", body);
        setItems((prev) => prev.map((s) => (s.id === tmp.id ? created : s)));
        return created;
      } catch (e) {
        setItems((prev) => prev.filter((s) => s.id !== tmp.id));
        showToast(`${tr("Couldn't save the change")} — ${e instanceof Error ? e.message : ""}`);
        return null;
      }
    },
    [showToast, tr],
  );

  const create = useCallback(
    (item: LibItem, day: number, min: number) =>
      createFromBody({
        name: item.name,
        branchId: item.branchId,
        targetType: item.targetType,
        targetId: item.targetId,
        sourceId: item.targetType === "SOURCE" ? item.targetId : undefined,
        recurrence: "weekly",
        daysOfWeek: [day],
        startTimeLocal: minutesToTimeLocal(min),
        enabled: true,
        priority: 1,
      }),
    [createFromBody],
  );

  const removeNow = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await api("DELETE", `/api/schedules/${encodeURIComponent(id)}`);
      } catch (e) {
        if (!(e instanceof Error) || !/not found|404/i.test(e.message)) {
          showToast(`${tr("Couldn't save the change")} — ${e instanceof Error ? e.message : ""}`);
          return false;
        }
      }
      clearLocalAutoPrefs(id);
      setBlockColor(id, null);
      setItems((prev) => prev.filter((s) => s.id !== id));
      return true;
    },
    [showToast, tr, setBlockColor],
  );

  async function confirmDelete() {
    const id = deleteId;
    if (!id) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      try {
        await api("DELETE", `/api/schedules/${encodeURIComponent(id)}`);
      } catch (e) {
        if (!(e instanceof Error) || !/not found|404/i.test(e.message)) throw e;
      }
      clearLocalAutoPrefs(id);
      setBlockColor(id, null);
      setItems((prev) => prev.filter((s) => s.id !== id));
      setEditor(null);
      setDeleteId(null);
      router.refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed");
      throw e;
    } finally {
      setDeleting(false);
    }
  }

  async function playNow(s: Schedule) {
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
    (s: Schedule) => {
      setClip(s);
      showToast(tr("Copied — click a day's title to paste it there at the same hour."));
    },
    [showToast, tr],
  );
  const pasteOn = useCallback(
    async (ymd: string) => {
      if (!clip) return;
      const created = await createFromBody(pastedScheduleBody(clip, ymd));
      if (created) {
        if (blockColors[clip.id] !== undefined) setBlockColor(created.id, blockColors[clip.id]!);
        showToast(`${tr("Pasted")} · ${dateLabel(ymd)} ${formatMinutes(startMinutes(created))}`, () => void removeNow(created.id));
      }
    },
    [clip, createFromBody, removeNow, showToast, tr, blockColors, setBlockColor], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const pasteHint = tr("Point at a day (or open the Day view), then paste.");
  const latest = useRef({ editing, clip, hoverDate, view, focusKey, pasteOn, copyBlock, say: showToast, hint: pasteHint });
  useEffect(() => {
    latest.current = { editing, clip, hoverDate, view, focusKey, pasteOn, copyBlock, say: showToast, hint: pasteHint };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.altKey) return;
      const L = latest.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "c" && L.editing) {
        e.preventDefault();
        L.copyBlock(L.editing);
      } else if (mod && e.key.toLowerCase() === "v" && L.clip) {
        const ymd = L.hoverDate ?? (L.view === "day" ? L.focusKey : null);
        e.preventDefault();
        if (!ymd) {
          L.say(L.hint);
          return;
        }
        void L.pasteOn(ymd);
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
    if (e.target !== e.currentTarget || drag) {
      if (hover) setHover(null);
      return;
    }
    const m = minuteAtPointer(e.clientX, e.clientY, e.currentTarget, orient);
    if (!hover || hover.key !== key || hover.min !== m) setHover({ key, min: m });
  };
  const trackClick = (e: React.MouseEvent<HTMLDivElement>, day: number, orient: Orient, branchId?: string) => {
    if (e.target !== e.currentTarget) return;
    setEditor({ kind: "new", day, min: minuteAtPointer(e.clientX, e.clientY, e.currentTarget, orient), rect: { x: e.clientX, y: e.clientY, w: 0, h: 0 }, branchId });
  };
  const trackDragOver = (e: React.DragEvent<HTMLDivElement>, key: string, orient: Orient) => {
    if (!Array.from(e.dataTransfer.types).includes("application/x-ss-lib")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const m = minuteAtPointer(e.clientX, e.clientY, e.currentTarget, orient);
    if (!hover || hover.key !== key || hover.min !== m) setHover({ key, min: m });
  };
  const trackDrop = async (e: React.DragEvent<HTMLDivElement>, day: number, orient: Orient) => {
    const key = e.dataTransfer.getData("application/x-ss-lib");
    if (!key) return;
    e.preventDefault();
    const m = minuteAtPointer(e.clientX, e.clientY, e.currentTarget, orient);
    const rect: Rect = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
    setHover(null);
    const item = libMap.get(key);
    if (!item) return;
    const created = await create(item, day, m);
    if (created) setEditor({ kind: "edit", id: created.id, rect, day });
  };

  // a block: click = open its card, drag = move it in time
  const onBlockPointerDown = (e: React.PointerEvent<HTMLDivElement>, sc: Scene, orient: Orient) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = e.currentTarget;
    const track = el.parentElement as HTMLElement;
    const startPt = orient === "v" ? e.clientY : e.clientX;
    const perMin = orient === "v" ? HOUR_H / 60 : (track.getBoundingClientRect().width / SPAN) * (isRtl() ? -1 : 1);
    const startMin = startMinutes(sc.schedule);
    let moved = false;
    let last = startMin;
    const move = (ev: PointerEvent) => {
      const d = (orient === "v" ? ev.clientY : ev.clientX) - startPt;
      if (!moved && Math.abs(d) < 5) return;
      moved = true;
      last = snapMinutes(startMin + d / perMin, 5);
      setDrag({ id: sc.schedule.id, start: last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!moved) {
        const r = el.getBoundingClientRect();
        setEditor({ kind: "edit", id: sc.schedule.id, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, day: sc.day });
        return;
      }
      setDrag(null);
      if (last !== startMin) void update(sc.schedule.id, { startTimeLocal: minutesToTimeLocal(last) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const renderBlock = (sc: Scene, orient: Orient) => {
    if (sc.end <= FIRST_H * 60) return null;
    const li = libFor(sc.schedule);
    const end = Math.min(sc.end, DAY_MINUTES);
    const vHeight = Math.max(26, ((end - Math.max(sc.start, FIRST_H * 60)) * HOUR_H) / 60 - 3);
    const style: CSSProperties =
      orient === "v"
        ? { top: topOf(sc.start), height: vHeight }
        : { insetInlineStart: `${pct(sc.start)}%`, width: `calc(${Math.max(1.2, pct(end) - pct(sc.start))}% - 4px)` };
    const cls = `ss-block ss-block--${orient}${sc.paused ? " is-paused" : ""}${sc.shadowed ? " is-shadowed" : ""}${drag?.id === sc.schedule.id ? " is-dragging" : ""}${editing?.id === sc.schedule.id && editor?.day === sc.day ? " is-selected" : ""}${menu?.id === sc.schedule.id && menu.day === sc.day ? " is-menu" : ""}${clip?.id === sc.schedule.id ? " is-copied" : ""}`;
    const tall = orient === "v" && vHeight > 60;
    return (
      <div
        key={`${sc.schedule.id}-${orient}-${sc.day}`}
        className={cls}
        data-c={colourOf(sc.schedule)}
        style={style}
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
        {li?.cover && !sc.paused ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ss-b-cover" src={li.cover} alt="" draggable={false} loading="lazy" />
        ) : null}
        <span className="ss-b-text">
          <span className="ss-b-name">{nameOf(sc.schedule)}</span>
          <span className="ss-b-time">{formatMinutes(sc.start)}{!sc.paused && !sc.shadowed && (orient === "h" || tall) ? ` – ${formatMinutes(Math.min(sc.end, DAY_MINUTES - 1))}` : ""}</span>
        </span>
        {!sc.shadowed ? (
          <button
            type="button"
            className="ss-b-more"
            aria-label={tr("More actions")}
            aria-haspopup="menu"
            aria-expanded={menu?.id === sc.schedule.id}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ id: sc.schedule.id, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, day: sc.day });
            }}
          >
            <i /><i /><i />
          </button>
        ) : null}
      </div>
    );
  };

  const nm = (sc: Scene) => <bdi>{nameOf(sc.schedule)}</bdi>;
  const statusText = nowScene
    ? `${tr("Now")}: ${nameOf(nowScene.schedule)}${nextScene ? ` · ${tr("Next")} ${formatMinutes(nextScene.start)} ${nameOf(nextScene.schedule)}` : ""}`
    : nextScene
      ? `${tr("Nothing scheduled right now")} · ${tr("Next")} ${formatMinutes(nextScene.start)} ${nameOf(nextScene.schedule)}`
      : tr("Nothing scheduled right now");
  const status = nowScene ? (
    <>
      <span className="ss-dot" aria-hidden />{tr("Now")}: {nm(nowScene)}
      {nextScene ? <> · {tr("Next")} <bdi>{formatMinutes(nextScene.start)}</bdi> {nm(nextScene)}</> : null}
    </>
  ) : nextScene ? (
    <>{tr("Nothing scheduled right now")} · {tr("Next")} <bdi>{formatMinutes(nextScene.start)}</bdi> {nm(nextScene)}</>
  ) : (
    tr("Nothing scheduled right now")
  );
  const addNow = () => {
    const m = Math.min(snapMinutes(Math.max(nowMin + 15, FIRST_H * 60 + 60)), 22 * 60);
    setEditor({ kind: "new", day: view === "day" ? focusDay : clock.getDay(), min: m, rect: { x: window.innerWidth / 2 - 40, y: 150, w: 0, h: 0 } });
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
    <div className="ss" data-panel={panelOpen ? "open" : "closed"}>
      <div className="ss-main">
        <header className="ss-top">
          <div className="ss-titles">
            <h1 className="ss-title">{T.schedules ?? tr("Schedule")}</h1>
            <p className="ss-status" title={statusText}>{engineEnabled ? status : tr("Auto-play is off — nothing starts by itself")}</p>
          </div>
          <div className="ss-top-actions">
            <button type="button" role="switch" aria-checked={engineEnabled} className="ss-switch" data-on={engineEnabled} onClick={() => setEngineEnabled(!engineEnabled)} title={T.scheduleEngineHint}>
              <span className="ss-switch-label">{tr("Auto-play")}</span>
              <span className="ss-switch-track"><span className="ss-switch-knob" /></span>
            </button>
            <button type="button" className="ss-btn" onClick={addNow}>
              <span aria-hidden className="ss-plus">+</span> {tr("Add music")}
            </button>
            <button type="button" className="ss-iconbtn ss-panel-toggle" onClick={togglePanel} aria-pressed={panelOpen} title={panelOpen ? tr("Close the music list") : tr("Open the music list")} aria-label={panelOpen ? tr("Close the music list") : tr("Open the music list")}>
              <span className="ss-chev" aria-hidden />
            </button>
          </div>
        </header>

        <div className="ss-toolbar">
          <div className="ss-nav">
            <button type="button" className="ss-iconbtn ss-iconbtn--sm" onClick={() => shiftFocus(view === "day" ? -1 : -7)} aria-label={view === "day" ? tr("Previous day") : tr("Previous week")} title={view === "day" ? tr("Previous day") : tr("Previous week")}><span className="ss-arrow ss-arrow--prev" aria-hidden /></button>
            <button type="button" className="ss-iconbtn ss-iconbtn--sm" onClick={() => shiftFocus(view === "day" ? 1 : 7)} aria-label={view === "day" ? tr("Next day") : tr("Next week")} title={view === "day" ? tr("Next day") : tr("Next week")}><span className="ss-arrow ss-arrow--next" aria-hidden /></button>
            <button type="button" className="ss-pill" onClick={() => setFocus(null)} disabled={focus === null || isTodayInView}>{tr("Today")}</button>
            <span className="ss-range" aria-live="polite">{rangeLabel}</span>
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
            <div className="ss-seg ss-seg--view" role="tablist" aria-label={tr("View")}>
              <button type="button" role="tab" aria-selected={view === "day"} className={view === "day" ? "is-on" : ""} onClick={() => chooseView("day")}>{tr("Day")}</button>
              <button type="button" role="tab" aria-selected={view === "week"} className={view === "week" ? "is-on" : ""} onClick={() => chooseView("week")}>{tr("Week")}</button>
            </div>
          </div>
        </div>

        {view === "week" ? (
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
            <div className="ss-scroll" ref={scrollRef}>
              <div className="ss-body" style={{ height: (LAST_H - FIRST_H) * HOUR_H }}>
                <div className="ss-gutter" aria-hidden>
                  {Array.from({ length: LAST_H - FIRST_H }, (_, i) => (
                    <span key={i} className="ss-hour" style={{ top: i * HOUR_H }}>{String(FIRST_H + i).padStart(2, "0")}:00</span>
                  ))}
                </div>
                {WEEK_DAYS.map((d) => (
                  <div
                    key={d}
                    className={`ss-col${weekDates[d] === todayKey ? " is-today" : ""}`}
                    data-day={d}
                    onPointerMove={(e) => trackMove(e, `d${d}`, weekDates[d]!, "v")}
                    onPointerLeave={() => { setHover(null); setHoverDate(null); }}
                    onClick={(e) => trackClick(e, d, "v")}
                    onDragOver={(e) => trackDragOver(e, `d${d}`, "v")}
                    onDragLeave={() => setHover(null)}
                    onDrop={(e) => void trackDrop(e, d, "v")}
                  >
                    {(weekScenes[d] ?? []).map((sc) => renderBlock(sc, "v"))}
                    {hover?.key === `d${d}` ? (
                      <div className="ss-hover" style={{ top: topOf(hover.min) }} aria-hidden><span>{formatMinutes(hover.min)}</span></div>
                    ) : null}
                    {weekDates[d] === todayKey && nowMin >= FIRST_H * 60 ? (
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
            <div className="ss-daychips" role="tablist">
              {WEEK_DAYS.map((d) => (
                <button key={d} type="button" role="tab" aria-selected={weekDates[d] === focusKey} className={`ss-daychip${weekDates[d] === focusKey ? " is-on" : ""}${weekDates[d] === todayKey ? " is-today" : ""}`} onClick={() => setFocus(new Date(`${weekDates[d]}T12:00:00`))}>
                  {dayName(d)}{weekDates[d] === todayKey ? ` · ${tr("Today")}` : ""}
                </button>
              ))}
            </div>
            <div className="ss-dayview" style={{ ["--rows" as string]: dayRows.length }}>
              <div className={`ss-hrow ss-hrow--axis${dayRows.length > 1 ? " has-label" : ""}`} aria-hidden>
                {dayRows.length > 1 ? <span className="ss-hlabel" /> : null}
                <div className="ss-haxis">
                  {Array.from({ length: LAST_H - FIRST_H }, (_, i) => (
                    <span key={i} className="ss-htick" style={{ insetInlineStart: `${pct((FIRST_H + i) * 60)}%` }}>{String(FIRST_H + i).padStart(2, "0")}<span className="ss-htick-min">:00</span></span>
                  ))}
                </div>
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
                      onDrop={(e) => void trackDrop(e, focusDay, "h")}
                    >
                      {row.scenes.map((sc) => renderBlock(sc, "h"))}
                      {hover?.key === `r${row.id}` ? (
                        <div className="ss-hhover" style={{ insetInlineStart: `${pct(hover.min)}%` }} aria-hidden><span>{formatMinutes(hover.min)}</span></div>
                      ) : null}
                      {isTodayInView && nowMin >= FIRST_H * 60 ? (
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
                          className={`ss-ag${live ? " is-live" : ""}${sc.paused ? " is-paused" : ""}`}
                          data-c={colourOf(sc.schedule)}
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setEditor({ kind: "edit", id: sc.schedule.id, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, day: sc.day });
                          }}
                        >
                          <span className="ss-ag-time" dir="ltr">{formatMinutes(sc.start)} – {formatMinutes(Math.min(sc.end, DAY_MINUTES - 1))}</span>
                          {li ? <Cover item={li} /> : <span className="ss-cover ss-cover--ph" aria-hidden>♪</span>}
                          <span className="ss-ag-name"><bdi>{nameOf(sc.schedule)}</bdi></span>
                          {live ? <span className="ss-ag-live">{tr("Now")}</span> : sc.paused ? <span className="ss-ag-live ss-ag-live--dim">{tr("Paused")}</span> : null}
                        </button>
                        <button
                          type="button"
                          className="ss-ag-more"
                          aria-label={tr("More actions")}
                          aria-haspopup="menu"
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setMenu({ id: sc.schedule.id, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, day: sc.day });
                          }}
                        >
                          <i /><i /><i />
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
        <LibraryPanel lib={lib} onAddNext={(it) => { const m = Math.min(snapMinutes(Math.max(nowMin + 15, FIRST_H * 60 + 60)), 22 * 60); const day = view === "day" ? focusDay : clock.getDay(); void create(it, day, m).then((c) => c && setEditor({ kind: "edit", id: c.id, rect: { x: window.innerWidth / 2 - 40, y: 150, w: 0, h: 0 }, day })); }} />
      </aside>

      {menu && items.find((x) => x.id === menu.id) ? (
        <BlockMenu
          key={menu.id}
          menu={menu}
          schedule={items.find((x) => x.id === menu.id)!}
          onClose={() => setMenu(null)}
          onEdit={() => { setEditor({ kind: "edit", id: menu.id, rect: menu.rect, day: menu.day }); setMenu(null); }}
          onPlay={() => { const sc = items.find((x) => x.id === menu.id); setMenu(null); if (sc) void playNow(sc); }}
          onCopy={() => { const sc = items.find((x) => x.id === menu.id); setMenu(null); if (sc) copyBlock(sc); }}
          onNudge={(d) => { const sc = items.find((x) => x.id === menu.id); setMenu(null); if (sc) void update(sc.id, { startTimeLocal: minutesToTimeLocal(Math.min(DAY_MINUTES - 1, Math.max(0, startMinutes(sc) + d))) }); }}
          colour={colourOf(items.find((x) => x.id === menu.id)!)}
          onColour={(i) => { setBlockColor(menu.id, i); setMenu(null); }}
          onMoreColours={() => { setEditor({ kind: "edit", id: menu.id, rect: menu.rect, day: menu.day }); setMenu(null); }}
          onToggle={() => { const sc = items.find((x) => x.id === menu.id); setMenu(null); if (sc) void update(sc.id, { enabled: !sc.enabled }); }}
          onDelete={() => { setDeleteError(null); setDeleteId(menu.id); setMenu(null); }}
        />
      ) : null}

      {editor ? (
        <ScenePopover
          key={editor.kind === "edit" ? editor.id : `new-${editor.day}-${editor.min}`}
          editor={editor}
          schedule={editing}
          lib={editor.kind === "new" && editor.branchId ? lib.filter((l) => l.branchId === editor.branchId) : lib}
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
              const created = await create(item, editor.day, editor.min);
              if (created) setEditor({ kind: "edit", id: created.id, rect: editor.rect, day: editor.day });
              else setEditor(null);
            } else if (editing) {
              void update(editing.id, {
                name: item.name,
                targetType: item.targetType,
                targetId: item.targetId,
                sourceId: item.targetType === "SOURCE" ? item.targetId : undefined,
                branchId: item.branchId,
              });
            }
          }}
          onPatch={(patch) => editing && void update(editing.id, patch)}
          onDelete={() => { if (!editing) return; setDeleteError(null); setDeleteId(editing.id); setEditor(null); }}
          onPlay={() => editing && void playNow(editing)}
          onCopy={() => { if (editing) { copyBlock(editing); setEditor(null); } }}
        />
      ) : null}

      <DeleteConfirmModal
        isOpen={!!deleteId}
        onClose={() => { setDeleteId(null); setDeleteError(null); }}
        onConfirm={confirmDelete}
        loading={deleting}
        message={T.deleteScheduleConfirm}
        errorHint={deleteError}
      />
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
  return item.cover ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="ss-cover" src={item.cover} alt="" draggable={false} loading="lazy" />
  ) : (
    <span className="ss-cover ss-cover--ph" data-c={item.ci} aria-hidden>{item.kind === "radio" ? "◉" : "♪"}</span>
  );
}

function FilterBar({ f, tr }: { f: ReturnType<typeof useFilteredLib>; tr: (s: string, v?: Record<string, string | number>) => string }) {
  return (
    <>
      <label className="ss-search">
        <span aria-hidden className="ss-search-ico" />
        <input value={f.q} onChange={(e) => f.setQ(e.target.value)} placeholder={tr("Search playlists, songs, radio…")} aria-label={tr("Search playlists, songs, radio…")} />
      </label>
      <div className="ss-chips" role="tablist">
        {(["all", "playlist", "song", "radio"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={f.kind === k} className={`ss-chip${f.kind === k ? " is-on" : ""}`} onClick={() => f.setKind(k)}>
            {k === "all" ? tr("All") : k === "playlist" ? tr("Playlists") : k === "song" ? tr("Songs") : tr("Radio")}
          </button>
        ))}
      </div>
    </>
  );
}

function LibraryPanel({ lib, onAddNext }: { lib: LibItem[]; onAddNext: (it: LibItem) => void }) {
  const tr = useTr();
  const f = useFilteredLib(lib);
  return (
    <div className="ss-panel-in">
      <h2 className="ss-panel-title">{tr("Your music")}</h2>
      <FilterBar f={f} tr={tr} />
      <ul className="ss-list">
        {f.shown.map((it) => (
          <li
            key={it.key}
            className="ss-row"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-ss-lib", it.key);
              e.dataTransfer.effectAllowed = "copy";
            }}
          >
            <Cover item={it} />
            <span className="ss-row-text">
              <span className="ss-row-name">{it.name}</span>
              <span className="ss-row-sub">{it.sub}</span>
            </span>
            <button type="button" className="ss-row-add" onClick={() => onAddNext(it)} title={tr("Add music")} aria-label={`${tr("Add music")}: ${it.name}`}>+</button>
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

// ───────────────────────────── the "⋯" menu of a block (also a right-click) ─────────────────────────────

const MENU_W = 224;

function BlockMenu({
  menu, schedule, colour, onColour, onMoreColours, onClose, onEdit, onPlay, onCopy, onNudge, onToggle, onDelete,
}: {
  menu: { id: string; rect: Rect; day: number };
  schedule: Schedule;
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
      {item(T.playNow ?? tr("Play now"), onPlay)}
      {item(tr("Copy"), onCopy, { hint: mac ? "⌘C" : "Ctrl+C" })}
      <hr />
      {item(tr("15 minutes earlier"), () => onNudge(-15))}
      {item(tr("15 minutes later"), () => onNudge(15))}
      {item(schedule.enabled ? tr("Pause") : tr("Resume"), onToggle)}
      <hr />
      <div className="ss-menu-colors" role="group" aria-label={tr("Color")}>
        {Array.from({ length: BLUE_SHADES }, (_, i) => (
          <button key={i} type="button" className={`ss-sw${colour === i ? " is-on" : ""}`} data-c={i} aria-label={`${tr("Color")} ${i + 1}`} aria-pressed={colour === i} onClick={() => onColour(i)} />
        ))}
        <button type="button" className={`ss-sw ss-sw--more${colour >= BLUE_SHADES ? " is-on" : ""}`} data-c={colour >= BLUE_SHADES ? colour : undefined} aria-label={tr("More colors")} title={tr("More colors")} onClick={onMoreColours}><i /><i /><i /></button>
      </div>
      <hr />
      {item(T.delete ?? tr("Delete"), onDelete, { danger: true })}
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
  editor, schedule, lib, libFor, devices, colour, onColour, occurrenceDate, dayName, dateLabel, onClose, onPick, onPatch, onDelete, onPlay, onCopy,
}: {
  editor: Editor;
  schedule: Schedule | null;
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
  const li = schedule ? libFor(schedule) : null;
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
  const stepStart = (delta: number) => onPatch({ startTimeLocal: minutesToTimeLocal(Math.min(DAY_MINUTES - 1, Math.max(0, startMin + delta))) });
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
            {li ? <Cover item={li} /> : <span className="ss-cover ss-cover--ph" data-c={colour} aria-hidden>♪</span>}
            <span className="ss-row-text">
              <span className="ss-row-name">{li?.name ?? schedule.name ?? tr("Schedule")}</span>
              <span className="ss-row-sub">{li?.sub ?? ""}</span>
            </span>
            <button type="button" className="ss-linkbtn" onClick={() => setChoosing(true)}>{tr("Change")}</button>
          </div>

          <div className="ss-field">
            <span className="ss-label">{tr("Starts at")}</span>
            <div className="ss-stepper">
              <button type="button" onClick={() => stepStart(-15)} aria-label="−15">−</button>
              <TimeInput key={formatMinutes(startMin)} minutes={startMin} onCommit={(m) => onPatch({ startTimeLocal: minutesToTimeLocal(m) })} label={tr("Starts at")} />
              <button type="button" onClick={() => stepStart(15)} aria-label="+15">+</button>
            </div>
          </div>

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

          <div className="ss-field">
            <span className="ss-label">{tr("Color")}</span>
            <ColorSwatches value={colour} onPick={onColour} />
          </div>

          {devices.length > 0 ? (
            <div className="ss-field">
              <span className="ss-label">{T.device}</span>
              <select className="ss-select" value={schedule.deviceId ?? ""} onChange={(e) => onPatch({ deviceId: e.target.value || undefined })}>
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
            {autoPlaybackOff ? (
              <button type="button" className="ss-linkbtn" onClick={() => setAutoPlaybackOff(false)} title={tr("This block was switched off on this computer only")}>{tr("Off on this computer — turn on")}</button>
            ) : null}
          </div>

          <div className="ss-pop-actions">
            <button type="button" className="ss-btn ss-btn--ghost" onClick={onPlay}>▶ {T.playNow}</button>
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
