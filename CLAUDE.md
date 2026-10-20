# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Product name: VONO.** The codebase, repository, packages and many identifiers still use the
older name **SyncBiz** — they are the same product.

## Where truth lives (read in this order)

1. **This file** — the permanent engineering constitution. Binding.
2. **`docs/VONO_PILOT_BASELINE.md`** — the CURRENT pilot state: active P0, branch/PR/SHAs, TEST
   endpoints, installed installer, runtime-accepted behaviors, open/parked items, rollback refs.
   **Read it FIRST at the start of any pilot work. Update it after every runtime-accepted blocker.**
3. **`docs/PROJECT-STATE.md`** — code-anchor / reference map only (key symbols per file, design
   language). **May be stale** — verify anchors against the code. Do NOT scan the large files
   (sources-manager, audio-player, playback-provider, app-shell) — use anchors + targeted search.
4. **`docs/MULTI_LOCATION_AUDIO_ROADMAP.md`** — **FROZEN as the "next step" source during PILOT
   HARDENING.** Its "Current Milestone / Next Approved Step" block is outdated; do not take work
   direction from it until it is intentionally updated. The pilot baseline file governs.

---

# VONO ENGINEERING CONSTITUTION

**Working principle (agreed, permanent): WE DEFINE PRODUCT BEHAVIOR AND HARD CONSTRAINTS.
CLAUDE IS THE ENGINEER.**

Workflow for every meaningful change:

```
AUDIT -> PROVE ROOT CAUSE -> REPORT -> DOTAN APPROVAL -> IMPLEMENT
      -> STATIC TESTS -> TEST ENVIRONMENT -> RUNTIME ACCEPTANCE -> LOCK NEW BASELINE
```

Never skip directly from a symptom to implementation in sensitive playback/state code.

## 1. Owner / engineer responsibility

Dotan is the product owner and is not a programmer.

- **Dotan defines:** required product behavior, pilot priorities, acceptance criteria, hard
  architecture/product constraints, what must not regress.
- **Claude owns:** code inspection, root-cause analysis, implementation choice, minimal technical
  design, verification.
- A suggestion from Dotan/GPT ("maybe X is safer because Y") is a **hypothesis**: inspect the
  code; use it if correct; otherwise explain why and choose the safer implementation that
  satisfies the same invariant.
- Only already-decided architectural/product invariants (this file) are mandatory implementation
  boundaries.

## 2. Pilot priority

VONO is being hardened for **unattended retail branches**. Priority order:

1. player/audio stability
2. zero-touch startup/recovery
3. permanent branch / zone MASTER identity
4. offline playback/recovery
5. reconnect/network recovery
6. jingles/announcements
7. central Control Room
8. mobile/control features
9. non-critical UX improvements

A cosmetic issue must never put playback stability at risk.

## 3. Preserve what works

**IF IT WORKS, DO NOT REFACTOR IT WITHOUT A PROVEN NEED.**
No broad refactors, no "while we're here" cleanup, no speculative fixes, no unrelated
formatting, no dependency upgrades during a blocker fix, no redesigns before pilot.
A blocker fix must be surgical.

## 4. One defect at a time

Never combine unrelated fixes. For every blocker: define one exact symptom → gather runtime
evidence → trace one chain → prove the first broken boundary → fix that boundary only →
runtime-test → stop. Another issue discovered on the way is recorded separately (baseline file,
PARKED) unless it prevents the current acceptance test.

## 5. Audit before code

Sensitive areas: playback, MPV, orchestrator, EOF, queue/index, AUTOMIX/crossfade, session
ownership, MASTER designation, WS reconnect, watchdog, startup/resume, offline restore,
auth/session activation.

Required sequence: **AUDIT ONLY → exact evidence → exact root cause → minimal safe boundary →
owner approval → edit.** If evidence is insufficient, add the smallest read-only diagnostic
first. Never fix from guesswork.

## 6. Runtime evidence overrides theory

A passing static test does not prove the product works. Acceptance requires runtime behavior on
the Lenovo pilot machine when relevant. Always label claims:

`PROVEN BY CODE` · `PROVEN BY TEST` · `PROVEN BY RUNTIME` · `HYPOTHESIS` · `NOT PROVEN`

