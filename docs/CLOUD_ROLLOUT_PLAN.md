# Cloud rollout plan — how everything we built locally reaches the cloud, in order

**Status (2026-10-26): Step 0 is DONE — nothing else.** Backup: `design/backups/step0-2026-10-26/` (`working-tree.zip` 8.9 MB, `HEAD.txt` = 18646f3, `status.txt`). The work is now five LOCAL commits on `son/full-2026-10-23` (not pushed; secret scan of all 65 files found nothing): `28374bc` server · `9ce91bc` player · `aea8812` radio · `c5e5acf` display screen + lock-screen design + Jingles tab + graphics modes · `d3672b2` docs. Nothing is uploaded, pushed, deployed or migrated. Next: Step 1 (the separate preview environment) — waiting for the owner.
## Corrections 2026-10-26 (after the father's Claude reviewed this plan; all six accepted by both sides)

1. **PR facts fixed** (table above): #60 / #61 are merged, #62 reverted the design, #65 is open. Always `git fetch` before any step.
2. **NEVER merge `main` into `son/full-2026-10-23`.** Dry run (read-only `git merge-tree`): **12 conflicting files, 44 files DELETED, 78 modified** — main's revert (#62) would strip the redesign. The way in: a NEW branch from current `main` → bring the design back (a "revert of the revert", or better a selective re-apply, see slices) → our new work on top, file by file.
3. **Two tracks.** **Track A = UI / renderer only, NO database change** (our tree adds nothing under `prisma/`; verified: 0 differing files vs main; settings live in localStorage, everything else uses existing APIs). **Track B = server + DB** (`KioskDisplaySettings`, `KioskUnlockCode`, unlock codes, settings per branch) — later, and only after the phone app / remote control exist (see "Order").
4. **The player chain is its own slice with its own real test.** Measured: OUR changes since the shared base in the player files are small — 100 lines added / 25 removed in 5 files (`audio-player.tsx` +25: publishes the position to the display, radio-cover art, and a `statusRef !== "stopped"` guard; `playback-provider.tsx` +28: `sessionRepeatMode` — a LOCAL playlist loops by default so a store never falls silent — and "a single song that ends with loop off just ends"; `mix-preferences.ts`, `autoplay-recommender.tsx` incl. the 2026-10-26 Play-next-first fix, `player-deck-transport-surface.tsx`). The "680 lines in audio-player.tsx" figure is MISLEADING: it is the difference to main, i.e. mostly the content of #60 that main reverted (the deck mirror video, AUTOMIX deck handling, scrub arming…). Rule: do NOT restore those wholesale — restore only what the UI needs; our 100 lines go in a separate slice, reviewed with the owner, tested on the Lenovo (silence, loop, next, EOF, AutoMix, reconnect — the CLAUDE.md "do not regress" list). Test M8 only checks that the string `isManagementRoute` is absent from player files; it does NOT prove the player is unchanged.
5. **GPU gate — a real gate, not a formality.** PR #62's hypothesis: 100+ `backdrop-filter` rules (many `blur(28–46px)`) that weaker Windows GPUs fail to paint; owner-attested: fine with acceleration OFF. Our tree still carries **≈163 `backdrop-filter` occurrences vs ≈65 on main**. The light-graphics mode (`app/lite-fx.css`) removes 104 blur rules, BUT its automatic choice looks at CPU cores (≤ 4) and memory (≤ 4 GB), not at the GPU — **NOT PROVEN to protect the machine that failed**. Plan: ship with **light graphics as the default** until the owner verifies full mode on his Windows machine. The check must run in the **packaged Electron app on Windows** (the original flicker was there), not only in a browser tab: `desktop/src/main/hosted-url.ts` documents a runtime override `SYNCBIZ_DESKTOP_WEB_APP_URL` for staging — `NOT PROVEN` that the installed TEST-pinned beta (transient `normalizeEndpointsForPackaged`) honours it; if it does not, a transient installer pointed at the preview is needed (installer hygiene rules apply).
6. **Google Maps in the preview:** the Control Room uses Google Maps (`app/api/control-room/map-config`, branch forms). The preview environment needs the Maps keys, and the preview's domain must be added to the key's allowed referrers — otherwise opening a branch with an address fails there.

**Order — the owner must approve this explicitly:** Track A (UI, no DB) → phone app / remote control built and tested in the cloud → Track B (cloud settings + one-time unlock code). Nothing runs without the owner's yes at each gate.

**Slices for Track A (one PR each, in this order):** (1) UI: display screen, lock-screen design, Jingles tab, graphics modes, tooltips (+ the minimum the UI needs); (2) radio library; (3) player chain (our 100 lines) — separate gate with the Lenovo test; (4) whatever of the server commit is not already in main via #61 (check first — the 12 files may be identical).

Owner's words: "after that we move everything we did to the cloud — don't do it now; let us have visibility and a plan in advance so it is done in the most orderly way."

