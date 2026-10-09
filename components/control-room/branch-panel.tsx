"use client";

import { useEffect, useRef, useState } from "react";
import type { BranchSummary, RemoteCommand, StationPlaybackState } from "@/lib/remote-control/types";
import { DOT_FILL, type MapDotStatus } from "@/components/control-room/branch-map";

/**
 * CONTROL ROOM — part 2: one branch, full control. Now playing, Previous / Play-Pause / Next, volume and the devices
 * connected to the branch. Every action is the EXISTING remote COMMAND to the branch's designated station through the
 * cloud (owner_global → server authorisation → the station's MAIN). This panel never plays audio and can never become
 * a player / MASTER. No STOP and no raw URL loading (kept out of the demo on purpose).
 */

export type PanelBranch = {
  id: string;
  name: string;
  branchNumber: string | null;
  city: string;
  status: MapDotStatus;
  live: BranchSummary | null;
  state: StationPlaybackState | null;
};

const STATUS_TEXT: Record<MapDotStatus, string> = {
  playing: "Playing",
  idle: "Online · not playing",
  offline: "Offline",
  install: "Needs installation",
  unknown: "—",
};

/** Volume sends: at most one every VOLUME_SEND_MS while dragging, plus the final value. */
const VOLUME_SEND_MS = 200;

export function BranchPanel({
  branch,
  onBack,
  sendCommandTo,
}: {
  branch: PanelBranch;
  onBack: () => void;
  sendCommandTo: (targetBranchId: string, command: RemoteCommand, payload?: { volume?: number }) => boolean;
}) {
  const live = branch.live;
  const state = branch.state;
  const canControl = !!live && (branch.status === "playing" || branch.status === "idle");
  const playing = state?.status === "playing";
  const title = state?.currentTrack?.title || state?.currentSource?.title || "";
  const source = state?.currentSource?.title && state.currentSource.title !== title ? state.currentSource.title : "";
  const cover = state?.currentTrack?.cover || state?.currentSource?.cover || null;

  const send = (command: RemoteCommand, payload?: { volume?: number }) => {
    if (!live) return;
    sendCommandTo(live.branchId, command, payload); // raw branch id — the server routes it to the designated station
  };

  // volume: local while dragging, then follows the station again
  const [dragVolume, setDragVolume] = useState<number | null>(null);
  const lastSentAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  const volume = dragVolume ?? (typeof state?.volume === "number" ? state.volume : 0);
  const onVolume = (v: number) => {
    setDragVolume(v);
    const now = Date.now();
    if (pending.current) clearTimeout(pending.current);
    if (now - lastSentAt.current >= VOLUME_SEND_MS) {
      lastSentAt.current = now;
      send("SET_VOLUME", { volume: v });
    }
    pending.current = setTimeout(() => {
      lastSentAt.current = Date.now();
      send("SET_VOLUME", { volume: v });
      setTimeout(() => setDragVolume(null), 1500); // let the station's own value take over after it applied
    }, VOLUME_SEND_MS);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[color:var(--sb-border)] px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--sb-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--sb-text)]"
          aria-label="Back to all branches"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-[var(--sb-text)]">{branch.name}</h2>
          <p className="truncate text-xs text-[var(--sb-text-secondary)]">
            {[branch.branchNumber ? `Branch ${branch.branchNumber}` : "", branch.city].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 text-sm text-[var(--sb-text-secondary)]">
          <span className="h-2 w-2 rounded-full" style={{ background: DOT_FILL[branch.status] }} aria-hidden />
          {STATUS_TEXT[branch.status]}
        </span>
      </div>

      {!canControl ? (
        <div className="px-6 py-10 text-sm text-[var(--sb-text-secondary)]">
          {branch.status === "install"
            ? "No station installed in this branch yet."
            : branch.status === "offline"
              ? "The branch station is offline. Controls return as soon as it reconnects."
              : "Waiting for live status…"}
        </div>
      ) : (
        <>
          <section className="border-b border-[color:var(--sb-border)] px-6 py-5">
            <div className="text-xs text-[var(--sb-text-tertiary)]">Now playing</div>
            <div className="mt-3 flex items-center gap-4">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/[0.06]">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote artwork (station / YouTube covers), any host
                  <img src={cover} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-semibold text-[var(--sb-text)]">{title || "Nothing playing"}</div>
                {source ? <div className="truncate text-xs text-[var(--sb-text-tertiary)]">{source}</div> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <RoundButton label="Previous" onClick={() => send("PREV")}>
                  <path d="M19 20 9 12l10-8v16Z" /><path d="M5 19V5" />
                </RoundButton>
                <RoundButton label={playing ? "Pause" : "Play"} primary onClick={() => send(playing ? "PAUSE" : "PLAY")}>
                  {playing ? <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></> : <path d="M7 4v16l13-8L7 4Z" />}
                </RoundButton>
                <RoundButton label="Next" onClick={() => send("NEXT")}>
                  <path d="m5 4 10 8-10 8V4Z" /><path d="M19 5v14" />
                </RoundButton>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-3">
              <svg className="h-4 w-4 shrink-0 text-[var(--sb-text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" />
              </svg>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => onVolume(Number(e.target.value))}
                className="h-1 w-full cursor-pointer accent-[var(--sb-accent)]"
                aria-label="Branch volume"
              />
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-[var(--sb-text-secondary)]">{volume}</span>
            </div>
          </section>

          <section className="px-6 py-5">
            <div className="text-xs text-[var(--sb-text-tertiary)]">Connected devices</div>
            <ul className="mt-3 space-y-2">
              {(live?.devices ?? []).length === 0 ? (
                <li className="text-sm text-[var(--sb-text-tertiary)]">—</li>
              ) : (
                (live?.devices ?? []).map((d, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 text-[var(--sb-text)]">
                      <DeviceIcon type={d.type} />
                      {DEVICE_LABEL[d.type]}
                    </span>
                    <span className={d.role === "playing" ? "text-[var(--sb-accent)]" : "text-[var(--sb-text-tertiary)]"}>
                      {d.role === "playing" ? "Playing station" : "Control"}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function RoundButton({ label, primary, onClick, children }: { label: string; primary?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-full transition-transform active:scale-95 ${
        primary ? "h-12 w-12 bg-white text-black hover:bg-white/90" : "h-10 w-10 bg-white/[0.08] text-[var(--sb-text)] hover:bg-white/[0.14]"
      }`}
    >
      <svg className={primary ? "h-5 w-5" : "h-4 w-4"} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

type DeviceKind = NonNullable<BranchSummary["devices"]>[number]["type"];
const DEVICE_LABEL: Record<DeviceKind, string> = {
  computer: "Computer",
  streamer: "Streamer",
  browser: "Browser",
  phone_tablet: "Phone / Tablet",
  remote: "Remote control",
  unknown: "Device",
};

function DeviceIcon({ type }: { type: DeviceKind }) {
  const common = { className: "h-4 w-4 shrink-0 text-[var(--sb-text-secondary)]", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (type === "computer") return <svg {...common}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
  if (type === "streamer") return <svg {...common}><rect x="2" y="7" width="20" height="10" rx="2" /><path d="M6 12h.01M10 12h.01" /></svg>;
  if (type === "phone_tablet" || type === "remote") return <svg {...common}><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
}
