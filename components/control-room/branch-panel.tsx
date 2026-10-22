"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getControlBranch, setControlBranch } from "@/lib/control-branch";
import type { BranchSummary, RemoteCommand, StationPlaybackState } from "@/lib/remote-control/types";
import { StatusLed, STATUS_KEY, type MapDotStatus } from "@/components/control-room/branch-map";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import { Marquee } from "@/components/control-room/marquee";
import { StationActivation } from "@/components/control-room/station-activation";
import { LogoTile } from "@/components/control-room/logo-tile";

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
  /** the branch's own logo, or its brand's (shown beside the name) */
  logoUrl?: string | null;
  /** the branch's brand (name + colour) — shown under the name, and its colour / initial draw the tile when there is no logo */
  brandName?: string | null;
  brandColor?: string | null;
};

/**
 * BROWSER ONLY (owner 2026-10-13): make THIS browser's player control this branch (CONTROL in the branch room; the
 * branch's designated station stays the MASTER). Label = Station ID ("UNV-030") + name. A full page load follows so
 * every socket re-joins the chosen room. Hidden in the VONO desktop app.
 */
function ControlThisBranchButton({ branch, label, onDone }: { branch: PanelBranch; label: string; onDone?: () => void }) {
  const isDesktopApp = useSyncExternalStore(() => () => {}, () => "syncbizDesktop" in window, () => true);
  const current = useSyncExternalStore(() => () => {}, () => getControlBranch()?.branchId ?? "", () => "");
  const target = branch.live?.branchId ?? branch.id;
  if (isDesktopApp) return null;
  const active = current === target || current === branch.id;
  const choose = async () => {
    onDone?.();
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
    <button type="button" role="menuitem" onClick={() => void choose()} aria-pressed={active} className={`cr-pop-opt${active ? " is-on" : ""}`}>
      {label}
    </button>
  );
}