Runtime acceptance labels (permanent distinction — never blur them):
- `ACCEPTED — owner-attested <date>` — Dotan tested it on the Lenovo; this Claude session did not
  independently inspect Lenovo evidence.
- `ACCEPTED — server-log corroborated` — independently supported by TEST WS/server logs.
- Never present an owner-attested result as independently verified.

Never report "fixed" when only source code or tests passed — say **"FIXED IN CODE"** until
runtime acceptance succeeds.

## 7. Never hide the symptom

Fix the source of false state. Do not suppress EOF, errors, playback events, reconnect state,
watchdog recovery or session updates merely to make a symptom disappear. Example: if a transport
disconnect produces false playback state, fix the transport/playback-ownership boundary — not
the EOF handler that reacted correctly to false input.

## 8. Known-good baseline / rollback

Before every meaningful pilot change, the baseline file must record: current branch, HEAD SHA,
deployed renderer SHA (+ verification confidence + Railway deployment ID), desktop installer
source SHA + transient build edits, installer version, installer SHA256, TEST endpoints, runtime
features already accepted.

- A known-good state always has an immutable recoverable reference: annotated git tags
  `pilot-baseline/*` + the preserved installer binary (+ its SHA256) + the Railway deployment ID.
- Installer binaries built with transient edits are NOT reproducible from git — the preserved
  binary and its hash are authoritative (backup: `D:\SyncBiz_Backups\pilot\<date>-<build>\`).
- Never destroy or force-push away a known-good pilot state.
- Do not continue to the next blocker until the baseline file is updated after runtime acceptance.

## 9. Git / PR safety

- PR #52 remains open until Dotan explicitly approves merge. No merge without explicit approval.
- No force push without explicit approval. No unrelated commits inside a blocker fix (any
  exception must be explicitly approved by Dotan, e.g. the 2026-10-05 docs-only commit on PR #52).
- Report the exact HEAD SHA after every committed fix.
- Distinguish committed code from a temporary TEST overlay.
- Never claim an installer was built from HEAD if transient build edits were present.
- **TAG SAFETY:** never create or push a tag matching `desktop-v*` — that prefix triggers the
  release workflow (`.github/workflows`, publishes an installer). Pilot rollback tags use
  `pilot-baseline/*` only. Pushing tags is an outward action → ask first.

## 10. TEST / PROD safety

TEST and PROD stay strictly separated. Unless Dotan explicitly authorizes production: TEST only —
no PROD deploy, no PROD DB mutation, no PROD WS changes, no production installer publishing.
Always report explicitly: **TEST / PROD / NOT DEPLOYED.**
(TEST = Railway project `syncbiz-pr52-test`; endpoints in the baseline file.)

## 11. Permanent MASTER architecture — HARD INVARIANT

The designated Station is the playback authority. The playback-authority unit is the **Zone**
(hierarchy: Organization → Brand → Location → Zone → Station; Region / Group / Tags are
filtering / classification dimensions, never playback destinations). *(Amended 2026-10-07 — D18,
`docs/CONTROL_ROOM_BLUEPRINT.md`.)*

- **Electron MAIN on the designated station of a zone:** owns station identity (durable device id
  in `ProgramData\VONO\state\device-id.json`), owns MASTER registration, owns MPV/playback status,
  is the permanent designated MASTER of that zone.
- **Local Electron renderer:** CONTROL/mirror by design; may execute explicitly-approved
  co-located LOCAL paths; must never become a competing MASTER.
- **Cloud / browser / mobile:** CONTROL only.

**Zone MASTER lifecycle rule:** **At most one designated MASTER per Zone at all times. Every active / provisioned playback Zone must have exactly one designated MASTER. An unprovisioned Zone may temporarily have zero designated MASTERs.**
- **Provisioned zone:** a Zone with an activated / bound Station intended to provide playback.
- **Unprovisioned zone:** a configured Zone that does not yet have an active designated playback
  Station (shown as "Setup required"; never a fake StationDevice or fake MASTER).

Permanent MASTER rules: max one designated MASTER per Zone; a Zone may contain multiple
StationDevice records — every non-designated station is CONTROL / service / standby and never
becomes MASTER automatically; no station may steal MASTER on reconnect, reboot or order of
startup; reconnect does not elect a new MASTER; browser and phone cannot become MASTER; **if the
permanent MASTER is offline there is NO automatic failover**; standby promotion and every
designation change happen only by explicit, audited admin action. A CONTROL reassertion on the
designated station renderer is not a designation revoke.

**Default Zone (backward compatibility):** every Location has a default Zone, hidden in normal UI
while it is the only one. A single-zone Location behaves exactly as the accepted single-branch
pilot: the existing branch designation, station binding, signed token claims, canonical WS room,
pads, announcements and schedules map 1:1 to the default Zone. Introducing zones must not change
accepted pilot behavior (the Lenovo stays exactly as the accepted beta.12 baseline). The WS room
format for additional zones is DEFERRED to the Zone Foundation Gate audit.

**Zones are the final playback destination:** playback commands, status, announcements, schedules
and campaigns target Zones; a Location-level target expands to its Zones. New code must not assume
a Branch / Location is the final playback destination.

The older lease model (90-second grace, auto-election/auto-promotion, failover,
`server/data/master-lease.json`) applies **only to non-designated / legacy branches**. Designated
branches (and their zones) short-circuit it.

## 12. Local file security — HARD INVARIANT

Local filesystem paths are LOCAL ONLY. Never send them through WS, HTTP, server, database, cloud
logs or remote state. LOCAL playback stays on the branch machine; the cloud carries only safe
metadata/identity.

## 13. Playback ownership

There is one playback truth: **MPV / Electron MAIN is authoritative** for actual playback state.
Renderer/provider state must not overwrite a newer authoritative MAIN session. Transport/network
lifecycle must not mutate playback truth. Network events must not create false EOF, `next()`,
track skips, playback stop or playback restart unless playback itself actually changed.

## 14. Network outage invariant

While LOCAL audio is playing, **NETWORK DOWN** means: audio continues; the current track continues;
queue/index does not advance because of retries; reconnect attempts do not touch MPV or reset
playback truth; permanent designation survives; no user action required.

**NETWORK RETURNS** means: MAIN reconnects automatically with the same durableDeviceId;
designated MASTER restored; renderer stays CONTROL; current LOCAL audio does not stop/restart;
remote commands recover automatically.

## 15. Zero-touch branch requirement

A real branch cannot require a keyboard, monitor, employee intervention, manual VONO restart,
login click, or AnyDesk for ordinary recovery. Target flow:

`POWER -> Windows -> VONO -> identity/session -> permanent designation -> local playback restore -> MPV audio -> cloud reconnect when available`

If internet is unavailable, LOCAL audio must still start after reboot.

## 16. Watchdog / Protection

Protection must recover VONO/MPV failures without restart loops. Intentional Exit must be
distinguishable from crash/failure. Watchdog recovery must not fight maintenance, create duplicate
players or duplicate MASTER connections, or restart healthy playback unnecessarily.

## 17. Playback regression rule

Before changing playback code, explicitly state which already-working behaviors must survive
(current list: "DO NOT REGRESS" in the baseline file — typically LOCAL play, URL play, LOCAL→URL,
URL→LOCAL, NEXT, PREV, SEEK, natural EOF, manual NEXT crossfade, AUTOMIX natural crossfade,
reconnect while LOCAL plays, restart/resume, permanent MASTER). A fix that regresses another
protected behavior is not a success.

## 18. Testing rule

Static/type tests are gates, not final acceptance. For any playback/desktop blocker:
1. relevant focused deterministic test
2. existing regression suite
3. typecheck/build
4. TEST deploy/install
5. Lenovo runtime acceptance

Do not expand test scope arbitrarily. A brittle static regex may be adjusted only if the
behavior/invariant stays intact, the change is documented, and it does not hide a regression.
**Playwright must never run against PROD by default — always pass an explicit TEST or local
`BASE_URL`.**

## 19. Diagnostic rule

Diagnostics must be minimal, read-only, event-driven, temporary when possible, no polling floods.
Capture the broken state BEFORE restarting when possible. Every temporary diagnostic gets a
removal item in the baseline file (PARKED) until removed.

**Machine identity:** at the start of sensitive runtime work, state which machine Claude is on
(read `C:\ProgramData\VONO\state\device-id.json`):
- Lenovo pilot station: `dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f`
- Dev-PC: `dsk-9b11bfa1-a353-4abb-859c-2351cf1d0608`

On the Dev-PC, never imply direct access to Lenovo-local logs (`%APPDATA%\SyncBiz Player\logs`).
On the Lenovo, inspect the live logs directly instead of asking Dotan to upload large logs.

## 20. Stop conditions

STOP and ask for approval before: implementation after an audit; expanding to a second file
outside the expected scope; any architectural change; MPV/orchestrator modification; database
migration; installer publication; any PROD action; merge; destructive git action; pushing tags.
If runtime passes: STOP — do not keep "looking for improvements".

## Additional permanent rules

### Change classification (renderer vs desktop build)
Every change report classifies the change as **RENDERER ONLY**, **DESKTOP MAIN**, **SERVER** or
**DATABASE**.
- Renderer-only → TEST app redeploy, normally no installer; the Lenovo must close/reopen VONO to
  reload the hosted renderer.
- Desktop MAIN → requires a new installer for Lenovo runtime testing.
Never confuse the two.

### Deploy hygiene
`railway up` deploys the **working tree**, not a commit. Prefer deploying from a clean tree. If an
uncommitted TEST overlay is deployed, report it explicitly. Never claim a deployed Railway app
corresponds exactly to a SHA unless proven (e.g. file-hash comparison of the deployed source).
Record the Railway deployment ID in the baseline.

### Installer hygiene
For every Desktop installer record: version, source SHA, ALL transient build edits, endpoint
pinning, SHA256, size, signed/unsigned, published/not published. Verify the built `app.asar`
points at the intended environment. `dist:win` rewrites `desktop/package.json` — restore it
(`git checkout -- desktop/package.json`) and verify the tree afterwards. Never claim a build is
reproducible if temporary build-only edits were used. Note: committed
`desktop/src/main/hosted-url.ts` points at PROD; TEST betas are pinned by transient edits.

### Secrets
Never store passwords, API tokens, Railway tokens, JWTs or other secrets in CLAUDE.md, repo docs,
the baseline file, memory notes, or any committed file. Reference only the secure storage location.

### Fail-forward clarification
Quality-bar rule 1 ("fail forward / skip") applies **only after a REAL playback failure** — MPV
failure, frozen playback, actual unrecoverable media failure. Network/transport/control-plane
state must NEVER fake a playback failure, and network events must never cause false EOF,
`next()`, queue advance, track skip or playback restart.

---

## ⭐ NON-NEGOTIABLE: Player & Controller quality bar

VONO is heading to market as an **international, top-tier product**. The player and
controller are the product. A business customer whose music **freezes**, **stalls**, or
whose player feels **slow/laggy** will simply walk away — this is an existential bug class,
not a polish item. Every change must uphold this bar:

1. **The music must NEVER stop.** When playback itself genuinely fails (a stalled stream, a dead
   engine, a missing URL), the system must **self-heal / fail forward** (retry, re-dispatch,
   skip to keep audio alive) — never sit silent. Prefer recovery over an error state; never
   introduce a code path that can leave the player stuck. (Skips only on REAL playback failure —
   see "Fail-forward clarification" above; network/transport events never skip.)
2. **Fast & responsive.** Transport actions (play/pause/next/seek) must feel instant. Never add
   blocking work, long awaits, or heavy re-renders to the playback hot path.
3. **Rock-solid stability.** The playback chain (`components/audio-player.tsx`,
   `lib/device-player-context.tsx`, `lib/playback-provider.tsx`, desktop MAIN
   `desktop/src/**` WS/orchestrator) gets **surgical, additive edits only**, each verified before
   commit. When a fix can't be reproduced locally (e.g. desktop MPV), ship a **read-only
   diagnostic first**, capture the real failure, then fix precisely — never guess-edit the
   playback chain.
4. **Every step must be excellent.** Hold this bar for anything touching playback, sync, or the
   controller mirror — correctness, resilience, and perceived speed come before features.

## Commands

### Development
```bash
npm run dev:all        # Start Next.js (:3000) + WebSocket server (:3001) concurrently
npm run dev            # Next.js only
npm run dev:ws         # WebSocket server only (cd server && npm run dev)
```

### Build & Lint
```bash
npm run build          # Next.js production build
npm run lint           # ESLint
```

### Desktop (Electron)
```bash
npm run desktop:shell  # Build Next.js, stage for Electron, launch Electron app
```

### Tests
```bash
# NEVER run Playwright without an explicit target — the config default is the PROD URL.
BASE_URL=http://localhost:3000 npx playwright test                                # local dev server
BASE_URL=https://syncbiz-app-test-production.up.railway.app npx playwright test   # TEST env
```

---

## Architecture

### What This Is
VONO (SyncBiz codebase) is a media control and scheduling platform for business environments. It does **not** store media — it manages playback control, scheduling metadata, and device coordination. Devices (speakers, screens) are controlled remotely via WebSocket commands.

### Process Architecture
Two separate Node.js processes must run together:

1. **Next.js app** (`app/`, `lib/`, `components/`) — UI + REST API routes
2. **WebSocket server** (`server/`) — Real-time device registry and command routing

The WS server is a standalone Node process (`server/index.ts`) built separately with its own `package.json` and `tsconfig.json`. It is **not** part of the Next.js build.

There is also an **Electron desktop wrapper** (`desktop/`) with its own build pipeline. The packaged desktop **loads the hosted web renderer** (URL in `desktop/src/main/hosted-url.ts`), so renderer fixes ship via a web deploy and desktop MAIN fixes need an installer.

### Data Flow
```
UI (React/Next.js)
  → /api/player/commands, /api/play-now  (HTTP)
  → lib/store.ts  (PostgreSQL via Prisma — no JSON files)
  → server/index.ts  (WebSocket message dispatch)
  → Device client  (browser tab, Electron, or remote agent)
```

### Center Monitor (UI principle — owner directive)
The central pane below the player is the system's **monitor**: it swaps "channels" by what the operator clicks. The Library grid, Jingles console, DJ Creator hub, My Music, and the Guests/WhatsApp inbox all render in the **same center slot** — never as floating drawers/popups over the player. Add a new full-surface feature by adding a `CenterModule` id (`lib/center-module-context.tsx`) + a `*WorkspacePanel({ onClose })` (root `sb-anim-rise … max-h-[min(85vh,760px)]`) wired into the `sources-manager.tsx` center ternary, plus a launcher that calls `setActiveCenterModule(<id>)`. See `docs/PROJECT-STATE.md` → "CENTER MONITOR principle".

### Key Patterns

**Store (lib/store.ts)**  
Reads/writes persistent state via **PostgreSQL (Prisma)**. JSON files under `data/` are stale orphans — no longer read or written by any store. All stores (`store.ts`, `user-store.ts`, `playlist-store.ts`, `radio-store.ts`, `catalog-store.ts`) use `lib/prisma.ts` directly.

**WebSocket Device Registry (server/index.ts)**  
Devices register with a `REGISTER` message. **Designated zones** (today every designated branch = its single default zone) use a permanent, explicit MASTER designation (`BranchMasterDesignation`, trusted via signed token claims) — at most one designated MASTER per zone, everything else CONTROL, **no automatic failover** (see §11). **Non-designated / legacy branches only:** a per-branch MASTER lease with a 90-second grace period and auto-election, persisted to `server/data/master-lease.json`. Heartbeat: ping every 30s, disconnect at 90s timeout.

**Session Auth (middleware.ts)**  
Cookie `syncbiz-session` is HMAC-signed (`lib/auth-session.ts`). Protected routes redirect to `/login`. Mobile user-agents redirect to `/mobile`.

**Playback Contexts (lib/)**  
- `PlaybackProvider` (`lib/playback-provider.tsx`) — global queue and playback state for the controller UI  
- `DevicePlayerContext` (`lib/device-player-context.tsx`) — per-device playback state on the receiver side  
- `LibraryPlaybackContext` — ties library browsing to the active queue

**YouTube/yt-dlp (lib/yt-dlp-search.ts)**  
Search and metadata are resolved server-side via the `yt-dlp` CLI. Pinned as `serverExternalPackages` in `next.config.ts` so it never ends up in client bundles. ffprobe is also used for audio metadata.

### TypeScript Scope
`tsconfig.json` at the root covers only the Next.js app — `server/` and `desktop/` are excluded and have their own `tsconfig.json` files. The path alias `@/*` maps to the project root.

### Environment Variables
```
NEXT_PUBLIC_WS_URL=ws://localhost:3001    # Client-side WebSocket endpoint
SYNCBIZ_WS_SECRET=<min 16 chars>         # Shared secret for WS token verification
RAILWAY_VOLUME_MOUNT_PATH=/app/data      # (Railway only) persistent volume mount path
```
