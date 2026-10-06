# VONO PILOT KNOWN-GOOD BASELINE

> Operational, changeable state. Update after EVERY runtime-accepted blocker (CLAUDE.md §8).
> Permanent rules live in `CLAUDE.md`. No secrets in this file — ever.
> Evidence labels: `ACCEPTED — owner-attested <date>` (Dotan on the Lenovo; not independently
> inspected by Claude) vs `ACCEPTED — server-log corroborated` (TEST WS/server logs).
> Earlier baselines are kept verbatim-in-substance in §13 HISTORY — never delete history.

## 1. STATUS

- **Date:** 2026-10-05 (jingles acceptance recorded 2026-10-06 UTC+3 night)
- **Phase:** PILOT HARDENING
  - **PLAYER PHASE: PILOT ACCEPTED** (owner-attested 2026-10-05)
  - **JINGLES / ANNOUNCEMENTS: PILOT ACCEPTED** (owner-attested 2026-10-05)
- **Current active P0:** none. Next phase: Control Room / branch management.
- **PR #52:** OPEN — **NOT MERGED / DO NOT MERGE** without explicit approval
- **PROD:** UNTOUCHED
- **Written from:** Dev-PC (`dsk-9b11bfa1-a353-4abb-859c-2351cf1d0608`) — no direct Lenovo log access.

## 2. GIT

| Item | Value |
|---|---|
| Repository | `D:\APP Project\syncbiz-app` |
| Branch | `fix/local-playback-designated-master-prb` |
| PR | #52 — OPEN / NOT MERGED |
| **CURRENT PR HEAD** | the **docs-only** commit `docs(pilot): accept Jingles and beta.10 runtime baseline`, whose parent is `cd4c631`. A commit cannot contain its own SHA — read it with `git rev-parse origin/fix/local-playback-designated-master-prb`. |
| **RENDERER + MAIN APPLICATION BASELINE** | `cd4c631fc90570f062040def825f0c91bcff5bc3` — accepted application/runtime source (player phase `2ebdbe4` + jingles P0) |
| **DESKTOP beta.10 SOURCE LINEAGE** | `cd4c631fc90570f062040def825f0c91bcff5bc3` + documented temporary TEST build pins (see §5) |
| **DESKTOP AUTHORITATIVE ARTIFACT** | `2.2.8-beta.10`, SHA256 `0e292ec190f587dca920f4f0d00a50fe67cfbb934f21c8aaf377bc3c4b23f9b0` |
| main / PR base | `951a44cd99f39d921e217d246f6422b49cee2941` (verified after fresh fetch) |
| Working tree when written | clean at `cd4c631` (before this docs-only commit) |
| Stash present | `stash@{0}` = `pr52-xfade-diag-hold` (temporary diagnostic, see §9) |

Meaning: `cd4c631` is the exact application/runtime source accepted for the pilot (renderer AND desktop
MAIN). Everything above it is **documentation only**. **No application source changed after `cd4c631`.**
Verify with `git diff --stat cd4c631..origin/fix/local-playback-designated-master-prb`.
Lineage: `865ba81` (offline cold boot, MAIN) → `2ebdbe4` (renderer stall fix) → `17a1b84` (docs) →
`cd4c631` (jingles: MAIN PLAY_INTERRUPT + Preview safety).

## 3. TEST ENVIRONMENT

| Item | Value |
|---|---|
| Railway project | `syncbiz-pr52-test` |
| Renderer (app) | https://syncbiz-app-test-production.up.railway.app (HTTP 200; `/api/health` status ok, database ok, yt-dlp ok) |
| WS | wss://syncbiz-ws-test-production.up.railway.app |
| Renderer Railway deployment ID | `b591c130-4112-433a-a928-6f0f424a5dce` (SUCCESS, 2026-10-06 00:26:49 +03:00) |
| Renderer image digest | `sha256:4b1e5ef4414f399869f1e72b2002ea09dad63eaa6992bee6f7b3c2f75cad4b11` |
| TEST DB | Postgres inside `syncbiz-pr52-test` (test secrets stored outside the repo — never here) |
| **ElevenLabs** | `ELEVENLABS_API_KEY` configured on `syncbiz-app-test` by the owner (verified by NAME only; value never read) |
| **App volume** | `syncbiz-app-test-volume` (id `4272e7c6-1518-436d-9da0-1fe1c7c5e54f`) attached to `syncbiz-app-test` only, mount path **`/data`**; Railway exposes `RAILWAY_VOLUME_MOUNT_PATH=/data` |
| **Jingle storage** | generated MP3s under **`/data/jingles/<uuid>.mp3`**, served at `/api/jingles/audio/<uuid>` |

