"use client";

import { useEffect, useMemo, useState } from "react";
import { useRemoteOwner } from "@/lib/remote-control/ws-client";
import type { BranchSummary, StationPlaybackState } from "@/lib/remote-control/types";

/**
 * CONTROL ROOM — step 1: all branches in one place (read-only view).
 *
 * Branch list = the workspace's branches from the database (`GET /api/branches`). Live status = the existing
 * owner_global WebSocket (`useRemoteOwner`): a branch is ONLINE when its station (MASTER) is connected, and its
 * playing state / title / artwork come from that station's last STATE_UPDATE. This view never sends a playback
 * command and never registers as a player — it cannot affect playback.
 */

type DbBranch = { id: string; name: string; code?: string; city?: string; country?: string; status?: string };

type Card = {
  id: string;
  name: string;
  subtitle: string;
  online: boolean;
  live: BranchSummary | null;
  state: StationPlaybackState | null;
};

/** The connected-station list is only sent on request — ask again so a station that drops shows Offline. */
const LIVE_REFRESH_MS = 10_000;

export function AllBranchesView() {
  const { branches: liveBranches, remoteStateByDeviceId, status, refreshBranchList } = useRemoteOwner();
  const [dbBranches, setDbBranches] = useState<DbBranch[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/branches", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: unknown) => {
        if (cancelled) return;
        setDbBranches(Array.isArray(rows) ? (rows as DbBranch[]).filter((b) => b && typeof b.id === "string") : []);
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(refreshBranchList, LIVE_REFRESH_MS);
    return () => clearInterval(id);
    // refreshBranchList is a fresh function each render; the interval only needs the latest socket (read inside it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const liveKnown = status === "connected";

  const cards: Card[] = useMemo(() => {
    const liveById = new Map(liveBranches.map((b) => [b.branchId, b] as const));
    const out: Card[] = (dbBranches ?? []).map((b) => {
      const live = liveById.get(b.id) ?? null;
      liveById.delete(b.id);
      return {
        id: b.id,
        name: b.name || b.code || "Branch",
        subtitle: [b.code, b.city].filter(Boolean).join(" · "),
        online: !!live,
        live,
        state: live ? remoteStateByDeviceId[live.masterDeviceId] ?? null : null,
      };
    });
    // a connected station whose branch is not in the list (legacy id) — still shown, never hidden
    for (const live of liveById.values()) {
      out.push({
        id: live.branchId,
        name: live.branchName ?? "Connected station",
        subtitle: "Not linked to a branch record",
        online: true,
        live,
        state: remoteStateByDeviceId[live.masterDeviceId] ?? null,
      });
    }
    return out;
  }, [dbBranches, liveBranches, remoteStateByDeviceId]);

  const onlineCount = cards.filter((c) => c.online).length;
  const playingCount = cards.filter((c) => c.state?.status === "playing").length;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--sb-text)]">Control Room</h1>
          <p className="mt-1 text-sm text-[var(--sb-text-secondary)]">All your branches, live.</p>
        </div>
        <div className="flex items-center gap-2">
          <SummaryPill label="Branches" value={dbBranches ? cards.length : "—"} />
          <SummaryPill label="Online" value={liveKnown ? onlineCount : "—"} tone="online" />
          <SummaryPill label="Playing" value={liveKnown ? playingCount : "—"} tone="accent" />
        </div>
      </header>

      {!liveKnown ? (
        <p className="text-xs text-[var(--sb-text-tertiary)]">
          {status === "connecting" ? "Connecting to live status…" : "Live status unavailable — reconnecting…"}
        </p>
      ) : null}

      {loadError ? (
        <p className="text-sm text-[var(--sb-text-secondary)]">Could not load branches. Refresh the page to try again.</p>
      ) : dbBranches === null ? (
        <p className="text-sm text-[var(--sb-text-secondary)]">Loading branches…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <BranchCard key={c.id} card={c} liveKnown={liveKnown} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: number | string; tone?: "online" | "accent" }) {
  const valueColor = tone === "online" ? "text-emerald-400" : tone === "accent" ? "text-[var(--sb-accent)]" : "text-[var(--sb-text)]";
  return (
    <div className="rounded-xl border border-[color:var(--sb-border)] bg-[var(--sb-surface)] px-3.5 py-2 text-center">
      <div className={`text-lg font-semibold leading-none tabular-nums ${valueColor}`}>{value}</div>
      <div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-[var(--sb-text-tertiary)]">{label}</div>
    </div>
  );
}

