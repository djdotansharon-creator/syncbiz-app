"use client";

import { useEffect, useRef, useState } from "react";

// Bump on each meaningful deploy so a pasted diagnostic proves which build the
// desktop actually loaded (Electron can keep serving an old renderer until a
// FULL quit + relaunch). If this shows an old value, the fix hasn't loaded yet.
const DIAG_BUILD = "sh2-2026-07-20";

/**
 * DISPLAY-ONLY desktop playback diagnostic.
 *
 * Chasing an intermittent bug where, on the desktop MASTER, a track LOADS but
 * does not progress (local files too, no error shown), then sometimes starts
 * after minutes — a refresh reliably fixes it. That rules out yt-dlp (local
 * also fails) and the 4s stall (no error surfaced), pointing at the renderer→MPV
 * dispatch or the MPV engine.
 *
 * HARD CONSTRAINTS (per approval):
 *   • Read-only. Never triggers retry / reload / play / any transport command.
 *   • Changes nothing in MPV, the dispatch path, MASTER/CONTROL, queue, or
 *     playlist playback. Every value here is tracked inside THIS component.
 *   • Desktop + local-MPV only (never mobile/streamer/CONTROL-mirror).
 *   • Shows only after the failure has persisted > 4.5s; auto-hides on recovery.
 *   • Does NOT claim "no sound" when MPV reports playing AND position advances.
 *
 * Failure = intent is "playing", yet the source was not dispatched, OR MPV is
 * idle/paused, OR MPV reports playing but position is not advancing.
 *
 * URLs are sanitized to host + short path (query string / tokens stripped).
 */

function classifySource(url: string | null): string {
  if (!url) return "none";
  const low = url.toLowerCase();
  if (low.startsWith("file:") || low.startsWith("/") || /^[a-z]:\\/i.test(url)) return "local-file";
  if (low.includes("youtube.com") || low.includes("youtu.be") || low.startsWith("ytdl:")) return "youtube";
  if (low.includes("soundcloud")) return "soundcloud";
  if (low.startsWith("http")) return "http-stream";
  return "other";
}

/** host + short path, never the query string (may carry tokens). */
function sanitizeUrl(u: string | null): string {
  if (!u) return "—";
  try {
    const parsed = new URL(u);
    const path = parsed.pathname.length > 28 ? `${parsed.pathname.slice(0, 28)}…` : parsed.pathname;
    return `${parsed.host}${path}${parsed.search ? " (+query)" : ""}`;
  } catch {
    // Local path / non-URL: show only the final segment.
    const seg = u.split(/[\\/]/).filter(Boolean).pop() ?? u;
    return seg.length > 40 ? `…${seg.slice(-40)}` : seg;
  }
}