**PROD untouched.** No PROD deploy, DB, WS, variable, volume or installer action in this baseline.

## 4. LENOVO PILOT STATION

| Item | Value | Evidence |
|---|---|---|
| durableDeviceId | `dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f` | server-log corroborated (TEST WS REGISTER) |
| branch | `default` | server-log corroborated |
| workspace (TEST) | `31d30e23-8f4a-4bf2-a1df-c707b69b5673` | verified 2026-10-06 from the TEST DB (`BranchMasterDesignation`) + TEST WS designation file (`ws:31d30e23-…:default`) |
| workspace (PROD — not this pilot env) | `f2366813-341d-46ba-a6b8-92d2c1fd39b1` | PROD designation of the same Lenovo (2026-10-02); earlier versions of this file wrongly listed it as the TEST workspace — corrected 2026-10-06 |
| Installed Desktop | `2.2.8-beta.10` | **OWNER-ATTESTED / NOT DIRECTLY VERIFIED FROM THIS MACHINE** |
| Embedded renderer WS id | `ba8ffdba-d00b-468d-bf74-f805013d37ef` (CONTROL) | server-log corroborated (earlier sessions) |

## 5. DESKTOP INSTALLER (ACCEPTED)

| Item | Value |
|---|---|
| Version | `2.2.8-beta.10` |
| Desktop source lineage | `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| Artifact | `SyncBiz-Player-Setup-2.2.8-beta.10-x64.exe` |
| SHA256 | `0e292ec190f587dca920f4f0d00a50fe67cfbb934f21c8aaf377bc3c4b23f9b0` |
| Size | 140,769,315 bytes |
| Environment | **TEST-pinned** |
| Signing | unsigned |
| Published | **NO** |
| Accepted copy | `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-accepted\` (+ `SHA256.txt`, `README.txt`; hash verified) |
| Candidate copy (kept) | `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-candidate\` |
| Older rollback artifacts | beta.9 — `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-accepted\`; beta.8 — `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\` (see §13) |

**Important:** beta.10 was built from `cd4c631` **plus temporary TEST pin edits**, reverted after the
build: `desktop/src/main/hosted-url.ts` → TEST app + TEST WS; `normalizeEndpointsForPackaged` → force
TEST endpoints on every packaged load; `desktop/package.json` version → `2.2.8-beta.10`.
Packaged `app.asar` verified: version beta.10; TEST app/WS only (0 PROD hosts on executable lines);
`case "PLAY_INTERRUPT"` + `resolveInterruptUrl` compiled; beta.9 offline renderer cache present.
**`cd4c631` alone cannot reproduce the binary — the artifact hash is authoritative.** Committed
`hosted-url.ts` points at PROD.

## 6. RENDERER

| Item | Value |
|---|---|
| Accepted renderer source | `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| Railway deployment ID | `b591c130-4112-433a-a928-6f0f424a5dce` |
| Deploy method | `railway up` from a **clean** working tree (Railway metadata carries no commit hash) |

**Verification (2026-10-06, read-only, `railway ssh` into the TEST container):** deployed
`components/jingles-control/JinglesShell.tsx` byte-identical to `cd4c631`; `components/audio-player.tsx`
unchanged since `2ebdbe4` (byte-identical). Jingle MP3s on `/data` survived this redeploy.
**Confidence:** source verified at file-hash level for the changed files; exact commit-to-deploy linkage
**NOT CRYPTOGRAPHICALLY PROVEN** (no commit hash in Railway metadata).

