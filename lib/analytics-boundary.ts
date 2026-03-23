/**
 * Stage 2 – Analytics/Events boundary.
 * Defines where future event collection should attach.
 * Does NOT implement any analytics pipeline.
 *
 * SEPARATION:
 * - Operational data: User, Branch, Membership, Session, Device access
 * - Analytics/events: PlaybackEvent, RecommendationSignals, etc.
 * Events are emitted from operational flows but stored/processed separately.
 */

/** Future: playback event for analytics. Not implemented now. */
export type PlaybackEvent = {
  id: string;
  deviceId: string;
  branchId: string;
  sourceId?: string;
  startedAt: string;
  endedAt?: string;
  userId?: string;
};

/** Future: event collection hook. Attach here later. */
export type EventHook = (event: { type: string; payload: unknown }) => void;

/** No-op by default. Replace with real sink when building analytics. */
let eventHook: EventHook | null = null;

/** Register a global event hook. Call from app init when analytics is ready. */
export function setEventHook(hook: EventHook | null): void {
  eventHook = hook;
}

/** Emit an event. Does nothing unless hook is set. */
export function emitEvent(type: string, payload: unknown): void {
  eventHook?.({ type, payload });
}

/**
 * Event types that can later be emitted.
 * These are conceptual – no implementation in this slice.
 */
export const EVENT_TYPES = {
  PLAYBACK_STARTED: "playback_started",
  PLAYBACK_ENDED: "playback_ended",
  SOURCE_PLAYED: "source_played",
  GUEST_RECOMMENDATION: "guest_recommendation",
  USER_LOGIN: "user_login",
  USER_CREATED: "user_created",
  USER_UPDATED: "user_updated",
  BRANCH_ASSIGNMENT_CHANGED: "branch_assignment_changed",
} as const;
