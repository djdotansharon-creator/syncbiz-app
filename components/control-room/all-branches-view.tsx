"use client";

import { useEffect, useMemo, useState } from "react";
import { useRemoteOwner } from "@/lib/remote-control/ws-client";
import type { BranchSummary, StationPlaybackState } from "@/lib/remote-control/types";

/**
 * CONTROL ROOM — step 1: all branches in one place (read-only view), built to scale to hundreds of branches.
 *
 * Branch list = the workspace's branches from the database (`GET /api/branches`). Live status = the existing
 * owner_global WebSocket (`useRemoteOwner`): a branch is ONLINE when its station (MASTER) is connected; PLAYING comes
 * from that station's last STATE_UPDATE. Primary per row: name + one status (Playing / Online · not playing / Offline);
 * the song title is a secondary line. This view never sends a playback command and never registers as a player.
 */

type DbBranch = { id: string; name: string; code?: string; city?: string; country?: string; status?: string; locationCode?: string | null };

type Row = {
  id: string;
  name: string;
  /** customer branch number (locationCode) — secondary but clear */
  branchNumber: string | null;
  subtitle: string;
  online: boolean;
  live: BranchSummary | null;
  state: StationPlaybackState | null;
};

type RowStatus = "playing" | "idle" | "offline" | "unknown";

/** Next step (branch control): the per-branch route, keyed by the branch id. Not built yet — the row's chevron will
 *  link here without changing the row structure. */
export function branchControlHref(branchId: string): string {
  return `/owner/control-room/${encodeURIComponent(branchId)}`;
}

/** The connected-station list is only sent on request — ask again so a station that drops shows Offline. */
const LIVE_REFRESH_MS = 10_000;

