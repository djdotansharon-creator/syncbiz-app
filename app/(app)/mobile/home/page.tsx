"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMobileFleet, type FleetBranch, type FleetStatus } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { VmPage } from "@/components/vm/vm-ui";
import { VmCover, VmEq, VmMarquee, branchLine } from "@/components/vm/vm-parts";
import { IconPause, IconPlay, IconSearch, IconStore, IconWifiOff } from "@/components/vm/vm-icons";

/**
 * BRANCHES — the phone app's home. Every business location the person may see, live: what each plays right now, who is offline, and one tap to
 * pause / resume a branch without opening it. Tap a card to open that branch's player. (Status + sort = the Control Room's.)
 */

function BranchCard({ b, onToggle }: { b: FleetBranch; onToggle: (id: string) => void }) {
  const tr = useTr();
  const line = branchLine(b, tr);
  const playing = b.status === "playing";
  const cover = b.state?.currentTrack?.cover ?? b.state?.currentSource?.cover ?? b.logoUrl;
  return (
    <div className="vm-card" data-status={b.status}>
      <Link href={`/mobile/branch/${encodeURIComponent(b.id)}`} className="vm-card-link" aria-label={b.name}>
        <VmCover src={cover} name={b.name} size={62} radius={15} />
        <span className="vm-card-text">
          <span className="vm-card-name vm-bdi">{b.name}</span>
          <span className="vm-card-line" data-live={line.live ? "" : undefined}>
            {playing ? <VmEq /> : null}
            {line.live ? <span style={{ minWidth: 0, flex: 1 }}><VmMarquee text={line.text} /></span> : <span className="vm-bdi" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{line.text}</span>}
          </span>
          {/* a branch that plays already says so with its live bars: no second "Playing" and no green dot under them (owner 2026-11-17) */}
          {playing ? (
            b.city ? <span className="vm-card-meta"><span className="vm-bdi">{b.city}</span></span> : null
          ) : (
            <span className="vm-card-meta">
              <span className="vm-dot" data-s={b.status} />
              <span>{statusWord(b.status, tr)}</span>
              {b.city ? <span className="vm-bdi">· {b.city}</span> : null}
            </span>
          )}
        </span>
      </Link>
      {b.online ? (
        <button type="button" className="vm-pp" onClick={() => onToggle(b.id)} aria-label={playing ? tr("Pause") : tr("Play")}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
      ) : null}
    </div>
  );
}

function statusWord(s: FleetStatus, tr: (t: string) => string): string {
  switch (s) {
    case "playing": return tr("Playing");
    case "idle": return tr("Online");
    case "offline": return tr("Offline");
    case "install": return tr("Not installed");
    default: return tr("Connecting…");
  }
}

export default function MobileBranchesPage() {
  const f = useMobileFleet();
  const tr = useTr();
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? f.branches.filter((b) => `${b.name} ${b.city}`.toLowerCase().includes(t)) : f.branches;
  }, [f.branches, q]);

  const live = visible.filter((b) => b.status === "playing");
  const online = visible.filter((b) => b.status === "idle" || b.status === "unknown");
  const away = visible.filter((b) => b.status === "offline" || b.status === "install");
  const playingCount = f.branches.filter((b) => b.status === "playing").length;
  const onlineCount = f.branches.filter((b) => b.online).length;

  const sub =
    f.loaded && f.branches.length
      ? tr("{playing} playing · {online} of {total} online", { playing: playingCount, online: onlineCount, total: f.branches.length })
      : undefined;

  return (
    <VmPage title={tr("Branches")} subtitle={sub}>
      {f.connection === "error" || f.connection === "disconnected" ? (
        <div className="vm-notice" role="status">
          <IconWifiOff />
          <span>{f.connection === "error" ? tr("Can't reach VONO. Trying again…") : tr("Connecting to your branches…")}</span>
        </div>
      ) : null}

      {f.branches.length > 5 ? (
        <label className="vm-field">
          <IconSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search branches")} inputMode="search" enterKeyHint="search" />
        </label>
      ) : null}

      {!f.loaded && !f.loadError ? (
        <div className="vm-list" style={{ marginTop: 16 }} aria-busy>
          <div className="vm-skel" />
          <div className="vm-skel" />
          <div className="vm-skel" />
        </div>
      ) : f.loadError && !f.branches.length ? (
        <div className="vm-empty">
          <IconWifiOff />
          <h2>{tr("Couldn't load your branches")}</h2>
          <span>{tr("Check the connection and try again.")}</span>
          <button type="button" className="vm-pill" onClick={() => window.location.reload()}>{tr("Try again")}</button>
        </div>
      ) : !f.branches.length ? (
        <div className="vm-empty">
          <IconStore />
          <h2>{tr("No branches yet")}</h2>
          <span>{tr("Add your first branch from the Control Room on a computer, and it will appear here.")}</span>
        </div>
      ) : !visible.length ? (
        <div className="vm-empty">
          <span>{tr("No branch matches")} “{q}”</span>
        </div>
      ) : (
        <>
          {live.length ? (
            <>
              <div className="vm-sec">{tr("Playing now")} <b>{live.length}</b></div>
              <div className="vm-list">{live.map((b) => <BranchCard key={b.id} b={b} onToggle={f.toggleBranch} />)}</div>
            </>
          ) : null}
          {online.length ? (
            <>
              <div className="vm-sec">{tr("Online")} <b>{online.length}</b></div>
              <div className="vm-list">{online.map((b) => <BranchCard key={b.id} b={b} onToggle={f.toggleBranch} />)}</div>
            </>
          ) : null}
          {away.length ? (
            <>
              <div className="vm-sec">{tr("Offline")} <b>{away.length}</b></div>
              <div className="vm-list">{away.map((b) => <BranchCard key={b.id} b={b} onToggle={f.toggleBranch} />)}</div>
            </>
          ) : null}
        </>
      )}
    </VmPage>
  );
}
