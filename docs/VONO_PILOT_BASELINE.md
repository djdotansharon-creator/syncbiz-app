# VONO PILOT KNOWN-GOOD BASELINE

> Operational, changeable state. Update after EVERY runtime-accepted blocker (CLAUDE.md §8).
> Permanent rules live in `CLAUDE.md`. No secrets in this file — ever.
> Evidence labels: `ACCEPTED — owner-attested <date>` (Dotan on the Lenovo; not independently
> inspected by Claude) vs `ACCEPTED — server-log corroborated` (TEST WS/server logs).
> Earlier baselines are kept verbatim-in-substance in §13 HISTORY — never delete history.

## 1. STATUS

- **Date:** 2026-10-05
- **Phase:** PILOT HARDENING — **PLAYER PHASE: PILOT ACCEPTED** (owner-attested 2026-10-05)
- **Current active P0:** none in the player phase. Next phase: Control Room / branch management.
- **PR #52:** OPEN — **NOT MERGED / DO NOT MERGE** without explicit approval
- **PROD:** UNTOUCHED
- **Written from:** Dev-PC (`dsk-9b11bfa1-a353-4abb-859c-2351cf1d0608`) — no direct Lenovo log access.

## 2. GIT

| Item | Value |
|---|---|
| Repository | `D:\APP Project\syncbiz-app` |
| Branch | `fix/local-playback-designated-master-prb` |
| PR | #52 — OPEN / NOT MERGED |
| **CURRENT PR HEAD** | the **docs-only** commit `docs(pilot): accept VONO player baseline after runtime validation`, whose parent is `2ebdbe4`. A commit cannot contain its own SHA — read it with `git rev-parse origin/fix/local-playback-designated-master-prb`. |
| **RENDERER APPLICATION BASELINE** | `2ebdbe4b9f2945e91987b2dfb5f61719103a9adf` — accepted application/runtime source (includes the LOCAL startup-stall recovery fix) |
| **DESKTOP beta.9 SOURCE LINEAGE** | `865ba81e5cb83be8493ab7374194aa1d145ea633` + documented temporary TEST build pins (see §5) |
| **DESKTOP AUTHORITATIVE ARTIFACT** | `2.2.8-beta.9`, SHA256 `72744069ad422c45130ddf530880f7e0fdc7b8b071dfd0fbde4693357ce6dc58` |
| main / PR base | `951a44cd99f39d921e217d246f6422b49cee2941` (verified after fresh fetch, 2026-10-05) |
| Working tree when written | clean at `2ebdbe4` (before this docs-only commit) |
| Stash present | `stash@{0}` = `pr52-xfade-diag-hold` (temporary diagnostic, see §9) |

Meaning: `2ebdbe4` is the exact application/runtime source accepted for the pilot. Everything above
it is **documentation only**. **No application source changed after `2ebdbe4`.** Verify with
`git diff --stat 2ebdbe4..origin/fix/local-playback-designated-master-prb`.
`865ba81` (desktop MAIN offline-cold-boot fix) is the parent chain of `2ebdbe4`; `2ebdbe4` adds only the
renderer stall fix (`components/audio-player.tsx`, `lib/desktop-freeze-self-heal.ts`, one test).

## 3. TEST ENVIRONMENT

| Item | Value |
|---|---|
| Railway project | `syncbiz-pr52-test` |
| Renderer (app) | https://syncbiz-app-test-production.up.railway.app (HTTP 200; `/api/health` status ok, database ok, yt-dlp ok) |
| WS | wss://syncbiz-ws-test-production.up.railway.app |
| Renderer Railway deployment ID | `673fae24-3105-4360-8c31-88d83f61705f` (SUCCESS, 2026-10-05 23:04:20 +03:00) |
| Renderer image digest | `sha256:c2d16ad09077de4317b7f1c25a0c948e4c28209772d7b2f05c976d08827f7fff` |
| TEST DB | Postgres inside `syncbiz-pr52-test` (test secrets stored outside the repo — never here) |

**PROD untouched.** No PROD deploy, DB, WS or installer action in this baseline.

## 4. LENOVO PILOT STATION

