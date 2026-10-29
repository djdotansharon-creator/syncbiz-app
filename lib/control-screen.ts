/**
 * The routes that make up the CONTROL SCREEN (owner 2026-10-29): Control Room, Dashboard, Permissions (+ the Display screen under it) and Settings — one separate plain-black screen,
 * not part of the player. Pure (no React / CSS), so the app shell, the control bar and the tests share ONE definition.
 */
export const CONTROL_SCREEN_ROUTE = /^\/(dashboard|access-control|owner\/control-room|settings)(\/|$)/;

export function isControlScreenPath(pathname: string | null | undefined): boolean {
  return CONTROL_SCREEN_ROUTE.test(pathname ?? "");
}
