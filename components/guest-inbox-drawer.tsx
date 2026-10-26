"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { useLocale } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { useDevicePlayer } from "@/lib/device-player-context";
import {
  resolveGuestCard,
  guestCardToSource,
  addSourceToGuestsPlaylist,
  loadGuestsPlaylistTracks,
  guestSavedTrackToSource,
  type GuestCard,
  type GuestSavedTrack,
} from "@/lib/guest-playlist-client";
import type { UnifiedSource } from "@/lib/source-types";

type CardState = {
  id: string;
  card: GuestCard;
  source: UnifiedSource | null; // resolved lazily + cached across Play/Add
  busy: boolean;
  note: string | null;
};

type Copy = {
  title: string;
  subtitle: string;
  open: string;
  close: string;
  placeholder: string;
  resolve: string;
  resolving: string;
  empty: string;
  playNow: string;
  addToGuests: string;
  reject: string;
  added: string;
  alreadyThere: string;
  playing: string;
  failed: string;
  badUrl: string;
  waConnect: string;
  waConnected: string;
  waOn: string;
  waDisconnect: string;
  waConnectHint: string;
  waLoading: string;
  heroTitle: string;
  heroSub: string;
  getApp: string;
  appNote: string;
  addShort: string;
  inboxTitle: string;
  incomingTitle: string;
  savedTitle: string;
  savedEmpty: string;
  copyLink: string;
  linkCopied: string;
};

const EN: Copy = {
  title: "Guests",
  subtitle: "Songs your guests send, all in one place.",
  open: "Open Guest inbox",
  close: "Close",
  placeholder: "Paste a music link (YouTube, SoundCloud…)",
  resolve: "Add",
  resolving: "Resolving…",
  empty: "Links your guests send will show up here.",
  playNow: "Play now",
  addToGuests: "Add to GUESTS",
  reject: "Dismiss",
  added: "Added to GUESTS",
  alreadyThere: "Already in GUESTS",
  playing: "Playing",
  failed: "Something went wrong — try again",
  badUrl: "That doesn't look like a link",
  waConnect: "Connect WhatsApp",
  waConnected: "WhatsApp connected",
  waOn: "Connected",
  waDisconnect: "Disconnect",
  waConnectHint:
    "Connect once (scan the QR here in the app). Music links from new messages land in the inbox automatically.",
  waLoading: "Loading WhatsApp…",
  heroTitle: "Take song requests on WhatsApp",
  heroSub: "Connect once. Every music link your guests send lands here.",
  getApp: "Get the desktop app",
  appNote: "WhatsApp connects in the SyncBiz desktop app.",
  addShort: "Save",
  inboxTitle: "Inbox",
  incomingTitle: "New links",
  savedTitle: "In GUESTS",
  savedEmpty: "Songs you add to GUESTS show up here.",
  copyLink: "Copy guest link",
  linkCopied: "Copied!",
};

const HE: Copy = {
  title: "אורחים",
  subtitle: "השירים שהאורחים שולחים, במקום אחד.",
  open: "פתיחת תיבת האורחים",
  close: "סגור",
  placeholder: "הדביקו כאן קישור לשיר…",
  resolve: "הוסף",
  resolving: "מזהה…",
  empty: "קישורים שהאורחים ישלחו יופיעו כאן.",
  playNow: "נגן עכשיו",
  addToGuests: "הוסף ל-GUESTS",
  reject: "הסר",
  added: "נוסף ל-GUESTS",
  alreadyThere: "כבר ב-GUESTS",
  playing: "מנגן",
  failed: "משהו השתבש — נסו שוב",
  badUrl: "זה לא נראה כמו קישור",
  waConnect: "התחבר ל-WhatsApp",
  waConnected: "WhatsApp מחובר",
  waOn: "מחובר",
  waDisconnect: "נתק",
  waConnectHint:
    "התחברו פעם אחת (סרקו את ה-QR כאן בתוך האפליקציה). קישורי מוזיקה מהודעות חדשות יופיעו בתיבה אוטומטית.",
  waLoading: "טוען WhatsApp…",
  heroTitle: "בקשות שירים בוואטסאפ",
  heroSub: "מתחברים פעם אחת — וכל קישור שהאורחים שולחים מופיע כאן.",
  getApp: "הורדת אפליקציית שולחן העבודה",
  appNote: "החיבור ל-WhatsApp פועל באפליקציית SyncBiz לשולחן העבודה.",
  addShort: "שמור",
  inboxTitle: "תיבה",
  incomingTitle: "קישורים חדשים",
  savedTitle: "ב-GUESTS",
  savedEmpty: "שירים שתוסיפו ל-GUESTS יופיעו כאן.",
  copyLink: "העתק לינק אורחים",
  linkCopied: "הועתק!",
};

