"use client";

/**
 * JingleScheduleDialog — the jingle's own screen (owner 2026-10-18): tap ⋯ on a jingle square and the square opens
 * (grows out of itself) into a glass screen. At the top: the clock, the day and the date. Below: when it works —
 * FIXED (chosen days of the week, every week) or ONE-TIME (a single date) — and Save. Writes into the same jingle
 * schedule storage the background auto-player reads (`schedule-storage.ts`), so it really fires. Styles: `.sb-js-*`.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/locale-context";
import { JINGLE_SCHEDULE_EVENT, loadJingleSchedule, nextFiringMs, persistJingleSchedule } from "./schedule-storage";
import type { JingleBellStyle, MockScheduleItem } from "./types";
import { useTr } from "@/lib/i18n/use-tr";

export type JingleRef = { id: string; label: string; url: string; color: string; bell: string | null };

const DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EXIT_MS = 300;
const INLINE_EXIT_MS = 500;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The stored schedule texts are English ("Sun–Thu · 12:30", "Today 12:30", "Every day") — shown in the interface language (Hebrew: "א׳–ה׳ · 12:30", "היום 12:30"). */
export function localizeWhen(text: string, tr: (s: string) => string): string {
  return text
    .replace(/\b(Today|Tomorrow|Every day|No day|Weekly|Once)\b/g, (m) => tr(m))
    .replace(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g, (m) => tr(m));
}

function daysLabel(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 0) return "No day";
  const sorted = [...days].sort((a, b) => a - b);
  // a run of consecutive days → "Sun–Thu"
  const run = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  if (run && sorted.length >= 3) return `${DAY_NAME[sorted[0]!]}–${DAY_NAME[sorted[sorted.length - 1]!]}`;
  return sorted.map((d) => DAY_NAME[d]).join(" ");
}

