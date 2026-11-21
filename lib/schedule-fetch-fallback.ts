/**
 * When may the schedule engine use its LAST COPY of the branch's schedules instead of a fresh answer? (PURE, 2026-11-21)
 *
 * The engine already falls back to the cached copy when the request THROWS (network down — CLAUDE.md §14: nothing may need the cloud; "a closing time must
 * silence the music even offline"). But when the network is up and the SERVER answers with an error — the app restarting during a deploy (502/503/504), the cloud
 * session expired (401), a timeout (408) or too many requests (429) — the engine used to just do nothing for that poll, so a block's start or a closing time that fell
 * in that window was not acted on for as long as the errors lasted. Those answers say "the cloud cannot tell right now", exactly like a down network, so the same copy
 * decides. Any other answer (a 403 "no access", a 404 "no such branch", a 400) says the cloud DID answer and the answer is "no" — that stays "do nothing".
 */
export function cachedCopyMayDecide(status: number): boolean {
  return status >= 500 || status === 401 || status === 408 || status === 429;
}
