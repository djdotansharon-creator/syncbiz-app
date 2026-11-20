"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useLocale } from "@/lib/locale-context";
import { useTr } from "@/lib/i18n/use-tr";
import { buildDayScenes, formatMinutes, nowAndNext, parseTypedTime, weekDatesFor, DAY_MINUTES, type Scene } from "@/lib/schedules-timeline";
import type { Schedule } from "@/lib/types";
import type { UnifiedSource } from "@/lib/source-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { dateKey, parseDateKey, shiftDay } from "@/lib/day-board";
import { isSkippedOn, withSkipDate } from "@/lib/schedule-skip";
import { rememberedTone, sampleHs, type Hs } from "@/lib/cover-tone";
import {
  QUIET_CHOICE,
  EVERY_DAY,
  WEEKDAYS,
  barSegments,
  blockColours,
  blockFields,
  canRemoveOneDay,
  clashingBlock,
  createBody,
  daysTextOf,
  daysWithout,
  fitsBranch,
  formFromSchedule,
  formProblem,
  musicOfSchedule,
  musicOfSource,
  newForm,
  rowState,
  stripDays,
  suggestStart,
  type BlockForm,
  type DaysText,
  type FormProblem,
  type MusicChoice,
  type RowState,
} from "@/lib/mobile-schedule";
import { VmCover, VmEq } from "@/components/vm/vm-parts";
import { useVmUi } from "@/components/vm/vm-ui";
import { playlistSeconds, sourceCover } from "@/components/vm/vm-source-row";
import { IconCalendar, IconCheck, IconChevronBack, IconChevronForward, IconMoon, IconPencil, IconPlus, IconSearch } from "@/components/vm/vm-icons";

/**
 * THE PHONE'S SCHEDULE (owner 2026-11-20: "I must get the song scheduling working on the phone — properly, nicely designed").
 * The day of the OPEN branch: a week strip on top (a press on a day opens it; a dot marks the days that have a plan), the whole day as one thin bar, and under it the blocks in the order they play —
 * each with its picture (the block takes the colour of the music's picture), its start and end, and how often it repeats. The block that plays now is lifted, the next one is marked.
 * A round "+" adds a block; a press on a block changes it, switches it off for this one day, or removes it (from this day only, or from all). The blocks are the Schedules Studio's own (`buildDayScenes`),
 * and everything is saved with the Studio's own routes — so the phone and the computer never disagree about what plays when.
 */

type ReadStatus = "loading" | "ready" | "error";

/** the schedules of one branch (re-read when the app comes back to the front: the plan may have been changed on the computer) */
export function useBranchSchedules(branchId: string | null): { schedules: Schedule[] | null; status: ReadStatus; reload: () => void } {
  const [res, setRes] = useState<{ branch: string | null; schedules: Schedule[] | null; status: ReadStatus }>({ branch: null, schedules: null, status: "loading" });
  const [round, setRound] = useState(0);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  useEffect(() => {
    if (!branchId) return;
    let alive = true;
    const read = () =>
      fetch(`/api/schedules?branchId=${encodeURIComponent(branchId)}`, { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = (await r.json()) as Schedule[];
          if (alive) setRes({ branch: branchId, schedules: Array.isArray(data) ? data : [], status: "ready" });
        })
        .catch(() => {
          if (alive) setRes((s) => (s.branch === branchId && s.status === "ready" ? s : { branch: branchId, schedules: null, status: "error" }));
        });
    void read();
    const onVisible = () => document.visibilityState === "visible" && void read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [branchId, round]);
  return res.branch === branchId ? { schedules: res.schedules, status: res.status, reload } : { schedules: null, status: "loading", reload };
}

/** the colour of a picture, when it can be known (remembered at once, else read) */
function useCoverHs(cover: string | null | undefined): Hs | null {
  const [st, setSt] = useState<{ cover: string | null; hs: Hs | null }>({ cover: null, hs: null });
  useEffect(() => {
    if (!cover) return;
    let alive = true;
    const own = rememberedTone(cover);
    if (own) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the colour remembered on this phone, read once the picture is known
      setSt({ cover, hs: own });
      return;
    }
    void sampleHs(cover).then((hs) => {
      if (alive) setSt({ cover, hs });
    });
    return () => {
      alive = false;
    };
  }, [cover]);
  return cover && st.cover === cover ? st.hs : null;
}