## 7. RUNTIME ACCEPTED

### JINGLES / ANNOUNCEMENTS — ACCEPTED — owner-attested 2026-10-05 (Lenovo beta.10 + TEST renderer `cd4c631`)
- Announcement Generate works in TEST.
- Generated MP3 is persisted on the Railway volume.
- On-Air from CONTROL reaches the designated Lenovo MASTER.
- Music ducks.
- Announcement plays.
- Music resumes automatically.
- LOCAL queue/session remains intact.
- Preview cannot broadcast accidentally.

### JINGLES — independently verified by Claude (TEST server, 2026-10-06)
- One TEST generate via the real API (owner-signed-in throwaway profile): HTTP 200, `audio/mpeg`, valid
  MP3 (35,152 B); file present at `/data/jingles/91361cb7-e1cf-48e4-8db8-6d542d34f516.mp3`; survived a
  container restart (PID 1 restarted after the file was written) and the later `b591c130` redeploy.

### PLAYER PHASE — ACCEPTED — owner-attested 2026-10-05 (beta.9 + renderer `2ebdbe4`, still in force)
1. LOCAL normal playback works.
2. AUTOMIX natural LOCAL → LOCAL works.
3. Manual NEXT LOCAL → LOCAL crossfade works.
4. SEEK works.
5. Watchdog: closing VONO causes it to return automatically.
6. Windows reboot WITH internet: VONO returns and playback resumes.
7. Windows cold boot WITHOUT internet: VONO starts automatically and LOCAL playback resumes
   automatically without user action.
8. Internet returns after offline cold boot: playback continues smoothly — no stop, restart or track jump.
9. Heavy system load: no deck clear, no permanent stop; playback continued.

### Earlier acceptance still in force (2026-10-05, beta.8 + `bfd3a49` — see §13)
URL playback, LOCAL ↔ URL handoffs, metadata handoff, localSync flood fix, MAIN WS auto-reconnect,
no reconnect-paced skips / false EOF / stop / restart, URL control after reconnect — owner-attested;
designated MASTER re-registration + renderer CONTROL + no auto-failover — server-log corroborated.

## 8. ROOT CAUSES FIXED

### JINGLES / ANNOUNCEMENTS — FIXED + runtime accepted (owner-attested 2026-10-05)
- **Generate failed on TEST:** `ELEVENLABS_API_KEY` missing on `syncbiz-app-test` (route returned 503
  before any TTS) → configured by the owner. No persistent app volume (files lost on redeploy) → `/data`
  volume attached; files now under `/data/jingles`.
- **On-Air never reached the designated station:** since PR #50 the branch MASTER is Electron MAIN, and
  MAIN's `routeToOrchestrator` dropped `PLAY_INTERRUPT` (`default: break`). **Fix (`cd4c631`, desktop
  MAIN → beta.10):** additive `case "PLAY_INTERRUPT"` → `interruptUrlsForPayload` / `resolveInterruptUrl`
  (relative server paths resolve against the configured app origin; https kept; local / UNC / `file:` /
  `local://` / other schemes rejected; optional pre-roll bell) → existing `orchestrator.playInterrupt`
  (duck → play once → restore). No orchestrator / music channel / session / designation change.
- **Desktop "Preview" was actually On-Air:** **Fix (`cd4c631`, renderer):** Preview separated from
  On-Air. Browser/mobile Preview is local-only (unchanged). In the Electron app (Chromium audio muted)
  Preview is disabled/unavailable with a clear tooltip instead of broadcasting. On-Air is an explicit
  separate `📡 On-Air` button that routes to the designated MASTER.

### OFFLINE COLD BOOT — FIXED + runtime accepted (owner-attested 2026-10-05)
- **Cause:** hosted renderer unavailable offline → renderer-owned restore never ran; MAIN station WS
  depended on the renderer; dead Retry.
- **Fix (`865ba81`):** same-origin last-known-good renderer cache + MAIN WS startup connect + Retry fix.