let cardSeq = 0;

type WaStatus = { connected: boolean; windowOpen: boolean };
type WaBounds = { x: number; y: number; width: number; height: number };
type DesktopWA = {
  connectWhatsApp: () => Promise<WaStatus>;
  disconnectWhatsApp: () => Promise<WaStatus>;
  showWhatsAppWindow: () => Promise<void>;
  hideWhatsAppWindow: () => Promise<void>;
  setWhatsAppBounds: (bounds: WaBounds) => Promise<void>;
  setWhatsAppSolo: (on: boolean) => Promise<void>;
  onWhatsAppUrl: (cb: (url: string) => void) => () => void;
  onWhatsAppStatus: (cb: (s: WaStatus) => void) => () => void;
};

/** The desktop bridge is only present in the Electron app (not the browser/mobile). */
function getDesktopWA(): DesktopWA | null {
  if (typeof window === "undefined") return null;
  const d = (window as unknown as { syncbizDesktop?: Partial<DesktopWA> }).syncbizDesktop;
  return d && typeof d.connectWhatsApp === "function" && typeof d.setWhatsAppBounds === "function"
    ? (d as DesktopWA)
    : null;
}

/**
 * Right-rail launcher card. Clicking it opens the Guest inbox in the CENTER
 * "monitor" area (like Jingles / DJ Creator) — see SourcesManager wiring.
 */