/** one call to the schedule routes: what the server said (its words, or the status) when it did not accept */
async function send(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<{ ok: true; json: unknown } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { ok: true, json } : { ok: false, status: res.status, error: json.error ?? "" };
  } catch {
    return { ok: false, status: 0, error: "" };
  }
}

/** a refusal, in the person's words */
function refusal(r: { status: number; error: string }, tr: (s: string) => string): string {
  if (r.status === 401) return tr("Your session ended. Sign in again.");
  if (r.status === 403) return tr("You don't have permission to change this branch's schedule.");
  if (/different branch/i.test(r.error)) return tr("That music belongs to another branch.");
  if (r.status === 404) return tr("This block was already removed.");
  if (r.status === 0) return tr("No connection. Try again.");
  return tr("Couldn't save the change");
}

/** the short names of the week, Sunday first */
function useDayNames(): { short: string[]; long: string[] } {
  const { locale } = useLocale();
  return useMemo(() => {
    const loc = locale === "he" ? "he-IL" : "en-GB";
    const at = (i: number, weekday: "short" | "narrow" | "long") => new Date(2026, 10, 15 + i).toLocaleDateString(loc, { weekday });
    return { short: [0, 1, 2, 3, 4, 5, 6].map((i) => at(i, locale === "he" ? "narrow" : "short")), long: [0, 1, 2, 3, 4, 5, 6].map((i) => at(i, "long")) };
  }, [locale]);
}

