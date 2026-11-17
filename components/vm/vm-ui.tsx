"use client";

import "@/app/mobile-app.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PwaRegister } from "@/components/pwa-register";
import { useMobileFleet, type FleetBranch } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { useMobileRole } from "@/lib/mobile-role-context";
import { VmNowPlaying } from "@/components/vm/vm-now-playing";
import { VmCover, VmEq, VmMarquee, branchLine } from "@/components/vm/vm-parts";
import { useNowTone } from "@/components/vm/vm-tone";
import { IconCheck, IconLibrary, IconNext, IconPause, IconPerson, IconPlay, IconSearch, IconStore, IconSwap } from "@/components/vm/vm-icons";

/* ───────────────────────────── the phone app's own UI state ───────────────────────────── */

type VmUi = {
  openNowPlaying: () => void;
  openPicker: () => void;
  toast: (message: string) => void;
  /** a short bottom sheet over everything (a song's menu): the shell shows `node` under `label` until `closeSheet` */
  openSheet: (label: string, node: ReactNode) => void;
  closeSheet: () => void;
};
const VmUiContext = createContext<VmUi | null>(null);
export function useVmUi(): VmUi {
  const c = useContext(VmUiContext);
  if (!c) throw new Error("useVmUi must be used inside <VmShell>");
  return c;
}

/* ───────────────────────────── a page with an Apple-Music large title ───────────────────────────── */

/**
 * `title` is big at the top of the page; once it has scrolled away a slim glass bar shows it small. `lead` (a back button) and `end` (actions) stay
 * visible in that bar all the time. Pages render inside the shell's one scroll container (#vm-scroll).
 */
