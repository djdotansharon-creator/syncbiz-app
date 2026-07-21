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
  type GuestCard,
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
  waOpen: string;
  waDisconnect: string;
  waHint: string;
};

const EN: Copy = {
  title: "Guests",
  subtitle: "Paste a music link — review, then play or add to the GUESTS playlist.",
  open: "Open Guest inbox",
  close: "Close Guest inbox",
  placeholder: "Paste a music link (YouTube, SoundCloud…)",
  resolve: "Add",
  resolving: "Resolving…",
  empty: "No guest links yet. Paste a link above.",
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
  waOpen: "Open WhatsApp Web",
  waDisconnect: "Disconnect",
  waHint: "In WhatsApp, tap a music link (YouTube / SoundCloud / Spotify) — it lands here.",
};

const HE: Copy = {
  title: "אורחים",
  subtitle: "הדביקו קישור לשיר — לבדוק, ואז לנגן או להוסיף לפלייליסט GUESTS.",
  open: "פתיחת תיבת האורחים",
  close: "סגירת תיבת האורחים",
  placeholder: "הדביקו קישור לשיר (YouTube, SoundCloud…)",
  resolve: "הוסף",
  resolving: "מזהה…",
  empty: "עדיין אין קישורים. הדביקו קישור למעלה.",
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
  waOpen: "פתח WhatsApp Web",
  waDisconnect: "נתק",
  waHint: "ב-WhatsApp, הקישו על קישור לשיר (YouTube / SoundCloud / Spotify) — הוא יופיע כאן.",
};

let cardSeq = 0;

type WaStatus = { connected: boolean; windowOpen: boolean };
type DesktopWA = {
  connectWhatsApp: () => Promise<WaStatus>;
  disconnectWhatsApp: () => Promise<WaStatus>;
  showWhatsAppWindow: () => Promise<void>;
  onWhatsAppUrl: (cb: (url: string) => void) => () => void;
  onWhatsAppStatus: (cb: (s: WaStatus) => void) => () => void;
};

/** The desktop bridge is only present in the Electron app (not the browser/mobile). */
function getDesktopWA(): DesktopWA | null {
  if (typeof window === "undefined") return null;
  const d = (window as unknown as { syncbizDesktop?: Partial<DesktopWA> }).syncbizDesktop;
  return d && typeof d.connectWhatsApp === "function" ? (d as DesktopWA) : null;
}

export function GuestInboxDrawer({
  drawerOpen,
  onDrawerOpenChange,
}: {
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
}): ReactElement {
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

  const close = useCallback(() => onDrawerOpenChange(false), [onDrawerOpenChange]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, close]);

  const patch = useCallback((id: string, p: Partial<CardState>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...p } : c)));
  }, []);

  /** Resolve any URL (manual paste OR a WhatsApp click) into a card. */
  const addCardFromUrl = useCallback(async (rawUrl: string): Promise<boolean> => {
    const url = rawUrl.trim();
    if (!url) return false;
    const card = await resolveGuestCard(url);
    if (!card) return false;
    setCards((prev) => {
      if (prev.some((c) => c.card.rawUrl === card.rawUrl)) return prev; // de-dupe
      return [{ id: `g-${++cardSeq}`, card, source: null, busy: false, note: null }, ...prev];
    });
    return true;
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

  // ── WhatsApp (desktop-only) ──
  const wa = useMemo(() => getDesktopWA(), []);
  const [waStatus, setWaStatus] = useState<WaStatus>({ connected: false, windowOpen: false });
  const [waBusy, setWaBusy] = useState(false);
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
      } catch {
        patch(c.id, { busy: false, note: t.failed });
      }
    },
    [ensureSource, patch, t.added, t.alreadyThere, t.failed],
  );

  const reject = useCallback((id: string) => setCards((prev) => prev.filter((c) => c.id !== id)), []);

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (drawerOpen) inputRef.current?.focus();
  }, [drawerOpen]);

  return (
    <>
      {/* Launcher card in the rail (mirrors the DJ Creator shell). */}
      <section className="rounded-2xl border border-white/[0.06] bg-[#101014] p-3.5" dir={dir}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-100">{t.title}</p>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{t.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => onDrawerOpenChange(true)}
            className="shrink-0 rounded-xl bg-[var(--sb-text)] px-3 py-2 text-[12px] font-semibold text-[#111114] transition active:scale-95"
          >
            {t.open}
          </button>
        </div>
      </section>

      {drawerOpen ? (
        <>
          <button
            type="button"
            aria-label={t.close}
            onClick={close}
            className="fixed inset-0 z-[119] bg-slate-950/20"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.title}
            dir={dir}
            className="fixed bottom-3 right-3 z-[120] flex h-[min(680px,calc(100vh-3rem))] w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101014] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[color:var(--sb-accent-soft)] text-[#409cff]">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </span>
                <span className="text-[14px] font-semibold text-slate-100">{t.title}</span>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label={t.close}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-200"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* URL input */}
            <div className="border-b border-white/[0.06] px-3 py-3">
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

            {/* WhatsApp (desktop app only) */}
            {wa ? (
              <div className="border-b border-white/[0.06] px-3 py-2.5">
                {!waStatus.connected ? (
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
                ) : (
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="flex flex-1 items-center gap-1.5 text-[12px] font-medium text-emerald-300">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        {t.waConnected}
                      </span>
                      <button
                        type="button"
                        onClick={() => void wa.showWhatsAppWindow()}
                        className="rounded-lg border border-white/[0.12] bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-white/[0.08]"
                      >
                        {t.waOpen}
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
                    <p className="mt-1.5 text-[11px] text-slate-500">{t.waHint}</p>
                  </div>
                )}
              </div>
            ) : null}

            {/* Cards */}
            <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
              {cards.length === 0 ? (
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
          </div>
        </>
      ) : null}
    </>
  );
}

const BTN_PRIMARY =
  "flex items-center justify-center rounded-lg bg-[var(--sb-text)] px-2 py-1.5 text-[11px] font-semibold text-[#111114] transition active:scale-95 disabled:opacity-40 disabled:pointer-events-none";
const BTN_SECONDARY =
  "flex items-center justify-center rounded-lg border border-white/[0.12] bg-white/[0.04] px-2 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/[0.08] active:scale-95 disabled:opacity-40 disabled:pointer-events-none";
const BTN_GHOST =
  "flex items-center justify-center rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-400 transition hover:text-slate-200 active:scale-95 disabled:opacity-40 disabled:pointer-events-none";