/** how often, in words */
function useDaysWords(): (d: DaysText) => string {
  const tr = useTr();
  const { locale } = useLocale();
  const names = useDayNames();
  return useCallback(
    (d: DaysText) => {
      if (d.kind === "every") return tr("Every day");
      if (d.kind === "weekdays") return tr("Weekdays");
      if (d.kind === "weekend") return tr("Weekends");
      if (d.kind === "once") {
        const dt = d.date ? parseDateKey(d.date) : null;
        return tr("Only {date}", { date: dt ? dt.toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short" }) : "" });
      }
      return d.days.map((x) => names.short[x]).join(" ");
    },
    [tr, locale, names],
  );
}

type Lookup = (s: Schedule) => UnifiedSource | undefined;

/** what a block plays, in a few words: "Playlist · 12 songs", "Song", "Radio", "No music" */
function useKindWords(): (m: MusicChoice, u: UnifiedSource | undefined) => string {
  const tr = useTr();
  return useCallback(
    (m, u) => {
      if (m.targetType === "SILENCE") return tr("No music");
      if (m.targetType === "RADIO") return tr("Radio");
      if (m.targetType === "BANK") return tr("Music bank");
      if (m.targetType === "PLAYLIST") {
        const n = u?.playlist ? getPlaylistTracks(u.playlist).length : 0;
        return n > 1 ? tr("{n} songs", { n }) : tr("Playlist");
      }
      return tr("Song");
    },
    [tr],
  );
}

// ───────────── the pieces of the screen ─────────────

function Segment({ sc, cover, name }: { sc: Scene; cover: string | null; name: string }) {
  const hs = useCoverHs(cover);
  const c = blockColours(hs, sc.schedule.targetId || name);
  const seg = barSegments([sc])[0];
  if (!seg) return null;
  return <i style={{ insetInlineStart: `${seg.left}%`, width: `${seg.width}%`, ["--sa" as string]: c.accent } as CSSProperties} data-quiet={sc.quiet ? "" : undefined} />;
}

function Row({
  sc,
  state,
  name,
  sub,
  cover,
  focus,
  onOpen,
}: {
  sc: Scene;
  state: RowState;
  name: string;
  sub: string;
  cover: string | null;
  focus: boolean;
  onOpen: () => void;
}) {
  const tr = useTr();
  const hs = useCoverHs(cover);
  const c = blockColours(sc.quiet ? null : hs, sc.schedule.targetId || name);
  const hasEnd = sc.end < DAY_MINUTES - 1;
  return (
    <button
      type="button"
      className="vm-sch-row"
      data-state={state}
      data-quiet={sc.quiet ? "" : undefined}
      data-focus={focus ? "" : undefined}
      style={{ ["--sa" as string]: sc.quiet ? "rgba(255,255,255,0.4)" : c.accent, ["--sw" as string]: sc.quiet ? "rgba(255,255,255,0.08)" : c.wash } as CSSProperties}
      onClick={onOpen}
      aria-label={`${name} ${formatMinutes(sc.start)}`}
    >
      <span className="vm-sch-time">
        <b><bdi dir="ltr">{formatMinutes(sc.start)}</bdi></b>
        {hasEnd ? <i><bdi dir="ltr">{formatMinutes(sc.end)}</bdi></i> : null}
      </span>
      <span className="vm-sch-rail" aria-hidden><u /></span>
      {sc.quiet ? (
        <VmCover className="vm-sch-art" size={48} radius={13} name={name} neutral glyph={<IconMoon />} />
      ) : (
        <VmCover className="vm-sch-art" size={48} radius={13} name={name} src={cover} quietTile />
      )}
      <span className="vm-sch-text">
        <span className="vm-sch-name vm-bdi">{name}</span>
        <span className="vm-sch-sub vm-bdi">{sub}</span>
      </span>
      {state === "now" ? (
        <span className="vm-sch-tag" data-live>
          <VmEq />
          {tr("Now")}
        </span>
      ) : state === "next" ? (
        <span className="vm-sch-tag">{tr("Next")}</span>
      ) : state === "off" ? (
        <span className="vm-sch-tag" data-off>{tr("Off")}</span>
      ) : null}
    </button>
  );
}

// ───────────── add / change a block ─────────────

function MusicPicker({ sources, value, onPick, onBack }: { sources: readonly UnifiedSource[]; value: MusicChoice | null; onPick: (m: MusicChoice) => void; onBack: () => void }) {
  const tr = useTr();
  const kind = useKindWords();
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = sources
      .map((u) => ({ u, m: musicOfSource(u) }))
      .filter((x): x is { u: UnifiedSource; m: MusicChoice } => x.m !== null)
      .filter((x) => !needle || x.m.title.toLowerCase().includes(needle));
    // playlists first, then single songs, then radio — the order a business thinks in
    const rank = (m: MusicChoice) => (m.targetType === "PLAYLIST" ? 0 : m.targetType === "SOURCE" ? 1 : 2);
    return all.sort((a, b) => rank(a.m) - rank(b.m)).slice(0, 150);
  }, [sources, q]);
  const isOn = (m: MusicChoice) => !!value && value.targetType === m.targetType && value.targetId === m.targetId;
  return (
    <div className="vm-sch-pick">
      <div className="vm-sch-pick-top">
        <button type="button" className="vm-icobtn" onClick={onBack} aria-label={tr("Back")}>
          <IconChevronBack className="vm-flip" />
        </button>
        <label className="vm-field" style={{ margin: 0, flex: 1 }}>
          <IconSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search your music")} enterKeyHint="search" />
        </label>
      </div>
      <div className="vm-sch-pick-list">
        {!q.trim() ? (
          <button type="button" className="vm-sch-pickrow" data-on={value?.targetType === "SILENCE" ? "" : undefined} onClick={() => onPick({ ...QUIET_CHOICE, title: tr("Quiet") })}>
            <VmCover size={44} radius={12} name={tr("Quiet")} neutral glyph={<IconMoon />} />
            <span className="vm-sch-text">
              <span className="vm-sch-name">{tr("Quiet — no music")}</span>
              <span className="vm-sch-sub">{tr("The music stops when it starts, until the next block.")}</span>
            </span>
            {value?.targetType === "SILENCE" ? <IconCheck className="vm-sch-check" /> : null}
          </button>
        ) : null}
        {rows.map(({ u, m }) => (
          <button type="button" key={`${m.targetType}:${m.targetId}`} className="vm-sch-pickrow" data-on={isOn(m) ? "" : undefined} onClick={() => onPick(m)}>
            <VmCover size={44} radius={12} name={m.title} src={sourceCover(u)} />
            <span className="vm-sch-text">
              <span className="vm-sch-name vm-bdi">{m.title}</span>
              <span className="vm-sch-sub">{kind(m, u)}</span>
            </span>
            {isOn(m) ? <IconCheck className="vm-sch-check" /> : null}
          </button>
        ))}
        {rows.length === 0 && q.trim() ? <p className="vm-sch-none">{tr("Nothing found")}</p> : null}
      </div>
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; text: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="vm-sch-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} data-on={value === o.v ? "" : undefined} onClick={() => onChange(o.v)}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** the form: what plays · from when · until when · on which days — and the one button that saves it */
function BlockEditor({
  init,
  editingId,
  branchId,
  sources,
  schedules,
  weekDates,
  onSaved,
  onCancel,
}: {
  init: BlockForm;
  /** the block being changed (null = a new one) */
  editingId: string | null;
  branchId: string;
  sources: readonly UnifiedSource[];
  schedules: readonly Schedule[];
  weekDates: readonly string[];
  onSaved: (f: BlockForm) => void;
  onCancel: () => void;
}) {
  const tr = useTr();
  const { locale } = useLocale();
  const names = useDayNames();
  const kind = useKindWords();
  const fleet = useMobileFleet();
  const [f, setF] = useState<BlockForm>(init);
  const [step, setStep] = useState<"form" | "pick">(init.music ? "form" : "pick");
  // only music that can play on THIS branch is offered (the server refuses another branch's)
  const pickable = useMemo(() => {
    const known = new Set(fleet.branches.map((b) => b.id));
    return sources.filter((u) => fitsBranch(u, branchId, known));
  }, [sources, fleet.branches, branchId]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const upd = (patch: Partial<BlockForm>) => {
    setProblem(null);
    setRefused(null);
    setF((cur) => {
      const next = { ...cur, ...patch };
      // the end must stay after the start
      if (next.endMode === "at" && !(next.end > next.start)) next.end = Math.min(DAY_MINUTES - 1, next.start + 60);
      return next;
    });
  };
  const toggleDay = (d: number) => upd({ days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort((a, b) => a - b) });
  const sameDays = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x) => b.includes(x));
  const onceDt = parseDateKey(f.onceDate);
  const onceText = onceDt ? onceDt.toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short" }) : f.onceDate;

  const clash = useMemo(() => (f.music ? clashingBlock(f, schedules, editingId, weekDates) : null), [f, schedules, editingId, weekDates]);
  const clashName = clash ? (clash.targetType === "SILENCE" ? clash.name?.trim() || tr("Quiet") : clash.name?.trim() || tr("Playlist")) : "";

  const save = async () => {
    if (busy) return;
    const p = formProblem(f) ?? (clash ? "clash" : null);
    if (p) {
      setProblem(p);
      return;
    }
    setBusy(true);
    setRefused(null);
    const quiet = tr("Quiet");
    const r = editingId
      ? await send("PATCH", `/api/schedules/${encodeURIComponent(editingId)}`, blockFields(f, quiet))
      : await send("POST", "/api/schedules", createBody(f, branchId, quiet));
    setBusy(false);
    if (r.ok) onSaved(f);
    else setRefused(refusal(r, tr));
  };

  if (step === "pick") {
    return (
      <MusicPicker
        sources={pickable}
        value={f.music}
        onBack={() => (f.music ? setStep("form") : onCancel())}
        onPick={(m) => {
          upd({ music: m });
          setStep("form");
        }}
      />
    );
  }

  const m = f.music;
  const u = m && m.targetType !== "SILENCE" ? sources.find((x) => musicOfSource(x)?.targetId === m.targetId && musicOfSource(x)?.targetType === m.targetType) : undefined;
  const problemText: Record<FormProblem, string> = {
    music: tr("Choose what plays."),
    days: tr("Choose at least one day."),
    date: tr("Choose a date."),
    end: tr("The end must be after the start."),
    clash: tr("Another block already starts at {time}: {name}. Pick another time.", { time: formatMinutes(f.start), name: clashName }),
  };
  const shownProblem = problem ?? (clash ? "clash" : null);
  return (
    <div className="vm-ask vm-sch-ed">
      <h2>{editingId ? tr("Change the block") : tr("Add to the schedule")}</h2>

      <button type="button" className="vm-sch-field" onClick={() => setStep("pick")}>
        {m?.targetType === "SILENCE" ? <VmCover size={46} radius={12} name={tr("Quiet")} neutral glyph={<IconMoon />} /> : <VmCover size={46} radius={12} name={m?.title ?? "·"} src={u ? sourceCover(u) : m?.cover} />}
        <span className="vm-sch-text">
          <small>{tr("What plays")}</small>
          <span className="vm-sch-name vm-bdi">{m ? (m.targetType === "SILENCE" ? tr("Quiet — no music") : m.title || tr("Playlist")) : tr("Choose music")}</span>
          {m ? <span className="vm-sch-sub">{kind(m, u)}</span> : null}
        </span>
        <IconChevronForward className="vm-flip vm-sch-chev" />
      </button>

      <div className="vm-sch-group">
        <label className="vm-sch-timebox">
          <small>{tr("Starts")}</small>
          <input
            type="time"
            value={formatMinutes(f.start)}
            onChange={(e) => {
              const v = parseTypedTime(e.target.value);
              if (v !== null) upd({ start: v });
            }}
          />
        </label>
        <div className="vm-sch-endrow">
          <small>{tr("Ends")}</small>
          <Seg
            label={tr("Ends")}
            value={f.endMode}
            onChange={(v) => upd({ endMode: v })}
            options={[
              { v: "next", text: tr("When the next block starts") },
              { v: "at", text: tr("At a time") },
            ]}
          />
          {f.endMode === "at" ? (
            <label className="vm-sch-timebox" data-inline>
              <small>{tr("Stops at")}</small>
              <input
                type="time"
                value={formatMinutes(f.end)}
                onChange={(e) => {
                  const v = parseTypedTime(e.target.value);
                  if (v !== null) upd({ end: v });
                }}
              />
            </label>
          ) : null}
        </div>
      </div>

      <div className="vm-sch-group">
        <small className="vm-sch-gl">{tr("Repeats")}</small>
        <Seg
          label={tr("Repeats")}
          value={f.repeat}
          onChange={(v) => upd({ repeat: v })}
          options={[
            { v: "weekly", text: tr("Every week") },
            { v: "once", text: tr("Only {date}", { date: onceText }) },
          ]}
        />
        {f.repeat === "weekly" ? (
          <>
            <div className="vm-sch-daychips" role="group" aria-label={tr("Days")}>
              {names.short.map((n, d) => (
                <button key={d} type="button" aria-pressed={f.days.includes(d)} data-on={f.days.includes(d) ? "" : undefined} onClick={() => toggleDay(d)} aria-label={names.long[d]}>
                  {n}
                </button>
              ))}
            </div>
            <div className="vm-sch-presets">
              <button type="button" data-on={sameDays(f.days, EVERY_DAY) ? "" : undefined} onClick={() => upd({ days: [...EVERY_DAY] })}>{tr("Every day")}</button>
              <button type="button" data-on={sameDays(f.days, WEEKDAYS) ? "" : undefined} onClick={() => upd({ days: [...WEEKDAYS] })}>{tr("Weekdays")}</button>
            </div>
          </>
        ) : null}
      </div>

      {shownProblem || refused ? <p className="vm-blk-err" role="alert">{refused ?? problemText[shownProblem!]}</p> : null}
      <button type="button" className="vm-ask-btn" data-main disabled={busy} onClick={() => void save()}>
        {busy ? "…" : tr("Save")}
      </button>
      <button type="button" className="vm-ask-btn" onClick={onCancel}>
        {tr("Cancel")}
      </button>
    </div>
  );
}

// ───────────── one block: switch off today · change · remove ─────────────

function BlockSheet({
  scene,
  name,
  music,
  dateStr,
  dateText,
  today,
  schedules,
  weekDates,
  branchId,
  sources,
  onChanged,
}: {
  scene: Scene;
  name: string;
  music: MusicChoice;
  dateStr: string;
  dateText: string;
  today: boolean;
  schedules: readonly Schedule[];
  weekDates: readonly string[];
  branchId: string;
  sources: readonly UnifiedSource[];
  /** something was saved or removed: the plan is read again (and, for a one-time block moved to another day, that day opens) */
  onChanged: (openDate?: string) => void;
}) {
  const tr = useTr();
  const ui = useVmUi();
  const words = useDaysWords();
  const names = useDayNames();
  const sc = scene.schedule;
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const [dates, setDates] = useState<string[]>(sc.skipDates ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const off = isSkippedOn({ skipDates: dates }, dateStr);
  const range = scene.offDay || scene.end >= DAY_MINUTES - 1 ? formatMinutes(scene.start) : `${formatMinutes(scene.start)}–${formatMinutes(scene.end)}`;
  const dow = scene.day;
  const oneDay = canRemoveOneDay(sc, dow);

  const flip = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const r = await send("PATCH", `/api/schedules/${encodeURIComponent(sc.id)}`, { skipDates: withSkipDate(dates, dateStr, !off, dateKey(new Date())) });
    setBusy(false);
    if (r.ok) {
      const saved = r.json as Schedule;
      setDates(Array.isArray(saved.skipDates) ? saved.skipDates : []);
      onChanged();
    } else setErr(refusal(r, tr));
  };

  const remove = async (all: boolean) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const r = all || !oneDay ? await send("DELETE", `/api/schedules/${encodeURIComponent(sc.id)}`) : await send("PATCH", `/api/schedules/${encodeURIComponent(sc.id)}`, { daysOfWeek: daysWithout(sc, dow) });
    setBusy(false);
    if (r.ok) {
      ui.closeSheet();
      ui.toast(tr("Removed"));
      onChanged();
    } else setErr(refusal(r, tr));
  };

  if (mode === "edit") {
    return (
      <BlockEditor
        init={formFromSchedule(sc, music, dateStr)}
        editingId={sc.id}
        branchId={branchId}
        sources={sources}
        schedules={schedules}
        weekDates={weekDates}
        onCancel={() => setMode("view")}
        onSaved={(f) => {
          ui.closeSheet();
          ui.toast(tr("Saved"));
          onChanged(f.repeat === "once" ? f.onceDate : undefined);
        }}
      />
    );
  }

  if (mode === "remove") {
    return (
      <div className="vm-ask">
        <h2 className="vm-bdi">{tr("Remove this block?")}</h2>
        <p className="vm-bdi">{name} · <bdi dir="ltr">{formatMinutes(scene.start)}</bdi></p>
        {oneDay ? (
          <button type="button" className="vm-ask-btn" data-danger disabled={busy} onClick={() => void remove(false)}>
            {tr("Remove from {day} only", { day: names.long[dow] ?? "" })}
          </button>
        ) : null}
        <button type="button" className="vm-ask-btn" data-danger disabled={busy} onClick={() => void remove(true)}>
          {oneDay ? tr("Remove from every day") : tr("Remove the block")}
        </button>
        {err ? <p className="vm-blk-err">{err}</p> : null}
        <button type="button" className="vm-ask-btn" data-main onClick={() => setMode("view")}>
          {tr("Keep it")}
        </button>
      </div>
    );
  }

  return (
    <div className="vm-ask">
      <h2 className="vm-bdi">{name}</h2>
      <p>
        <bdi dir="ltr">{range}</bdi> · {words(daysTextOf(sc))}
      </p>
      <button type="button" className="vm-blk-switch" role="switch" aria-checked={!off} onClick={() => void flip()} disabled={busy}>
        <span className="vm-blk-switch-text">
          {today ? tr("Plays today") : tr("Plays on {date}", { date: dateText })}
          <small>{off ? tr("Off — the block before it plays on until the next one") : tr("On — plays at its time")}</small>
        </span>
        <span className="vm-switch" data-on={off ? undefined : ""} data-busy={busy ? "" : undefined} />
      </button>
      {err ? <p className="vm-blk-err">{err}</p> : null}
      <button type="button" className="vm-ask-btn" onClick={() => setMode("edit")}>
        <IconPencil style={{ marginInlineEnd: 8 }} />
        {tr("Change the block")}
      </button>
      <button type="button" className="vm-ask-btn" data-danger onClick={() => setMode("remove")}>
        {tr("Remove")}
      </button>
      <button type="button" className="vm-ask-btn" data-main onClick={() => ui.closeSheet()}>
        {tr("Done")}
      </button>
    </div>
  );
}