| Item | Value | Evidence |
|---|---|---|
| durableDeviceId | `dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f` | server-log corroborated (TEST WS REGISTER) |
| branch | `default` | server-log corroborated |
| workspace | `f2366813-341d-46ba-a6b8-92d2c1fd39b1` | recorded in project notes; not printed in the inspected WS log lines |
| Installed Desktop | `2.2.8-beta.9` | **OWNER-ATTESTED / NOT DIRECTLY VERIFIED FROM THIS MACHINE** |
| Embedded renderer WS id | `ba8ffdba-d00b-468d-bf74-f805013d37ef` (CONTROL) | server-log corroborated (earlier sessions) |

## 5. DESKTOP INSTALLER (ACCEPTED)

| Item | Value |
|---|---|
| Version | `2.2.8-beta.9` |
| Desktop source lineage | `865ba81e5cb83be8493ab7374194aa1d145ea633` |
| Artifact | `SyncBiz-Player-Setup-2.2.8-beta.9-x64.exe` |
| SHA256 | `72744069ad422c45130ddf530880f7e0fdc7b8b071dfd0fbde4693357ce6dc58` |
| Size | 140,768,398 bytes |
| Environment | **TEST-pinned** |
| Signing | unsigned |
| Published | **NO** |
| Accepted copy | `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-accepted\` (+ `SHA256.txt`, `README.txt`; hash verified) |
| Candidate copy (kept) | `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-candidate\` |
| Older rollback artifact | beta.8 — `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\` (see §13) |

**Important:** beta.9 was built from `865ba81` **plus temporary TEST pin edits**, reverted after the
build: `desktop/src/main/hosted-url.ts` → TEST app + TEST WS; `normalizeEndpointsForPackaged` →
force TEST endpoints on every packaged load; `desktop/package.json` version → `2.2.8-beta.9`.
Packaged `app.asar` verified: version beta.9; TEST app/WS are the only executable endpoints (PROD
appears only in a code comment); offline-cache module, offline fallback, Retry fix, MAIN startup
connect and APPLY guard present. **`865ba81` alone cannot reproduce the binary — the artifact hash is
authoritative.** Committed `hosted-url.ts` points at PROD.

## 6. RENDERER

| Item | Value |
|---|---|
| Accepted renderer source | `2ebdbe4b9f2945e91987b2dfb5f61719103a9adf` |
| Railway deployment ID | `673fae24-3105-4360-8c31-88d83f61705f` |
| Deploy method | `railway up` from a **clean** working tree (Railway metadata carries no commit hash) |

**Verification (2026-10-05, read-only, `railway ssh` into the TEST container):** deployed
`components/audio-player.tsx` and `lib/desktop-freeze-self-heal.ts` are byte-identical to `2ebdbe4`
and differ from the previous renderer (`865ba81`/`bfd3a49` lineage); `decideLocalStartupStall` present.
**Confidence:** source verified at file-hash level for the changed files; exact commit-to-deploy
linkage **NOT CRYPTOGRAPHICALLY PROVEN** (no commit hash in Railway metadata).

## 7. RUNTIME ACCEPTED

### ACCEPTED — owner-attested 2026-10-05 (Lenovo, Desktop beta.9 + renderer `2ebdbe4`)
1. LOCAL normal playback works.
2. AUTOMIX natural LOCAL → LOCAL works.
3. Manual NEXT LOCAL → LOCAL crossfade works.
4. SEEK works.
5. Watchdog: closing VONO causes it to return automatically.
6. Windows reboot WITH internet: VONO returns and playback resumes.
7. Windows cold boot WITHOUT internet: VONO starts automatically and LOCAL playback resumes
   automatically without user action.
8. Internet returns after offline cold boot: playback continues smoothly — no stop, restart or track jump.
9. Heavy system load regression: opening Claude on the Lenovo previously caused
   freeze → redispatch → stall timeout → `stop()` → deck/queue clear. After renderer fix `2ebdbe4`,
   repeating the heavy-load scenario did NOT clear the deck, did NOT permanently stop playback,
   and playback continued.

### Earlier acceptance still in force (2026-10-05, beta.8 + `bfd3a49` — see §13)
URL playback, LOCAL ↔ URL handoffs, metadata handoff, localSync flood fix, MAIN WS auto-reconnect,
no reconnect-paced skips / false EOF / stop / restart, URL control after reconnect — owner-attested;
designated MASTER re-registration + renderer CONTROL + no auto-failover — server-log corroborated.

## 8. ROOT CAUSES FIXED (player phase)

### OFFLINE COLD BOOT — FIXED + runtime accepted (owner-attested 2026-10-05)
- **Cause:** the packaged shell always loads the hosted renderer; offline it never loaded, so the
  renderer-owned restore pipeline never ran; MAIN's station WS only connected via the renderer's
  APPLY_DESKTOP_AUTH; the error page's Retry reloaded its own `data:` URL.
- **Fix (`865ba81`, desktop MAIN → beta.9):** same-origin last-known-good renderer cache
  (`desktop/src/main/renderer-offline-cache.ts`; protocol interception only after a network-class
  main-frame failure with a fully valid cache; removed without reload when the network returns) +
  MAIN WS connects at startup with persisted auth (APPLY_DESKTOP_AUTH reconnects only when not already
  registered) + Retry navigates to the hosted URL with a single-timer auto retry.

### STALL / SESSION DESTRUCTION — FIXED + runtime accepted (owner-attested 2026-10-05)
- **Cause:** the LOCAL 4-second startup backstop called `stop()`, which destroyed
  currentSource/playlist/queue and the recovery snapshot (MPV merely slow under machine load).
- **Fix (`2ebdbe4`, renderer):** the backstop now enters the existing bounded startup recovery
  (grace → one retry → SKIP_FORWARD) instead of `stop()`; genuine file errors still fail forward via
  the existing load_error path; crossfade attempts stay owned by the orchestrator.

## 9. PARKED / NON-BLOCKING

Not pilot blockers for the player phase. Do not fix inside unrelated work.
1. **Explicit kill-`mpv.exe` resilience test** — manual destructive test not yet run (code path
   regression-tested: engine-unavailable → bounded startup recovery, never stop).
2. **Missing/corrupt LOCAL file runtime acceptance** — manual test not yet run (code path
   regression-tested: load_error → SKIP_FORWARD, session preserved).
3. **Playback recovery snapshot 24-hour TTL — REAL PILOT FOLLOW-UP.** `RECOVERY_TTL_MS` (24h) in
   `lib/playback-provider.tsx`: a station powered off for more than 24 hours may not auto-resume from
   the current recovery snapshot (applies with or without internet). Record only — fix in a later
   pilot-hardening step.
4. **Mobile TEST login/user issue** — separate authentication/control task, not part of playback acceptance.

Carried over (still open):
- Temporary `[VONO MetaSync]` `console.warn` diagnostics — still present in
  `lib/device-player-context.tsx`. Remove after acceptance (owner-approved temporary).
- `[VONO Shuffle Diag]` `console.log` — still present in `components/audio-player.tsx` (~4395).
- Git stash `pr52-xfade-diag-hold` (`stash@{0}`) — still present; diagnostic only.
- Long-outage / token-expiry endurance test — not yet run.
- URL startup latency (~10–13 s on Lenovo) — owner-reported; reproducibility NOT VERIFIED.
- Reconnect: CONTROL LOCAL title display blank — addressed in `9264bb3`; **NOT runtime-confirmed**.
- Offline cache edge: a TEST deploy during an outage may break lazily-loaded UI pieces of the cached
  build until the next natural restart (playback unaffected) — not runtime-tested.
- SECURITY TODO: a Railway token is stored in plaintext in `.claude/settings.local.json`
  (gitignored, not committed) — rotate the token and remove it, separately.
- Pre-existing desktop `tsconfig.typecheck.json` errors (not the packaging path) — known, untouched.

## 10. DO NOT REGRESS

- permanent designated MASTER (MAIN = MASTER, renderer = CONTROL; no failover, no steal)
- LOCAL playback
- URL playback
- LOCAL -> URL
- URL -> LOCAL
- NEXT
- PREV
- SEEK
- metadata handoff
- localSync idempotency / no flood
- natural EOF
- manual crossfade
- AUTOMIX natural crossfade
- reconnect while LOCAL plays
- no reconnect skips
- no reconnect stop/restart
- watchdog recovery
- restart WITH internet
- **cold boot WITHOUT internet → LOCAL auto-resume (offline renderer cache)**
- **internet return after offline boot → no reload / stop / restart / jump**
- **heavy system load → no deck clear, no permanent stop (stall backstop never calls stop())**
- renderer CONTROL + MAIN MASTER architecture
- no local file paths over WS/HTTP/server/DB/logs

## 11. LAST ACCEPTANCE

- **Date:** 2026-10-05
- **Build under test:** Desktop 2.2.8-beta.9 (TEST-pinned, SHA256 `72744069…6dc58`) + TEST renderer `2ebdbe4`.
- **OWNER-ATTESTED:** §7 items 1–9 — LOCAL playback, AUTOMIX, manual NEXT crossfade, SEEK, watchdog
  return, reboot with internet, offline cold boot auto-resume, smooth internet return, heavy-load
  regression (no deck clear / no permanent stop).
- **SERVER-LOG CORROBORATED (earlier, still in force):** designated MASTER re-registration, renderer
  CONTROL, no auto-failover.
- **Result:** PLAYER PHASE — PILOT ACCEPTED.

## 12. ROLLBACK

| Layer | Reference |
|---|---|
| **Accepted renderer tag** | `pilot-baseline/2026-10-05-renderer-2ebdbe4` → `2ebdbe4b9f2945e91987b2dfb5f61719103a9adf` |
| **Accepted desktop source-lineage tag** | `pilot-baseline/2026-10-05-desktop-beta9-865ba81` → `865ba81e5cb83be8493ab7374194aa1d145ea633` |
| **Accepted installer artifact** | `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-accepted\SyncBiz-Player-Setup-2.2.8-beta.9-x64.exe`, SHA256 `72744069ad422c45130ddf530880f7e0fdc7b8b071dfd0fbde4693357ce6dc58` |
| Railway TEST deployment | `673fae24-3105-4360-8c31-88d83f61705f` (may become non-redeployable once REMOVED — the tag is the fallback) |
| Older rollback (preserved) | tags `pilot-baseline/2026-10-05-renderer-bfd3a49`, `pilot-baseline/2026-10-05-desktop-beta8-9264bb3`; artifact `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\` (SHA256 `349152a9…583ff`) |

All `pilot-baseline/*` tags are annotated and pushed to origin (owner-approved). Never use the
`desktop-v*` prefix (triggers the release workflow).

**WARNING:** desktop source tags do NOT reproduce beta.8/beta.9 exactly by themselves — both used
temporary TEST-pin edits. Restore the Lenovo from the preserved installer binary, verified by hash.

## 13. HISTORY

### Baseline 2026-10-05 (pre-offline-fix) — superseded by the player-phase acceptance above
- Application/renderer baseline `bfd3a49a056b98a7d3daa33cd7aeb6e8ec29a5bb`; docs-only head
  `044219043c76dcfeae33350124b8d7faa4930c89` (constitution + first baseline).
- Desktop `2.2.8-beta.8`, source lineage `9264bb3331c1cd3953689f6fdd32f827332420a8` + temporary
  TEST pins; SHA256 `349152a9d9caa7c81634b2850fa967f2349b0e58eabde1df73e0cc66dfa583ff`,
  140,762,736 bytes, TEST-pinned, unsigned, not published; backup `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\`.
- TEST renderer deployment `25b48cc0-03b1-48a9-a1d7-a099420eeabd` (image
  `sha256:d2a1e1ba5de3bc7ed9e0bcb61e6ef8c014ad0b3be03d0f4268af066f016c74cf`); deployed source
  verified file-hash identical to `bfd3a49` (629 source files + root config files; linkage not
  cryptographically proven).
- Owner-attested at that baseline: LOCAL, URL, LOCAL↔URL, metadata handoff, stale-session fix,
  localSync flood fix, SEEK, manual NEXT crossfade, natural AUTOMIX, MAIN WS auto-reconnect, no
  reconnect skips / false EOF / stop / restart, designated MASTER return, renderer CONTROL, URL
  control after reconnect, watchdog relaunch, reboot with internet.
- Open P0 at that time: **OFFLINE COLD BOOT** (shell showed "Cannot connect to SyncBiz — Could not
  load the SyncBiz web app." on reboot without internet) — later FIXED (§8).

### Offline cold boot fix — test candidate (2026-10-05)
- `865ba81` pushed to PR #52; beta.9 candidate built and preserved at
  `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-candidate\` (NOT accepted at that time; rollback was beta.8).
- Phase 1 proofs (real Electron 34.5.8, TEST): session fetch carries auth context; same-origin
  `protocol.handle` interception keeps origin + localStorage. E2E offline-cache proof PASS.
- Lenovo runtime then found the separate stall/session-destruction P0 → fixed in `2ebdbe4`.