Labels used: `PROVEN BY CODE` · `PROVEN BY RUNTIME` · `NOT PROVEN` · `DECISION NEEDED`.

---

## Progress 2026-10-26 — the merge with GitHub's latest is DONE locally (nothing pushed)

New local branch **`son/rollout-prep-2026-10-26`** (merge commit `9c9d4f2` + fix 41e9fa7) = the redesign + all our work + main's new work (#63 browser tab identity, #64 F4 scheduled jingle once per branch; only 11 files arrived, all pilot / identity / scheduling logic). Merged with the base `8a26352` (main before the redesign) so main's revert did not strip the design: **0 conflicts**, nothing of main deleted. A semantic clash the automatic merge could not see was fixed: main made the jingle schedule branch-scoped, and our schedule dialog + jingles pane (they exist only in the redesign) still called the old API (tsc found it; fixed, runtime-checked). Verified on the merged tree: tsc (app + server) clean; `verify-kiosk` 138, management-security 29, fx-mode 28, radio 30, autoplay 25; main's three new tests 20 + 33 + 15 (real Chromium / WS); the other 42 verify scripts behave IDENTICALLY before and after the merge (9 fail the same way before it — electron / environment); production build OK; browser smoke (display, Jingles tab + schedule dialog) OK. NOT done: any push, PR, deploy, GPU / Windows check, preview environment. Rule that stays: the owner's design and interface are final — on any clash the redesign wins; from main only security / identity / station logic.

## 1. Where everything is today (facts)

