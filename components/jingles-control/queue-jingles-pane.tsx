"use client";

/**
 * QueueJinglesPane — the "Jingles" tab of the queue panel (owner 2026-10-18): the operator's quick pads and saved
 * jingles as glass SQUARES — FOUR at a time (2×2, paged with dots; round 13: the third row used to be cut off). One tap puts
 * the jingle ON AIR (same routing as the Jingles console); the ⋯ on a square opens its own screen (the square grows into it)
 * to schedule it — fixed days or one-time. The wide "All jingles" button opens the console on its Library (when there are
 * jingles) or on Create (when there are none). Styles: `.sb-jq-*` in globals.css.
 */

import { useEffect, useRef, useState } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import { fetchCloudPads, padsFromCloud } from "./cloud-pads";
import { bellUrl, fireJingleOnAir } from "./fire-on-air";
import { jingleTint } from "./jingle-tint";
import { JingleScheduleDialog, localizeWhen, whenNextLabel, type JingleRef } from "./jingle-schedule-dialog";
import { JINGLE_SCHEDULE_EVENT, loadJingleSchedule } from "./schedule-storage";
import { stationBranchIdNow, useStationBranchId } from "@/lib/station-branch";
import type { MockScheduleItem } from "./types";
import { useTr } from "@/lib/i18n/use-tr";

type Item = JingleRef & { meta: string | null };

const PAD_COLORS: Record<string, string> = {
  default: "#d1d1d6",
  sky: "#5ac8fa",
  violet: "#bf5af2",
  pink: "#ff6bb0",
  amber: "#ffb340",
  rose: "#ff6b81",
  teal: "#40d0c0",
  lime: "#a8e060",
  indigo: "#7d7aff",
};

