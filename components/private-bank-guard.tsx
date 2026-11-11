"use client";

/**
 * PRIVATE BANK GUARD (owner 2026-11-11) — "we never cut a business's music in the middle of the day, and never leave it
 * silent". When a private bank is switched off (Platform → Accounts) it keeps playing until the next 04:00 in branch time
 * (server: lib/music-bank/day-boundary.ts + bank-access.ts; the media token keeps it CLOSE_GRACE_MS longer). After that
 * moment, if THIS station is playing that bank, this guard sends the business's FALLBACK MUSIC — exactly the way a
 * schedule starts music (runSchedulePlayback / playSourceOrSend → PLAY_SOURCE → MAIN), so MAIN is NOT changed:
 *   - while a bank song plays → at the song's mix point (the next song starts with the normal crossfade);
 *   - after a reboot (MAIN's saved bank source is refused: bootSource url-pending / url-failed) or when the station went
 *     idle on that bank → right away.
 * Gating: only the designated station's own window (schedule route "station", URL-ready), never a phone / browser /
 * non-designated desktop; at most one send per (bank, close time, MAIN attempt) + one retry. Refs only on the status hot
 * path (MAIN status arrives several times a second) — React state changes only when the notice changes.
 * Also feeds the notice pill (components/private-bank-notice.tsx) through a tiny module store. Renders null.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useSchedulePlaybackHandlers } from "@/lib/use-schedule-playback-handlers";
import { runSchedulePlayback } from "@/lib/schedule-playback-client";
import { stationMayStart } from "@/lib/schedule-station-route";
import { usePlayback } from "@/lib/playback-provider";
import { getAutoMix, getMixDuration } from "@/lib/mix-preferences";
import { buildGeneralMixFallbackSource, isMusicBankSourceOf } from "@/lib/music-bank/stream-source";
import type { Schedule } from "@/lib/types";

export type GuardBank = {
  bankId: string;
  name: string;
  state: "open" | "closing" | "closed";
  endsAt: string | null;
  reason: "manual" | "payment" | "end-date" | null;
};
type BankStatusResponse = { banks: GuardBank[]; fallbackPlaylistId: string | null };

const POLL_MS = 5 * 60 * 1000;
const RETRY_AFTER_MS = 20_000;

// ── notice store (read by the pill) ──
let noticeBanks: GuardBank[] = [];
const noticeListeners = new Set<() => void>();
function setNoticeBanks(next: GuardBank[]): void {
  const key = (l: GuardBank[]) => JSON.stringify(l.map((b) => [b.bankId, b.state, b.endsAt, b.reason]));
  if (key(next) === key(noticeBanks)) return;
  noticeBanks = next;
  noticeListeners.forEach((fn) => fn());
}
/** Banks the station should tell the staff about: closing (ends later) or closed within the last week. */
export function useBankNotice(): GuardBank[] {
  return useSyncExternalStore(
    (fn) => {
      noticeListeners.add(fn);
      return () => noticeListeners.delete(fn);
    },
    () => noticeBanks,
    () => noticeBanks,
  );
}

type MainStatus = {
  mockSelectedLibraryId?: unknown;
  mockPlaybackStatus?: unknown;
  mpvAttemptId?: unknown;
  mpvAttemptPending?: unknown;
  mpvPosition?: unknown;
  mpvDuration?: unknown;
  bootSource?: unknown;
  mpvLastError?: unknown;
};