export function GuestInboxLauncher({ onOpen }: { onOpen: () => void }): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const dir: "rtl" | "ltr" = he ? "rtl" : "ltr";
  return (
    <button
      type="button"
      onClick={onOpen}
      dir={dir}
      className="group flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-[#101014] p-3.5 text-start transition-colors duration-150 hover:border-white/[0.16] hover:bg-white/[0.04] active:scale-[0.99]"
    >
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-[color:var(--sb-accent-soft)] text-[#409cff]"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-slate-100">{t.title}</span>
        <span className="mt-0.5 line-clamp-1 block text-[11px] text-slate-500">{t.open}</span>
      </span>
      <svg className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-150 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/**
 * Guest inbox — opens in the CENTER monitor area (full-width panel like the
 * Jingles console). When WhatsApp is connected on desktop, the panel splits into
 * two: the embedded WhatsApp conversation (left) + the resolved-link inbox (right).
 */
export function GuestInboxWorkspacePanel({ onClose }: { onClose: () => void }): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const dir: "rtl" | "ltr" = he ? "rtl" : "ltr";

  const playback = usePlayback();
  const deviceCtx = useDevicePlayer();

  const [input, setInput] = useState("");
  const [resolving, setResolving] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [cards, setCards] = useState<CardState[]>([]);
  // URLs currently being resolved → shown as "thinking" spinner cards (paste OR WhatsApp).
  const [pending, setPending] = useState<string[]>([]);
  // Songs already saved in the GUESTS playlist — always findable/playable here.
  const [saved, setSaved] = useState<GuestSavedTrack[]>([]);

  const refreshSaved = useCallback(() => {
    void loadGuestsPlaylistTracks().then(setSaved);
  }, []);
  useEffect(() => {
    refreshSaved();
    const onLib = () => refreshSaved();
    window.addEventListener("library-updated", onLib);
    return () => window.removeEventListener("library-updated", onLib);
  }, [refreshSaved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = useCallback((id: string, p: Partial<CardState>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...p } : c)));
  }, []);

  /** Resolve any URL (manual paste OR a WhatsApp message) into a card. Shows a
   *  "thinking" spinner card while the metadata is being fetched. */
  const addCardFromUrl = useCallback(async (rawUrl: string): Promise<boolean> => {
    const url = rawUrl.trim();
    if (!url) return false;
    setPending((p) => (p.includes(url) ? p : [url, ...p]));
    try {
      const card = await resolveGuestCard(url);
      if (!card) return false;
      setCards((prev) => {
        if (prev.some((c) => c.card.rawUrl === card.rawUrl)) return prev; // de-dupe
        return [{ id: `g-${++cardSeq}`, card, source: null, busy: false, note: null }, ...prev];
      });
      return true;
    } finally {
      setPending((p) => p.filter((u) => u !== url));
    }
  }, []);

  const handleResolve = useCallback(async () => {
    const raw = input.trim();
    if (!raw) return;
    setInputError(null);
    setResolving(true);
    try {
      const ok = await addCardFromUrl(raw);
      if (ok) setInput("");
      else setInputError(t.badUrl);
    } finally {
      setResolving(false);
    }
  }, [input, addCardFromUrl, t.badUrl]);

  // ── WhatsApp (desktop-only, embedded) ──
  const wa = useMemo(() => getDesktopWA(), []);
  const [waStatus, setWaStatus] = useState<WaStatus>({ connected: false, windowOpen: false });
  const [waBusy, setWaBusy] = useState(false);
  const waRegionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!wa) return;
    const offUrl = wa.onWhatsAppUrl((url) => void addCardFromUrl(url));
    const offStatus = wa.onWhatsAppStatus((s) => setWaStatus(s));
    return () => {
      offUrl();
      offStatus();
    };
  }, [wa, addCardFromUrl]);

  const connectWa = useCallback(async () => {
    if (!wa) return;
    setWaBusy(true);
    try {
      setWaStatus(await wa.connectWhatsApp());
    } finally {
      setWaBusy(false);
    }
  }, [wa]);
  const disconnectWa = useCallback(async () => {
    if (!wa) return;
    setWaBusy(true);
    try {
      setWaStatus(await wa.disconnectWhatsApp());
    } finally {
      setWaBusy(false);
    }
  }, [wa]);

  const embedded = !!wa && waStatus.connected;

  // Keep the embedded WhatsApp view glued to the region rect (survives resize/zoom).
  useEffect(() => {
    if (!wa || !waStatus.connected) return;
    const el = waRegionRef.current;
    if (!el) return;
    const push = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) {
        void wa.setWhatsAppBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
      }
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    window.addEventListener("resize", push);
    // Safety net: also re-push on a light cadence so a late zoom settle can't
    // leave the view a few pixels off.
    const iv = window.setInterval(push, 800);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", push);
      window.clearInterval(iv);
    };
  }, [wa, waStatus.connected]);

  // Detach the embedded view whenever it shouldn't show (not connected). The
  // session stays alive so background capture keeps working.
  useEffect(() => {
    if (!wa || waStatus.connected) return;
    void wa.hideWhatsAppWindow();
  }, [wa, waStatus.connected]);

  // On unmount (panel closed / switched away), never leave the overlay floating.
  useEffect(() => {
    return () => {
      getDesktopWA()?.hideWhatsAppWindow();
    };
  }, []);

  /** Resolve → UnifiedSource once, cached on the card. */
  const ensureSource = useCallback(
    async (c: CardState): Promise<UnifiedSource | null> => {
      if (c.source) return c.source;
      const src = await guestCardToSource(c.card);
      if (src) patch(c.id, { source: src });
      return src;
    },
    [patch],
  );

  const playNow = useCallback(
    async (c: CardState) => {
      patch(c.id, { busy: true, note: null });
      try {
        const src = await ensureSource(c);
        if (!src) return patch(c.id, { busy: false, note: t.failed });
        // playSourceOrSend already routes CONTROL → MASTER; falls back to local.
        if (deviceCtx?.playSourceOrSend) deviceCtx.playSourceOrSend(src);
        else playback.playSource(src);
        patch(c.id, { busy: false, note: t.playing });
      } catch {
        patch(c.id, { busy: false, note: t.failed });
      }
    },
    [ensureSource, deviceCtx, playback, patch, t.failed, t.playing],
  );

  const addToGuests = useCallback(
    async (c: CardState) => {
      patch(c.id, { busy: true, note: null });
      try {
        const src = await ensureSource(c);
        if (!src) return patch(c.id, { busy: false, note: t.failed });
        const res = await addSourceToGuestsPlaylist(src);
        patch(c.id, { busy: false, note: res.ok ? (res.alreadyThere ? t.alreadyThere : t.added) : t.failed });
        if (res.ok) refreshSaved();
      } catch {
        patch(c.id, { busy: false, note: t.failed });
      }
    },
    [ensureSource, patch, t.added, t.alreadyThere, t.failed, refreshSaved],
  );

  /** Play a song already saved in GUESTS (routes CONTROL → MASTER, else local). */
  const playSaved = useCallback(
    (tk: GuestSavedTrack) => {
      const src = guestSavedTrackToSource(tk);
      if (deviceCtx?.playSourceOrSend) deviceCtx.playSourceOrSend(src);
      else playback.playSource(src);
    },
    [deviceCtx, playback],
  );

  const reject = useCallback((id: string) => setCards((prev) => prev.filter((c) => c.id !== id)), []);

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // "Copy guest link" — the branch's guest-recommendation link (moved here from the
  // old toolbar button, so guests without WhatsApp can still recommend a song).
  const guestLink = (deviceCtx as { guestLink?: string | null } | null)?.guestLink ?? null;
  const [linkCopied, setLinkCopied] = useState(false);
  const copyGuestLink = useCallback(async () => {
    if (!guestLink) return;
    try {
      await navigator.clipboard.writeText(guestLink);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [guestLink]);

  // ── Reusable blocks ── (round 9: minimal glass, DJ language — left = WhatsApp hero / live pane, right = the inbox)
  const iconPlay = (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8.6 5.6v12.8L18.6 12z" />
    </svg>
  );
  const iconX = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
  const iconPlus = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
  const spinner = (
    <svg className="sb-gst-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );

  const inputBlock = (
    <div className="sb-gst-pastewrap">
      <div className="sb-gst-paste">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (inputError) setInputError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void handleResolve()}
          placeholder={t.placeholder}
        />
        <button
          type="button"
          onClick={() => void handleResolve()}
          disabled={resolving || !input.trim()}
          aria-label={t.resolve}
          title={t.resolve}
        >
          {resolving ? spinner : iconPlus}
        </button>
      </div>
      {inputError ? <p className="sb-gst-err">{inputError}</p> : null}
    </div>
  );

  const hasIncoming = pending.length > 0 || cards.length > 0;
  const isEmpty = !hasIncoming && saved.length === 0;

  const listBlock = (
    <div className="sb-gst-list">
      {isEmpty ? (
        <div className="sb-gst-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          <p>{t.empty}</p>
        </div>
      ) : null}

      {hasIncoming ? <p className="sb-gst-label">{t.incomingTitle}</p> : null}
      {/* "Thinking" cards while links resolve (paste OR WhatsApp arrivals). */}
      {pending.map((url) => (
        <div key={`p-${url}`} className="sb-gst-card is-pending">
          <span className="sb-gst-cover">{spinner}</span>
          <span className="sb-gst-text">
            <b>{t.resolving}</b>
            <i dir="ltr">{url}</i>
          </span>
        </div>
      ))}
      {cards.map((c) => (
        <div key={c.id} className="sb-gst-card">
          <span className="sb-gst-cover">
            {c.card.cover ? <HydrationSafeImage src={c.card.cover} alt="" className="h-full w-full object-cover" /> : null}
          </span>
          <span className="sb-gst-text">
            <b dir="auto">{c.card.title}</b>
            <i data-note={c.note ? "1" : undefined} dir="auto">{c.note ?? c.card.artist ?? c.card.type}</i>
          </span>
          <span className="sb-gst-acts">
            <button type="button" className="sb-gst-save" onClick={() => void addToGuests(c)} disabled={c.busy} title={t.addToGuests}>
              {t.addShort}
            </button>
            <button type="button" className="sb-gst-play" onClick={() => void playNow(c)} disabled={c.busy} aria-label={t.playNow} title={t.playNow}>
              {iconPlay}
            </button>
            <button type="button" className="sb-gst-x" onClick={() => reject(c.id)} disabled={c.busy} aria-label={t.reject} title={t.reject}>
              {iconX}
            </button>
          </span>
        </div>
      ))}

      {saved.length > 0 ? (
        <p className="sb-gst-label">
          {t.savedTitle}
          <span> · {saved.length}</span>
        </p>
      ) : null}
      {saved.map((tk) => (
        <div key={tk.id} className="sb-gst-card is-saved">
          <span className="sb-gst-cover">
            {tk.cover ? <HydrationSafeImage src={tk.cover} alt="" className="h-full w-full object-cover" /> : null}
          </span>
          <span className="sb-gst-text">
            <b dir="auto">{tk.title}</b>
          </span>
          <span className="sb-gst-acts">
            <button type="button" className="sb-gst-play" onClick={() => playSaved(tk)} aria-label={t.playNow} title={t.playNow}>
              {iconPlay}
            </button>
          </span>
        </div>
      ))}
    </div>
  );

  // Open the SyncBiz Player desktop download (installer if available, else the releases page).
  const openDesktopDownload = async () => {
    let url = "https://github.com/djdotansharon-creator/syncbiz-app/releases";
    try {
      const resp = await fetch("/api/desktop/download", { cache: "no-store" });
      const d = (await resp.json().catch(() => ({}))) as { url?: string; releasesPageUrl?: string };
      url = (typeof d.url === "string" && d.url.trim()) || (typeof d.releasesPageUrl === "string" && d.releasesPageUrl) || url;
    } catch { /* fall back to the releases page */ }
    if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
  };

  const waLogo = (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );

  // Left card. Connected on desktop → the live WhatsApp pane (big). Otherwise → one big, pretty connect hero.
  const waCard = embedded ? (
    <section className="sb-gst-wa-pane" aria-label="WhatsApp">
      <div className="sb-gst-wa-bar">
        <span className="sb-gst-wa-mini">{waLogo}</span>
        <b>WhatsApp</b>
        <span className="sb-gst-live">
          <i aria-hidden />
          {t.waOn}
        </span>
        <button type="button" className="sb-gst-quiet" onClick={() => void disconnectWa()} disabled={waBusy}>
          {t.waDisconnect}
        </button>
      </div>
      {/* The native WhatsApp view is overlaid exactly on this box. */}
      <div ref={waRegionRef} className="sb-gst-wa-region">
        <span>{t.waLoading}</span>
      </div>
    </section>
  ) : (
    <section className="sb-gst-hero">
      <span className="sb-gst-wa-logo" aria-hidden>
        {waLogo}
      </span>
      <h3>{t.heroTitle}</h3>
      <p>{t.heroSub}</p>
      {wa ? (
        <button type="button" className="sb-dj-go" onClick={() => void connectWa()} disabled={waBusy}>
          {waBusy ? "…" : t.waConnect}
        </button>
      ) : (
        <>
          <button type="button" className="sb-dj-go" onClick={() => void openDesktopDownload()}>
            {t.getApp}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="sb-gst-dl">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5M12 15V3" />
            </svg>
          </button>
          <span className="sb-gst-note">{t.appNote}</span>
        </>
      )}
    </section>
  );

  return (
    <div dir={dir} className="sb-gst min-h-0 w-full flex-1">
      <header className="sb-gst-head">
        <div className="sb-gst-titles">
          <h2>{t.title}</h2>
          <p>{t.subtitle}</p>
        </div>
        {guestLink ? (
          <button type="button" className="sb-dj-pill" onClick={() => void copyGuestLink()} title={t.copyLink}>
            {linkCopied ? t.linkCopied : t.copyLink}
          </button>
        ) : null}
        <button type="button" className="sb-wz-x" onClick={onClose} aria-label={t.close}>
          {iconX}
        </button>
      </header>
      <div className="sb-gst-grid" data-wa={embedded ? "live" : "off"}>
        {waCard}
        <div className="sb-gst-inbox">
          {inputBlock}
          {listBlock}
        </div>
      </div>
    </div>
  );
}
