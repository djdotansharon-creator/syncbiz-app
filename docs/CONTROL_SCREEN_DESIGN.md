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
