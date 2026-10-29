# "The approved Player is the only one that plays; no automatic replacement" — 2026-10-29

Owner decision (2026-10-29, answering the question in chat): *"A computer defined as a branch's Player is the only one that can play, unless there is a change through an explicit action (API). Like Spotify. A Remote opened in a browser cannot play at all — it opens on the control screen with the icon to the player."*

**Classification: SERVER (the WS service `server/`) + SERVER (token route). No desktop MAIN / MPV / orchestrator change, no installer, no database change.** Takes effect **only** for devices that carry a **signed enrollment claim** — i.e. only when device approval is switched on for a workspace (dormant today). Rooms without such a device — the Lenovo pilot station, TEST, every legacy branch — behave exactly as before.

## What changed
| Rule | Where |
|---|---|
| A **Remote** is never MASTER, never elected, never promoted, `SET_MASTER` ignored | already existed (#73) |
| The owner's **own computer** (approved class `owner`) is **never elected at REGISTER and never auto-promoted**; it becomes the player only by an **explicit `SET_MASTER`** (its Settings → "Remote player" switch) | new: signed claim `enrollmentOwner` (`lib/auth-ws-token.ts`, `app/api/auth/ws-token/route.ts`, `server/ws-token.ts`), `server/index.ts` |
| In a room where an **approved Player** (not the owner's computer) has registered since the server started, **a lost MASTER is NOT replaced automatically** — nobody (not another approved Player, not a station, not the owner's computer) is promoted; a change is explicit | new: `enrolledRooms` + `tryPromoteConnectedControlOnMasterLoss` |
| The approved Player that **comes back** (reload / reconnect) reclaims MASTER as before — zero-touch for the defined Player | unchanged (tested E8) |

## Evidence (labels per CLAUDE.md §6)
- **PROVEN BY TEST** (real WS process, no DB): `server/verify-enrollment-role.ts` 20/20 — old E0–E5 unchanged; new E6 (owner's computer never elected; explicit SET_MASTER works), E7 (standby approved Player not promoted), E8 (the Player comes back → MASTER again; owner's computer never promoted), E9, E10 (legacy room keeps the old election). `scripts/verify-owner-claim.ts` 4/4 (claim minted only for owner PLAYER, signed, forgery fails).
- **Regression suites on the same server code, all green:** permanent MASTER 25/25, web reload window 15/15, WS integration 18/18, gate2a3 activation 34/34, control-room broadcast 14/14; enrollment 35/35 + DB 42/42.
- **NOT PROVEN by runtime:** nothing here has run on a real branch. Needs a runtime pass when device approval is first switched on (see the handoff doc): the father's browser as approved Player keeps playing across a reload; closing it leaves the branch silent (by design) and the owner's computer does not take over; the owner can still make his computer the player explicitly.
- The Lenovo is not affected (no enrollment claim on its tokens), so no Lenovo regression is required for this change; the standing "DO NOT REGRESS" list is covered by the suites above.

## Consequence to know
With approval on, if the approved Player computer is switched off, **the branch has no player** until it returns (or someone makes another computer the player explicitly). That is the intended "no automatic failover".

## Rollback
Revert the merge commit, or switch device approval off for the workspace (tokens then carry no claim and the old election applies).
