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
  waDisconnect: string;
  waConnectHint: string;
  waLoading: string;
  waSolo: string;
  waAllChats: string;
  inboxTitle: string;
  incomingTitle: string;
  savedTitle: string;
  savedEmpty: string;
};

const EN: Copy = {
  title: "Guests",
  subtitle: "Paste a music link — review, then play or add to the GUESTS playlist.",
  open: "Open Guest inbox",
  close: "Close",
  placeholder: "Paste a music link (YouTube, SoundCloud…)",
  resolve: "Add",
  resolving: "Resolving…",
  empty: "No guest links yet. Paste a link above, or they arrive from WhatsApp.",
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
  waDisconnect: "Disconnect",
  waConnectHint:
    "Connect once (scan the QR here in the app). Music links from new messages land in the inbox automatically.",
  waLoading: "Loading WhatsApp…",
  waSolo: "Only this chat",
  waAllChats: "All chats",
  inboxTitle: "Inbox",
  incomingTitle: "New links",
  savedTitle: "In GUESTS",
  savedEmpty: "Songs you add to GUESTS show up here.",
};

const HE: Copy = {
  title: "אורחים",
  subtitle: "הדביקו קישור לשיר — לבדוק, ואז לנגן או להוסיף לפלייליסט GUESTS.",
  open: "פתיחת תיבת האורחים",
  close: "סגור",
  placeholder: "הדביקו קישור לשיר (YouTube, SoundCloud…)",
  resolve: "הוסף",
  resolving: "מזהה…",
  empty: "עדיין אין קישורים. הדביקו קישור למעלה, או שהם יגיעו מ-WhatsApp.",
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
  waDisconnect: "נתק",
  waConnectHint:
    "התחברו פעם אחת (סרקו את ה-QR כאן בתוך האפליקציה). קישורי מוזיקה מהודעות חדשות יופיעו בתיבה אוטומטית.",
  waLoading: "טוען WhatsApp…",
  waSolo: "רק הצ'אט הזה",
  waAllChats: "כל הצ'אטים",
  inboxTitle: "תיבה",
  incomingTitle: "קישורים חדשים",
  savedTitle: "ב-GUESTS",
  savedEmpty: "שירים שתוסיפו ל-GUESTS יופיעו כאן.",
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
  const [waSolo, setWaSolo] = useState(true); // MONI-style: only the open chat, default on
  const waRegionRef = useRef<HTMLDivElement | null>(null);

  const toggleSolo = useCallback(() => {
    setWaSolo((prev) => {
      const next = !prev;
      void wa?.setWhatsAppSolo(next);
      return next;
    });
  }, [wa]);

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

  // ── Reusable blocks ──
  const inputBlock = (
    <div className="px-3 py-3">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (inputError) setInputError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void handleResolve()}
          placeholder={t.placeholder}
          className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-[13px] text-slate-100 placeholder:text-slate-600 focus:border-[color:var(--sb-accent-border)] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleResolve()}
          disabled={resolving || !input.trim()}
          className="shrink-0 rounded-xl bg-[var(--sb-text)] px-3 py-2 text-[12px] font-semibold text-[#111114] transition active:scale-95 disabled:opacity-40"
        >
          {resolving ? t.resolving : t.resolve}
        </button>
      </div>
      {inputError ? <p className="mt-1.5 text-[12px] text-amber-300">{inputError}</p> : null}
    </div>
  );

  const sectionHeader = (label: string, count?: number) => (
    <p className="px-1 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
      {label}
      {typeof count === "number" && count > 0 ? <span className="ml-1 text-slate-600">· {count}</span> : null}
    </p>
  );

  const savedBlock = (
    <div className="max-h-[42%] shrink-0 overflow-y-auto border-t border-white/[0.06] px-3 py-2">
      {sectionHeader(t.savedTitle, saved.length)}
      {saved.length === 0 ? (
        <p className="px-1 py-2 text-[11px] text-slate-600">{t.savedEmpty}</p>
      ) : (
        <div className="space-y-1.5">
          {saved.map((tk) => (
            <div key={tk.id} className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-black/20 p-2">
              <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                {tk.cover ? <HydrationSafeImage src={tk.cover} alt="" className="h-full w-full object-cover" /> : null}
              </span>
              <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-100">{tk.title}</p>
              <button
                type="button"
                onClick={() => playSaved(tk)}
                aria-label={t.playNow}
                title={t.playNow}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--sb-text)] text-[#111114] transition active:scale-90"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const cardsBlock = (
    <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
      {pending.length > 0 || cards.length > 0 ? sectionHeader(t.incomingTitle) : null}
      {/* "Thinking" cards while links resolve (paste OR WhatsApp arrivals). */}
      {pending.map((url) => (
        <div
          key={`p-${url}`}
          className="flex items-center gap-2.5 rounded-xl border border-[color:var(--sb-accent-border)] bg-[color:var(--sb-accent-soft)]/40 p-2.5"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-black/20">
            <svg className="h-5 w-5 animate-spin text-[#409cff]" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-slate-100">{t.resolving}</p>
            <p className="truncate text-[11px] text-slate-500" dir="ltr">{url}</p>
          </div>
        </div>
      ))}
      {cards.length === 0 && pending.length === 0 ? (
        <p className="px-1 py-6 text-center text-[12px] text-slate-600">{t.empty}</p>
      ) : (
        cards.map((c) => (
          <div key={c.id} className="rounded-xl border border-white/[0.07] bg-black/25 p-2.5">
            <div className="flex items-center gap-2.5">
              <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                {c.card.cover ? (
                  <HydrationSafeImage src={c.card.cover} alt="" className="h-full w-full object-cover" />
                ) : null}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-slate-50">{c.card.title}</p>
                <p className="truncate text-[11px] text-slate-400">{c.card.artist ?? c.card.type}</p>
              </div>
            </div>
            {c.note ? (
              <p className="mt-2 rounded-lg border border-[color:var(--sb-accent-border)] bg-[color:var(--sb-accent-soft)] px-2 py-1 text-center text-[11px] text-[#409cff]">
                {c.note}
              </p>
            ) : null}
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <button type="button" onClick={() => void addToGuests(c)} disabled={c.busy} className={BTN_PRIMARY}>
                {t.addToGuests}
              </button>
              <button type="button" onClick={() => void playNow(c)} disabled={c.busy} className={BTN_SECONDARY}>
                {t.playNow}
              </button>
              <button type="button" onClick={() => reject(c.id)} disabled={c.busy} className={BTN_GHOST}>
                {t.reject}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );

  // WhatsApp connect prompt (desktop bridge present but not connected yet).
  const waConnectBlock = wa ? (
    <div className="border-t border-white/[0.06] px-3 py-2.5">
      <button
        type="button"
        onClick={() => void connectWa()}
        disabled={waBusy}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--sb-accent-border)] bg-[color:var(--sb-accent-soft)] px-3 py-2 text-[13px] font-semibold text-[#409cff] transition active:scale-[0.99] disabled:opacity-50"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        {waBusy ? "…" : t.waConnect}
      </button>
      <p className="mt-1.5 text-[11px] text-slate-500">{t.waConnectHint}</p>
    </div>
  ) : null;

  return (
    <div
      dir={dir}
      className="sb-anim-rise flex max-h-[min(85vh,760px)] w-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101014]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[color:var(--sb-accent-soft)] text-[#409cff]">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>
          <span className="text-[15px] font-semibold text-slate-100">{t.title}</span>
          {embedded ? (
            <span className="ml-1 flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {t.waConnected}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-200"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {embedded ? (
        // Two panes: embedded WhatsApp (left) + Guest inbox (right).
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[58%] min-w-0 shrink-0 flex-col border-e border-white/[0.06]">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-300">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                WhatsApp
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleSolo}
                  title={waSolo ? t.waAllChats : t.waSolo}
                  className="rounded-lg border border-white/[0.12] bg-white/[0.04] px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-white/[0.08]"
                >
                  {waSolo ? t.waAllChats : t.waSolo}
                </button>
                <button
                  type="button"
                  onClick={() => void disconnectWa()}
                  disabled={waBusy}
                  className="rounded-lg px-2 py-1 text-[11px] text-slate-400 transition hover:text-slate-200 disabled:opacity-50"
                >
                  {t.waDisconnect}
                </button>
              </div>
            </div>
            {/* The native WhatsApp view is overlaid exactly on this box. */}
            <div
              ref={waRegionRef}
              className="relative m-2 mt-0 flex-1 overflow-hidden rounded-xl bg-black/50"
            >
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="text-[12px] text-slate-600">{t.waLoading}</span>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {inputBlock}
            <div className="border-t border-white/[0.06]" />
            {cardsBlock}
            {savedBlock}
          </div>
        </div>
      ) : (
        // Single column: paste + connect prompt + cards + saved GUESTS.
        <div className="flex min-h-0 flex-1 flex-col">
          {inputBlock}
          <div className="border-t border-white/[0.06]" />
          {cardsBlock}
          {savedBlock}
          {waConnectBlock}
        </div>
      )}
    </div>
  );
}

const BTN_PRIMARY =
  "flex items-center justify-center rounded-lg bg-[var(--sb-text)] px-2 py-1.5 text-[11px] font-semibold text-[#111114] transition active:scale-95 disabled:opacity-40 disabled:pointer-events-none";
const BTN_SECONDARY =
  "flex items-center justify-center rounded-lg border border-white/[0.12] bg-white/[0.04] px-2 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/[0.08] active:scale-95 disabled:opacity-40 disabled:pointer-events-none";
const BTN_GHOST =
  "flex items-center justify-center rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-400 transition hover:text-slate-200 active:scale-95 disabled:opacity-40 disabled:pointer-events-none";