### STALL / SESSION DESTRUCTION — FIXED + runtime accepted (owner-attested 2026-10-05)
- **Cause:** LOCAL 4-second startup backstop called `stop()` → destroyed source/playlist/queue + recovery snapshot.
- **Fix (`2ebdbe4`):** backstop enters the existing bounded startup recovery instead of `stop()`.

## 9. PARKED / NON-BLOCKING

Not pilot blockers. Do not fix inside unrelated work.
1. **Jingle schedules are still localStorage-only** (`components/jingles-control/schedule-storage.ts` +
   `JingleScheduleAutoPlayer`): each device fires only its own schedules while that client is open.
   **Must move to a central/server-side model during Control Room.**
2. **Multi-branch broadcast not implemented yet** (server fan-out to several rooms + delivery/ack).
3. **Mobile TEST login/user issue** — separate authentication/control task.
4. **Playback recovery snapshot 24-hour TTL — REAL PILOT FOLLOW-UP.** `RECOVERY_TTL_MS` (24h) in
   `lib/playback-provider.tsx`: a station powered off >24h may not auto-resume. Record only.
5. **Explicit kill-`mpv.exe` resilience test** — manual destructive test not yet run (code path regression-tested).
6. **Missing/corrupt LOCAL file runtime acceptance** — manual test not yet run (code path regression-tested).

Carried over (still open):
- Jingle library/pads still use `branchId:"default"`; no link to `MediaAsset`; generated-but-unsaved MP3s
  are never cleaned up; `/api/jingles/audio/<id>` is unauthenticated (UUID-only).
- Desktop app has no local Preview engine yet (Preview unavailable there by design for now).
- Temporary `[VONO MetaSync]` `console.warn` diagnostics — still present in `lib/device-player-context.tsx`.
- `[VONO Shuffle Diag]` `console.log` — still present in `components/audio-player.tsx` (~4395).
- Git stash `pr52-xfade-diag-hold` (`stash@{0}`) — still present; diagnostic only.
- Long-outage / token-expiry endurance test — not yet run.
- URL startup latency (~10–13 s on Lenovo) — owner-reported; reproducibility NOT VERIFIED.
- Reconnect: CONTROL LOCAL title display blank — addressed in `9264bb3`; **NOT runtime-confirmed**.
- Offline cache edge: a TEST deploy during an outage may break lazily-loaded UI pieces until restart.
- Offline station cannot play hosted jingle MP3s (no local jingle cache yet).
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
- cold boot WITHOUT internet → LOCAL auto-resume (offline renderer cache)
- internet return after offline boot → no reload / stop / restart / jump
- heavy system load → no deck clear, no permanent stop (stall backstop never calls stop())
- **On-Air jingle from any CONTROL → designated MAIN: duck → play → resume; LOCAL queue/session intact**
- **Preview never emits PLAY_INTERRUPT (browser/mobile local; desktop Preview unavailable)**
- **jingle MP3s persisted on the TEST `/data` volume**
- renderer CONTROL + MAIN MASTER architecture
- no local file paths over WS/HTTP/server/DB/logs (PLAY_INTERRUPT rejects local paths)

## 11. LAST ACCEPTANCE

- **Date:** 2026-10-05
- **Build under test:** Desktop 2.2.8-beta.10 (TEST-pinned, SHA256 `0e292ec1…f9b0`) + TEST renderer `cd4c631`.
- **OWNER-ATTESTED:** §7 jingles list — Generate in TEST, MP3 persisted, On-Air from CONTROL reaches the
  designated Lenovo MASTER, music ducks, announcement plays, music resumes, LOCAL queue/session intact,
  Preview cannot broadcast.
- **CLAUDE-VERIFIED (TEST server):** one real generate → MP3 on `/data/jingles`, survives restart/redeploy.
- **Result:** JINGLES / ANNOUNCEMENTS — PILOT ACCEPTED (player phase acceptance remains in force).

## 12. ROLLBACK