function rowStatus(row: Row, liveKnown: boolean): RowStatus {
  if (!liveKnown) return "unknown";
  if (!row.online) return "offline";
  return row.state?.status === "playing" ? "playing" : "idle";
}

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

  const rows: Row[] = useMemo(() => {
    // join on the canonical branch id (a station may register with a legacy alias such as "default")
    const liveById = new Map(liveBranches.map((b) => [b.canonicalBranchId || b.branchId, b] as const));
    const out: Row[] = (dbBranches ?? []).map((b) => {
      const live = liveById.get(b.id) ?? null;
      liveById.delete(b.id);
      return {
        id: b.id,
        name: b.name || b.code || "Branch",
        branchNumber: typeof b.locationCode === "string" && b.locationCode.trim() ? b.locationCode.trim() : null,
        subtitle: b.city ?? "",
        online: !!live,
        live,
        state: live ? remoteStateByDeviceId[live.masterDeviceId] ?? null : null,
      };
    });
    // a connected station whose branch is not in the list (legacy id) — still shown, never hidden
    for (const live of liveById.values()) {
      out.push({
        id: live.canonicalBranchId || live.branchId,
        name: live.branchName ?? "Connected station",
        branchNumber: null,
        subtitle: "Not linked to a branch record",
        online: true,
        live,
        state: remoteStateByDeviceId[live.masterDeviceId] ?? null,
      });
    }
    return out;
  }, [dbBranches, liveBranches, remoteStateByDeviceId]);

  const onlineCount = rows.filter((r) => r.online).length;
  const playingCount = rows.filter((r) => rowStatus(r, liveKnown) === "playing").length;

  return (
    <div className="overflow-hidden rounded-2xl border border-[color:var(--sb-border)] bg-[var(--sb-surface)]">
      <header className="flex items-center justify-between gap-4 border-b border-[color:var(--sb-border)] px-6 py-4">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-[var(--sb-text)]">Control Room</h1>
          <p className="text-xs text-[var(--sb-text-tertiary)]">
            {liveKnown ? "Your network, live" : status === "connecting" ? "Connecting to live status…" : "Live status unavailable — reconnecting…"}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 border-b border-[color:var(--sb-border)]">
        <Stat value={dbBranches ? rows.length : "—"} label="Branches" />
        <Stat value={liveKnown ? onlineCount : "—"} label="Online" dot="bg-emerald-400" />
        <Stat value={liveKnown ? playingCount : "—"} label="Playing" dot="bg-[var(--sb-accent)]" last />
      </div>

      {loadError ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">Could not load branches. Refresh the page to try again.</p>
      ) : dbBranches === null ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">Loading branches…</p>
      ) : rows.length === 0 ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">No branches yet.</p>
      ) : (
        <ul className="divide-y divide-[color:var(--sb-border)]">
          {rows.map((r) => (
            <BranchRow key={r.id} row={r} status={rowStatus(r, liveKnown)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ value, label, dot, last }: { value: number | string; label: string; dot?: string; last?: boolean }) {
  return (
    <div className={`px-6 py-5 ${last ? "" : "border-r border-[color:var(--sb-border)]"}`}>
      <div className="text-4xl font-bold leading-none tracking-tight tabular-nums text-[var(--sb-text)]">{value}</div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--sb-text-secondary)]">
        {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden /> : null}
        {label}
      </div>
    </div>
  );
}

const STATUS_UI: Record<RowStatus, { label: string; dot: string; text: string }> = {
  playing: { label: "Playing", dot: "bg-[var(--sb-accent)]", text: "text-[var(--sb-text)]" },
  idle: { label: "Online · not playing", dot: "bg-emerald-400", text: "text-[var(--sb-text-secondary)]" },
  offline: { label: "Offline", dot: "bg-[var(--sb-text-tertiary)]", text: "text-[var(--sb-text-tertiary)]" },
  unknown: { label: "—", dot: "bg-white/20", text: "text-[var(--sb-text-tertiary)]" },
};

function BranchRow({ row, status }: { row: Row; status: RowStatus }) {
  const ui = STATUS_UI[status];
  // secondary only: what plays, one muted line (no artwork — light at hundreds of branches)
  const nowPlaying = status === "playing" ? row.state?.currentTrack?.title || row.state?.currentSource?.title || "" : "";
  return (
    <li data-branch-id={row.id} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.3fr)_16px] items-center gap-4 px-6 py-3.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-[var(--sb-text)]">{row.name}</div>
        {row.branchNumber || row.subtitle ? (
          <div className="truncate text-xs text-[var(--sb-text-secondary)]">
            {row.branchNumber ? <span className="font-medium tabular-nums">Branch {row.branchNumber}</span> : null}
            {row.branchNumber && row.subtitle ? <span className="text-[var(--sb-text-tertiary)]"> · </span> : null}
            {row.subtitle ? <span className="text-[var(--sb-text-tertiary)]">{row.subtitle}</span> : null}
          </div>
        ) : null}
      </div>
      <div className={`flex min-w-0 items-center gap-2 text-sm ${ui.text}`}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${ui.dot}`} aria-hidden />
        <span className="truncate">{ui.label}</span>
      </div>
      <DeviceType type={row.online ? row.live?.deviceType : undefined} />
      <div className="min-w-0 truncate text-sm text-[var(--sb-text-tertiary)]" title={nowPlaying || undefined}>
        {nowPlaying || "—"}
      </div>
      {/* next step: opens full control of this branch (branchControlHref(row.id)) — not active yet */}
      <svg className="h-4 w-4 text-[var(--sb-text-tertiary)] opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m9 18 6-6-6-6" />
      </svg>
    </li>
  );
}

const DEVICE_LABEL: Record<"computer" | "streamer" | "browser", string> = { computer: "Computer", streamer: "Streamer", browser: "Browser" };

/** The kind of device playing in the branch (info only; shown while the station is online). */
function DeviceType({ type }: { type?: "computer" | "streamer" | "browser" | "unknown" }) {
  if (!type || type === "unknown") return <span className="text-sm text-[var(--sb-text-tertiary)]">—</span>;
  const common = { className: "h-4 w-4 shrink-0", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--sb-text-secondary)]">
      {type === "computer" ? (
        <svg {...common}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
      ) : type === "streamer" ? (
        <svg {...common}><rect x="2" y="7" width="20" height="10" rx="2" /><path d="M6 12h.01M10 12h.01" /></svg>
      ) : (
        <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
      )}
      <span className="truncate">{DEVICE_LABEL[type]}</span>
    </span>
  );
}