export function VmPage({ title, subtitle, lead, end, barTitle, children }: { title: string; subtitle?: ReactNode; lead?: ReactNode; end?: ReactNode; barTitle?: string; children: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const root = document.getElementById("vm-scroll");
    const el = sentinel.current;
    if (!root || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e!.isIntersecting), { root, threshold: 0, rootMargin: "-52px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="vm-page">
      <div className="vm-bar" data-on={scrolled ? "" : undefined}>
        {lead ? <div className="vm-bar-lead">{lead}</div> : null}
        <span className="vm-bar-title vm-bdi">{barTitle ?? title}</span>
        {end ? <div className="vm-bar-end">{end}</div> : null}
      </div>
      <div className="vm-head" data-lead={lead ? "" : undefined}>
        <div style={{ minWidth: 0 }}>
          <h1 className="vm-title vm-bdi">{title}</h1>
          {subtitle ? <p className="vm-sub">{subtitle}</p> : null}
        </div>
      </div>
      <div className="vm-sentinel" ref={sentinel} />
      {children}
    </div>
  );
}

/* ───────────────────────────── a bottom sheet that can be pulled down ───────────────────────────── */

export function VmSheet({ open, onClose, label, height, above, tone, children }: { open: boolean; onClose: () => void; label: string; height?: string; above?: boolean; /** the Now Playing sheet: drawn in the song's colours (`style` carries the colour variables) */ tone?: CSSProperties; children: ReactNode }) {
  // the content is mounted while the sheet is open and for the 0.5 s it takes to slide away (an idle sheet costs nothing: the player's clock ticks 4× a second)
  const [slidingAway, setSlidingAway] = useState(false);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    return () => {
      setSlidingAway(true); // the sheet was open and is closing now
      t = setTimeout(() => setSlidingAway(false), 520);
      closeTimer.current = t;
    };
  }, [open]);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <>
      <div className="vm-sheet-back" data-open={open ? "" : undefined} data-above={above ? "" : undefined} onClick={onClose} />
      <div
        className={`vm-sheet${tone ? " vm-sheet--np" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-hidden={!open}
        data-open={open ? "" : undefined}
        data-above={above ? "" : undefined}
        data-drag={dragging ? "" : undefined}
        data-auto={height === "auto" ? "" : undefined}
        style={{ ["--vm-drag" as string]: `${dy}px`, ...(height ? { ["--vm-sheet-h" as string]: height } : {}), ...tone }}
      >
        <div
          className="vm-grab"
          onPointerDown={(e) => {
            startY.current = e.clientY;
            setDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (startY.current !== null) setDy(Math.max(0, e.clientY - startY.current));
          }}
          onPointerUp={() => {
            const far = dy > 120;
            startY.current = null;
            setDragging(false);
            setDy(0);
            if (far) onClose();
          }}
          onPointerCancel={() => {
            startY.current = null;
            setDragging(false);
            setDy(0);
          }}
        >
          <i />
        </div>
        <div className="vm-sheet-body">{open || slidingAway ? children : null}</div>
      </div>
    </>
  );
}


/** "Playing on <branch>" — the chip at the top of Library / Search: which branch a tap will send music to (tap = choose another) */
export function VmTarget() {
  const f = useMobileFleet();
  const ui = useVmUi();
  const tr = useTr();
  const b = f.selected;
  return (
    <button type="button" className="vm-target" onClick={ui.openPicker} aria-label={tr("Choose branch")}>
      <IconStore />
      <span>{tr("Play on")}</span>
      <b className="vm-bdi">{b ? b.name : tr("No branch selected")}</b>
      {b ? <span className="vm-dot" data-s={b.status} /> : null}
      <IconSwap />
    </button>
  );
}

/* ───────────────────────────── the branch picker ───────────────────────────── */

function PickerRow({ b, selected, onPick }: { b: FleetBranch; selected: boolean; onPick: () => void }) {
  const tr = useTr();
  const line = branchLine(b, tr);
  return (
    <button type="button" className="vm-src" onClick={onPick} data-active={selected ? "" : undefined}>
      <VmCover src={b.state?.currentTrack?.cover ?? b.state?.currentSource?.cover ?? b.logoUrl} name={b.name} size={52} radius={13} />
      <div className="vm-src-text">
        <div className="vm-src-title vm-bdi" style={selected ? { color: "var(--vm-text)" } : undefined}>{b.name}</div>
        <div className="vm-src-sub vm-bdi" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="vm-dot" data-s={b.status} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{line.text}</span>
        </div>
      </div>
      {selected ? <IconCheck style={{ fontSize: 22 }} /> : null}
    </button>
  );
}

function BranchPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const f = useMobileFleet();
  const tr = useTr();
  return (
    <VmSheet open={open} onClose={onClose} label={tr("Choose branch")} height="72dvh" above>
      <div className="vm-sheet-title">{tr("Choose branch")}</div>
      <div style={{ padding: "0 6px" }}>
        {f.branches.map((b) => (
          <PickerRow
            key={b.id}
            b={b}
            selected={f.selected?.id === b.id}
            onPick={() => {
              f.select(b.id);
              onClose();
            }}
          />
        ))}
        {!f.branches.length ? <div className="vm-empty" style={{ marginTop: 30 }}>{tr("No branches yet")}</div> : null}
      </div>
    </VmSheet>
  );
}

/* ───────────────────────────── the dock: mini-player + tab bar ───────────────────────────── */

const TABS = [
  { href: "/mobile/home", label: "Branches", icon: <IconStore /> },
  { href: "/mobile/library", label: "Library", icon: <IconLibrary /> },
  { href: "/mobile/search", label: "Search", icon: <IconSearch /> },
  { href: "/mobile/account", label: "Account", icon: <IconPerson /> },
] as const;

function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const f = useMobileFleet();
  const tr = useTr();
  const b = f.selected;
  const tone = useNowTone();
  if (!b) return null;
  const s = f.display.shown;
  const playing = s?.status === "playing";
  const title = s?.currentTrack?.title || s?.currentSource?.title || "";
  const cover = s?.currentTrack?.cover ?? s?.currentSource?.cover ?? b.logoUrl;
  const dur = s?.duration && s.duration > 0 ? s.duration : 0;
  const pct = dur && typeof s?.position === "number" ? Math.min(100, Math.max(0, (s.position / dur) * 100)) : 0;
  return (
    <div
      className="vm-mini"
      data-tone=""
      style={tone}
      role="button"
      tabIndex={0}
      aria-label={tr("Open the player")}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <VmCover src={cover} name={title || b.name} size={42} radius={10} />
      <div className="vm-mini-text">
        <div className="vm-mini-title">
          {title ? <VmMarquee text={title} /> : <span style={{ color: "var(--vm-text2)" }}>{b.online ? tr("Nothing playing") : tr("Offline")}</span>}
        </div>
        <div className="vm-mini-sub vm-bdi">
          {playing ? <VmEq /> : <span className="vm-dot" data-s={b.status} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</span>
        </div>
      </div>
      <div className="vm-mini-btns" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="vm-icobtn" onClick={() => (playing ? f.pause() : f.play())} disabled={!f.canControl} aria-label={playing ? tr("Pause") : tr("Play")}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <button type="button" className="vm-icobtn" onClick={f.next} disabled={!f.canControl || !s || s.status === "idle"} aria-label={tr("Next")}>
          <IconNext />
        </button>
      </div>
      <div className="vm-mini-prog" aria-hidden>
        <i style={{ ["--p" as string]: `${pct}%` } as React.CSSProperties} />
      </div>
    </div>
  );
}

function Dock({ onOpenNowPlaying }: { onOpenNowPlaying: () => void }) {
  const pathname = usePathname() ?? "";
  const f = useMobileFleet();
  const tr = useTr();
  const anyLive = f.branches.some((b) => b.status === "playing");
  return (
    <div className="vm-dock">
      <MiniPlayer onOpen={onOpenNowPlaying} />
      <nav className="vm-tabs" aria-label={tr("Navigation")}>
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`) || (t.href === "/mobile/home" && pathname.startsWith("/mobile/branch"));
          return (
            <Link key={t.href} href={t.href} className="vm-tab" aria-current={active ? "page" : undefined} prefetch>
              {t.icon}
              <span>{tr(t.label)}</span>
              {t.href === "/mobile/home" && anyLive ? <i className="vm-tab-live" aria-hidden /> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/* ───────────────────────────── the shell ───────────────────────────── */

/** screens that still use the older form components (Tailwind slate / sky): their fields and cards are re-skinned to the phone app's look by CSS (`[data-legacy]`) */
const LEGACY_ROUTE = /^\/mobile\/(jingles|scheduling|announcer|search|identify|shazam-share)(\/|$)/;
/** …and of those, the ones that lose their frames too (the Announcer keeps its record ring: that ring IS the button) */
const FLAT_ROUTE = /^\/mobile\/(jingles|search|identify|shazam-share)(\/|$)/;

/** the Now Playing sheet: its background is the colour of the song that plays */
function NowPlayingSheet({ open, onClose, onPickBranch }: { open: boolean; onClose: () => void; onPickBranch: () => void }) {
  const tr = useTr();
  const tone = useNowTone();
  return (
    <VmSheet open={open} onClose={onClose} label={tr("Now playing")} tone={tone}>
      <VmNowPlaying onPickBranch={onPickBranch} />
    </VmSheet>
  );
}

export function VmShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [np, setNp] = useState(false);
  const [picker, setPicker] = useState(false);
  const [msg, setMsg] = useState<{ id: number; text: string } | null>(null);
  // a song's menu (and any short sheet): the node stays until the next one opens, so the sheet can slide away with its content still in it
  const [sheet, setSheet] = useState<{ label: string; node: ReactNode } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // owner 2026-11-16: no local player on the phone for now — an old "Player" choice saved on this phone is put back to Controller
  const { mobileRole, setMobileRole } = useMobileRole();
  useEffect(() => {
    if (mobileRole !== "controller") setMobileRole("controller");
  }, [mobileRole, setMobileRole]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pathname]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);

  const ui = useMemo<VmUi>(
    () => ({
      openNowPlaying: () => setNp(true),
      openPicker: () => setPicker(true),
      toast: (text: string) => setMsg({ id: Date.now(), text }),
      openSheet: (label: string, node: ReactNode) => {
        setSheet({ label, node });
        setSheetOpen(true);
      },
      closeSheet: () => setSheetOpen(false),
    }),
    [],
  );
  const closeNp = useCallback(() => setNp(false), []);
  const closePicker = useCallback(() => setPicker(false), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  return (
    <VmUiContext.Provider value={ui}>
      <div className="vm">
        <PwaRegister />
        <div className="vm-scroll" id="vm-scroll" ref={scrollRef} data-legacy={LEGACY_ROUTE.test(pathname) ? "" : undefined} data-flat={FLAT_ROUTE.test(pathname) ? "" : undefined}>
          {children}
        </div>
        <Dock onOpenNowPlaying={ui.openNowPlaying} />
        <NowPlayingSheet open={np} onClose={closeNp} onPickBranch={ui.openPicker} />
        <BranchPicker open={picker} onClose={closePicker} />
        <VmSheet open={sheetOpen} onClose={closeSheet} label={sheet?.label ?? ""} height="auto" above>
          {sheet?.node}
        </VmSheet>
        {msg ? (
          <div className="vm-toast" key={msg.id} role="status">
            <span>{msg.text}</span>
          </div>
        ) : null}
      </div>
    </VmUiContext.Provider>
  );
}
