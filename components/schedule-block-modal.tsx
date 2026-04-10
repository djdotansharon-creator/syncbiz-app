"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "@/lib/locale-context";
import { defaultStartTimeForScheduleModalContext } from "@/lib/daypart-schedule-defaults";
import type { Playlist } from "@/lib/playlist-types";
import {
  normalizeScheduleTimeLocal as normalizeTimeLocal,
  parseScheduleTargetKey as parseTargetKey,
  resolveScheduleTargetBranchId as resolveScheduleBranchId,
  scheduleTargetKey as targetKey,
  scheduleTimeToHtmlInputValue,
  type ScheduleTargetRadio,
} from "@/lib/schedule-target-helpers";
import type { Device, Schedule, ScheduleRecurrence, Source } from "@/lib/types";
import { ScheduleTimePresets } from "@/components/schedule-time-presets";

export type ScheduleModalInitialContext = {
  daypartLabel?: string;
  /** e.g. `daypart:morning` — used for preset start time */
  daypartKey?: string;
  playlistId?: string;
  playlistName?: string;
};

type RadioRow = ScheduleTargetRadio;

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** Edit existing block */
  initialScheduleId?: string | null;
  /** Prefill from playlist tile (clock) */
  initialContext?: ScheduleModalInitialContext | null;
  /**
   * Daypart tile clock on Sources: target is the bound scheduled playlist only (readonly).
   * Omit on schedule-card edit — full target picker comes from loaded schedule.
   */
  tileClockScheduleMode?: boolean;
};

function ConsoleSurface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-slate-800/90 bg-[#0b111b]/95 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_48px_rgba(0,0,0,0.45)] ${className}`}
    >
      {children}
    </div>
  );
}

