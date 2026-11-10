"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "@/lib/locale-context";
import { useTr } from "@/lib/i18n/use-tr";
import { LAST_LEGACY_VERSION, isBelowMinEngine, isNewer } from "@/lib/desktop-version";

/**
 * Electron-only header pill (owner 2026-11-02: next to the logo, a flat ellipse with no frame, "Update" / "עדכון").
 * Compares the running desktop app version (`window.syncbizDesktop.getAppVersion()`) against the canonical version
 * advertised by `/api/desktop/download`. When the API version is newer it shows the pill, linking to the installer
 * (`data.url`) or, if no direct installer URL is resolvable, the GitHub releases page. 2026-11-10: the pill now opens a small CARD first (version number, "What's new" = /whats-new on our site, "Update now" = the installer); a click anywhere else or Escape closes it. Amber = an update is available;
 * red + "Update required" = this engine is older than MIN_ENGINE_VERSION (lib/desktop-version.ts).
 *
 * Backward compatibility: desktop builds <= 0.1.2 shipped before the `getAppVersion` bridge existed. Those clients
 * still expose `window.syncbizDesktop` (so we can tell it's the desktop app) but cannot report their own version. We
 * must NOT hide the pill from them — they are by definition the oldest installs. For those clients we skip the version
 * comparison and notify whenever the server advertises a build newer than the last bridge-less release.
 *
 * Renders nothing in the browser (the browser gets `DesktopDownloadButton`), while a build is current, or if the
 * endpoint can't be read.
 */

const DEFAULT_RELEASES = "https://github.com/djdotansharon-creator/syncbiz-app/releases";

type DesktopBridge = { getAppVersion?: () => Promise<string> };

function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { syncbizDesktop?: DesktopBridge }).syncbizDesktop;
}

// Flat ellipse, no frame / shadow / glow (so it is identical in black, white, transparent and Lite graphics).
// Amber text #1c1400 on #fbbf24 = 11:1; white on red #dc2626 = 4.8:1.
const PILL_BASE =
  "sb-update-pill inline-flex h-[22px] shrink-0 items-center rounded-full px-2.5 text-[11px] font-bold leading-none " +
  "no-underline transition-[background-color,transform] duration-150 active:scale-[0.97] " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80";
const PILL_AMBER = " bg-[#fbbf24] text-[#1c1400] hover:bg-[#fcd34d]";
const PILL_RED = " bg-[#dc2626] text-white hover:bg-[#b91c1c]";

export function DesktopUpdatePill() {
  const { t } = useTranslations();
  const tr = t as unknown as Record<string, string | undefined>;
  const [target, setTarget] = useState<{ version: string; href: string; required: boolean } | null>(null);
  const trp = useTr();
  // the card (owner 2026-11-10): the ellipse opens a small rectangle with the version number, "What's new" (our site) and "Update now"; it opens with an effect and closes by a click anywhere else
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const rtl = document.documentElement.getAttribute("dir") === "rtl";
    setPos(rtl ? { top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) } : { top: r.bottom + 8, left: Math.max(8, r.left) });
  }, []);
  const closeCard = useCallback(() => {
    setClosing(true);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
      setClosing(false);
    }, 170);
  }, []);
  const toggleCard = useCallback(() => {
    if (open && !closing) {
      closeCard();
      return;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    place();
    setClosing(false);
    setOpen(true);
  }, [open, closing, closeCard, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node | null;
      if (n && (cardRef.current?.contains(n) || btnRef.current?.contains(n))) return;
      closeCard();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCard();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    };
  }, [open, closeCard, place]);
  useEffect(() => () => { if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current); }, []);

  useEffect(() => {
    const bridge = desktopBridge();
    // Presence of the bridge object = running in the desktop app. This is true
    // for ALL desktop versions, including legacy <= 0.1.2 that lack getAppVersion.
    if (!bridge) return;
    let cancelled = false;

    (async () => {
      try {
        // Legacy desktop (<= 0.1.2) has no getAppVersion — current stays null.
        const current =
          typeof bridge.getAppVersion === "function"
            ? (await bridge.getAppVersion()).trim()
            : null;

        const resp = await fetch("/api/desktop/download", { cache: "no-store" });
        const data = (await resp.json().catch(() => ({}))) as {
          version?: string;
          expectedVersion?: string;
          url?: string | null;
          releasesPageUrl?: string;
        };
        if (cancelled) return;

        // `version` on ok:true; `expectedVersion` on ok:false (no installer yet) —
        // both are the canonical advertised desktop version.
        const latest = (data.version ?? data.expectedVersion ?? "").trim();
        if (!latest) return;

        const required = isBelowMinEngine(current);
        const shouldNotify =
          required ||
          (current === null
            ? // Legacy client: it predates the bridge, so any server build newer
              // than the last bridge-less release is an update for it.
              isNewer(latest, LAST_LEGACY_VERSION)
            : isNewer(latest, current));
        if (!shouldNotify) return;

        const directUrl = typeof data.url === "string" ? data.url.trim() : "";
        const releases =
          typeof data.releasesPageUrl === "string" && data.releasesPageUrl.startsWith("https://")
            ? data.releasesPageUrl
            : DEFAULT_RELEASES;
        setTarget({ version: latest, href: directUrl.length > 0 ? directUrl : releases, required });
      } catch {
        /* offline / endpoint unreachable / version unreadable — stay silent */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!target) return null;

  const title = (tr.desktopUpdateAvailable ?? "Update available v{v}").replaceAll("{v}", target.version);
  const text = target.required ? (tr.desktopUpdateRequiredPill ?? "Update required") : (tr.desktopUpdatePill ?? "Update");

  const kicker = target.required ? (tr.desktopUpdateRequiredPill ?? "Update required") : trp("Update available");

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggleCard}
        aria-haspopup="dialog"
        aria-expanded={open && !closing}
        className={PILL_BASE + (target.required ? PILL_RED : PILL_AMBER)}
        title={title}
        aria-label={title}
        data-sb-update={target.required ? "required" : "available"}
      >
        <span className="sb-pill-t">{text}</span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={cardRef}
              role="dialog"
              aria-label={title}
              className={`sb-update-card${closing ? " is-closing" : ""}`}
              style={{ top: pos.top, left: pos.left, right: pos.right }}
            >
              <p className="sb-update-card-kicker">{kicker}</p>
              <p className="sb-update-card-ver" dir="ltr">{target.version}</p>
              <a className="sb-update-card-btn" href="/whats-new" target="_blank" rel="noopener noreferrer">{trp("What's new")}</a>
              <a className="sb-update-card-btn sb-update-card-btn--go" href={target.href} target="_blank" rel="noopener noreferrer">{trp("Update now")}</a>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
