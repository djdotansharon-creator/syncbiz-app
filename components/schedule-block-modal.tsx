"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "@/lib/locale-context";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import type { Playlist } from "@/lib/playlist-types";
import type { Device, Schedule, ScheduleRecurrence, Source } from "@/lib/types";

export type ScheduleModalInitialContext = {
  daypartLabel?: string;
  playlistId?: string;
  playlistName?: string;
};

type RadioRow = { id: string; name: string; branchId?: string | null };

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** Edit existing block */
  initialScheduleId?: string | null;
  /** Prefill from playlist tile (clock) */
  initialContext?: ScheduleModalInitialContext | null;
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

function targetKey(tt: string, id: string) {
  return `${tt}:${id}`;
}

function parseTargetKey(raw: string): { targetType: "SOURCE" | "PLAYLIST" | "RADIO"; targetId: string } | null {
  const [tt, ...rest] = raw.split(":");
  const id = rest.join(":");
  if (!id) return null;
  if (tt === "SOURCE" || tt === "PLAYLIST" || tt === "RADIO") return { targetType: tt, targetId: id };
  return null;
}

/** HTML time → HH:mm:ss for API (branch-aware schedules need valid targets). */
function normalizeTimeLocal(raw: string): string {
  const s = raw.trim();
  if (!s) return "09:00:00";
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return s.length >= 5 ? s.slice(0, 8) : "09:00:00";
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  const sec = m[3] != null ? Math.min(59, Math.max(0, parseInt(m[3], 10))) : 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function resolveScheduleBranchId(
  parsed: { targetType: "SOURCE" | "PLAYLIST" | "RADIO"; targetId: string },
  sources: Source[],
  playlists: Playlist[],
  radios: RadioRow[],
): string {
  if (parsed.targetType === "SOURCE") {
    const src = sources.find((x) => x.id === parsed.targetId);
    return (src?.branchId ?? "default").trim() || "default";
  }
  if (parsed.targetType === "PLAYLIST") {
    const p = playlists.find((x) => x.id === parsed.targetId);
    return resolveMediaBranchId(p ?? {});
  }
  if (parsed.targetType === "RADIO") {
    const r = radios.find((x) => x.id === parsed.targetId);
    return resolveMediaBranchId(r ?? {});
  }
  return "default";
}

type DayLedButtonProps = { label: string; on: boolean; onToggle: () => void };
/** LED-style day pill — shared with full-page schedule form */
export function ScheduleDayLedButton({ label, on, onToggle }: DayLedButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex min-w-[3.25rem] items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 ${
        on
          ? "border-amber-500/50 bg-amber-500/10 text-amber-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
          : "border-slate-800/90 bg-slate-950/50 text-slate-500 hover:border-slate-700 hover:text-slate-400"
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full transition ${
          on
            ? "bg-amber-400 shadow-[0_0_10px_3px_rgba(251,191,36,0.55)]"
            : "bg-slate-700/90 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]"
        }`}
        aria-hidden
      />
      {label}
    </button>
  );
}

export function ScheduleBlockModal({ open, onClose, onSaved, initialScheduleId, initialContext }: Props) {
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
  const [endTime, setEndTime] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, sRes, pRes, rRes] = await Promise.all([
        fetch("/api/devices", { credentials: "include", cache: "no-store" }),
        fetch("/api/sources", { credentials: "include", cache: "no-store" }),
        fetch("/api/playlists", { credentials: "include", cache: "no-store" }),
        fetch("/api/radio", { credentials: "include", cache: "no-store" }),
      ]);
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSaveError(null);
    void loadLists();
  }, [open, loadLists]);

  useEffect(() => {
    if (!open) return;
    if (initialScheduleId) {
      (async () => {
        setLoading(true);
        try {
          const res = await fetch(`/api/schedules/${encodeURIComponent(initialScheduleId)}`, {
            credentials: "include",
            cache: "no-store",
          });
          if (!res.ok) return;
          const sch = (await res.json()) as Schedule;
          setName(sch.name ?? "");
          setDeviceId(sch.deviceId ?? "");
          setRecurrence(sch.recurrence === "one_off" ? "one_off" : "weekly");
          setDays(sch.daysOfWeek?.length ? [...sch.daysOfWeek].sort((a, b) => a - b) : [1, 2, 3, 4, 5]);
          setOneOffDate(sch.oneOffDateLocal ?? "");
          setStartTime(sch.startTimeLocal.length === 5 ? `${sch.startTimeLocal}:00` : sch.startTimeLocal);
          setEndTime(
            sch.endTimeLocal && sch.endTimeLocal !== "23:59"
              ? sch.endTimeLocal.length === 5
                ? `${sch.endTimeLocal}:00`
                : sch.endTimeLocal
              : "",
          );
          setTargetKeyValue(targetKey(sch.targetType, sch.targetId));
        } finally {
          setLoading(false);
        }
      })();
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
    setStartTime("09:00:00");
    setEndTime("");
    if (initialContext?.playlistId) {
      setTargetKeyValue(targetKey("PLAYLIST", initialContext.playlistId));
    } else {
      setTargetKeyValue("");
    }
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    const parsed = parseTargetKey(targetKeyValue);
    if (!parsed) {
      setSaveError("Select a playback target.");
      return;
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
      endTimeLocal: endTime.trim() ? normalizeTimeLocal(endTime) : undefined,
      enabled: true,
      priority: 1,
    };
    setSaving(true);
    try {
      const url = initialScheduleId ? `/api/schedules/${encodeURIComponent(initialScheduleId)}` : "/api/schedules";
      const method = initialScheduleId ? "PATCH" : "POST";
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
              <p className="mt-1 text-xs text-slate-500">{t.newScheduleDescription}</p>
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
                <label htmlFor="sch-target" className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                  {t.schedulePlaybackTarget}
                </label>
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
              </div>

              <div>
                <p className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{t.scheduleRecurrence}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setRecurrence("weekly")}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                      recurrence === "weekly"
                        ? "border-amber-500/50 bg-amber-500/10 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.12)]"
                        : "border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    {t.scheduleWeekly}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecurrence("one_off")}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                      recurrence === "one_off"
                        ? "border-amber-500/50 bg-amber-500/10 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.12)]"
                        : "border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700"
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

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="sch-start" className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                    {t.startTime}
                  </label>
                  <input
                    id="sch-start"
                    type="time"
                    step={1}
                    required
                    value={startTime.length === 5 ? `${startTime}:00` : startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-800/90 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-500/40 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
                <div>
                  <label htmlFor="sch-end" className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                    {t.endTimeOptional}
                  </label>
                  <input
                    id="sch-end"
                    type="time"
                    step={1}
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-800/90 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-500/40 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
              </div>

              {saveError ? (
                <p className="text-sm text-rose-400/95" role="alert">
                  {saveError}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saving || (recurrence === "weekly" && days.length === 0) || !targetKeyValue}
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