export function PrivateBankGuard() {
  const router = useRouter();
  const handlers = useSchedulePlaybackHandlers();
  const { isRestoring } = usePlayback();
  const isStation = handlers.route?.kind === "station";

  const ctxRef = useRef({ router, handlers, isRestoring });
  useEffect(() => {
    ctxRef.current = { router, handlers, isRestoring };
  });
  const statusRef = useRef<BankStatusResponse>({ banks: [], fallbackPlaylistId: null });
  const firedRef = useRef<{ key: string; at: number; tries: number } | null>(null);
  const busyRef = useRef(false);

  // ── poll the business's bank status (station window only) ──
  useEffect(() => {
    if (!isStation) {
      setNoticeBanks([]);
      return;
    }
    let cancelled = false;
    let endTimer: number | null = null;
    const load = async () => {
      try {
        const r = await fetch("/api/music-bank/bank-status", { credentials: "include", cache: "no-store" });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as BankStatusResponse;
        statusRef.current = { banks: Array.isArray(j.banks) ? j.banks : [], fallbackPlaylistId: j.fallbackPlaylistId ?? null };
        setNoticeBanks(statusRef.current.banks.filter((b) => b.state !== "open"));
        // re-read right after the next close time so "closing" → "closed" without waiting for the next poll
        if (endTimer) window.clearTimeout(endTimer);
        const next = statusRef.current.banks
          .map((b) => (b.state === "closing" && b.endsAt ? Date.parse(b.endsAt) - Date.now() : Infinity))
          .reduce((a, b) => Math.min(a, b), Infinity);
        if (Number.isFinite(next) && next < POLL_MS) endTimer = window.setTimeout(() => void load(), Math.max(1000, next + 2000));
      } catch {
        /* offline / transient — keep the last known status, retry next poll */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (endTimer) window.clearTimeout(endTimer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [isStation]);

  // ── watch MAIN's status and switch a closed bank to the fallback ──
  useEffect(() => {
    if (!isStation || typeof window === "undefined") return;
    const desktop = (window as unknown as { syncbizDesktop?: { onStatus?: (cb: (s: MainStatus) => void) => (() => void) | void } }).syncbizDesktop;
    if (typeof desktop?.onStatus !== "function") return;

    const fire = async (bank: GuardBank, why: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const { handlers: h, router: r } = ctxRef.current;
        const fallbackId = statusRef.current.fallbackPlaylistId;
        let ok = false;
        if (fallbackId) {
          ok = await runSchedulePlayback(
            { targetType: "PLAYLIST", targetId: fallbackId, sourceId: null } as unknown as Schedule,
            null,
            { stop: h.stop, setQueue: h.setQueue, playSource: h.playSource, setLastMessage: h.setLastMessage, route: h.route },
            r,
          ).catch(() => false);
        }
        if (!ok) {
          const src = buildGeneralMixFallbackSource(window.location.origin);
          if (src && h.route?.kind === "station" && stationMayStart(h.route, src.type)) {
            h.setQueue([src], { force: true });
            h.playSource(src, 0);
            ok = true;
          }
        }
        console.info(`[VONO bank-guard] "${bank.name}" closed (${why}) → fallback ${fallbackId ? "playlist" : "general mix"}: ${ok ? "sent" : "not sent (will retry)"}`);
      } finally {
        busyRef.current = false;
      }
    };

    const onStatus = (st: MainStatus) => {
      const now = Date.now();
      const closed = statusRef.current.banks.filter((b) => b.state === "closed" || (b.endsAt != null && Date.parse(b.endsAt) <= now));
      if (closed.length === 0) return;
      const libId = typeof st.mockSelectedLibraryId === "string" ? st.mockSelectedLibraryId : null;
      const bank = closed.find((b) => isMusicBankSourceOf(libId, b.bankId));
      if (!bank) return;
      const route = ctxRef.current.handlers.route;
      if (route?.kind !== "station" || !route.urlReady) return; // the fallback travels to MAIN over the cloud WS — wait for it

      const status = typeof st.mockPlaybackStatus === "string" ? st.mockPlaybackStatus : "idle";
      const attempt = typeof st.mpvAttemptId === "number" ? st.mpvAttemptId : 0;
      const pending = st.mpvAttemptPending === true;
      const boot = typeof st.bootSource === "string" ? st.bootSource : null;
      const pos = typeof st.mpvPosition === "number" ? st.mpvPosition : 0;
      const dur = typeof st.mpvDuration === "number" ? st.mpvDuration : 0;

      let why: string | null = null;
      if (boot === "url-pending" || boot === "url-failed") why = `restore ${boot}`;
      // idle only counts when MAIN stopped on an ERROR (a refused bank song) — never restart music the staff stopped on purpose
      else if (status === "idle" && !pending && typeof st.mpvLastError === "string" && st.mpvLastError) why = "station stopped on an error";
      else if (status === "playing" && dur > 0) {
        const mix = getAutoMix() ? getMixDuration() : 1;
        if (dur - pos <= Math.max(1, mix) + 1.5) why = "song mix point";
      }
      if (!why) return;
      if (ctxRef.current.isRestoring && !why.startsWith("restore")) return; // the renderer's own boot restore runs first

      const key = `${bank.bankId}|${bank.endsAt}|${attempt}`;
      const f = firedRef.current;
      if (f && f.key === key) {
        if (f.tries >= 2 || now - f.at < RETRY_AFTER_MS) return; // one send + one retry per bank / close / attempt
        firedRef.current = { key, at: now, tries: f.tries + 1 };
      } else {
        firedRef.current = { key, at: now, tries: 1 };
      }
      void fire(bank, why);
    };

    const unsub = desktop.onStatus(onStatus);
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [isStation]);

  return null;
}