| Place | What runs there | Our redesign / display screen? |
|---|---|---|
| **This Mac** (`~/Desktop/syncbiz-app`, branch `son/full-2026-10-23`) | the full local app + local database | **YES — and only here.** ~60 files changed or new, mostly uncommitted (display screen, cover colours, graphics modes, search/playlists/jingles pages, radio "classic", lock-screen design, tests, docs). |
| **GitHub** | `main` (as fetched: `ed98d59` = PR #64). **PR #60 (the design) and #61 (server) were MERGED, then #62 REVERTED #60 on PROD** (GPU flicker / stall on Windows; "Ori's design comes back gradually after a lighter-graphics pass verified on the owner's Windows machine"); #63 and #64 merged; **#65 open** (VONO icon + Dev-PC PROD station). Backup branch `backup/ori-2026-10-23` (never touch). | No — main has the pre-redesign UI. |
| **Cloud TEST** (`syncbiz-app-test-production.up.railway.app`, WS `syncbiz-ws-test-production.up.railway.app`) | the pilot code (PR #52 line). **The Lenovo branch machine loads this renderer.** | No |
| **Cloud PROD** (`syncbiz-app-production.up.railway.app`) | the production app | No |

Both cloud apps answered `/api/health` = 200 on 2026-10-26.

**The one rule that shapes everything:** the Lenovo's installed VONO is pinned to the cloud TEST app. Anything deployed there changes what the pilot branch loads. **The redesign must never be deployed onto the pilot TEST app.**

## 2. Guardrails (from `CLAUDE.md` and the owner's standing rules)

- TEST and PROD stay separate. No PROD deploy / PROD database change / PROD WS change without an explicit word from the owner.
- No merge without explicit approval. No force push. Never touch `backup/ori-2026-10-23`, the `pilot-baseline/*` tags or the preserved installers.
- Never create or push a tag that starts with `desktop-v` (it triggers the installer release workflow).
- Database changes are **additive only** (new tables / nullable columns), approved before they are written, applied to a throw-away or preview database first.
- `railway up` deploys the **working tree**, not a commit → deploy only from a clean tree and record the Railway deployment id.
- Local file paths never go to the cloud (hard invariant). Passwords only as salted hashes, codes only as hashes.
- Renderer-only changes need no new installer (the desktop loads the hosted renderer); desktop MAIN changes do.

## 3. What has to move to the cloud (and what stays local)

| Thing | Today | In the cloud | Notes |
|---|---|---|---|
| Display screen **password** | this browser's localStorage (salted hash) | server, per branch (default zone) | the screen keeps a cached copy of the hash so the normal password still works **offline** |
| **Staff permissions** | localStorage | server, same row | same cached-copy rule |
| **Lock-screen design** (`KioskDesign`, one small JSON) | localStorage | server, same row | already one JSON value on purpose (`lib/kiosk-design.ts`) |
| **One-time unlock code** | not built | new table, copy of the `BranchActivationCode` pattern (hashed, expiring, single use, attempts limit) + `AuditLog` | owner creates it in his account; the on-site admin types it in the display's password bar. **Needs internet to verify** (by design). |
| Playlists, schedules, jingles | already in the cloud database / APIs | unchanged | the display only reads / writes them through the existing APIs |
| Remote control (phone app, remote screens) | `*OrSend` commands over the WS to the station | unchanged transport | **NOT PROVEN for the new display** — only tested on one machine with the WS blocked |
| Queue order / "Play next" | player + recommender in the renderer | unchanged | the fix of 2026-10-26 is renderer-only |
| Cover colours, graphics modes, tooltips, fonts | renderer only | ships with the renderer | no database |

## 4. The order (each step has a gate — the owner says yes before the next)

**Step 0 — Freeze and secure (local, no outward action)**
1. Backup: `design/backups/<date>/` (files + a database copy) and a zip, as done before. Record `HEAD` and the list of changed files.
2. Sort the uncommitted work into a few local commits by area (display screen · jingles tab + lock-screen design · search/playlists · radio · graphics modes · tests/docs). **Local commits only — no push.** (Needs the owner to lift the local-only rule for commits.)

**Step 1 — A separate preview environment (DECISION NEEDED)**
- A new Railway project (e.g. `syncbiz-redesign-preview`) with **its own Postgres and its own WS service** — not the pilot TEST, not PROD.
- Environment variables from the secure store only (never in a file in the repo).
- Gate: the owner approves creating it (it is an outward action and may cost money).

**Step 2 — Database (additive, preview only)**
- New table `KioskDisplaySettings` (per branch / default zone: `pinHash`, `pinSalt`, `permissions` JSON, `design` JSON, `updatedBy`, `updatedAt`) and new table `KioskUnlockCode` (like `BranchActivationCode`: `codeHash`, `branchId`, `createdByUserId`, `expiresAt`, `usedAt`, `revokedAt`, `failedAttempts`).
- Migration written locally, applied to the **preview** database first. Rollback = drop the two new tables (nothing existing is altered).
- Gate: the owner approves the migration file (he said the migration itself is "no problem").

**Step 3 — Server + wiring**
- Manager-only APIs: read / write settings; create / revoke unlock codes. Screen-side API: verify password (rate limited) and redeem a code (hashed compare, attempts limit, single use, branch-bound, `AuditLog` row for create / use / revoke).
- The display reads its settings from the server and keeps a cached copy; the design page and the settings page write to the server.
- Tests: unit (hash, expiry, single use, attempts), API (authorisation: staff cannot read or write settings), offline (cached password still opens the controller).

**Step 4 — Verify on the preview (before anyone else sees it)**
1. Automated: type-check, lint, all suites, production build.
2. Browser end-to-end on the preview URL, Hebrew and English.
3. **Phone app / remote control:** a phone controls a second screen's station through the preview WS (this is the test we could not do locally).
4. **Offline:** cut the network on a station: local audio continues, the screen unlocks with the cached password, a one-time code is correctly refused with a clear message.
5. Owner reviews the preview in his own browser (this is also the "link I can open" he asked for).

**Step 5 — Bring it into git properly** (see Corrections 2–5)
- A NEW branch from current `main`; never merge `main` into `son/full-2026-10-23`. Slices as listed above, one PR each, UI first, player chain separate.
- Before the UI slice is proposed again: the GPU gate (light graphics default; full mode only after the owner's Windows / packaged-Electron check).
- Gate: the owner approves each push and each PR; merge only on his explicit word.

**Step 6 — Pilot TEST (only together with a Lenovo plan)**
- Renderer-only first (no installer). Deploy from a clean tree; record the Railway deployment id and the source SHA in `docs/VONO_PILOT_BASELINE.md`; keep a `pilot-baseline/*` tag as the rollback reference (tags: ask first; never `desktop-v*`).
- Runtime acceptance on the Lenovo, labelled honestly (`ACCEPTED — owner-attested` vs `server-log corroborated`).

**Step 7 — PROD (last)**
- Only on an explicit instruction. Additive migration first, then the app, then a smoke test; rollback plan written before the deploy.

## 5. Risks and open questions

- **Pilot safety:** the single biggest risk is a redesign deploy reaching the Lenovo through the shared TEST app → solved by the separate preview environment (Step 1).
- **Merge conflicts:** 20+ files differ between our tree and `main`; do it slice by slice, never in one step.
- **Remote control and the phone app** are not built or tested yet — the plan above assumes they come before the cloud settings go live (the owner's order).
- **Search / recommendations on the cloud server** depend on `yt-dlp` there (`/api/health` reported `yt-dlp ok` on TEST) — `NOT PROVEN` for the preview until it is created.
- **Offline behaviour of the one-time code:** it cannot work offline; the normal password must. `DECISION NEEDED`: should a station that has been offline for long show a hint ("connect to the internet to use a code")?
- **Who may create codes:** default proposal = owner and managers only (not staff); `DECISION NEEDED`.
- **After a code unlock:** stay open until someone presses the lock (simple) or lock again automatically after N minutes (safer for technician visits)? `DECISION NEEDED` — recommendation: automatic, default 60 minutes.

## 6. What the owner needs to approve, in order

1. Lift the local-only rule for **local commits** (Step 0).
2. Create the **preview environment** (Step 1).
3. The **migration file** (Step 2).
4. Pushing slices / opening PRs (Step 5), each separately.
5. Pilot TEST rollout with a Lenovo test (Step 6), then PROD (Step 7).