export function DesktopPlaybackDiagnostic(props: {
  isDesktop: boolean;
  isControlMirror: boolean;
  intentStatus: string;
  mpvStatus: string | null;
  engineReady: boolean | null;
  lastError: string | null;
  position: number | null;
  duration: number | null;
  currentPlayUrl: string | null;
  dispatchedUrl: string | null;
  chAStatus: string | null;
  /** Real wall-clock of the LAST actual dispatch to MPV (incl. self-heal re-sends). */
  lastDispatchAt?: number | null;
  /** How many self-heal re-dispatches have fired for the current track. */
  selfHealAttempts?: number | null;
}) {
  const {
    isDesktop,
    isControlMirror,
    intentStatus,
    mpvStatus,
    engineReady,
    lastError,
    position,
    duration,
    currentPlayUrl,
    dispatchedUrl,
    chAStatus,
    lastDispatchAt,
    selfHealAttempts,
  } = props;

  // ── Component-local tracking (no writes back into the player) ──────────────
  // When the play intent last began.
  const playAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (intentStatus === "playing") {
      if (playAtRef.current === null) playAtRef.current = Date.now();
    } else {
      playAtRef.current = null;
    }
  }, [intentStatus]);

  // When a URL was last handed to MPV (observed via the dispatched-url changing).
  const lastDispatchAtRef = useRef<number | null>(null);
  const prevDispatchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (dispatchedUrl && dispatchedUrl !== prevDispatchedRef.current) {
      lastDispatchAtRef.current = Date.now();
    }
    prevDispatchedRef.current = dispatchedUrl;
  }, [dispatchedUrl]);

  // Position-advancing detector: remember the last time position increased.
  const lastPosAdvanceAtRef = useRef<number | null>(null);
  const prevPosRef = useRef<number>(-1);
  useEffect(() => {
    const p = position ?? 0;
    if (p > prevPosRef.current) lastPosAdvanceAtRef.current = Date.now();
    prevPosRef.current = p;
  }, [position]);

  // ── Failure evaluation ─────────────────────────────────────────────────────
  const now = Date.now();
  const positionAdvancing =
    lastPosAdvanceAtRef.current !== null && now - lastPosAdvanceAtRef.current < 3000;
  const actuallyPlaying = mpvStatus === "playing" && positionAdvancing;

  const notDispatched = !dispatchedUrl || (!!currentPlayUrl && dispatchedUrl !== currentPlayUrl);
  const mpvIdleOrPaused = mpvStatus == null || mpvStatus === "idle" || mpvStatus === "paused";
  const stalled = mpvStatus === "playing" && !positionAdvancing;

  const failure =
    isDesktop &&
    !isControlMirror &&
    intentStatus === "playing" &&
    !actuallyPlaying &&
    (notDispatched || mpvIdleOrPaused || stalled || engineReady === false);

  // Reveal only after the failure holds > 4.5s (never during a normal load).
  const [visible, setVisible] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!failure) {
      if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
      setVisible(false);
      return;
    }
    if (revealTimerRef.current) return;
    revealTimerRef.current = setTimeout(() => {
      revealTimerRef.current = null;
      setVisible(true);
    }, 4500);
    return () => {
      if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
    };
  }, [failure]);

  // While visible, tick every second so the elapsed timers update live.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [visible]);

  const [copied, setCopied] = useState(false);

  if (!visible) return null;

  const secsSince = (t: number | null) => (t === null ? "—" : `${((Date.now() - t) / 1000).toFixed(1)}s`);
  // Prefer the real dispatch timestamp from the player (includes self-heal
  // re-sends of the SAME url, which the url-change observer above can't see).
  const effLastDispatch =
    typeof lastDispatchAt === "number" && lastDispatchAt > 0 ? lastDispatchAt : lastDispatchAtRef.current;
  const reason = notDispatched
    ? "url NOT sent to MPV"
    : engineReady === false
    ? "MPV engine not ready"
    : mpvIdleOrPaused
    ? `MPV is ${mpvStatus ?? "null"} (not playing)`
    : stalled
    ? "MPV playing but position frozen"
    : "unknown";

  const rows: Array<[string, string]> = [
    ["build", DIAG_BUILD],
    ["self-heal tries", selfHealAttempts == null ? "—" : String(selfHealAttempts)],
    ["reason", reason],
    ["since Play", secsSince(playAtRef.current)],
    ["intent", intentStatus],
    ["source type", classifySource(currentPlayUrl)],
    ["url computed", currentPlayUrl ? "yes" : "NO"],
    ["url sent→MPV", dispatchedUrl ? "yes" : "NO"],
    ["last sent ago", secsSince(effLastDispatch)],
    ["mpv.status", mpvStatus ?? "—"],
    ["mpv.chA", chAStatus ?? "—"],
    ["engineReady", engineReady === null ? "—" : String(engineReady)],
    ["pos / dur", `${(position ?? 0).toFixed(1)} / ${(duration ?? 0).toFixed(1)}`],
    ["advancing", String(positionAdvancing)],
    ["lastError", lastError ?? "—"],
    ["url", sanitizeUrl(currentPlayUrl)],
    ["dispatched", sanitizeUrl(dispatchedUrl)],
  ];

  const copyText = [
    "SyncBiz desktop playback diagnostic",
    ...rows.map(([k, v]) => `${k}: ${v}`),
  ].join("\n");

  const handleCopy = () => {
    try {
      void navigator.clipboard?.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the screenshot still carries everything */
    }
  };

  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-2 left-2 z-50 max-w-[94%] rounded-lg border border-[#ff453a]/60 bg-black/85 px-3 py-2 font-mono text-[10px] leading-[1.5] text-white shadow-lg"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="font-semibold text-[#ff9f0a]">⚠ playback stuck (intent=playing, no progress)</span>
        <button
          type="button"
          onClick={handleCopy}
          className="pointer-events-auto rounded border border-white/30 bg-white/10 px-2 py-[1px] text-[9px] text-white/90 hover:bg-white/20"
        >
          {copied ? "Copied ✓" : "Copy diagnostics"}
        </button>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="w-[86px] shrink-0 text-white/50">{k}</span>
          <span className="break-all text-white/90">{v}</span>
        </div>
      ))}
    </div>
  );
}