// ───────────── the screen ─────────────

export function VmSchedule({ branchId }: { branchId: string | null }) {
  const tr = useTr();
  const { locale } = useLocale();
  const ui = useVmUi();
  const names = useDayNames();
  const words = useDaysWords();
  const kind = useKindWords();
  const { sources } = useMobileSources();
  const { schedules, status, reload } = useBranchSchedules(branchId);
  const [now, setNow] = useState<Date | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // null = today
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const t0 = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  }, []);

  const todayKey = now ? dateKey(now) : "";
  const day = useMemo(() => (picked ? parseDateKey(picked) : null) ?? now, [picked, now]);
  const dayKeyStr = day ? dateKey(day) : "";
  const isToday = !!day && dayKeyStr === todayKey;
  const weekDates = useMemo(() => (day ? weekDatesFor(day) : []), [day]);
  const loc = locale === "he" ? "he-IL" : "en-GB";

  const lookup: Lookup = useCallback(
    (s: Schedule) =>
      sources.find((u) => {
        if (s.targetType === "PLAYLIST") return u.origin === "playlist" && (u.playlist?.id === s.targetId || u.id === s.targetId);
        if (s.targetType === "SOURCE") return u.origin === "source" && (u.source?.id === s.targetId || u.id === s.targetId);
        if (s.targetType === "RADIO") return u.origin === "radio" && u.id === s.targetId;
        return false;
      }),
    [sources],
  );

  const scenes: Scene[] = useMemo(() => {
    if (!schedules || !day) return [];
    // how long a block's own music lasts: a block with no end of its own is drawn only that long (the same rule as the computer's timeline)
    const musicMinutes = (s: Schedule): number | null => {
      const u = lookup(s);
      const sec = u?.origin === "playlist" ? playlistSeconds(u.playlist) : null;
      return sec && sec > 0 ? Math.max(1, Math.ceil((sec + 20) / 60)) : null;
    };
    // a block switched off for THIS day only stays on the list (dimmed) so it can be switched on again; a block that is paused for every day is not drawn
    return buildDayScenes(schedules, day.getDay(), weekDatesFor(day), musicMinutes).filter((s) => !s.shadowed && (!s.paused || s.offDay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, dayKeyStr, lookup]);

  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : 0;
  const { now: playingNow, next } = useMemo(() => nowAndNext(scenes, nowMin), [scenes, nowMin]);
  const strip = useMemo(() => stripDays(weekDates, todayKey, dayKeyStr, schedules), [weekDates, todayKey, dayKeyStr, schedules]);

  const nameOf = (sc: Scene): string => {
    const own = sc.schedule.name?.trim();
    if (sc.quiet) return own || tr("Quiet");
    return lookup(sc.schedule)?.title || own || tr("Playlist");
  };
  const coverOf = (sc: Scene): string | null => {
    const u = sc.quiet ? undefined : lookup(sc.schedule);
    return u ? sourceCover(u) : null;
  };

  // the list opens where the day is: at the block that plays now / comes next (today), or at the first block
  const focusScene = isToday ? (playingNow ?? next ?? scenes[0]) : scenes[0];
  const ready = status === "ready" && scenes.length > 0;
  useEffect(() => {
    const el = listRef.current;
    if (!el || !ready) return;
    const target = el.querySelector<HTMLElement>("[data-focus]");
    el.scrollTop = target ? Math.max(0, target.offsetTop - 10) : 0;
    // only when the day (or the plan) is opened — not at every tick of the clock
  }, [dayKeyStr, ready]);

  const dayLabel = day ? day.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" }) : "";
  const monthLabel = day ? day.toLocaleDateString(loc, { month: "long", year: "numeric" }) : "";
  const go = (n: number) => {
    if (!day) return;
    const k = dateKey(shiftDay(day, n));
    setPicked(k === todayKey ? null : k);
  };
  const open = (ymd: string) => setPicked(ymd === todayKey ? null : ymd);

  const changed = (openDate?: string) => {
    reload();
    if (openDate) open(openDate);
  };

  const openAdd = () => {
    if (!branchId || !day || !schedules) return;
    const init = newForm({ dateYmd: dayKeyStr, dow: day.getDay(), start: suggestStart({ isToday, nowMin, scenes }) });
    ui.openSheet(
      tr("Add to the schedule"),
      <BlockEditor
        init={init}
        editingId={null}
        branchId={branchId}
        sources={sources}
        schedules={schedules}
        weekDates={weekDates}
        onCancel={() => ui.closeSheet()}
        onSaved={(f) => {
          ui.closeSheet();
          ui.toast(tr("Added to the schedule"));
          changed(f.repeat === "once" ? f.onceDate : undefined);
        }}
      />,
    );
  };

  const openBlock = (sc: Scene) => {
    if (!branchId || !schedules) return;
    ui.openSheet(
      nameOf(sc),
      <BlockSheet
        scene={sc}
        name={nameOf(sc)}
        music={musicOfSchedule(sc.schedule, lookup)}
        dateStr={dayKeyStr}
        dateText={dayLabel}
        today={isToday}
        schedules={schedules}
        weekDates={weekDates}
        branchId={branchId}
        sources={sources}
        onChanged={changed}
      />,
    );
  };

  const summary = !isToday
    ? scenes.length
      ? tr("{n} blocks", { n: scenes.filter((s) => !s.offDay).length })
      : ""
    : playingNow
      ? tr("Now: {name}", { name: nameOf(playingNow) })
      : next
        ? tr("Next at {time}: {name}", { time: formatMinutes(next.start), name: nameOf(next) })
        : scenes.length
          ? tr("Nothing more today")
          : "";

  return (
    <div className="vm-sch">
      <div className="vm-sch-week">
        <div className="vm-sch-weekbar">
          <button type="button" className="vm-icobtn" onClick={() => go(-7)} aria-label={tr("The week before")}>
            <IconChevronBack className="vm-flip" />
          </button>
          <label className="vm-sch-month">
            <IconCalendar />
            <span className="vm-bdi">{monthLabel}</span>
            <input
              type="date"
              value={dayKeyStr}
              aria-label={tr("Choose a date")}
              onChange={(e) => {
                const v = e.target.value;
                if (v && parseDateKey(v)) open(v);
              }}
            />
          </label>
          {!isToday && day ? (
            <button type="button" className="vm-sch-today" onClick={() => setPicked(null)}>
              {tr("Today")}
            </button>
          ) : null}
          <button type="button" className="vm-icobtn" onClick={() => go(7)} aria-label={tr("The week after")}>
            <IconChevronForward className="vm-flip" />
          </button>
        </div>
        <div className="vm-sch-days" role="tablist" aria-label={tr("Days of the week")}>
          {strip.map((d) => (
            <button
              key={d.ymd}
              type="button"
              role="tab"
              aria-selected={d.isSelected}
              data-on={d.isSelected ? "" : undefined}
              data-today={d.isToday ? "" : undefined}
              onClick={() => open(d.ymd)}
              aria-label={`${names.long[d.dow]} ${d.day}`}
            >
              <small>{names.short[d.dow]}</small>
              <b>{d.day}</b>
              <i data-has={d.hasBlocks ? "" : undefined} />
            </button>
          ))}
        </div>
      </div>

      <div className="vm-sch-dayhead">
        <h3 className="vm-bdi">{isToday ? `${tr("Today")} · ${dayLabel}` : dayLabel}</h3>
        {summary ? <span className="vm-bdi">{summary}</span> : null}
      </div>

      {status === "ready" && scenes.length > 0 ? (
        <div className="vm-sch-bar" aria-hidden>
          <div className="vm-sch-bar-track">
            {scenes
              .filter((s) => !s.paused && !s.shadowed)
              .map((s) => (
                <Segment key={`${s.schedule.id}:${s.start}`} sc={s} cover={coverOf(s)} name={nameOf(s)} />
              ))}
            {isToday ? <b className="vm-sch-bar-now" style={{ insetInlineStart: `${(nowMin / DAY_MINUTES) * 100}%` }} /> : null}
          </div>
          <div className="vm-sch-bar-ticks">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="vm-sch-empty" aria-busy>…</div>
      ) : status === "error" ? (
        <div className="vm-sch-empty">
          <span>{tr("Couldn't load the plan")}</span>
          <button type="button" className="vm-pill" onClick={reload}>{tr("Try again")}</button>
        </div>
      ) : scenes.length === 0 ? (
        <div className="vm-sch-empty">
          <IconCalendar />
          <span>{tr("Nothing is planned for this day")}</span>
          {branchId ? (
            <button type="button" className="vm-pill" onClick={openAdd}>
              <IconPlus />
              {tr("Add a block")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="vm-sch-list" ref={listRef}>
          {scenes.map((sc) => {
            const st = rowState(sc, { isToday, nowMin, playing: playingNow, next });
            const m = musicOfSchedule(sc.schedule, lookup);
            const sub = [kind(m, lookup(sc.schedule)), words(daysTextOf(sc.schedule))].join(" · ");
            return <Row key={`${sc.schedule.id}:${sc.start}`} sc={sc} state={st} name={nameOf(sc)} sub={sub} cover={coverOf(sc)} focus={sc === focusScene} onOpen={() => openBlock(sc)} />;
          })}
          <div className="vm-sch-end" aria-hidden />
        </div>
      )}

      {branchId && status === "ready" ? (
        <button type="button" className="vm-sch-fab" onClick={openAdd} aria-label={tr("Add a block")}>
          <IconPlus />
        </button>
      ) : null}
    </div>
  );
}