| Layer | Reference |
|---|---|
| **Accepted renderer tag** | `pilot-baseline/2026-10-05-renderer-cd4c631` → `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| **Accepted desktop source-lineage tag** | `pilot-baseline/2026-10-05-desktop-beta10-cd4c631` → `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| **Accepted installer artifact** | `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-accepted\SyncBiz-Player-Setup-2.2.8-beta.10-x64.exe`, SHA256 `0e292ec190f587dca920f4f0d00a50fe67cfbb934f21c8aaf377bc3c4b23f9b0` |
| Railway TEST deployment | `b591c130-4112-433a-a928-6f0f424a5dce` (may become non-redeployable once REMOVED — the tag is the fallback) |
| Older rollback (preserved) | player phase: tags `pilot-baseline/2026-10-05-renderer-2ebdbe4`, `pilot-baseline/2026-10-05-desktop-beta9-865ba81`; artifact `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-accepted\` (SHA256 `72744069…6dc58`). Pre-offline: tags `…renderer-bfd3a49`, `…desktop-beta8-9264bb3`; artifact `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\` (SHA256 `349152a9…583ff`) |

All `pilot-baseline/*` tags are annotated and pushed to origin (owner-approved). Never use the
`desktop-v*` prefix (triggers the release workflow).

**WARNING:** desktop source tags do NOT reproduce beta.8/beta.9/beta.10 exactly by themselves — all used
temporary TEST-pin edits. Restore the Lenovo from the preserved installer binary, verified by hash.
Rolling the renderer back below `cd4c631` while beta.10 is installed is safe (MAIN PLAY_INTERRUPT is
additive); rolling the desktop back to beta.9 loses MAIN On-Air jingles.

## 13. HISTORY

### Player phase acceptance (2026-10-05) — superseded as "current" by the jingles acceptance above
- Renderer application baseline `2ebdbe4b9f2945e91987b2dfb5f61719103a9adf` (LOCAL startup-stall fix);
  docs-only head `17a1b849e7005f99e51269db5a0d42689ab8acc0`.
- Desktop `2.2.8-beta.9`, source lineage `865ba81e5cb83be8493ab7374194aa1d145ea633` + temporary TEST
  pins; SHA256 `72744069ad422c45130ddf530880f7e0fdc7b8b071dfd0fbde4693357ce6dc58`, 140,768,398 bytes,
  TEST-pinned, unsigned, not published; accepted backup `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-accepted\`
  (candidate copy `…-beta9-candidate\`).
- TEST renderer deployment `673fae24-3105-4360-8c31-88d83f61705f` (image
  `sha256:c2d16ad09077de4317b7f1c25a0c948e4c28209772d7b2f05c976d08827f7fff`); deployed
  `audio-player.tsx` + `desktop-freeze-self-heal.ts` file-hash identical to `2ebdbe4`.
- Owner-attested: §7 PLAYER PHASE items 1–9. Tags `pilot-baseline/2026-10-05-renderer-2ebdbe4`,
  `pilot-baseline/2026-10-05-desktop-beta9-865ba81`.

### Baseline 2026-10-05 (pre-offline-fix)
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
- Open P0 at that time: **OFFLINE COLD BOOT** — later FIXED (§8).

### Offline cold boot fix — test candidate (2026-10-05)
- `865ba81` pushed to PR #52; beta.9 candidate built and preserved at
  `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-candidate\` (NOT accepted at that time; rollback was beta.8).
- Phase 1 proofs (real Electron 34.5.8, TEST): session fetch carries auth context; same-origin
  `protocol.handle` interception keeps origin + localStorage. E2E offline-cache proof PASS.
- Lenovo runtime then found the separate stall/session-destruction P0 → fixed in `2ebdbe4`.

### Jingles P0 — test candidate (2026-10-06)
- Audit: Generate failed on TEST (missing `ELEVENLABS_API_KEY`); no app volume; MAIN dropped
  `PLAY_INTERRUPT`; desktop Preview was On-Air; schedules localStorage-only (parked).
- TEST config: key added by the owner; `/data` volume attached; one real generate verified.
- `cd4c631` pushed; beta.10 candidate preserved at `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-candidate\`;
  then owner-accepted on the Lenovo (§7).
