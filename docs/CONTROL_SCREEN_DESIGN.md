# The Control Screen (stage 3 of the new accounts model) — owner brief 2026-10-29

> "The control room, dashboard and everything there, and the more-settings, are a NEW screen — not the player's. Plain black and organized buttons. Between the control screen and the player: no code, just a button in the corner."

## What it is
One separate, plain-black screen for **Control Room · Dashboard · Permissions (+ Display screen) · Settings**. A single row of buttons at the top (icon + one word, no frames). The **corner button** (the start edge: right in Hebrew, left in English) goes to the **live player**; in the player, a quiet icon in its corner comes back. **No code** between them.

## What changed (UI only — RENDERER)
| Piece | Where |
|---|---|
| The routes that belong to it (one definition) | `lib/control-screen.ts` |
| The black bar (corner Player button + 5 icon/word buttons) | `components/control-screen/control-bar.tsx`, `control-screen.css` |
| The shell draws it on those routes and hides the player's top-bar **row** by CSS | `components/app-shell.tsx` (`isControlScreen`, `data-control-screen`) |
| Settings moved out of the player's rails workspace (a full plain screen) | `app/(app)/settings/page.tsx` (was `(workspace)/settings`; same URL) |
| A computer approved as a **Remote** opens on the control screen — once per tab, only from the player's home | `components/enrollment-hold.tsx` (`RemoteHome`; exists only while enrollment is on) |
| The Control Room **tab** stays only in the desktop app (a browser uses the corner icon) | `components/app-shell.tsx` |

## Playback safety (why this cannot stop the music)
The player deck lives **inside** the shell's header. The control screen hides only the header's top-bar *row* (`.sources-app-header-row1 { display:none }`); the deck row keeps its existing management-mode treatment (browser: a tiny transparent box so YouTube keeps playing; desktop app: `display:none`, no stray MPV window). Nothing is unmounted; the same JSX tree stays. Settings joined the management routes (its deck is hidden like the others) — it was already in the socket rule, so every browser keeps its device socket there. Guard test: `scripts/verify-control-screen.ts`, `scripts/verify-branch-socket-routes.ts` (R2 updated to the new shell shape; same invariant).

## Not built yet (next)
- **Player computer (desktop station):** one extra tab with a **gear icon** that opens this screen behind the **code the owner sets** (today: the Control Room tab + the existing management lock/password).
- Which computers open on the control screen **by role** (today only an approved Remote, and only when device approval is on).
- The role switch "may sign in from a computer", and showing the branch being controlled.

## Rollback
Revert the merge commit (UI only; no data, no migration). The old tabbed management pages return as before.

## Update 2026-10-29 (evening): the access code for Settings on the Player computer
Owner: "no access code for More settings — do it now, 123".
- On the **desktop app** (the Player computer), Settings now asks for the **access code**: `123` until the owner chooses his own (`lib/management-code.ts`; a deployment may override with `SYNCBIZ_MANAGEMENT_CODE`, 3+ characters). Typing it lifts the station lock for 60 minutes of inactivity (the existing unlock cookie). A **browser** (a remote computer) is never locked — no code, as specified.
- The code lifts only the lock; **role still decides what is seen** (a branch employee still never gets the manager pages). A manager's own password still works in the same field.
- `/settings` is not manager-only: `SettingsGate` (station lock only). The control bar offers a non-manager only "Settings".
- Same rate limiter as sign-in (10 wrong tries per account / 20 per address → blocked 5 min).
- **Not built:** the owner choosing his own code (needs a place in the database — a later migration), and "gear tab" as its own tab (today: the gear menu's "More settings" and the Control Room tab, both behind the code on the desktop app).
- Tests: `scripts/verify-management-code.ts` (10). Runtime (local, desktop user agent): locked → lock screen, wrong code 401, `123` 200, then the settings render; a browser goes straight in.

## Update 2026-10-30: the control skin (one design line for the whole control area)
Owner: *"organize the design of the Permissions screen, the windows that open on a click, the sub-buttons, the Dashboard — in our design line; check you understand it."* The line is the **Control Room's own** (`cr-*` in `app/globals.css`): soft glass cards without borders, soft white pills for every button (a **solid white pill** for the main action — never blue; the danger red `#ff453a` for a destructive one), filled borderless fields, flat counters, hairline dividers, glass windows like the "⋯" menu / Player details.
- `components/control-screen/control-skin.css` re-skins the legacy Tailwind-slate boxes of Access Control / Dashboard / Display (and the Roles / People / People-joining panels) **from CSS only** — no logic touched. Scope: `[data-control-screen="true"] .mgmt-type` + `html[data-sb-control]` (the mark the control bar puts on the document so the windows that open on a click — portals — are reached too). Test C23 proves every selector is scoped; the player and every other screen are untouched. No backdrop blur on the many nested cards (Windows GPU history): flat gradients; blur only on the windows.
- Dashboard: side padding like the other screens, no blue links, a pill "Logs" link.
- Not restyled yet: the inner pages of the legacy console that need a person selected (they are skinned, but not re-laid-out), and the Control Room's own wizard windows (already in the glass language).