function playbackLabel(card: Card, liveKnown: boolean): { text: string; tone: "playing" | "paused" | "idle" | "unknown" } {
  if (!liveKnown) return { text: "—", tone: "unknown" };
  if (!card.online) return { text: "Not playing", tone: "idle" };
  const s = card.state?.status;
  if (s === "playing") return { text: "Playing", tone: "playing" };
  if (s === "paused") return { text: "Paused", tone: "paused" };
  if (s === "idle" || s === "stopped") return { text: "Not playing", tone: "idle" };
  return { text: "Waiting for status", tone: "unknown" };
}

function BranchCard({ card, liveKnown }: { card: Card; liveKnown: boolean }) {
  const pb = playbackLabel(card, liveKnown);
  const title = card.state?.currentTrack?.title || card.state?.currentSource?.title || "";
  const cover = card.state?.currentTrack?.cover || card.state?.currentSource?.cover || null;
  const showNowPlaying = liveKnown && card.online && !!title && (pb.tone === "playing" || pb.tone === "paused");
  return (
    <article
      className={`relative overflow-hidden rounded-2xl border bg-[var(--sb-surface)] p-5 transition-colors ${
        pb.tone === "playing" ? "border-[color:var(--sb-accent-border)]" : "border-[color:var(--sb-border)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-[var(--sb-text)]">{card.name}</h2>
          {card.subtitle ? <p className="mt-0.5 truncate text-xs text-[var(--sb-text-tertiary)]">{card.subtitle}</p> : null}
        </div>
        <ConnectionBadge online={card.online} liveKnown={liveKnown} />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/[0.06]">
          {showNowPlaying && cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote artwork (YouTube / station covers), any host
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[var(--sb-text-tertiary)]" aria-hidden>
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <PlaybackBadge text={pb.text} tone={pb.tone} />
          <p className="mt-1.5 truncate text-sm text-[var(--sb-text)]" title={showNowPlaying ? title : undefined}>
            {showNowPlaying ? title : <span className="text-[var(--sb-text-tertiary)]">{card.online || !liveKnown ? "—" : "Station offline"}</span>}
          </p>
        </div>
      </div>
    </article>
  );
}

function ConnectionBadge({ online, liveKnown }: { online: boolean; liveKnown: boolean }) {
  if (!liveKnown) {
    return <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-[var(--sb-text-tertiary)]">—</span>;
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        online ? "bg-emerald-500/15 text-emerald-400" : "bg-white/[0.06] text-[var(--sb-text-secondary)]"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-[var(--sb-text-tertiary)]"}`} aria-hidden />
      {online ? "Online" : "Offline"}
    </span>
  );
}

function PlaybackBadge({ text, tone }: { text: string; tone: "playing" | "paused" | "idle" | "unknown" }) {
  const cls =
    tone === "playing"
      ? "text-[var(--sb-accent)]"
      : tone === "paused"
        ? "text-amber-400"
        : "text-[var(--sb-text-tertiary)]";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${cls}`}>
      {tone === "playing" ? <EqualizerIcon /> : null}
      {text}
    </span>
  );
}

function EqualizerIcon() {
  return (
    <span className="inline-flex h-3 items-end gap-[2px]" aria-hidden>
      <span className="w-[2px] animate-pulse rounded-sm bg-current" style={{ height: "60%" }} />
      <span className="w-[2px] animate-pulse rounded-sm bg-current [animation-delay:150ms]" style={{ height: "100%" }} />
      <span className="w-[2px] animate-pulse rounded-sm bg-current [animation-delay:300ms]" style={{ height: "45%" }} />
    </span>
  );
}