/** "Today 12:30" / "Tue 12:30" — when a schedule next fires. */
export function whenNextLabel(item: MockScheduleItem, now = Date.now()): string | null {
  const at = nextFiringMs(item, now);
  if (at === null) return null;
  const d = new Date(at);
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  return `${sameDay ? "Today" : DAY_NAME[d.getDay()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function Unit({ value, max, step, onChange, label }: { value: number; max: number; step: number; onChange: (v: number) => void; label: string }) {
  const tr = useTr();
  const ref = useRef<HTMLDivElement>(null);
  const [dir, setDir] = useState<"up" | "down">("up");
  const bump = (d: 1 | -1, by = step) => {
    setDir(d === 1 ? "up" : "down");
    onChange((((value + d * by) % (max + 1)) + (max + 1)) % (max + 1));
  };
  const bumpRef = useRef(bump);
  useEffect(() => {
    bumpRef.current = bump;
  });
  // the mouse wheel over the digits changes them (up = more, down = less); a native, NON-passive listener so the page behind never scrolls
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let acc = 0;
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
  // press and hold an arrow: one step at once, then it keeps going (a minute is a single step, so 40 minutes away is a short hold, not forty clicks)
  const hold = useRef<{ t?: number; i?: number }>({});
  const stopHold = () => {
    window.clearTimeout(hold.current.t);
    window.clearInterval(hold.current.i);
    hold.current = {};
  };
  useEffect(() => stopHold, []);
  const press = (d: 1 | -1) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stopHold();
    bumpRef.current(d);
    hold.current.t = window.setTimeout(() => {
      hold.current.i = window.setInterval(() => bumpRef.current(d), 70);
    }, 420);
  };
  return (
    <div
      ref={ref}
      className="sb-js-unit"
      role="spinbutton"
      aria-label={tr(label)}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") (e.preventDefault(), bump(1));
        if (e.key === "ArrowDown") (e.preventDefault(), bump(-1));
        if (e.key === "PageUp") (e.preventDefault(), bump(1, step * 5));
        if (e.key === "PageDown") (e.preventDefault(), bump(-1, step * 5));
      }}
    >
      <button type="button" tabIndex={-1} aria-label={`${tr(label)} ${tr("up")}`} onPointerDown={press(1)} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} onClick={(e) => { if (e.detail === 0) bump(1); }}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 10 8 5.5 12.5 10" /></svg>
      </button>
      <span key={value} className="sb-js-num" data-dir={dir}>{pad2(value)}</span>
      <button type="button" tabIndex={-1} aria-label={`${tr(label)} ${tr("down")}`} onPointerDown={press(-1)} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} onClick={(e) => { if (e.detail === 0) bump(-1); }}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 6 8 10.5 12.5 6" /></svg>
      </button>
    </div>
  );
}

export function JingleScheduleDialog({ jingle, origin, nowMs: nowMs0, onClose, inline }: { jingle: JingleRef; origin: { x: number; y: number } | null; nowMs: number; onClose: () => void; inline?: { t: number; r: number; b: number; l: number } }) {
  const tr = useTr();
  const { locale } = useLocale();
  // `now` comes from the click that opened the dialog (render stays pure) and is refreshed while it is open
  const [nowMs, setNowMs] = useState(nowMs0);
  const [mode, setMode] = useState<"fixed" | "once">("fixed");
  // default = the next free 5-minute slot (a slot that is already "now" would be in the past by the time you save)
  const slot0 = new Date(Math.ceil((nowMs0 + 1) / 300000) * 300000);
  const [hour, setHour] = useState(slot0.getHours());
  const [minute, setMinute] = useState(slot0.getMinutes());
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [dateOffset, setDateOffset] = useState(0);
  const [mine, setMine] = useState<MockScheduleItem[]>(() => loadJingleSchedule().filter((x) => x.url === jingle.url));
  const [phase, setPhase] = useState<"open" | "saved" | "closing">("open");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const list = timers.current;
    const refresh = () => setMine(loadJingleSchedule().filter((x) => x.url === jingle.url));
    window.addEventListener(JINGLE_SCHEDULE_EVENT, refresh);
    const tick = window.setInterval(() => setNowMs(Date.now()), 20000);
    return () => {
      window.clearInterval(tick);
      list.forEach((t) => window.clearTimeout(t));
      window.removeEventListener(JINGLE_SCHEDULE_EVENT, refresh);
    };
  }, [jingle.url]);

  const close = () => {
    setPhase("closing");
    // the inline screen shrinks back into its tile (460ms) — it is removed only when that has finished
    timers.current.push(window.setTimeout(onClose, inline ? INLINE_EXIT_MS : EXIT_MS));
  };

  const date = new Date(nowMs);
  date.setDate(date.getDate() + dateOffset);
  const when = new Date(date);
  when.setHours(hour, minute, 0, 0);
  const inPast = mode === "once" && when.getTime() <= nowMs;
  const canSave = mode === "fixed" ? days.length > 0 : !inPast;

  const save = () => {
    if (!canSave || phase !== "open") return;
    const bell = (jingle.bell ?? "ding") as JingleBellStyle;
    const base = { id: `jq-${crypto.randomUUID()}`, label: jingle.label, targetLabel: "Queue", url: jingle.url, preRoll: !!jingle.bell, bellStyle: bell };
    let item: MockScheduleItem;
    if (mode === "fixed") {
      const sorted = [...days].sort((a, b) => a - b);
      const probe: MockScheduleItem = { ...base, whenLabel: "", repeatLabel: "", repeat: "weekdays", days: sorted, timeOfDay: `${pad2(hour)}:${pad2(minute)}` };
      const next = nextFiringMs(probe, nowMs);
      item = { ...probe, whenLabel: `${daysLabel(sorted)} · ${pad2(hour)}:${pad2(minute)}`, repeatLabel: sorted.length === 7 ? "Every day" : "Weekly", scheduledAtIso: next ? new Date(next).toISOString() : undefined };
    } else {
      item = { ...base, whenLabel: `${DAY_NAME[when.getDay()]} ${when.getDate()}/${when.getMonth() + 1} · ${pad2(hour)}:${pad2(minute)}`, repeatLabel: "Once", repeat: "once", scheduledAtIso: when.toISOString() };
    }
    persistJingleSchedule([...loadJingleSchedule(), item]);
    setPhase("saved");
    timers.current.push(window.setTimeout(close, 900));
  };

  const removeOne = (id: string) => persistJingleSchedule(loadJingleSchedule().filter((x) => x.id !== id));
  const dateTitle = dateOffset === 0 ? tr("Today") : dateOffset === 1 ? tr("Tomorrow") : tr(DAY_NAME[date.getDay()]!);
  const dateLine = `${date.toLocaleDateString(locale === "he" ? "he-IL" : undefined, { day: "numeric", month: "long" })}`;
  const dayLetter = (i: number) => { const h = tr(DAY_NAME[i]!); return h === DAY_NAME[i] ? DAY_SHORT[i]! : h.replace(/׳/g, ""); };
  const closing = phase === "closing";

  const panelClass = inline ? `sb-js sb-js--inline${closing ? " is-closing" : ""}` : `sb-wz-panel sb-js${closing ? " is-closing" : ""}`;
  const panelStyle = (inline
    ? { ["--c" as string]: jingle.color, ["--ct" as string]: `${inline.t}px`, ["--cr" as string]: `${inline.r}px`, ["--cb" as string]: `${inline.b}px`, ["--cl" as string]: `${inline.l}px` }
    : { maxWidth: 400, ["--c" as string]: jingle.color, ...(origin ? { transformOrigin: `${origin.x}px ${origin.y}px` } : {}) }) as React.CSSProperties;
  const panel = (
      <div
        className={panelClass}
        data-mode={mode}
        style={panelStyle}
        role="dialog"
        aria-label={`${tr("Schedule")} ${jingle.label}`}
      >
        <header className="sb-js-head">
          <span dir="auto" className="sb-js-title">{jingle.label}</span>
          <button type="button" className="sb-js-x" onClick={close} aria-label={tr("Close")}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </header>

        {/* the top of the screen: hours · day · date */}
        <div className="sb-js-clock">
          <Unit value={hour} max={23} step={1} onChange={setHour} label="Hour" />
          <span className="sb-js-colon">:</span>
          <Unit value={minute} max={59} step={1} onChange={setMinute} label="Minute" />
        </div>
        <div className="sb-js-date">
          {mode === "once" ? (
            <>
              <button type="button" aria-label={tr("Previous day")} disabled={dateOffset <= 0} onClick={() => setDateOffset((n) => Math.max(0, n - 1))}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3.5 5.5 8 10 12.5" /></svg>
              </button>
              <span key={dateOffset} className="sb-js-date-text"><b>{dateTitle}</b> · {dateLine}</span>
              <button type="button" aria-label={tr("Next day")} onClick={() => setDateOffset((n) => n + 1)}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
              </button>
            </>
          ) : (
            <span className="sb-js-date-text"><b>{localizeWhen(daysLabel(days), tr)}</b>{days.length === 7 ? "" : ` · ${tr("every week")}`}</span>
          )}
        </div>

        {/* when it works */}
        <div className="sb-js-seg" role="tablist" data-mode={mode}>
          <span className="sb-js-seg-bar" aria-hidden />
          <button type="button" role="tab" aria-selected={mode === "fixed"} onClick={() => setMode("fixed")}>{tr("Fixed")}</button>
          <button type="button" role="tab" aria-selected={mode === "once"} onClick={() => setMode("once")}>{tr("One-time")}</button>
        </div>
        <div className="sb-js-body" key={mode}>
          {mode === "fixed" ? (
            <div className="sb-js-days" role="group" aria-label={tr("Days of the week")}>
              {DAY_SHORT.map((l, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={days.includes(i)}
                  aria-label={tr(DAY_NAME[i]!)}
                  className={days.includes(i) ? "is-on" : ""}
                  onClick={() => setDays((cur) => (cur.includes(i) ? cur.filter((d) => d !== i) : [...cur, i]))}
                >
                  {dayLetter(i)}
                </button>
              ))}
            </div>
          ) : (
            <div className="sb-js-quick">
              <button type="button" className={dateOffset === 0 ? "is-on" : ""} onClick={() => setDateOffset(0)}>{tr("Today")}</button>
              <button type="button" className={dateOffset === 1 ? "is-on" : ""} onClick={() => setDateOffset(1)}>{tr("Tomorrow")}</button>
              <button type="button" className={dateOffset === 7 ? "is-on" : ""} onClick={() => setDateOffset(7)}>{tr("In a week")}</button>
            </div>
          )}
          {inPast ? <p className="sb-js-warn">{tr("That time has already passed today.")}</p> : null}
        </div>

        {mine.length > 0 ? (
          <ul className="sb-js-list">
            {mine.map((m) => (
              <li key={m.id}>
                <span>{localizeWhen(m.whenLabel, tr)}</span>
                <button type="button" aria-label={tr("Remove schedule")} onClick={() => removeOne(m.id)}>
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <button type="button" className={`sb-js-save${phase === "saved" ? " is-saved" : ""}`} disabled={!canSave || phase !== "open"} onClick={save}>
          {phase === "saved" ? (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-label={tr("Scheduled")}><path className="sb-js-tick" d="M5 12.5l4.5 4.5L19 7.5" pathLength="1" /></svg>
          ) : (
            tr("Schedule")
          )}
        </button>
      </div>
  );
  if (inline) return panel;
  return createPortal(
    <div
      className={`sb-wz-backdrop${closing ? " is-closing" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phase === "open") close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && phase === "open") close();
      }}
    >
      {panel}
    </div>,
    document.body,
  );
}
