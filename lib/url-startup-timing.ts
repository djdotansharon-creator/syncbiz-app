/**
 * URL drop → playback startup timing (diagnostic only).
 * Logs under `[SyncBiz Audit] url_timing` — no behavior changes.
 */

export type UrlTimingMark = {
  stage: string;
  msFromDrop: number;
  stageDurationMs: number;
  cumulativeMs: number;
  meta?: Record<string, unknown>;
};

type ActiveUrlTimingSession = {
  id: string;
  originPerf: number;
  marks: Array<{ stage: string; t: number; meta?: Record<string, unknown> }>;
};

let activeSession: ActiveUrlTimingSession | null = null;

function canTime(): boolean {
  return typeof performance !== "undefined";
}

/** Begin a new timing session (player URL drop). */
export function urlTimingStart(meta?: Record<string, unknown>): void {
  if (!canTime()) return;
  activeSession = {
    id: `url-${Date.now()}`,
    originPerf: performance.now(),
    marks: [],
  };
  urlTimingMark("drop_start", meta);
}

/** Record a pipeline stage relative to drop_start. */
export function urlTimingMark(stage: string, meta?: Record<string, unknown>): void {
  if (!activeSession || !canTime()) return;
  const t = performance.now() - activeSession.originPerf;
  activeSession.marks.push({ stage, t, meta });
  console.log("[SyncBiz Audit] url_timing mark", {
    sessionId: activeSession.id,
    stage,
    msFromDrop: Math.round(t),
    ...meta,
  });
}

/** Build timing rows for summary table. */
export function urlTimingRows(): UrlTimingMark[] {
  if (!activeSession) return [];
  const marks = activeSession.marks;
  return marks.map((m, i) => {
    const prevT = i > 0 ? marks[i - 1]!.t : 0;
    return {
      stage: m.stage,
      msFromDrop: Math.round(m.t),
      stageDurationMs: Math.round(m.t - prevT),
      cumulativeMs: Math.round(m.t),
      meta: m.meta,
    };
  });
}

/** Log consolidated timing table and clear session. */
export function urlTimingSummary(extra?: Record<string, unknown>): void {
  if (!activeSession) return;
  const rows = urlTimingRows();
  const totalMs = rows.length > 0 ? rows[rows.length - 1]!.cumulativeMs : 0;
  let slowest = rows[0];
  for (const r of rows) {
    if (!slowest || r.stageDurationMs > slowest.stageDurationMs) slowest = r;
  }
  console.log("[SyncBiz Audit] url_timing summary", {
    sessionId: activeSession.id,
    totalMs,
    slowestStage: slowest?.stage ?? null,
    slowestStageMs: slowest?.stageDurationMs ?? 0,
    rows,
    ...extra,
  });
  activeSession = null;
}

export function urlTimingActive(): boolean {
  return activeSession != null;
}