function durLabel(sec: unknown): string | null {
  return typeof sec === "number" && Number.isFinite(sec) && sec >= 0 ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}` : null;
}

async function loadPads(): Promise<Item[]> {
  try {
    return padsFromCloud(await fetchCloudPads())
      .filter((p) => p.url)
      .map((p) => ({ id: p.id, label: p.label, url: p.url, color: PAD_COLORS[p.color ?? "default"] ?? PAD_COLORS.default!, meta: null, bell: p.preRoll ? (p.bellStyle ?? "ding") : null }));
  } catch {
    return [];
  }
}

async function loadLibrary(): Promise<Item[]> {
  try {
    const res = await fetch("/api/jingles/library", { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Array<{ id: string; title: string; url: string; durationSec?: number | null }> };
    return (data.items ?? [])
      .filter((i) => i.url)
      .slice(0, 12)
      .map((i) => ({ id: `lib-${i.id}`, label: i.title || "Jingle", url: i.url, color: jingleTint(i.id), meta: durLabel(i.durationSec), bell: null }));
  } catch {
    return [];
  }
}

/** the last loaded pads + jingles: re-opening the tab shows them at once (they are refreshed in the background) instead of an empty pane for a second */
let POOL: { pads: Item[]; lib: Item[] } | null = null;

export function QueueJinglesPane({ onOpenConsole }: { onOpenConsole: (tab: "library" | "create") => void }) {
  const tr = useTr();
  const devicePlayer = useDevicePlayer();
  const branch = useStationBranchId() ?? stationBranchIdNow() ?? "default"; // the schedule is kept per branch (main, F4)
  const [pads, setPads] = useState<Item[]>(POOL?.pads ?? []);
  const [lib, setLib] = useState<Item[]>(POOL?.lib ?? []);
  const [loaded, setLoaded] = useState(POOL !== null);
  const [fired, setFired] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [sched, setSched] = useState<MockScheduleItem[]>(() => loadJingleSchedule(stationBranchIdNow() ?? "default"));
  const [editing, setEditing] = useState<{ item: Item; inline: { t: number; r: number; b: number; l: number }; nowMs: number } | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let off = false;
    void Promise.all([loadPads(), loadLibrary()]).then(([p, l]) => {
      POOL = { pads: p, lib: l };
      if (off) return;
      setPads(p);
      setLib(l);
      setLoaded(true);
    });
    const refresh = () => setSched(loadJingleSchedule(branch));
    window.addEventListener(JINGLE_SCHEDULE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      off = true;
      window.removeEventListener(JINGLE_SCHEDULE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [branch]);

  const fire = (it: Item) => {
    const bell = bellUrl(it.bell);
    if (bell) fireJingleOnAir(devicePlayer, bell);
    fireJingleOnAir(devicePlayer, it.url);
    setFired(it.id);
    window.setTimeout(() => setFired((cur) => (cur === it.id ? null : cur)), 900);
  };

  /** the soonest scheduled firing of this jingle, e.g. "Today 12:30" */
  const nextOf = (it: Item): string | null => {
    let best: { at: number; label: string } | null = null;
    for (const s of sched) {
      if (s.url !== it.url) continue;
      const label = whenNextLabel(s);
      if (!label) continue;
      const at = Date.parse(s.scheduledAtIso ?? "") || 0;
      if (!best || (at && at < best.at)) best = { at, label };
    }
    return best?.label ?? null;
  };

  let seq = 0;
  const tile = (it: Item) => {
    const next = nextOf(it);
    return (
      <div
        key={it.id}
        className={`sb-jq-tile${fired === it.id ? " is-fired" : ""}`}
        style={{ ["--c" as string]: it.color, ["--d" as string]: `${Math.min(seq++, 10) * 50}ms` } as React.CSSProperties}
      >
        <button type="button" className="sb-jq-hit" onClick={() => fire(it)} title={`${it.label} — ${tr("on air")}`} aria-label={`${it.label} — ${tr("on air")}`} />
        <span className="sb-jq-glow" aria-hidden />
        {next ? (
          <span className="sb-jq-sched" title={`${tr("Scheduled")} · ${localizeWhen(next, tr)}`}>
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><circle cx="8" cy="8" r="6" /><path d="M8 4.6V8l2.2 1.4" /></svg>
            {localizeWhen(next, tr)}
          </span>
        ) : null}
        <button
          type="button"
          className="sb-jq-more"
          aria-label={`${tr("Schedule")} ${it.label}`}
          title={tr("Schedule")}
          onClick={(e) => {
            // the square itself becomes the schedule screen: it grows from its own rectangle to the whole pane
            const tileEl = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const pane = paneRef.current?.getBoundingClientRect();
            if (!pane) return;
            setEditing({ item: it, inline: { t: tileEl.top - pane.top, r: pane.right - tileEl.right, b: pane.bottom - tileEl.bottom, l: tileEl.left - pane.left }, nowMs: Date.now() });
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" /></svg>
        </button>
        <span className="sb-jq-playmark" aria-hidden>
          <svg className="sb-jq-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 5.5v13l10.5-6.5L8.5 5.5z" /></svg>
          <span className="sb-jq-bars"><i /><i /><i /><i /></span>
        </span>
        <span dir="auto" className="sb-jq-label">{it.label}</span>
        {it.meta ? <span className="sb-jq-meta">{it.meta}</span> : null}
      </div>
    );
  };

  // pads first, then the saved jingles (a jingle that is on a pad is not shown twice)
  const padUrls = new Set(pads.map((p) => p.url));
  const all = [...pads, ...lib.filter((l) => !padUrls.has(l.url))];
  const PER_PAGE = 4;
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = all.slice(cur * PER_PAGE, cur * PER_PAGE + PER_PAGE);
  const empty = loaded && all.length === 0;
  return (
    <div ref={paneRef} className="sb-jq">
      <div className="sb-jq-stage">
        {shown.length > 0 ? (
          <div className="sb-jq-grid" key={cur}>
            {shown.map(tile)}
          </div>
        ) : !loaded ? (
          <div className="sb-jq-grid" aria-hidden>
            {[0, 1, 2, 3].map((i) => <div key={i} className="sb-jq-tile sb-jq-skel" style={{ animationDelay: `${i * 90}ms` }} />)}
          </div>
        ) : null}
        {empty ? (
          <div className="sb-jq-empty">
            <p>{tr("No jingles yet")}</p>
            <button type="button" onClick={() => onOpenConsole("create")}>{tr("Create one")}</button>
          </div>
        ) : null}
      </div>
      {pages > 1 ? (
        <div className="sb-jq-dots" role="tablist" aria-label={tr("Jingle pages")}>
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === cur} aria-label={`${tr("Page")} ${i + 1}`} className={i === cur ? "is-on" : ""} onClick={() => setPage(i)} />
          ))}
        </div>
      ) : null}
      <button type="button" className="sb-jq-open" onClick={() => onOpenConsole(empty ? "create" : "library")}>
        {tr("All jingles")}
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 3.5 10.5 8 6 12.5" /></svg>
      </button>
      {editing ? <JingleScheduleDialog jingle={editing.item} origin={null} inline={editing.inline} nowMs={editing.nowMs} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
