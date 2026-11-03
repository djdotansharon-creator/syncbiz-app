/**
 * READ-ONLY performance diagnostic (owner 2026-11-03, no behavior): the pilot PC feels slow (a button answers late, a song switch takes seconds)
 * and nothing says whether the PC is weak or the web code is heavy. Inside the desktop shell the desktop's main.log keeps the renderer's warn / error
 * lines, so this writes (as warn lines, tag `[VONO perf-diag]`):
 *   - once, ~10 s after start: the hardware the page runs on (cores, memory, screen, graphics level, the GPU's name — "SwiftShader" = no hardware graphics);
 *   - every click / key press that took >= 120 ms to be painted, split into input delay / our code / waiting for the paint, with the button's name;
 *   - every long animation frame >= 200 ms, split into scripts / style + layout / paint, with the slowest script;
 *   - a 10-minute summary (only when something slow happened).
 * Nothing is stored, sent or changed: observers + console.warn only, rate-limited (12 lines a minute, 300 a session) so the log never floods.
 * Active in the desktop shell, or in any browser that set localStorage "syncbiz-perfdiag" = "1" (lines go to the DevTools console).
 * REMOVE (or keep, owner's call) once the slow-PC question is answered.
 */

const TAG = "[VONO perf-diag] ";
const EVENT_MIN_MS = 120;
const FRAME_MIN_MS = 200;
const MAX_LINES_PER_MINUTE = 12;
const MAX_LINES_PER_SESSION = 300;
const SUMMARY_EVERY_MS = 10 * 60 * 1000;

type EventTimingLike = PerformanceEntry & { processingStart: number; processingEnd: number; interactionId?: number; target?: Node | null };
type ScriptTimingLike = { duration: number; invoker?: string; sourceURL?: string; sourceFunctionName?: string; sourceCharPosition?: number };
type FrameTimingLike = PerformanceEntry & { blockingDuration?: number; renderStart?: number; styleAndLayoutStart?: number; scripts?: ScriptTimingLike[] };

let started = false;

function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "syncbizDesktop" in window;
}

function optedIn(): boolean {
  try {
    return window.localStorage.getItem("syncbiz-perfdiag") === "1";
  } catch {
    return false;
  }
}

function targetLabel(t: Node | null | undefined): string {
  if (!t || !(t instanceof Element)) return "?";
  const el = t.closest("button, a, [role=button], input, select, summary") ?? t;
  const name = el.getAttribute("aria-label") || el.getAttribute("title") || "";
  return (name || el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.split(/\s+/)[0] : "")).slice(0, 40);
}

function gpuName(): string {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "no-webgl";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name.slice(0, 120);
  } catch {
    return "error";
  }
}

export function startDesktopPerfDiag(): () => void {
  if (started || typeof window === "undefined" || !(isDesktopShell() || optedIn())) return () => undefined;
  started = true;

  let minuteStart = Date.now();
  let minuteLines = 0;
  let sessionLines = 0;
  let dropped = 0;
  const stats = { frames: 0, worstFrame: 0, events: 0, worstEvent: 0 };

  const emit = (step: string, data: Record<string, unknown>): void => {
    const now = Date.now();
    if (now - minuteStart >= 60_000) {
      minuteStart = now;
      minuteLines = 0;
    }
    if (minuteLines >= MAX_LINES_PER_MINUTE || sessionLines >= MAX_LINES_PER_SESSION) {
      dropped++;
      return;
    }
    minuteLines++;
    sessionLines++;
    try {
      console.warn(TAG + step + " " + JSON.stringify(dropped > 0 ? { ...data, droppedBefore: dropped } : data));
      dropped = 0;
    } catch {
      /* ignore */
    }
  };

  const observers: PerformanceObserver[] = [];
  const supported = typeof PerformanceObserver !== "undefined" ? PerformanceObserver.supportedEntryTypes ?? [] : [];
  const observe = (type: string, init: PerformanceObserverInit, onEntry: (e: PerformanceEntry) => void): void => {
    if (!supported.includes(type)) return;
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) onEntry(e);
      });
      po.observe({ type, ...init } as PerformanceObserverInit);
      observers.push(po);
    } catch {
      /* ignore */
    }
  };

  observe("event", { durationThreshold: EVENT_MIN_MS } as PerformanceObserverInit, (entry) => {
    const e = entry as EventTimingLike;
    if (e.name !== "click" && e.name !== "keydown") return;
    const ms = Math.round(e.duration);
    stats.events++;
    stats.worstEvent = Math.max(stats.worstEvent, ms);
    emit("slow input", {
      type: e.name,
      ms,
      inputDelayMs: Math.round(e.processingStart - e.startTime),
      codeMs: Math.round(e.processingEnd - e.processingStart),
      paintWaitMs: Math.max(0, Math.round(e.startTime + e.duration - e.processingEnd)),
      target: targetLabel(e.target),
    });
  });

  observe("long-animation-frame", {}, (entry) => {
    const f = entry as FrameTimingLike;
    const ms = Math.round(f.duration);
    if (ms < FRAME_MIN_MS) return;
    stats.frames++;
    stats.worstFrame = Math.max(stats.worstFrame, ms);
    const scripts = f.scripts ?? [];
    const scriptMs = Math.round(scripts.reduce((n, s) => n + s.duration, 0));
    const slowest = scripts.reduce<ScriptTimingLike | null>((top, s) => (!top || s.duration > top.duration ? s : top), null);
    const styleLayoutMs = f.styleAndLayoutStart && f.styleAndLayoutStart > 0 ? Math.max(0, Math.round(f.startTime + f.duration - f.styleAndLayoutStart)) : 0;
    emit("long frame", {
      ms,
      blockMs: Math.round(f.blockingDuration ?? 0),
      scriptMs,
      styleLayoutMs,
      slowest: slowest
        ? { ms: Math.round(slowest.duration), fn: (slowest.sourceFunctionName || slowest.invoker || "").slice(0, 60), file: (slowest.sourceURL || "").split("/").pop()?.slice(0, 50) ?? "", pos: slowest.sourceCharPosition ?? -1 }
        : null,
    });
  });

  const hwTimer = window.setTimeout(() => {
    emit("hardware", {
      cores: navigator.hardwareConcurrency ?? null,
      memGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      dpr: Math.round(window.devicePixelRatio * 100) / 100,
      screen: window.screen.width + "x" + window.screen.height,
      window: window.innerWidth + "x" + window.innerHeight,
      fx: document.documentElement.getAttribute("data-sb-fx") === "lite" ? "lite" : "full",
      display: document.documentElement.getAttribute("data-sb-display") ?? "",
      gpu: gpuName(),
    });
  }, 10_000);

  const summaryTimer = window.setInterval(() => {
    if (stats.frames === 0 && stats.events === 0) return;
    emit("summary 10 min", { slowFrames: stats.frames, worstFrameMs: stats.worstFrame, slowInputs: stats.events, worstInputMs: stats.worstEvent });
    stats.frames = 0;
    stats.worstFrame = 0;
    stats.events = 0;
    stats.worstEvent = 0;
  }, SUMMARY_EVERY_MS);

  return () => {
    window.clearTimeout(hwTimer);
    window.clearInterval(summaryTimer);
    observers.forEach((o) => o.disconnect());
    started = false;
  };
}