type DayLedButtonProps = { label: string; on: boolean; onToggle: () => void };
/** LED-style day pill — shared with full-page schedule form */
export function ScheduleDayLedButton({ label, on, onToggle }: DayLedButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex min-w-[3.25rem] items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
        on
          ? "border-white/35 bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          : "border-slate-700/80 bg-slate-950/50 text-slate-400 hover:border-slate-600 hover:bg-slate-900/60 hover:text-slate-200"
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full transition ${
          on
            ? "bg-white shadow-[0_0_10px_2px_rgba(255,255,255,0.35)]"
            : "bg-slate-600/90 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]"
        }`}
        aria-hidden
      />
      {label}
    </button>
  );
}

export function ScheduleBlockModal({
  open,
  onClose,
  onSaved,
  initialScheduleId,
  initialContext,
  tileClockScheduleMode = false,
}: Props) {
  const { t } = useTranslations();
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [radios, setRadios] = useState<RadioRow[]>([]);

  const [name, setName] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [targetKeyValue, setTargetKeyValue] = useState("");
  const [recurrence, setRecurrence] = useState<ScheduleRecurrence>("weekly");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [oneOffDate, setOneOffDate] = useState("");
  const [startTime, setStartTime] = useState("09:00:00");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  /** One open cycle: load dropdown data then either hydrate edit or new-block defaults. Avoids a race where list fetch cleared `loading` before the schedule GET finished (empty form / wrong defaults). */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSaveError(null);
    setLoading(true);

    void (async () => {
      try {
        const [dRes, sRes, pRes, rRes] = await Promise.all([
          fetch("/api/devices", { credentials: "include", cache: "no-store" }),
          fetch("/api/sources", { credentials: "include", cache: "no-store" }),
          fetch("/api/playlists", { credentials: "include", cache: "no-store" }),
          fetch("/api/radio", { credentials: "include", cache: "no-store" }),
        ]);
        if (cancelled) return;

        if (dRes.ok) setDevices((await dRes.json()) as Device[]);
        if (sRes.ok) setSources((await sRes.json()) as Source[]);
        if (pRes.ok) setPlaylists((await pRes.json()) as Playlist[]);
        if (rRes.ok) {
          const rj = await rRes.json();
          const arr = Array.isArray(rj) ? rj : [];
          setRadios(
            arr.map((x: { id?: string; name?: string; branchId?: string | null }) => ({
              id: String(x.id ?? ""),
              name: String(x.name ?? x.id ?? ""),
              branchId: x.branchId,
            })),
          );
        }

        if (cancelled) return;

        const editId = (initialScheduleId ?? "").trim();
        if (editId) {
          const res = await fetch(`/api/schedules/${encodeURIComponent(editId)}`, {
            credentials: "include",
            cache: "no-store",
          });
          if (cancelled) return;
          if (!res.ok) {
            const errBody = (await res.json().catch(() => ({}))) as { error?: string };
            setSaveError(errBody.error ?? `Request failed (${res.status})`);
            return;
          }
          const sch = (await res.json()) as Schedule;
          if (cancelled) return;

          setName(sch.name ?? "");
          setDeviceId(sch.deviceId ?? "");
          setRecurrence(sch.recurrence === "one_off" ? "one_off" : "weekly");
          setDays(sch.daysOfWeek?.length ? [...sch.daysOfWeek].sort((a, b) => a - b) : [1, 2, 3, 4, 5]);
          setOneOffDate(sch.oneOffDateLocal ?? "");
          setStartTime(scheduleTimeToHtmlInputValue(sch.startTimeLocal, "09:00:00"));
          const tid = (sch.targetId ?? sch.sourceId ?? "").trim();
          setTargetKeyValue(tid ? targetKey(sch.targetType, tid) : "");
          return;
        }

        setName(
          initialContext?.daypartLabel && initialContext?.playlistName
            ? `${initialContext.daypartLabel} — ${initialContext.playlistName}`
            : initialContext?.daypartLabel
              ? `${initialContext.daypartLabel}`
              : "",
        );
        setDeviceId("");
        setRecurrence("weekly");
        setDays([1, 2, 3, 4, 5]);
        setOneOffDate("");
        setStartTime(
          scheduleTimeToHtmlInputValue(
            defaultStartTimeForScheduleModalContext({
              daypartKey: initialContext?.daypartKey,
              daypartLabel: initialContext?.daypartLabel,
            }),
            "09:00:00",
          ),
        );
        if (initialContext?.playlistId) {
          setTargetKeyValue(targetKey("PLAYLIST", initialContext.playlistId));
        } else {
          setTargetKeyValue("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, initialScheduleId, initialContext]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function toggleDay(d: number) {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  }

  const fixedPlaylistId = (initialContext?.playlistId ?? "").trim();
  const hasFixedPlaylistTarget = tileClockScheduleMode && !!fixedPlaylistId;
  const tileClockNeedsAssignment = tileClockScheduleMode && !fixedPlaylistId;

  const fixedTargetDisplayName = useMemo(() => {
    if (!hasFixedPlaylistTarget) return "";
    const fromContext = (initialContext?.playlistName ?? "").trim();
    if (fromContext) return fromContext;
    const p = playlists.find((x) => x.id === fixedPlaylistId);
    return (p?.name ?? "").trim() || fixedPlaylistId;
  }, [hasFixedPlaylistTarget, initialContext?.playlistName, playlists, fixedPlaylistId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    const parsed = parseTargetKey(targetKeyValue);
    if (!parsed) {
      setSaveError("Select a playback target.");
      return;
    }
    if (hasFixedPlaylistTarget) {
      if (parsed.targetType !== "PLAYLIST" || parsed.targetId !== fixedPlaylistId) {
        setSaveError("Invalid playback target for this tile.");
        return;
      }
    }
    const branchId = resolveScheduleBranchId(parsed, sources, playlists, radios);
    const body: Record<string, unknown> = {
      name: name.trim() || "Schedule",
      branchId,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      sourceId: parsed.targetType === "SOURCE" ? parsed.targetId : undefined,
      deviceId: deviceId || undefined,
      recurrence,
      daysOfWeek: recurrence === "weekly" ? days : [],
      oneOffDateLocal: recurrence === "one_off" ? oneOffDate : undefined,
      startTimeLocal: normalizeTimeLocal(startTime),
      enabled: true,
      priority: 1,
    };
    setSaving(true);
    try {
      const idForSave = (initialScheduleId ?? "").trim();
      const url = idForSave ? `/api/schedules/${encodeURIComponent(idForSave)}` : "/api/schedules";
      const method = idForSave ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onSaved?.();
        onClose();
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      setSaveError(errBody.error ?? `Request failed (${res.status})`);
    } finally {
      setSaving(false);
    }
  }

  if (!mounted || !open) return null;

  const daysOptions = [
    { value: 0, label: t.sun },
    { value: 1, label: t.mon },
    { value: 2, label: t.tue },
    { value: 3, label: t.wed },
    { value: 4, label: t.thu },
    { value: 5, label: t.fri },
    { value: 6, label: t.sat },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button type="button" className="absolute inset-0 bg-transparent" aria-label={t.cancel} onClick={onClose} />
      <div className="relative w-full max-w-lg">
        <ConsoleSurface>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-50">
                {initialScheduleId ? t.scheduleModalTitleEdit : t.scheduleModalTitleNew}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {initialScheduleId
                  ? t.newScheduleDescription
                  : hasFixedPlaylistTarget
                    ? t.scheduleTileClockModalDescription
                    : tileClockNeedsAssignment
                      ? t.scheduleTileNoPlaylistBound
                      : t.newScheduleDescription}
              </p>
            </div>
            <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-400/90 shadow-[0_0_12px_rgba(251,191,36,0.35)]" aria-hidden />
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">{t.saving}</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="sch-name" className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                  {t.scheduleName}
                </label>
                <input
                  id="sch-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-800/90 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-amber-500/40 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              <div>
                <label htmlFor="sch-device" className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                  {t.device}
                </label>
                <select
                  id="sch-device"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-800/90 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-500/40 focus:ring-2 focus:ring-amber-500/20"
                >
                  <option value="">{t.anyCompatibleDevice}</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.platform})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <p className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{t.schedulePlaybackTarget}</p>
                {hasFixedPlaylistTarget ? (
                  <>
                    <div
                      className="mt-1.5 rounded-xl border border-slate-800/90 bg-slate-950/70 px-3 py-2.5"
                      role="group"
                      aria-label={t.schedulePlaybackTarget}
                    >
                      <p className="text-sm font-medium text-slate-100">{fixedTargetDisplayName}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t.scheduleTargetPlaylist}
                        {initialContext?.daypartLabel ? (
                          <>
                            {" "}
                            <span className="text-slate-600">·</span> {initialContext.daypartLabel}
                          </>
                        ) : null}
                      </p>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{t.scheduleTileFixedTargetHint}</p>
                  </>
                ) : tileClockNeedsAssignment ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-200/85">{t.scheduleTileNoPlaylistBound}</p>
                ) : (
                  <>
                    <select
                      id="sch-target"
                      required
                      value={targetKeyValue}
                      onChange={(e) => setTargetKeyValue(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-800/90 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-500/40 focus:ring-2 focus:ring-amber-500/20"
                    >
                      <option value="">{t.selectSource}</option>
                      <optgroup label={t.playbackTargetSource}>
                        {sources.map((s) => (
                          <option key={s.id} value={targetKey("SOURCE", s.id)}>
                            {s.name} ({s.type})
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={t.scheduleTargetPlaylist}>
                        {playlists.map((p) => (
                          <option key={p.id} value={targetKey("PLAYLIST", p.id)}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={t.scheduleTargetRadio}>
                        {radios.map((r) => (
                          <option key={r.id} value={targetKey("RADIO", r.id)}>
                            {r.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </>
                )}
              </div>

              <div>
                <p className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{t.scheduleRecurrence}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setRecurrence("weekly")}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                      recurrence === "weekly"
                        ? "border-white/35 bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                        : "border-slate-700/80 bg-slate-900/50 text-slate-300 hover:border-slate-600 hover:bg-slate-800/50 hover:text-slate-100"
                    }`}
                  >
                    {t.scheduleWeekly}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecurrence("one_off")}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                      recurrence === "one_off"
                        ? "border-white/35 bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                        : "border-slate-700/80 bg-slate-900/50 text-slate-300 hover:border-slate-600 hover:bg-slate-800/50 hover:text-slate-100"
                    }`}
                  >
                    {t.scheduleOneOff}
                  </button>
                </div>
              </div>

              {recurrence === "one_off" ? (
                <div>
                  <label htmlFor="sch-date" className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                    {t.scheduleOneOffDateLabel}
                  </label>
                  <input
                    id="sch-date"
                    type="date"
                    required
                    value={oneOffDate}
                    onChange={(e) => setOneOffDate(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-800/90 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-500/40 focus:ring-2 focus:ring-amber-500/20"
                  />
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{t.scheduleHintOneOff}</p>
                </div>
              ) : (
                <div>
                  <p className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{t.days}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {daysOptions.map(({ value, label }) => (
                      <ScheduleDayLedButton
                        key={value}
                        label={label}
                        on={days.includes(value)}
                        onToggle={() => toggleDay(value)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="sch-start" className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                  {t.startTime}
                </label>
                <ScheduleTimePresets
                  className="mt-1.5 mb-2"
                  value={startTime}
                  onPreset={(hhmmss) => setStartTime(scheduleTimeToHtmlInputValue(hhmmss, "09:00:00"))}
                />
                <input
                  id="sch-start"
                  type="time"
                  step={1}
                  required
                  value={scheduleTimeToHtmlInputValue(startTime, "09:00:00")}
                  onChange={(e) => setStartTime(scheduleTimeToHtmlInputValue(e.target.value, "09:00:00"))}
                  className="mt-0 w-full rounded-xl border border-slate-800/90 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-500/40 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              {saveError ? (
                <p className="text-sm text-rose-400/95" role="alert">
                  {saveError}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="submit"
                  disabled={
                    saving ||
                    (recurrence === "weekly" && days.length === 0) ||
                    !targetKeyValue ||
                    tileClockNeedsAssignment
                  }
                  className="rounded-xl border border-amber-500/45 bg-amber-500/15 px-4 py-2.5 text-sm font-semibold text-amber-100 shadow-[0_0_24px_rgba(245,158,11,0.12)] transition hover:bg-amber-500/25 disabled:opacity-50"
                >
                  {saving ? t.saving : t.saveSchedule}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-700/90 bg-slate-900/40 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800/60"
                >
                  {t.cancel}
                </button>
              </div>
            </form>
          )}
        </ConsoleSurface>
      </div>
    </div>,
    document.body,
  );
}
