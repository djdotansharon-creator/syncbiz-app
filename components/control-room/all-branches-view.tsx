"use client";

import { useEffect, useMemo, useState } from "react";
import { useRemoteOwner } from "@/lib/remote-control/ws-client";
import type { BranchSummary, StationPlaybackState } from "@/lib/remote-control/types";
import { BranchMap, DOT_FILL, type MapDotStatus } from "@/components/control-room/branch-map";
import { BranchPanel } from "@/components/control-room/branch-panel";

/**
 * CONTROL ROOM — all branches in one place: counters, a map of the network and the branch list (read-only view).
 *
 * Branch list = the workspace's branches from the database (`GET /api/branches`, incl. `hasStation`). Live status = the
 * existing owner_global WebSocket (`useRemoteOwner`): ONLINE when the branch's station (MASTER) is connected, PLAYING
 * from its last STATE_UPDATE. A branch with no registered station is "Needs installation" (never "Offline"). This view
 * never sends a playback command and never registers as a player.
 */

type DbBranch = {
  id: string;
  name: string;
  code?: string;
  city?: string;
  country?: string;
  status?: string;
  locationCode?: string | null;
  hasStation?: boolean;
};

type Row = {
  id: string;
  name: string;
  /** customer branch number (locationCode) — secondary but clear */
  branchNumber: string | null;
  city: string;
  hasStation: boolean;
  online: boolean;
  live: BranchSummary | null;
  state: StationPlaybackState | null;
};

type RowStatus = MapDotStatus;

/** The connected-station list is only sent on request — ask again so a station that drops shows Offline. */
const LIVE_REFRESH_MS = 10_000;

function rowStatus(row: Row, liveKnown: boolean): RowStatus {
  if (!row.online && !row.hasStation) return "install"; // no station yet — known from the DB, not from live status
  if (!liveKnown) return "unknown";
  if (!row.online) return "offline";
  return row.state?.status === "playing" ? "playing" : "idle";
}

