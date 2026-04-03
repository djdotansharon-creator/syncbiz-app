/**
 * TEMP: SyncBiz transport duplication diagnostics — remove after stabilization.
 * Tracks invocation counts and flags rapid duplicate next/playSource patterns.
 */

let nextInvocationTotal = 0;
let playSourceInvocationTotal = 0;
let trackChangedEmitTotal = 0;

let lastNextPerf = 0;
let lastNextSnapshot: { queueIndex: number; sourceId: string | null } | null = null;

let lastPlaySourcePerf = 0;
let lastPlaySourceId: string | null = null;

export function syncbizAuditTransportTransitionStart(detail: Record<string, unknown>): void {
  console.log("[SyncBiz Audit] transport transition start", detail);
}

export function syncbizAuditNextInvoked(detail: Record<string, unknown>): void {
  nextInvocationTotal++;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const dt = lastNextPerf ? now - lastNextPerf : null;
  const q = typeof detail.queueIndex === "number" ? detail.queueIndex : null;
  const sid = (detail.currentSourceId as string | null | undefined) ?? null;
  if (
    dt !== null &&
    dt < 160 &&
    lastNextSnapshot &&
    q !== null &&
    lastNextSnapshot.queueIndex === q &&
    lastNextSnapshot.sourceId === sid
  ) {
    console.warn("[SyncBiz Audit] duplicate advance detected", {
      kind: "rapid_next_same_queue_snapshot",
      dtMs: dt,
      totalNextInvocations: nextInvocationTotal,
      ...detail,
    });
  }
  lastNextPerf = now;
  if (q !== null) lastNextSnapshot = { queueIndex: q, sourceId: sid };

  console.log("[SyncBiz Audit] next invoked count", {
    total: nextInvocationTotal,
    dtSincePrevNextMs: dt,
    ...detail,
  });
}

export function syncbizAuditPlaySourceInvoked(detail: Record<string, unknown>): void {
  playSourceInvocationTotal++;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const dt = lastPlaySourcePerf ? now - lastPlaySourcePerf : null;
  const id = (detail.sourceId as string | undefined) ?? null;
  if (dt !== null && dt < 200 && lastPlaySourceId !== null && id !== null && lastPlaySourceId !== id) {
    console.warn("[SyncBiz Audit] duplicate advance detected", {
      kind: "rapid_playSource_different_targets",
      dtMs: dt,
      prevSourceId: lastPlaySourceId,
      nextSourceId: id,
      totalPlaySourceInvocations: playSourceInvocationTotal,
      ...detail,
    });
  }
  lastPlaySourcePerf = now;
  lastPlaySourceId = id;

  console.log("[SyncBiz Audit] playSource invoked count", {
    total: playSourceInvocationTotal,
    ...detail,
  });
}

export function syncbizAuditQueueIndexTransition(detail: {
  from: number;
  to: number;
  via: string;
  extra?: Record<string, unknown>;
}): void {
  console.log("[SyncBiz Audit] queueIndex transition", detail);
}

export function syncbizAuditCurrentSourceTransition(detail: {
  fromId: string | null;
  toId: string | null;
  via: string;
  extra?: Record<string, unknown>;
}): void {
  console.log("[SyncBiz Audit] currentSource transition", detail);
}

export function syncbizAuditPlayerCreationTarget(detail: Record<string, unknown>): void {
  console.log("[SyncBiz Audit] player creation target", detail);
}

export function syncbizAuditTrackChangedEmit(detail: Record<string, unknown>): void {
  trackChangedEmitTotal++;
  console.log("[SyncBiz Audit] track_changed emit count", {
    total: trackChangedEmitTotal,
    ...detail,
  });
}
