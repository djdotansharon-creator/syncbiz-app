/**
 * CONTROL ROOM — the browser's side of "send a day of a schedule to my other branches" (owner 2026-11-25, phase 2). The ONLY place the screens talk to the server routes of phase 1:
 *   GET  /api/schedule-day-shares?status=pending|accepted|history|all&branchId=<id>        — the offers
 *   POST /api/schedule-day-shares/preview   { fromBranchId, weekday, targetBranchIds }      — dry run of a send (owner)
 *   POST /api/schedule-day-shares           { fromBranchId, weekday, targetBranchIds, requestId } — send (owner) → PENDING offers
 *   POST /api/schedule-day-shares/<id>      { action: preview | accept | decline | undo, mode, weekdays | date, conflict } — the receiving branch answers
 * Every call answers `{ ok: true, data }` or `{ ok: false, status, error }` — `error` is an ENGLISH sentence the screens run through `tr` (see `errorText` in lib/branch-schedule-lane.ts). Nothing throws.
 * A local file path or address never travels here: the offers carry only the whitelisted snapshot (CLAUDE.md §12).
 */
import type { AcceptResult, OfferView, PreviewResult, SendResult, UndoResult } from "@/lib/schedule-day-share-store";
import type { Conflict, SkippedBlock, SnapshotBlock, Warning } from "@/lib/schedule-day-share-rules";
import { errorText } from "@/lib/branch-schedule-lane";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export type OfferStatusQuery = "pending" | "accepted" | "history" | "all";
export type SendTargets = string[] | "all";
export type ApplyChoice = { mode: "weekday"; weekdays: number[]; conflict: "replace" | "alongside" } | { mode: "date"; date: string; conflict: "replace" | "alongside" };

/** what the server answers to "what would accepting do" — nothing is written */
export type AcceptPreview = { willPlace: SnapshotBlock[]; skipped: SkippedBlock[]; replaced: Conflict[]; ties: Conflict[]; warnings: Warning[]; applied: AcceptResult["applied"] };

export type { AcceptResult, OfferView, PreviewResult, SendResult, UndoResult };

async function call<T>(url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!r.ok) return { ok: false, status: r.status, error: errorText(r.status, j?.error) };
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, status: 0, error: errorText(0, null) };
  }
}

/** the offers of ONE branch the caller may use (or of every branch they may use when `branchId` is left out) */
export function listOffers(i: { status: OfferStatusQuery; branchId?: string }): Promise<ApiResult<OfferView[]>> {
  const q = new URLSearchParams({ status: i.status });
  if (i.branchId) q.set("branchId", i.branchId);
  return call<OfferView[]>(`/api/schedule-day-shares?${q.toString()}`);
}

/** dry run of a send — "7 fit, 2 can't be placed", which branches would get it */
export function previewSend(i: { fromBranchId: string; weekday: number; targetBranchIds: SendTargets }): Promise<ApiResult<PreviewResult>> {
  return call<PreviewResult>("/api/schedule-day-shares/preview", { fromBranchId: i.fromBranchId, weekday: i.weekday, targetBranchIds: i.targetBranchIds });
}

/** the send itself — `requestId` is ONE fresh id per click, so a retry of the same click sends once */
export function sendDay(i: { fromBranchId: string; weekday: number; targetBranchIds: SendTargets; requestId: string }): Promise<ApiResult<SendResult>> {
  return call<SendResult>("/api/schedule-day-shares", { fromBranchId: i.fromBranchId, weekday: i.weekday, targetBranchIds: i.targetBranchIds, requestId: i.requestId });
}

const applyBody = (c: ApplyChoice) => (c.mode === "weekday" ? { mode: "weekday", weekdays: c.weekdays, conflict: c.conflict } : { mode: "date", date: c.date, conflict: c.conflict });

/** what accepting WOULD do (writes nothing) */
export async function previewAccept(offerId: string, c: ApplyChoice): Promise<ApiResult<AcceptPreview>> {
  const r = await call<{ ok: true; preview?: AcceptPreview }>(`/api/schedule-day-shares/${encodeURIComponent(offerId)}`, { action: "preview", ...applyBody(c) });
  if (!r.ok) return r;
  return r.data.preview ? { ok: true, data: r.data.preview } : { ok: false, status: 500, error: errorText(500, null) };
}

/** accept: copies the day onto the receiving branch, once, in one transaction */
export async function acceptOffer(offerId: string, c: ApplyChoice): Promise<ApiResult<AcceptResult>> {
  const r = await call<{ ok: true; result?: AcceptResult }>(`/api/schedule-day-shares/${encodeURIComponent(offerId)}`, { action: "accept", ...applyBody(c) });
  if (!r.ok) return r;
  return r.data.result ? { ok: true, data: r.data.result } : { ok: false, status: 500, error: errorText(500, null) };
}

/** "Not now": the receiving branch says no (the sender can send it again) */
export async function declineOffer(offerId: string): Promise<ApiResult<true>> {
  const r = await call<{ ok: true }>(`/api/schedule-day-shares/${encodeURIComponent(offerId)}`, { action: "decline" });
  return r.ok ? { ok: true, data: true } : r;
}

/** go back: within 14 days removes the copied blocks that were not edited since, puts back what was replaced */
export async function undoOffer(offerId: string): Promise<ApiResult<UndoResult>> {
  const r = await call<{ ok: true; undo?: UndoResult }>(`/api/schedule-day-shares/${encodeURIComponent(offerId)}`, { action: "undo" });
  if (!r.ok) return r;
  return r.data.undo ? { ok: true, data: r.data.undo } : { ok: false, status: 500, error: errorText(500, null) };
}
