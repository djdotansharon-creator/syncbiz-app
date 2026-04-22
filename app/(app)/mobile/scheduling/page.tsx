"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobileSectionHeader } from "@/components/mobile/mobile-section-header";
import { useMobileSources } from "@/lib/mobile-sources-context";
import type { Schedule, ScheduleTargetType } from "@/lib/types";

/**
 * Mobile Scheduling — READ ONLY for this first version.
 *
 * Scope (per product decision):
 *   - list upcoming schedules with time / day / target / status
 *   - show an "Edit on desktop" CTA — all create/update flows stay on desktop
 *
 * We rely on the existing `/api/schedules` GET endpoint. Edit flows are
 * intentionally NOT wired up here; there is no form, no delete, no toggle.
 */
export default function MobileSchedulingPage() {
  const { sources } = useMobileSources();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/schedules", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as Schedule[];
        if (!alive) return;
        setSchedules(Array.isArray(data) ? data : []);
        setStatus("ready");
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Failed to load schedules");
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  const sorted = useMemo(() => {
    const list = schedules ?? [];
    return [...list].sort((a, b) => {
      // Enabled first, then by start time, then alphabetical by name.
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      const ta = a.startTimeLocal || "99:99";
      const tb = b.startTimeLocal || "99:99";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [schedules]);

  const nameForTarget = (s: Schedule): string => {
    const match = sources.find((u) => {
      if (s.targetType === "PLAYLIST") return u.origin === "playlist" && (u.playlist?.id === s.targetId || u.id === s.targetId);
      if (s.targetType === "SOURCE") return u.origin === "source" && (u.source?.id === s.targetId || u.id === s.targetId);
      if (s.targetType === "RADIO") return u.origin === "radio" && u.id === s.targetId;
      return false;
    });
    return match?.title ?? shortenId(s.targetId);
  };

  return (
    <>
      <MobilePageHeader title="Scheduling" showModePill />

      <div className="px-4 py-3 pb-8">
        <div className="mb-4 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100/90">
          Scheduling is read-only on mobile. Open SyncBiz on desktop to add,
          edit or remove a schedule.
        </div>

        {status === "loading" ? (
          <div className="py-10 text-center text-sm text-slate-500">Loading schedules…</div>
        ) : status === "error" ? (
          <div className="py-10 text-center text-sm text-rose-400">{error}</div>
        ) : sorted.length === 0 ? (
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-400">
            <p className="mb-1">No schedules yet.</p>
            <p className="text-xs text-slate-500">Create one from the desktop app.</p>
          </div>
        ) : (
          <section>
            <MobileSectionHeader
              title="Your schedules"
              subtitle={`${sorted.length} item${sorted.length === 1 ? "" : "s"}`}
              action={
                <Link
                  href="/schedules"
                  className="shrink-0 rounded-full border border-slate-700/60 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-slate-500 hover:text-white"
                >
                  Edit on desktop
                </Link>
              }
            />
            <ul className="flex flex-col gap-2">
              {sorted.map((s) => (
                <ScheduleRow key={s.id} schedule={s} targetName={nameForTarget(s)} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function ScheduleRow({ schedule, targetName }: { schedule: Schedule; targetName: string }) {
  const when = describeWhen(schedule);
  const target = describeTarget(schedule.targetType, targetName);
  return (
    <li className="rounded-xl border border-slate-800/70 bg-slate-900/40 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100">
            {schedule.name?.trim() || targetName}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-400">{target}</p>
        </div>
        <StatusPill enabled={schedule.enabled} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-700/60 bg-slate-800/60 px-2 py-0.5">
          <Clock /> {when.time}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-700/60 bg-slate-800/60 px-2 py-0.5">
          <Cal /> {when.days}
        </span>
        {schedule.timezone && (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-700/60 bg-slate-800/60 px-2 py-0.5">
            {schedule.timezone}
          </span>
        )}
      </div>
    </li>
  );
}

function StatusPill({ enabled }: { enabled: boolean }) {
  const cls = enabled
    ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"
    : "border-slate-600/60 bg-slate-800/60 text-slate-400";
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {enabled ? "Active" : "Off"}
    </span>
  );
}

function describeWhen(s: Schedule): { time: string; days: string } {
  const start = s.startTimeLocal || "--:--";
  const end = s.endTimeLocal && s.endTimeLocal !== "23:59" ? s.endTimeLocal : null;
  const time = end ? `${start} – ${end}` : start;
  if (s.recurrence === "one_off") {
    return { time, days: s.oneOffDateLocal ? s.oneOffDateLocal : "One-off" };
  }
  const names = (s.daysOfWeek ?? []).map(dayName).filter(Boolean);
  const days = names.length === 0 ? "—" : names.length === 7 ? "Every day" : names.join(" · ");
  return { time, days };
}

function describeTarget(type: ScheduleTargetType, name: string): string {
  switch (type) {
    case "PLAYLIST":
      return `Playlist · ${name}`;
    case "SOURCE":
      return `Track · ${name}`;
    case "RADIO":
      return `Radio · ${name}`;
    default:
      return name;
  }
}

function dayName(idx: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][idx] ?? "";
}

function shortenId(id: string): string {
  if (!id) return "(unknown)";
  return id.length > 12 ? `${id.slice(0, 10)}…` : id;
}

function Clock() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Cal() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}