export function AllBranchesView() {
  const { branches: liveBranches, remoteStateByDeviceId, status, refreshBranchList, sendCommandTo } = useRemoteOwner();
  const [dbBranches, setDbBranches] = useState<DbBranch[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** part 2: the branch whose control panel is open (row / arrow / map dot) */
  const [openId, setOpenId] = useState<string | null>(null);
  const openBranch = (id: string) => { setSelectedId(id); setOpenId(id); };

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
        city: b.city ?? "",
        hasStation: b.hasStation !== false,
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
        city: "",
        hasStation: true,
        online: true,
        live,
        state: remoteStateByDeviceId[live.masterDeviceId] ?? null,
      });
    }
    // live branches first (playing, then online), then offline, then not yet installed — by name inside a group
    const rank: Record<RowStatus, number> = { playing: 0, idle: 1, unknown: 2, offline: 3, install: 4 };
    return out.sort((a, b) => rank[rowStatus(a, liveKnown)] - rank[rowStatus(b, liveKnown)] || a.name.localeCompare(b.name));
  }, [dbBranches, liveBranches, remoteStateByDeviceId, liveKnown]);

  const onlineCount = rows.filter((r) => r.online).length;
  const playingCount = rows.filter((r) => rowStatus(r, liveKnown) === "playing").length;
  const installCount = rows.filter((r) => rowStatus(r, liveKnown) === "install").length;

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

      <div className="grid grid-cols-2 border-b border-[color:var(--sb-border)] md:grid-cols-4">
        <Stat value={dbBranches ? rows.length : "—"} label="Branches" />
        <Stat value={liveKnown ? onlineCount : "—"} label="Online" dot={DOT_FILL.idle} />
        <Stat value={liveKnown ? playingCount : "—"} label="Playing" dot={DOT_FILL.playing} />
        <Stat value={dbBranches ? installCount : "—"} label="Needs installation" dot={DOT_FILL.install} valueColor={installCount > 0 ? "#fbbf24" : undefined} last />
      </div>

      {loadError ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">Could not load branches. Refresh the page to try again.</p>
      ) : dbBranches === null ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">Loading branches…</p>
      ) : rows.length === 0 ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">No branches yet.</p>
      ) : (
        <div className="grid lg:grid-cols-[minmax(240px,2fr)_3fr]">
          <div className="hidden items-center justify-center border-r border-[color:var(--sb-border)] p-6 lg:flex">
            <BranchMap
              branches={rows.map((r) => ({ id: r.id, name: r.name, city: r.city, status: rowStatus(r, liveKnown) }))}
              selectedId={selectedId}
              onSelect={openBranch}
            />
          </div>
          {(() => {
            const open = openId ? rows.find((r) => r.id === openId) : undefined;
            if (open) {
              return (
                <div className="max-h-[640px] overflow-y-auto">
                  <BranchPanel
                    branch={{ id: open.id, name: open.name, branchNumber: open.branchNumber, city: open.city, status: rowStatus(open, liveKnown), live: open.live, state: open.state }}
                    onBack={() => setOpenId(null)}
                    sendCommandTo={sendCommandTo}
                  />
                </div>
              );
            }
            return (
              <ul className="max-h-[640px] divide-y divide-[color:var(--sb-border)] overflow-y-auto">
                {rows.map((r) => (
                  <BranchRow
                    key={r.id}
                    row={r}
                    status={rowStatus(r, liveKnown)}
                    selected={r.id === selectedId}
                    onSelect={() => openBranch(r.id)}
                  />
                ))}
              </ul>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, dot, last, valueColor }: { value: number | string; label: string; dot?: string; last?: boolean; valueColor?: string }) {
  return (
    <div className={`px-6 py-5 ${last ? "" : "border-r border-[color:var(--sb-border)]"}`}>
      <div className="text-4xl font-bold leading-none tracking-tight tabular-nums text-[var(--sb-text)]" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--sb-text-secondary)]">
        {dot ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} aria-hidden /> : null}
        {label}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<RowStatus, { label: string; text: string }> = {
  playing: { label: "Playing", text: "text-[var(--sb-text)]" },
  idle: { label: "Online · not playing", text: "text-[var(--sb-text-secondary)]" },
  offline: { label: "Offline", text: "text-[var(--sb-text-tertiary)]" },
  install: { label: "Needs installation", text: "text-amber-300/90" },
  unknown: { label: "—", text: "text-[var(--sb-text-tertiary)]" },
};

function BranchRow({ row, status, selected, onSelect }: { row: Row; status: RowStatus; selected: boolean; onSelect: () => void }) {
  const ui = STATUS_LABEL[status];
  // secondary only: what plays, one muted line (no artwork — light at hundreds of branches)
  const nowPlaying = status === "playing" ? row.state?.currentTrack?.title || row.state?.currentSource?.title || "" : "";
  return (
    <li
      data-branch-id={row.id}
      onClick={onSelect}
      className={`grid cursor-pointer grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.3fr)_16px] items-center gap-4 px-6 py-3.5 transition-colors ${
        selected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
      }`}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-[var(--sb-text)]">{row.name}</div>
        {row.branchNumber || row.city ? (
          <div className="truncate text-xs text-[var(--sb-text-secondary)]">
            {row.branchNumber ? <span className="font-medium tabular-nums">Branch {row.branchNumber}</span> : null}
            {row.branchNumber && row.city ? <span className="text-[var(--sb-text-tertiary)]"> · </span> : null}
            {row.city ? <span className="text-[var(--sb-text-tertiary)]">{row.city}</span> : null}
          </div>
        ) : null}
      </div>
      <div className={`flex min-w-0 items-center gap-2 text-sm ${ui.text}`}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT_FILL[status] }} aria-hidden />
        <span className="truncate">{ui.label}</span>
      </div>
      <DeviceType type={row.online ? row.live?.deviceType : undefined} />
      <div className="min-w-0 truncate text-sm text-[var(--sb-text-tertiary)]" title={nowPlaying || undefined}>
        {nowPlaying || "—"}
      </div>
      {/* opens the branch control panel (the whole row is clickable) */}
      <svg className="h-4 w-4 text-[var(--sb-text-secondary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