/** the branch screen's one quiet "more" icon: Edit · Control this branch's player (owner 2026-10-21: fewer buttons) */
function BranchMenu({ branch, onEdit, onDelete, L }: { branch: PanelBranch; onEdit?: () => void; onDelete?: () => void; L: ReturnType<typeof useMgmt> }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={rootRef} className="cr-pop">
      <button type="button" className={`cr-bp-icon${open ? " is-on" : ""}`} aria-haspopup="menu" aria-expanded={open} aria-label={L.t("panel.more")} title={L.t("panel.more")} onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden><circle cx="5.5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.5" cy="12" r="1.7" /></svg>
      </button>
      {open ? (
        <div className="cr-pop-menu" role="menu">
          {onEdit ? <button type="button" role="menuitem" className="cr-pop-opt" onClick={() => { setOpen(false); onEdit(); }}>{L.t("common.edit")}</button> : null}
          <ControlThisBranchButton branch={branch} label={L.t("ctl.controlThis")} onDone={() => setOpen(false)} />
          {onDelete ? <button type="button" role="menuitem" className="cr-pop-opt cr-pop-opt--danger" onClick={() => { setOpen(false); onDelete(); }}>{L.t("common.delete")}</button> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Volume sends: at most one every VOLUME_SEND_MS while dragging, plus the final value. */
const VOLUME_SEND_MS = 200;

export function BranchPanel({
  branch,
  onBack,
  onEdit,
  onDelete,
  sendCommandTo,
  children,
}: {
  children?: React.ReactNode;
  branch: PanelBranch;
  onBack: () => void;
  /** owner: edit the branch (name, number, address) */
  onEdit?: () => void;
  /** owner: delete the branch (asks first; refused while a station is installed) */
  onDelete?: () => void;
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

  const color = branch.brandColor ?? "#8e8e93";
  const initial = ((branch.brandName || branch.name).trim().split(/\s+/).pop() ?? "").charAt(0).toUpperCase();
  return (
    <div className="cr-bp">
      <header className="cr-bp-head">
        <button type="button" onClick={onBack} className="cr-bp-icon cr-bp-back" aria-label={L.t("common.backToBranches")} title={L.t("common.backToBranches")}>
          <svg className="h-[18px] w-[18px] rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <LogoTile src={branch.logoUrl} color={color} initial={initial} />
        {/* the name block follows the language of the INTERFACE (like the list rows) and shows the WHOLE text */}
        <div className="cr-bp-name" dir={L.dir}>
          <h2 dir="auto">{branch.name}</h2>
          <p>{[branch.brandName, branch.branchNumber ? L.t("common.branchNumber", { n: branch.branchNumber }) : "", branch.city].filter(Boolean).join(" · ")}</p>
          <span className="cr-bp-status"><StatusLed status={branch.status} />{L.t(STATUS_KEY[branch.status])}</span>
        </div>
        <span className="flex-1" />
        <BranchMenu branch={branch} onEdit={onEdit} onDelete={onDelete} L={L} />
      </header>

      {/* "needs installation" says it in the Station section below — the note is only for offline / waiting */}
      {!canControl && branch.status !== "install" ? (
        <p className="cr-bp-note">{branch.status === "offline" ? L.t("panel.offline") : L.t("panel.waiting")}</p>
      ) : null}

      <div className="cr-bp-grid">
        <div className="cr-bp-col">
          {canControl ? (
            <section className="cr-bp-sec">
              <h3 className="cr-bp-title">{L.t("panel.devices")}</h3>
              <ul className="cr-bp-devs">
                {(live?.devices ?? []).length === 0 ? (
                  <li className="text-sm text-[var(--sb-text-tertiary)]">{L.t("panel.none")}</li>
                ) : (
                  (live?.devices ?? []).map((d, i) => (
                    <li key={i}>
                      <span className="flex items-center gap-2.5 text-[var(--sb-text)]">
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
          ) : null}
          <StationActivation branchId={branch.id} hasMainStation={branch.hasStation} />
        </div>
        <div className="cr-bp-col">{children}</div>
      </div>

      {/* the docked player: song square · title · previous / play-pause / next; rest the pointer on it (or tab to it) and it grows upward with the volume, the timeline and what is next */}
      {canControl ? (
        <NowDock
          L={L}
          title={title}
          source={source}
          cover={cover}
          playing={playing}
          volume={volume}
          onVolume={onVolume}
          position={state?.position ?? 0}
          duration={state?.duration ?? 0}
          positionAt={state?.positionAt ?? 0}
          next={state?.nextSessionTrack?.title ?? state?.playNextQueue?.[0]?.title ?? (state?.queue && typeof state.queueIndex === "number" ? state.queue[state.queueIndex + 1]?.title : "") ?? ""}
          onPrev={() => send("PREV")}
          onToggle={() => send(playing ? "PAUSE" : "PLAY")}
          onNext={() => send("NEXT")}
        />
      ) : null}
    </div>
  );
}

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

function NowDock({ L, title, source, cover, playing, volume, onVolume, position, duration, positionAt, next, onPrev, onToggle, onNext }: {
  L: ReturnType<typeof useMgmt>; title: string; source: string; cover: string | null; playing: boolean; volume: number; onVolume: (v: number) => void;
  position: number; duration: number; positionAt: number; next: string; onPrev: () => void; onToggle: () => void; onNext: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [hot, setHot] = useState(false);
  useEffect(() => {
    if (!playing || !hot) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [playing, hot]);
  const elapsed = Math.min(duration > 0 ? duration : Infinity, Math.max(0, position + (playing && positionAt ? (nowMs - positionAt) / 1000 : 0)));
  const pct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;
  return (
    <div className="cr-dock" onPointerEnter={() => setHot(true)} onPointerLeave={() => setHot(false)} onFocusCapture={() => setHot(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(false); }} data-hot={hot ? "1" : undefined}>
      <div className="cr-dock-more">
        <div className="cr-dock-more-in">
          <div className="cr-dock-line">
            <span className="tabular-nums" dir="ltr">{mmss(elapsed)}</span>
            <span className="cr-dock-track" aria-hidden><i style={{ width: `${pct}%` }} /></span>
            <span className="tabular-nums" dir="ltr">{duration > 0 ? mmss(duration) : "--:--"}</span>
          </div>
          <div className="cr-dock-line">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></svg>
            <input type="range" min={0} max={100} value={volume} onChange={(e) => onVolume(Number(e.target.value))} className="cr-dock-range" dir="ltr" aria-label={L.t("panel.volume")} tabIndex={hot ? 0 : -1} />
            <span className="w-7 shrink-0 text-end text-xs tabular-nums" dir="ltr">{volume}</span>
          </div>
          {next ? (
            <div className="cr-dock-next">
              <span>{L.t("panel.next")}</span>
              <b dir="auto">{next}</b>
            </div>
          ) : null}
        </div>
      </div>
      <div className="cr-dock-main">
        <span className="cr-dock-art">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote artwork (station / YouTube covers), any host
            <img src={cover} alt="" draggable={false} />
          ) : (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
          )}
        </span>
        <span className="cr-dock-text">
          {title ? <Marquee className="cr-dock-title" text={title} /> : <span className="cr-dock-title">{L.t("panel.nothing")}</span>}
          {source ? <span className="cr-dock-sub" dir="auto">{source}</span> : null}
        </span>
        <span className="cr-dock-ctl" dir="ltr">
          <button type="button" onClick={onPrev} aria-label={L.t("panel.prev")} title={L.t("panel.prev")} className="cr-dock-btn"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><path d="M19 20 9 12l10-8v16Z" /><path d="M6 4v16h-2V4z" /></svg></button>
          <button type="button" onClick={onToggle} aria-label={L.t(playing ? "panel.pause" : "panel.play")} title={L.t(playing ? "panel.pause" : "panel.play")} className="cr-dock-btn cr-dock-btn--main">
            {playing ? <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg> : <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden><path d="M8 4.8v14.4a1 1 0 0 0 1.5.86l11.5-7.2a1 1 0 0 0 0-1.72L9.5 3.94A1 1 0 0 0 8 4.8Z" /></svg>}
          </button>
          <button type="button" onClick={onNext} aria-label={L.t("panel.next")} title={L.t("panel.next")} className="cr-dock-btn"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><path d="m5 4 10 8-10 8V4Z" /><path d="M18 4h2v16h-2z" /></svg></button>
        </span>
      </div>
    </div>
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
