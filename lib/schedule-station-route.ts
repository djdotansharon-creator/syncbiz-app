/**
 * Schedule routing on the desktop station (PURE, no I/O) — 2026-11-04 incident (Lenovo + Dev-PC, PROVEN BY RUNTIME).
 *
 * ROOT CAUSE: a scheduled block on the designated station's OWN window was routed by `lib/use-routed-play-source.ts`, which
 * sends to MAIN only when `isBranchConnected && deviceMode === "CONTROL"`. The schedule can fire before the window's cloud WS
 * is connected (Dev-PC: 5 s after boot) or while it never reconnects (Lenovo: offline boot), so it played the track through
 * the renderer's OWN player (renderer attempt id) on top of MAIN's URL session → two playback owners: the screen kept
 * MAIN's session (wrong cover / queue) and, at the track's natural end, neither owner stepped forward (MAIN ignores a
 * renderer attempt — lib/url-eof-advance.ts "not-a-main-ws-attempt") → silence.
 *
 * RULE: on the designated station's own window a schedule starts EXACTLY like a manual library click (playSourceOrSend:
 * URL → MAIN's session, LOCAL → the accepted LOCAL path) and never stops the current music first. Until that route is known
 * (MAIN's designation snapshot not resolved yet) or a URL target cannot reach MAIN yet (cloud WS not connected), the
 * schedule does NOT fire — the current music keeps playing and the next poll retries. Every other window (browser, phone,
 * non-designated desktop) keeps its existing behavior ("default").
 */
export type ScheduleRoute =
  | { kind: "wait"; reason: "station-deciding" }
  | { kind: "station"; urlReady: boolean }
  | { kind: "default" };

export type ScheduleRouteInput = {
  /** Inside the desktop shell with MAIN's status bridge (window.syncbizDesktop.onStatus). */
  isDesktopShell: boolean;
  /** MAIN's designation snapshot has been received (true or false) — device-player-context `mainSnapResolved`. */
  mainSnapResolved: boolean;
  /** This machine is the branch's designated station — device-player-context `isDesignatedAudioStation` (canLocalExec). */
  isDesignatedStation: boolean;
  /** The window's cloud WS is connected to the branch. */
  isBranchConnected: boolean;
  /** A master device is known, so a PLAY_SOURCE has an addressee. */
  hasMaster: boolean;
};

export function decideScheduleRoute(i: ScheduleRouteInput): ScheduleRoute {
  if (!i.isDesktopShell) return { kind: "default" };
  if (!i.mainSnapResolved) return { kind: "wait", reason: "station-deciding" };
  if (!i.isDesignatedStation) return { kind: "default" };
  return { kind: "station", urlReady: i.isBranchConnected && i.hasMaster };
}

/** Station route: may a target of `sourceType` start now? LOCAL never needs the cloud; a URL travels to MAIN over the cloud WS. */
export function stationMayStart(route: { kind: "station"; urlReady: boolean }, sourceType: string | null | undefined): boolean {
  return sourceType === "local" || route.urlReady;
}
