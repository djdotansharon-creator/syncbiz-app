"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getControlBranch, setControlBranch } from "@/lib/control-branch";
import type { BranchSummary, RemoteCommand, StationPlaybackState } from "@/lib/remote-control/types";
import { StatusGlyph, STATUS_KEY, type MapDotStatus } from "@/components/control-room/branch-map";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import { StationActivation } from "@/components/control-room/station-activation";

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
  /** a station is registered to the branch (decides "install" vs "replace" wording; the server decides the purpose) */
  hasStation: boolean;
};

/**
 * BROWSER ONLY (owner 2026-10-13): make THIS browser's player control this branch (CONTROL in the branch room; the
 * branch's designated station stays the MASTER). Label = Station ID ("UNV-030") + name. A full page load follows so
 * every socket re-joins the chosen room. Hidden in the VONO desktop app.
 */
function ControlThisBranchButton({ branch, label }: { branch: PanelBranch; label: string }) {
  const isDesktopApp = useSyncExternalStore(() => () => {}, () => "syncbizDesktop" in window, () => true);
  const current = useSyncExternalStore(() => () => {}, () => getControlBranch()?.branchId ?? "", () => "");
  const target = branch.live?.branchId ?? branch.id;
  if (isDesktopApp) return null;
  const active = current === target || current === branch.id;
  const choose = async () => {
    let prefix = "";
    try {
      const r = await fetch("/api/control-room/network", { cache: "no-store" });
      if (r.ok) prefix = (((await r.json()) as { stationIdPrefix?: string | null }).stationIdPrefix ?? "").trim();
    } catch { /* label without the Station ID */ }
    const stationId = prefix && branch.branchNumber ? `${prefix}-${branch.branchNumber}` : branch.branchNumber ?? "";
    setControlBranch({ branchId: target, label: [stationId, branch.name].filter(Boolean).join(" · ") });
    window.location.assign("/sources");
  };
  return (
    <button
      type="button"
      onClick={() => void choose()}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${active ? "border-[color:var(--sb-accent)] text-[var(--sb-text)]" : "border-[color:var(--sb-border)] text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)]"}`}
    >
      {label}
    </button>
  );
}

/** Volume sends: at most one every VOLUME_SEND_MS while dragging, plus the final value. */
const VOLUME_SEND_MS = 200;

export function BranchPanel({
  branch,
  onBack,
  onEdit,
  sendCommandTo,
}: {
  branch: PanelBranch;
  onBack: () => void;
  /** owner: edit the branch (name, number, address) */
  onEdit?: () => void;
  sendCommandTo: (targetBranchId: string, command: RemoteCommand, payload?: { volume?: number }) => boolean;
}) {
  const L = useMgmt();
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
          aria-label={L.t("common.backToBranches")}
        >
          <svg className="h-4 w-4 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-[var(--sb-text)]" dir="auto">{branch.name}</h2>
          <p className="truncate text-xs text-[var(--sb-text-secondary)]">
            {[branch.branchNumber ? L.t("common.branchNumber", { n: branch.branchNumber }) : "", branch.city].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 text-sm text-[var(--sb-text-secondary)]">
          <StatusGlyph status={branch.status} />
          {L.t(STATUS_KEY[branch.status])}
        </span>
        <ControlThisBranchButton branch={branch} label={L.t("ctl.controlThis")} />
        {onEdit ? (
          <button type="button" onClick={onEdit} className="shrink-0 rounded-full border border-[color:var(--sb-border)] px-3 py-1 text-xs text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)]">
            {L.t("common.edit")}
          </button>
        ) : null}
      </div>

      {!canControl ? (
        <div className="px-6 py-10 text-sm text-[var(--sb-text-secondary)]">
          {branch.status === "install"
            ? L.t("panel.noStation")
            : branch.status === "offline"
              ? L.t("panel.offline")
              : L.t("panel.waiting")}
        </div>
      ) : (
        <>
          <section className="border-b border-[color:var(--sb-border)] px-6 py-5">
            <div className="text-xs text-[var(--sb-text-tertiary)]">{L.t("panel.nowPlaying")}</div>
            <div className="mt-3 flex items-center gap-4">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/[0.06]">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote artwork (station / YouTube covers), any host
                  <img src={cover} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-semibold text-[var(--sb-text)]">{title || L.t("panel.nothing")}</div>
                {source ? <div className="truncate text-xs text-[var(--sb-text-tertiary)]">{source}</div> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2" dir="ltr">
                <RoundButton label={L.t("panel.prev")} onClick={() => send("PREV")}>
                  <path d="M19 20 9 12l10-8v16Z" /><path d="M5 19V5" />
                </RoundButton>
                <RoundButton label={L.t(playing ? "panel.pause" : "panel.play")} primary onClick={() => send(playing ? "PAUSE" : "PLAY")}>
                  {playing ? <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></> : <path d="M7 4v16l13-8L7 4Z" />}
                </RoundButton>
                <RoundButton label={L.t("panel.next")} onClick={() => send("NEXT")}>
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
                dir="ltr"
                aria-label={L.t("panel.volume")}
              />
              <span className="w-8 shrink-0 text-end text-xs tabular-nums text-[var(--sb-text-secondary)]">{volume}</span>
            </div>
          </section>

          <section className="px-6 py-5">
            <div className="text-xs text-[var(--sb-text-tertiary)]">{L.t("panel.devices")}</div>
            <ul className="mt-3 space-y-2">
              {(live?.devices ?? []).length === 0 ? (
                <li className="text-sm text-[var(--sb-text-tertiary)]">{L.t("panel.none")}</li>
              ) : (
                (live?.devices ?? []).map((d, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 text-[var(--sb-text)]">
                      <DeviceIcon type={d.type} />
                      {L.t(`device.${d.type}`)}
                    </span>
                    <span className={d.role === "playing" ? "text-[var(--sb-accent)]" : "text-[var(--sb-text-tertiary)]"}>
                      {L.t(d.role === "playing" ? "panel.playingStation" : "panel.control")}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>
        </>
      )}

      <StationActivation branchId={branch.id} hasMainStation={branch.hasStation} />
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

function DeviceIcon({ type }: { type: DeviceKind }) {
  const common = { className: "h-4 w-4 shrink-0 text-[var(--sb-text-secondary)]", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (type === "computer") return <svg {...common}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
  if (type === "streamer") return <svg {...common}><rect x="2" y="7" width="20" height="10" rx="2" /><path d="M6 12h.01M10 12h.01" /></svg>;
  if (type === "phone_tablet" || type === "remote") return <svg {...common}><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
}
